import { createHash } from "node:crypto";

const chunkLength = 800;
const chunkOverlap = 120;

export interface WikiFaqEntry {
  id: string;
  question: string;
  answer: string;
  enabled: boolean;
}

export interface WikiSourceSnapshot {
  id: string;
  sourceUrlId: string;
  sourceType: "owned" | "reference";
  status: "succeeded" | "failed";
  title: string | null;
  content: string | null;
  fetchedAt: string;
}

export interface WikiChunk {
  sourceKind: "faq" | "owned_snapshot";
  sourceId: string;
  title: string | null;
  chunkIndex: number;
  content: string;
  contentHash: string;
}

export interface WikiDocument {
  sourceKind: WikiChunk["sourceKind"];
  sourceId: string;
  title: string | null;
  content: string;
  contentHash: string;
  chunks: WikiChunk[];
}

function contentHash(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function splitIntoChunks(content: string) {
  const normalized = content.trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  for (let start = 0; start < normalized.length; start += chunkLength - chunkOverlap) {
    chunks.push(normalized.slice(start, start + chunkLength));
    if (start + chunkLength >= normalized.length) break;
  }
  return chunks;
}

function latestOwnedSnapshots(snapshots: WikiSourceSnapshot[]) {
  const bySource = new Map<string, WikiSourceSnapshot>();
  for (const snapshot of snapshots) {
    if (snapshot.sourceType !== "owned" || snapshot.status !== "succeeded" || !snapshot.content?.trim()) continue;
    const previous = bySource.get(snapshot.sourceUrlId);
    if (!previous || new Date(snapshot.fetchedAt).getTime() > new Date(previous.fetchedAt).getTime()) {
      bySource.set(snapshot.sourceUrlId, snapshot);
    }
  }
  return [...bySource.values()].sort((left, right) => left.sourceUrlId.localeCompare(right.sourceUrlId));
}

export function buildWikiDocuments(input: {
  faqEntries: WikiFaqEntry[];
  sourceSnapshots: WikiSourceSnapshot[];
}): WikiDocument[] {
  const documents = [
    ...input.faqEntries
      .filter((entry) => entry.enabled && entry.question.trim() && entry.answer.trim())
      .map((entry) => ({
        sourceKind: "faq" as const,
        sourceId: entry.id,
        title: entry.question.trim(),
        content: `질문: ${entry.question.trim()}\n\n답변: ${entry.answer.trim()}`,
      })),
    ...latestOwnedSnapshots(input.sourceSnapshots).map((snapshot) => ({
      sourceKind: "owned_snapshot" as const,
      sourceId: snapshot.id,
      title: snapshot.title,
      content: snapshot.content!.trim(),
    })),
  ];

  return documents.map((document) => ({
    ...document,
    contentHash: contentHash(document.content),
    chunks: splitIntoChunks(document.content).map((content, chunkIndex) => ({
      sourceKind: document.sourceKind,
      sourceId: document.sourceId,
      title: document.title,
      chunkIndex,
      content,
      contentHash: contentHash(content),
    })),
  }));
}

export function buildWikiChunks(input: Parameters<typeof buildWikiDocuments>[0]): WikiChunk[] {
  return buildWikiDocuments(input).flatMap((document) => document.chunks);
}
