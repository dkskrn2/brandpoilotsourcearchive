import {
  parseContentGenerationInputV3,
  parseReelPlanV2,
  type ContentGenerationInputV3,
  type ReelPlanV2,
} from "@brand-pilot/content-contracts";

export interface ReelJob {
  id: string;
  generationId: string;
  outputId: string;
  workspaceId: string;
  brandId: string;
  jobType: "generate";
  outputFormat: "reel";
  status: "processing";
  payload: Record<string, unknown>;
  leaseToken: string;
}

export interface ReelClient {
  claim(workerId: string): Promise<ReelJob | null>;
  heartbeat(jobId: string, workerId: string, leaseToken: string): Promise<void>;
  complete(jobId: string, body: Record<string, unknown>): Promise<void>;
  fail(jobId: string, body: Record<string, unknown>): Promise<void>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("reel_job_invalid");
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseReelJob(value: unknown): ReelJob {
  const source = record(value);
  const keys = ["id", "generationId", "outputId", "workspaceId", "brandId", "jobType", "outputFormat", "status", "payload", "leaseToken"];
  if (Object.keys(source).length !== keys.length || keys.some((key) => !(key in source))
    || ![source.id, source.generationId, source.outputId, source.workspaceId, source.brandId, source.leaseToken].every(nonEmpty)
    || source.jobType !== "generate" || source.outputFormat !== "reel" || source.status !== "processing") {
    throw new Error("reel_job_invalid");
  }
  record(source.payload);
  return source as unknown as ReelJob;
}

export function parseReelInput(value: unknown, job: ReelJob): ContentGenerationInputV3 {
  const input = parseContentGenerationInputV3(value);
  if (input.generationId !== job.generationId || input.outputSettings.outputFormat !== "reel") {
    throw new Error("reel_input_invalid");
  }
  return input;
}

export function parseReelPlanForInput(value: unknown, input: ContentGenerationInputV3): ReelPlanV2 {
  const plan = parseReelPlanV2(value);
  if (plan.imagePackage.generationId !== input.generationId
    || plan.imagePackage.outputFormat !== "reel"
    || plan.imagePackage.purpose !== input.outputSettings.purpose
    || plan.imagePackage.assetCount !== input.selectedProposal.assetCount) {
    throw new Error("reel_plan_input_mismatch");
  }
  return plan;
}
