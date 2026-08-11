export type AiContentGenerationProgressPhase = "queued" | "planning" | "rendering" | "finalizing";
export type AiContentGenerationProgressItemStatus = "queued" | "processing" | "completed" | "failed";

export interface AiContentGenerationProgress {
  phase: AiContentGenerationProgressPhase;
  totalAssets: number;
  completedAssets: number;
  failedAssets: number;
  items: Array<{
    index: number;
    role: string;
    status: AiContentGenerationProgressItemStatus;
  }>;
  startedAt: string | null;
  updatedAt: string;
}

export interface AiContentGenerationProgressJob {
  assetIndex: number | null;
  jobKind: "image_asset" | "package_finalize" | string;
  status: string;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

type ProgressQuery = (sql: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function plannedAssets(plan: unknown): Array<{ index: number; role: string }> | null {
  const source = record(plan);
  if (!source || typeof source.contractVersion !== "string") return null;
  if (source.contractVersion === "blog-plan.v2" && source.imagePackage === null) return [];
  const imagePackage = record(source.imagePackage);
  if (!imagePackage || !Array.isArray(imagePackage.assets)) return null;
  const assets = imagePackage.assets.map((value) => {
    const asset = record(value);
    if (!asset || !Number.isSafeInteger(asset.index) || Number(asset.index) < 1 || typeof asset.role !== "string" || !asset.role.trim()) return null;
    return { index: Number(asset.index), role: asset.role };
  });
  if (assets.some((asset) => asset === null)) return null;
  const normalized = assets as Array<{ index: number; role: string }>;
  if (normalized.some((asset, position) => asset.index !== position + 1)) return null;
  return normalized;
}

function itemStatus(status: string): AiContentGenerationProgressItemStatus {
  if (status === "succeeded") return "completed";
  if (status === "processing") return "processing";
  if (status === "failed") return "failed";
  return "queued";
}

function laterJob(left: AiContentGenerationProgressJob, right: AiContentGenerationProgressJob): AiContentGenerationProgressJob {
  if (left.status === "succeeded" && right.status !== "succeeded") return left;
  if (right.status === "succeeded" && left.status !== "succeeded") return right;
  if (left.attemptCount !== right.attemptCount) return left.attemptCount > right.attemptCount ? left : right;
  return left.updatedAt >= right.updatedAt ? left : right;
}

export function buildAiContentGenerationProgress(input: {
  generationStatus: string;
  generationCreatedAt: string;
  generationUpdatedAt: string;
  plan: unknown;
  jobs: AiContentGenerationProgressJob[];
}): AiContentGenerationProgress | null {
  const assets = plannedAssets(input.plan);
  if (assets === null) return null;

  const currentByIndex = new Map<number, AiContentGenerationProgressJob>();
  for (const job of input.jobs) {
    if (job.jobKind !== "image_asset" || job.assetIndex === null || !Number.isSafeInteger(job.assetIndex)) continue;
    const current = currentByIndex.get(job.assetIndex);
    currentByIndex.set(job.assetIndex, current ? laterJob(current, job) : job);
  }

  const items = assets.map((asset) => ({
    ...asset,
    status: itemStatus(currentByIndex.get(asset.index)?.status ?? "queued"),
  }));
  const packageJobs = input.jobs.filter((job) => job.jobKind === "package_finalize");
  const currentPackage = packageJobs.reduce<AiContentGenerationProgressJob | null>(
    (current, job) => current ? laterJob(current, job) : job,
    null,
  );
  const phase: AiContentGenerationProgressPhase = input.generationStatus === "queued"
    ? "queued"
    : input.generationStatus === "planning"
      ? "planning"
      : currentPackage || (items.length > 0 && items.every((item) => item.status === "completed"))
        ? "finalizing"
        : "rendering";
  const timestamps = input.jobs.map((job) => job.updatedAt).filter(Boolean).sort();

  return {
    phase,
    totalAssets: items.length,
    completedAssets: items.filter((item) => item.status === "completed").length,
    failedAssets: items.filter((item) => item.status === "failed").length,
    items,
    startedAt: input.jobs.map((job) => job.createdAt).filter(Boolean).sort()[0] ?? input.generationCreatedAt ?? null,
    updatedAt: timestamps.at(-1) ?? input.generationUpdatedAt,
  };
}

export async function loadAiContentGenerationProgress(query: ProgressQuery, input: {
  generationId: string;
  workspaceId: string;
  brandId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}): Promise<AiContentGenerationProgress | null> {
  const result = await query(
    `select output.id as output_id,output.plan_json,
            job.asset_index,job.job_kind,job.status,job.attempt_count,
            job.created_at as job_created_at,job.updated_at as job_updated_at
       from ai_content_generation_outputs output
       left join ai_content_generation_render_jobs job
         on job.output_id=output.id
        and job.generation_id=output.generation_id
        and job.workspace_id=output.workspace_id
        and job.brand_id=output.brand_id
      where output.generation_id=$1 and output.workspace_id=$2 and output.brand_id=$3
      order by output.output_index,job.asset_index nulls last,job.attempt_count,job.updated_at`,
    [input.generationId, input.workspaceId, input.brandId],
  );
  if (!result.rows.length) return null;
  const outputIds = new Set(result.rows.map((row) => String(row.output_id)));
  if (outputIds.size !== 1) return null;
  const plan = result.rows[0]?.plan_json;
  const jobs = result.rows.flatMap((row): AiContentGenerationProgressJob[] => {
    if (row.job_kind === null || row.job_kind === undefined) return [];
    const createdAt = iso(row.job_created_at);
    const updatedAt = iso(row.job_updated_at);
    if (!createdAt || !updatedAt) return [];
    return [{
      assetIndex: row.asset_index === null || row.asset_index === undefined ? null : Number(row.asset_index),
      jobKind: String(row.job_kind),
      status: String(row.status),
      attemptCount: Number(row.attempt_count ?? 0),
      createdAt,
      updatedAt,
    }];
  });
  return buildAiContentGenerationProgress({
    generationStatus: input.status,
    generationCreatedAt: input.createdAt,
    generationUpdatedAt: input.updatedAt,
    plan,
    jobs,
  });
}
