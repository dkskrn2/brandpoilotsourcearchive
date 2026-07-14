import crypto from "node:crypto";
import { curateKnowledge, type CuratedKnowledgeUnit } from "./knowledgeCurator.js";
import { normalizeKnowledgeSource } from "./knowledgeNormalizer.js";

const chunkSize = 800;
const overlap = 120;

export type WikiSourceKind = "faq" | "product" | "policy" | "owned_snapshot";

export interface ClaimedWikiBuildItem {
  id: string;
  workspace_id: string;
  brand_id: string;
  wiki_version_id: string;
  source_kind: WikiSourceKind;
  source_id: string;
}

export interface WikiBuildSource {
  source_kind: WikiSourceKind;
  source_id: string;
  title: string;
  content: string;
  content_hash: string;
  aliases: string[];
  keywords: string[];
  structured_data: Record<string, string | number | null>;
  source_url: string | null;
}

export interface WikiBuildChunk {
  chunk_index: number;
  unit_type: CuratedKnowledgeUnit["unitType"];
  content: string;
  content_hash: string;
  embedding: string;
  embedding_model: string;
  embedding_version: string;
}

export interface WikiBuildDocument {
  wiki_version_id: string;
  source_kind: WikiSourceKind;
  source_id: string;
  title: string;
  content: string;
  content_hash: string;
  is_active: false;
  normalized_json: { units: CuratedKnowledgeUnit[] };
  source_url: string | null;
  chunks: WikiBuildChunk[];
}

interface ExistingEmbedding {
  content_hash: string;
  embedding: string;
  embedding_model: string;
  embedding_version: string;
  curator_prompt_version: string;
}

export interface WikiBuildDb {
  claimWikiBuildItem(workerId: string, versions: {
    curatorPromptVersion: string;
    embeddingModel: string;
    embeddingVersion: string;
  }): Promise<ClaimedWikiBuildItem | null>;
  getWikiBuildSource(item: ClaimedWikiBuildItem): Promise<WikiBuildSource>;
  getExistingEmbeddings(brandId: string, contentHashes: string[]): Promise<ExistingEmbedding[]>;
  completeWikiBuildItem(item: ClaimedWikiBuildItem, document: WikiBuildDocument | null): Promise<{ activated: boolean }>;
  failWikiBuildItem(item: ClaimedWikiBuildItem, error: string): Promise<void>;
}

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function directUnit(source: WikiBuildSource): CuratedKnowledgeUnit {
  return {
    unitType: source.source_kind as "faq" | "product" | "policy",
    title: source.title,
    content: source.content,
    keywords: source.keywords,
    aliases: source.aliases,
    sourceQuote: source.content,
    validFrom: null,
    validUntil: null,
    structuredData: source.structured_data,
  };
}

function unitContents(unit: CuratedKnowledgeUnit) {
  if (unit.unitType !== "guide_section" || unit.content.length <= chunkSize) return [unit.content.trim()];
  const chunks: string[] = [];
  for (let start = 0; start < unit.content.length;) {
    const end = Math.min(unit.content.length, start + chunkSize);
    const content = unit.content.slice(start, end).trim();
    if (content) chunks.push(content);
    if (end === unit.content.length) break;
    start = end - overlap;
  }
  return chunks;
}

function embeddingKey(
  contentHash: string,
  embeddingModel: string,
  embeddingVersion: string,
  curatorPromptVersion: string,
) {
  return [contentHash, embeddingModel, embeddingVersion, curatorPromptVersion].join("\u0000");
}

export async function runWikiBuildItemOnce({
  workerId,
  db,
  embed,
  apiKey,
  embeddingModel = "text-embedding-3-small",
  embeddingVersion = "v1",
  curatorPromptVersion = "v1",
  runtimeDirectory,
  curatorTimeoutMs = 30_000,
  runCodex,
}: {
  workerId: string;
  db: WikiBuildDb;
  embed: (input: { text: string; apiKey: string; model: string }) => Promise<number[]>;
  apiKey: string;
  embeddingModel?: string;
  embeddingVersion?: string;
  curatorPromptVersion?: string;
  runtimeDirectory: string;
  curatorTimeoutMs?: number;
  runCodex: (input: { prompt: string; runtimeDirectory: string; timeoutMs: number }) => Promise<unknown>;
}) {
  const item = await db.claimWikiBuildItem(workerId, {
    curatorPromptVersion,
    embeddingModel,
    embeddingVersion,
  });
  if (!item) return { status: "idle" as const };

  try {
    const source = await db.getWikiBuildSource(item);
    let content = source.content;
    let units: CuratedKnowledgeUnit[];
    if (source.source_kind === "owned_snapshot") {
      const normalized = normalizeKnowledgeSource(source.content);
      if (!normalized) {
        const completion = await db.completeWikiBuildItem(item, null);
        return { status: "completed" as const, itemId: item.id, chunkCount: 0, activated: completion.activated };
      }
      content = normalized;
      units = await curateKnowledge({
        normalizedSource: normalized,
        sourceTitle: source.title,
        sourceStructuredData: source.structured_data,
        runtimeDirectory,
        timeoutMs: curatorTimeoutMs,
        runCodex,
      });
    } else {
      units = [directUnit(source)];
    }

    const chunkInputs = units.flatMap((unit) => unitContents(unit).map((chunkContent) => ({
      unit_type: unit.unitType,
      content: chunkContent,
      content_hash: hash(chunkContent),
    })));
    const existing = await db.getExistingEmbeddings(item.brand_id, chunkInputs.map((chunk) => chunk.content_hash));
    const reusable = new Map(existing.map((embedding) => [
      embeddingKey(
        embedding.content_hash,
        embedding.embedding_model,
        embedding.embedding_version,
        embedding.curator_prompt_version,
      ),
      embedding.embedding,
    ]));
    const chunks: WikiBuildChunk[] = [];
    for (const [chunkIndex, chunk] of chunkInputs.entries()) {
      const key = embeddingKey(chunk.content_hash, embeddingModel, embeddingVersion, curatorPromptVersion);
      const reused = reusable.get(key);
      const embedding = reused ?? `[${(await embed({ text: chunk.content, apiKey, model: embeddingModel })).join(",")}]`;
      chunks.push({
        ...chunk,
        chunk_index: chunkIndex,
        embedding,
        embedding_model: embeddingModel,
        embedding_version: embeddingVersion,
      });
    }

    const document: WikiBuildDocument = {
      wiki_version_id: item.wiki_version_id,
      source_kind: source.source_kind,
      source_id: source.source_id,
      title: source.title,
      content,
      content_hash: source.source_kind === "owned_snapshot" ? hash(content) : source.content_hash,
      is_active: false,
      normalized_json: { units },
      source_url: source.source_url,
      chunks,
    };
    const completion = await db.completeWikiBuildItem(item, document);
    return {
      status: "completed" as const,
      itemId: item.id,
      chunkCount: chunks.length,
      activated: completion.activated,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "wiki_build_item_failed";
    await db.failWikiBuildItem(item, message);
    return { status: "failed" as const, itemId: item.id };
  }
}
