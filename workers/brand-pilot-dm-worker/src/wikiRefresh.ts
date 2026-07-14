import crypto from "node:crypto";

const chunkSize = 800;
const overlap = 120;

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function chunk(content: string) {
  const result: Array<{ chunk_index: number; content: string; content_hash: string }> = [];
  const normalized = content.trim();
  for (let start = 0, index = 0; start < normalized.length; index += 1) {
    const end = Math.min(normalized.length, start + chunkSize);
    const value = normalized.slice(start, end).trim();
    if (value) result.push({ chunk_index: index, content: value, content_hash: hash(value) });
    if (end === normalized.length) break;
    start = end - overlap;
  }
  return result;
}

export async function refreshWiki({ workerId, db, embed, apiKey, model }: {
  workerId: string;
  db: {
    claimWikiRefreshJob(workerId: string): Promise<{ id: string; workspace_id: string; brand_id: string; lease_token: string } | null>;
    getWikiSources(workspaceId: string, brandId: string): Promise<Array<{ source_kind: "faq" | "owned_snapshot"; source_id: string; title: string; content: string; content_hash: string }>>;
    getExistingEmbeddings(brandId: string, contentHashes: string[]): Promise<Array<{ content_hash: string; embedding: string; embedding_model: string; embedding_version: string }>>;
    replaceWiki(workspaceId: string, brandId: string, documents: unknown[]): Promise<void>;
    completeWikiRefreshJob(jobId: string, workerId: string, leaseToken: string, chunkCount: number): Promise<void>;
    failWikiRefreshJob(jobId: string, workerId: string, leaseToken: string, error: string): Promise<void>;
  };
  embed: (input: { text: string; apiKey: string; model: string }) => Promise<number[]>;
  apiKey: string;
  model: string;
}) {
  const job = await db.claimWikiRefreshJob(workerId);
  if (!job) return { status: "idle" as const };
  try {
    const sources = await db.getWikiSources(job.workspace_id, job.brand_id);
    const documentSources = sources.map((source) => ({ source, chunks: chunk(source.content) }));
    const contentHashes = documentSources.flatMap(({ chunks }) => chunks.map(({ content_hash }) => content_hash));
    const existingEmbeddings = await db.getExistingEmbeddings(job.brand_id, contentHashes);
    const existingByHash = new Map(
      existingEmbeddings
        .filter((item) => item.embedding_model === model && item.embedding_version === "v1")
        .map((item) => [item.content_hash, item.embedding]),
    );
    const documents = [];
    let chunkCount = 0;
    for (const { source, chunks: chunksForSource } of documentSources) {
      const chunks = [];
      for (const item of chunksForSource) {
        const existingEmbedding = existingByHash.get(item.content_hash);
        const embedding = existingEmbedding ?? `[${(await embed({ text: item.content, apiKey, model })).join(",")}]`;
        chunks.push({ ...item, embedding, embedding_model: model, embedding_version: "v1" });
      }
      chunkCount += chunks.length;
      documents.push({ ...source, chunks });
    }
    await db.replaceWiki(job.workspace_id, job.brand_id, documents);
    await db.completeWikiRefreshJob(job.id, workerId, job.lease_token, chunkCount);
    return { status: "completed" as const, jobId: job.id, chunkCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "wiki_refresh_failed";
    await db.failWikiRefreshJob(job.id, workerId, job.lease_token, message);
    return { status: "failed" as const, jobId: job.id };
  }
}
