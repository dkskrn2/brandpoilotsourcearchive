import type { Pool, PoolClient } from "pg";
import { createZipBuffer } from "./downloadPackage.js";
import { parseAiContentManifest } from "./aiContentManifest.js";
import type { AiContentManifest } from "./aiContentContracts.js";
import type { DownloadPackageDto } from "./types.js";

interface Scope {
  workspaceId: string;
  brandId: string;
  usageDate: string;
  dailyDownloadLimit: number;
}

interface OutputRow {
  id: string;
  generation_id: string;
  output_index: number;
  type: "card_news" | "blog" | "marketing";
  title: string;
  status: string;
  artifact_manifest_json: unknown;
  content_json: unknown;
}

export interface AiContentDownloadRepository {
  downloadAiContentOutput(input: Scope & { outputId: string }): Promise<DownloadPackageDto>;
  downloadAiContentGeneration(input: Scope & { generationId: string; outputIds?: string[] }): Promise<DownloadPackageDto>;
}

function safeSegment(value: string, fallback: string) {
  return value.normalize("NFKC").trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80) || fallback;
}

function blobUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !(url.hostname === "blob.vercel-storage.com" || url.hostname.endsWith(".blob.vercel-storage.com"))) {
    throw new Error("ai_content_download_asset_origin_invalid");
  }
  return url;
}

async function fetchAsset(url: string, fetchImpl: typeof fetch, maxBytes: number) {
  const response = await fetchImpl(blobUrl(url), { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`ai_content_download_asset_failed:${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("ai_content_download_asset_too_large");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error("ai_content_download_asset_too_large");
  return bytes;
}

async function outputEntries(row: OutputRow, fetchImpl: typeof fetch, maxAssetBytes: number) {
  if (row.status !== "completed") throw new Error("ai_content_output_not_completed");
  const manifest = parseAiContentManifest(row.type, row.artifact_manifest_json) as AiContentManifest;
  const folder = `${String(row.output_index).padStart(2, "0")}-${safeSegment(row.title, "result")}`;
  const assets = await Promise.all(manifest.assets.map(async (asset) => ({
    name: `${folder}/${safeSegment(asset.fileName, `asset-${asset.index}`)}`,
    data: await fetchAsset(asset.url, fetchImpl, maxAssetBytes),
  })));
  return [
    { name: `${folder}/manifest.json`, data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") },
    { name: `${folder}/content.json`, data: Buffer.from(`${JSON.stringify(row.content_json ?? manifest.content, null, 2)}\n`, "utf8") },
    ...assets,
  ];
}

async function recordDownloads(client: PoolClient, input: Scope, rows: OutputRow[]) {
  await client.query(
    `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`ai-content-download:${input.workspaceId}:${input.brandId}:${input.usageDate}`],
  );
  const existing = await client.query(
    `select count(*)::integer as count from ai_content_usage_ledger
      where workspace_id = $1 and brand_id = $2 and usage_date = $3::date and usage_type = 'new_download'`,
    [input.workspaceId, input.brandId, input.usageDate],
  );
  const already = await client.query(
    `select idempotency_key from ai_content_usage_ledger
      where workspace_id = $1 and brand_id = $2 and idempotency_key = any($3::text[])`,
    [input.workspaceId, input.brandId, rows.map((row) => `download:${row.id}`)],
  );
  const existingKeys = new Set(already.rows.map((row) => String(row.idempotency_key)));
  const newRows = rows.filter((row) => !existingKeys.has(`download:${row.id}`));
  if (Number(existing.rows[0]?.count ?? 0) + newRows.length > input.dailyDownloadLimit) throw new Error("ai_content_download_limit_reached");
  for (const row of newRows) {
    await client.query(
      `insert into ai_content_usage_ledger
         (workspace_id, brand_id, generation_id, output_id, usage_type, quantity, usage_date, idempotency_key)
       values ($1, $2, $3, $4, 'new_download', 1, $5::date, $6)
       on conflict (brand_id, idempotency_key) do nothing`,
      [input.workspaceId, input.brandId, row.generation_id, row.id, input.usageDate, `download:${row.id}`],
    );
  }
  await client.query(
    "update ai_content_generation_outputs set downloaded_at = coalesce(downloaded_at, now()) where id = any($1::uuid[])",
    [rows.map((row) => row.id)],
  );
}

export function createAiContentDownloadRepository(pool: Pool, options: { fetchImpl?: typeof fetch; maxAssetBytes?: number } = {}): AiContentDownloadRepository {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAssetBytes = options.maxAssetBytes ?? 20 * 1024 * 1024;

  async function packageRows(input: Scope, rows: OutputRow[], fileName: string) {
    if (!rows.length) throw new Error("ai_content_output_not_found");
    const entries = (await Promise.all(rows.map((row) => outputEntries(row, fetchImpl, maxAssetBytes)))).flat();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await recordDownloads(client, input, rows);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { fileName, mimeType: "application/zip" as const, buffer: createZipBuffer(entries), itemCount: rows.length };
  }

  return {
    async downloadAiContentOutput(input) {
      const result = await pool.query<OutputRow>(
        `select output.id, output.generation_id, output.output_index, generation.type, coalesce(output.title, generation.title) as title,
                output.status, output.artifact_manifest_json, output.content_json
           from ai_content_generation_outputs output
           join ai_content_generations generation on generation.id = output.generation_id
          where output.id = $1 and output.workspace_id = $2 and output.brand_id = $3`,
        [input.outputId, input.workspaceId, input.brandId],
      );
      return packageRows(input, result.rows, `brand-pilot-${safeSegment(result.rows[0]?.title ?? "result", "result")}.zip`);
    },

    async downloadAiContentGeneration(input) {
      const result = await pool.query<OutputRow>(
        `select output.id, output.generation_id, output.output_index, generation.type, coalesce(output.title, generation.title) as title,
                output.status, output.artifact_manifest_json, output.content_json
           from ai_content_generation_outputs output
           join ai_content_generations generation on generation.id = output.generation_id
          where generation.id = $1 and generation.workspace_id = $2 and generation.brand_id = $3
            and output.status = 'completed'
            and ($4::uuid[] is null or output.id = any($4::uuid[]))
          order by output.output_index`,
        [input.generationId, input.workspaceId, input.brandId, input.outputIds?.length ? input.outputIds : null],
      );
      return packageRows(input, result.rows, `brand-pilot-generation-${safeSegment(input.generationId, "results")}.zip`);
    },
  };
}
