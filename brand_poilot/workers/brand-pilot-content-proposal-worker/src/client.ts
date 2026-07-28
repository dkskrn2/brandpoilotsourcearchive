import {
  parseContentProposalJob,
  type ContentProposalJob,
  type ContentProposalWorkerClient,
} from "./contracts.js";

export class ContentProposalApiError extends Error {
  readonly retryable: boolean;
  readonly leaseLost: boolean;
  readonly status: number;

  constructor(message: string, status: number, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "ContentProposalApiError";
    this.status = status;
    this.leaseLost = message === "content_proposal_job_lease_invalid";
    this.retryable = options.retryable
      ?? (!this.leaseLost && (status === 0 || status === 408 || status === 429 || status >= 500));
  }
}

export interface ContentProposalModelClient {
  generate(prompt: string, signal?: AbortSignal): Promise<unknown>;
}

async function errorDetail(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: string | { message?: string } };
    if (typeof body.error === "string" && body.error.trim()) return body.error;
    if (body.error && typeof body.error === "object" && typeof body.error.message === "string") {
      return body.error.message;
    }
  } catch {
    // Preserve the stable fallback when an upstream error is not JSON.
  }
  return fallback;
}

async function timedFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fallbackCode: string,
): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal?.aborted) controller.abort();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new ContentProposalApiError(
      error instanceof Error && error.name !== "AbortError" ? error.message : fallbackCode,
      0,
      { retryable: true },
    );
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

export function createContentProposalApiClient(
  apiUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 300_000,
): ContentProposalWorkerClient {
  const base = apiUrl.replace(/\/+$/, "");

  async function request(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await timedFetch(fetchImpl, `${base}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }, timeoutMs, "content_proposal_api_timeout");
    if (!response.ok) {
      throw new ContentProposalApiError(
        await errorDetail(response, `content_proposal_api_failed:${response.status}`),
        response.status,
      );
    }
    if (response.status === 204) return {};
    return await response.json() as Record<string, unknown>;
  }

  return {
    async heartbeatWorker(workerId) {
      await request("/worker/content-proposal-jobs/heartbeat", { workerId });
    },
    async claim(workerId, leaseSeconds) {
      const payload = await request("/worker/content-proposal-jobs/claim", { workerId, leaseSeconds });
      return payload.job === null || payload.job === undefined
        ? null
        : parseContentProposalJob(payload.job);
    },
    async heartbeat(job, leaseSeconds) {
      await request(`/worker/content-proposal-jobs/${job.id}/heartbeat`, {
        workerId: job.workerId,
        leaseToken: job.leaseToken,
        leaseSeconds,
      });
    },
    async complete(job, proposals) {
      await request(`/worker/content-proposal-jobs/${job.id}/complete`, {
        workerId: job.workerId,
        leaseToken: job.leaseToken,
        proposals,
      });
    },
    async fail(job, input) {
      await request(`/worker/content-proposal-jobs/${job.id}/fail`, {
        workerId: job.workerId,
        leaseToken: job.leaseToken,
        ...input,
      });
    },
  };
}

const stringSchema = { type: "string", minLength: 1 };
const stringArraySchema = { type: "array", uniqueItems: true, items: stringSchema };
const proposalSchema = {
  type: "array",
  minItems: 2,
  maxItems: 3,
  items: {
    type: "object",
    additionalProperties: false,
    required: [
      "contractVersion", "title", "reasonToCreateNow", "contentFamily", "topic", "target",
      "messageStrategy", "hook", "keyMessage", "evidence", "outline", "outputFormat",
      "channelTargets", "recommendedReferenceQuery",
    ],
    properties: {
      contractVersion: { type: "string", const: "content-proposal.v1" },
      title: stringSchema,
      reasonToCreateNow: stringSchema,
      contentFamily: { type: "string", enum: ["informational", "marketing"] },
      topic: stringSchema,
      target: { type: "object", additionalProperties: true },
      messageStrategy: {
        type: "string",
        enum: [
          "problem_solution", "how_to", "comparison", "faq", "insight",
          "benefit", "social_proof", "brand_story", "cta",
        ],
      },
      hook: stringSchema,
      keyMessage: stringSchema,
      evidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["sourceSnapshotId", "summary"],
          properties: { sourceSnapshotId: stringSchema, summary: stringSchema },
        },
      },
      outline: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["heading", "purpose"],
          properties: { heading: stringSchema, purpose: stringSchema },
        },
      },
      outputFormat: {
        type: "string",
        enum: ["card_news", "blog", "single_image", "channel_text"],
      },
      channelTargets: stringArraySchema,
      recommendedReferenceQuery: {
        type: "object",
        additionalProperties: false,
        required: ["strategies", "formats", "tags"],
        properties: {
          strategies: stringArraySchema,
          formats: stringArraySchema,
          tags: stringArraySchema,
        },
      },
    },
  },
} as const;

function responseText(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SyntaxError("content_proposal_model_output_invalid");
  }
  const source = value as Record<string, unknown>;
  if (typeof source.output_text === "string" && source.output_text.trim()) return source.output_text;
  if (!Array.isArray(source.output)) throw new SyntaxError("content_proposal_model_output_invalid");
  for (const item of source.output) {
    if (!item || typeof item !== "object" || !Array.isArray((item as Record<string, unknown>).content)) continue;
    for (const content of (item as { content: unknown[] }).content) {
      if (content && typeof content === "object"
        && (content as Record<string, unknown>).type === "output_text"
        && typeof (content as Record<string, unknown>).text === "string") {
        return (content as Record<string, unknown>).text as string;
      }
    }
  }
  throw new SyntaxError("content_proposal_model_output_invalid");
}

export function createOpenAiContentProposalModel(
  apiKey: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 300_000,
): ContentProposalModelClient {
  return {
    async generate(prompt, signal) {
      const response = await timedFetch(fetchImpl, "https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: prompt,
          text: {
            format: {
              type: "json_schema",
              name: "content_proposals",
              strict: false,
              schema: proposalSchema,
            },
          },
        }),
        signal,
      }, timeoutMs, "content_proposal_model_timeout");
      if (!response.ok) {
        throw new ContentProposalApiError(
          await errorDetail(response, `content_proposal_model_failed:${response.status}`),
          response.status,
        );
      }
      return JSON.parse(responseText(await response.json()));
    },
  };
}

void (null as unknown as ContentProposalJob);
