import crypto from "node:crypto";
import { createEmbedding } from "./embeddings.js";
import { buildBrandCore, type WikiPageType } from "./wikiCompiler.js";

export interface ClaimedWikiValidationItem {
  id: string;
  workspaceId: string;
  brandId: string;
  wikiVersionId: string;
  leaseToken: string;
}

export interface WikiPageForFinalization {
  id: string;
  pageType: WikiPageType;
  stableKey: string;
  title: string;
  summary: string;
  contentMarkdown: string;
  contentHash: string;
  promptVersion: string;
  brandCoreEligible?: boolean;
}

export interface FinalizedWikiChunk {
  pageId: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  embedding: number[];
  embeddingModel: string;
  embeddingVersion: string;
}

export interface CompiledWikiFinalizeDb {
  claimWikiValidationItem(workerId: string): Promise<ClaimedWikiValidationItem | null>;
  getWikiPagesForFinalization(item: ClaimedWikiValidationItem): Promise<WikiPageForFinalization[]>;
  getReusablePageEmbeddings(
    brandId: string,
    contentHashes: string[],
    embeddingModel: string,
    embeddingVersion: string,
    promptVersion: string,
  ): Promise<Array<{ contentHash: string; embedding: number[] }>>;
  completeWikiValidationItem(
    item: ClaimedWikiValidationItem,
    chunks: FinalizedWikiChunk[],
    brandCore: string,
  ): Promise<void>;
  failWikiValidationItem(item: ClaimedWikiValidationItem, error: string): Promise<void>;
}

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function chunkCompiledWikiPage(page: WikiPageForFinalization) {
  const text = page.contentMarkdown.trim();
  if (!text) throw new Error("wiki_page_content_missing");
  if (page.pageType !== "guide" || text.length <= 800) {
    return [{ pageId: page.id, chunkIndex: 0, content: text, contentHash: hash(text) }];
  }
  const chunks: Array<{ pageId: string; chunkIndex: number; content: string; contentHash: string }> = [];
  let start = 0;
  while (start < text.length) {
    const content = text.slice(start, start + 800).trim();
    if (content) chunks.push({
      pageId: page.id,
      chunkIndex: chunks.length,
      content,
      contentHash: hash(content),
    });
    if (start + 800 >= text.length) break;
    start += 680;
  }
  return chunks;
}

function compiledBrandCore(pages: WikiPageForFinalization[]) {
  const overview = pages.find((page) => page.pageType === "brand_overview");
  const offerings = pages
    .filter((page) => (page.pageType === "product" || page.pageType === "service")
      && page.brandCoreEligible !== false)
    .sort((left, right) => left.stableKey.localeCompare(right.stableKey))
    .map((page) => `${page.title}: ${page.summary}`);
  return buildBrandCore({
    overviewSummary: overview?.summary ?? "",
    catalogItems: offerings,
  });
}

export async function runWikiFinalizeOnce(input: {
  workerId: string;
  db: CompiledWikiFinalizeDb;
  apiKey: string;
  embeddingModel: string;
  embeddingVersion: string;
  embed?: typeof createEmbedding;
}) {
  const item = await input.db.claimWikiValidationItem(input.workerId);
  if (!item) return { status: "idle" as const };
  try {
    const pages = await input.db.getWikiPagesForFinalization(item);
    if (!pages.length) throw new Error("wiki_pages_missing");
    const pending = pages.flatMap(chunkCompiledWikiPage);
    const reusable = await input.db.getReusablePageEmbeddings(
      item.brandId,
      pending.map((chunk) => chunk.contentHash),
      input.embeddingModel,
      input.embeddingVersion,
      pages[0]?.promptVersion ?? "v1",
    );
    const reuseByHash = new Map(reusable.map((entry) => [entry.contentHash, entry.embedding]));
    const embed = input.embed ?? createEmbedding;
    const chunks: FinalizedWikiChunk[] = [];
    for (const chunk of pending) {
      const embedding = reuseByHash.get(chunk.contentHash) ?? await embed({
        text: chunk.content,
        apiKey: input.apiKey,
        model: input.embeddingModel,
      });
      chunks.push({
        ...chunk,
        embedding,
        embeddingModel: input.embeddingModel,
        embeddingVersion: input.embeddingVersion,
      });
    }
    await input.db.completeWikiValidationItem(item, chunks, compiledBrandCore(pages));
    return { status: "ready" as const, itemId: item.id, chunkCount: chunks.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "wiki_validation_failed";
    await input.db.failWikiValidationItem(item, message);
    return { status: "failed" as const, itemId: item.id };
  }
}
