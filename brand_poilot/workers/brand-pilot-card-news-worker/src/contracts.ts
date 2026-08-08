import { parseContentGenerationInputV3, type ContentGenerationInputV3 } from "@brand-pilot/content-contracts";

export interface AiContentJob {
  id: string;
  generationId: string;
  outputId: string;
  workspaceId: string;
  brandId: string;
  jobType: "generate";
  outputFormat: "card_news";
  status: "processing";
  payload: Record<string, unknown>;
  leaseToken: string;
}

export interface WorkerClient {
  claim(workerId: string): Promise<AiContentJob | null>;
  heartbeat(jobId: string, workerId: string, leaseToken: string): Promise<void>;
  complete(jobId: string, body: Record<string, unknown>): Promise<void>;
  fail(jobId: string, body: Record<string, unknown>): Promise<void>;
  acquire(workerId: string): Promise<{ id: string; leaseToken: string } | null>;
  heartbeatResource(id: string, workerId: string, leaseToken: string): Promise<void>;
  releaseResource(id: string, workerId: string, leaseToken: string): Promise<void>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("card_news_job_invalid");
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseCardNewsJob(value: unknown): AiContentJob {
  const source = record(value);
  const keys = ["id", "generationId", "outputId", "workspaceId", "brandId", "jobType", "outputFormat", "status", "payload", "leaseToken"];
  if (Object.keys(source).length !== keys.length || keys.some((key) => !(key in source))
    || ![source.id, source.generationId, source.outputId, source.workspaceId, source.brandId, source.leaseToken].every(nonEmpty)
    || source.jobType !== "generate" || source.outputFormat !== "card_news" || source.status !== "processing") {
    throw new Error("card_news_job_invalid");
  }
  record(source.payload);
  return source as unknown as AiContentJob;
}

export function parseCardNewsInput(value: unknown, job: AiContentJob): ContentGenerationInputV3 {
  const input = parseContentGenerationInputV3(value);
  if (input.generationId !== job.generationId || input.outputSettings.outputFormat !== "card_news") {
    throw new Error("card_news_input_invalid");
  }
  return input;
}
