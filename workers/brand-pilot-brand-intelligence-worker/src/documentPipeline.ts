import { createHash } from "node:crypto";
import type { BrandEvidenceDocument } from "./contracts.js";
import {
  MAX_EVIDENCE_CHARACTERS,
  MAX_SEGMENT_CHARACTERS,
  MAX_SOURCE_CHARACTERS,
} from "./limits.js";

export interface EvidenceSegment {
  id: string;
  sourceId: string;
  sourceUrl: string | null;
  heading: string | null;
  text: string;
}

export interface EvidenceBatch {
  batchIndex: number;
  characterCount: number;
  segments: EvidenceSegment[];
}

function splitBounded(value: string): string[] {
  const paragraphs = value.normalize("NFKC").split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const normalized = paragraph.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    for (let offset = 0; offset < normalized.length; offset += MAX_SEGMENT_CHARACTERS) {
      const piece = normalized.slice(offset, offset + MAX_SEGMENT_CHARACTERS);
      if (current && current.length + 1 + piece.length > MAX_SEGMENT_CHARACTERS) {
        chunks.push(current);
        current = "";
      }
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function buildEvidenceBatches(documents: BrandEvidenceDocument[]): {
  segments: EvidenceSegment[];
  batches: [EvidenceBatch, EvidenceBatch, EvidenceBatch, EvidenceBatch];
  characterCount: number;
} {
  const segments: EvidenceSegment[] = [];
  let total = 0;
  outer: for (const document of documents) {
    let sourceCharacters = 0;
    const blocks = [
      ...document.textBlocks.map((block) => ({
        heading: block.heading,
        text: block.text,
      })),
      ...document.tables.map((table) => ({
        heading: table.sheet,
        text: [
          table.headers.join("\t"),
          ...table.rows.map((row) => row.join("\t")),
        ].join("\n"),
      })),
    ];
    for (const block of blocks) {
      for (const chunk of splitBounded(block.text)) {
        const remainingSource = MAX_SOURCE_CHARACTERS - sourceCharacters;
        const remainingTotal = MAX_EVIDENCE_CHARACTERS - total;
        const text = chunk.slice(0, Math.min(remainingSource, remainingTotal));
        if (!text) {
          if (remainingTotal <= 0) break outer;
          break;
        }
        const ordinal = segments.filter(({ sourceId }) => sourceId === document.sourceId).length;
        segments.push({
          id: `segment-${createHash("sha256")
            .update(`${document.sourceId}\0${ordinal}\0${text}`)
            .digest("hex")
            .slice(0, 24)}`,
          sourceId: document.sourceId,
          sourceUrl: document.sourceUrl,
          heading: block.heading,
          text,
        });
        sourceCharacters += text.length;
        total += text.length;
        if (sourceCharacters >= MAX_SOURCE_CHARACTERS) break;
        if (total >= MAX_EVIDENCE_CHARACTERS) break outer;
      }
      if (sourceCharacters >= MAX_SOURCE_CHARACTERS) break;
    }
  }

  const batches = Array.from({ length: 4 }, (_, batchIndex): EvidenceBatch => ({
    batchIndex,
    characterCount: 0,
    segments: [],
  })) as [EvidenceBatch, EvidenceBatch, EvidenceBatch, EvidenceBatch];
  for (const segment of segments) {
    const target = batches
      .filter((batch) => batch.characterCount + segment.text.length <= 100_000)
      .sort((left, right) => left.characterCount - right.characterCount)[0];
    if (!target) break;
    target.segments.push(segment);
    target.characterCount += segment.text.length;
  }
  return {
    segments: batches.flatMap((batch) => batch.segments),
    batches,
    characterCount: batches.reduce((sum, batch) => sum + batch.characterCount, 0),
  };
}
