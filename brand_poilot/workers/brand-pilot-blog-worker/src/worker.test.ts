import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentWorkerApiError } from "@brand-pilot/worker-runtime";
import type { BlogClient, BlogJob } from "./contracts.js";
import { runOnce } from "./worker.js";

const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const v3Input = {
  contractVersion: "content-generation-input.v3", generationId: uid(1),
  brandCore: { versionId: uid(2), companyOverview: "Overview", businessDescription: "Business", primaryCategory: "Category", detailedCategory: "Detail", primaryTarget: "Reader", differentiator: "Clear", coreAppeal: "Useful" },
  brandRules: { versionId: uid(3), version: 1, content: { contractVersion: "brand-rules.v1", requiredPhrases: [], forbiddenPhrases: [], exaggerationRules: [], ctaRules: { defaultCta: "", allowed: [] }, channelRules: {}, designRules: { colors: [], fonts: [], notes: [], referenceImages: [] }, autoApprovalRules: { enabled: false, conditions: [] } }, contentSha256: "f".repeat(64) },
  subject: { kind: "topic_text", title: "좋은 글 구조" }, contentInstruction: "구체적으로 작성", product: null,
  researchEvidence: { contractVersion: "research-evidence.v1", decision: "searched", reason: "Evidence", queries: ["query"], capturedAt: "2026-07-31T00:00:00.000Z", items: [{ id: uid(5), title: "Source", url: "https://example.com/source", publisher: null, publishedAt: null, capturedAt: "2026-07-31T00:00:00.000Z", claimSummary: "Claim", contentHash: "a".repeat(64) }] },
  references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
  selectedProposal: { id: uid(6), conceptKey: "guide", title: "Guide", informationalType: "how_to", oneLineIntent: "Explain", differentiator: "Direct", differentiationAxes: ["question"], target: "Reader", customerContext: "Need answer", keyMessage: "Answer", hook: "Question", selectionReason: "Useful", evidenceIds: [uid(5)], referenceIds: [], outputFormat: "blog", channelTargets: ["blog_export"], assetCount: null, outline: [{ index: 1, role: "article", headline: "Structure", purpose: "Guide" }], purposeDetails: { kind: "informational", question: "What?", value: "Answer", whyNow: "Now", learningPoints: ["Point"] } },
  userImageInstruction: null, outputSettings: { purpose: "informational", outputFormat: "blog", channelTargets: ["blog_export"], aspectRatio: null, outputCount: 1 }, capturedAt: "2026-07-31T00:00:00.000Z",
};
const supplemental = { contractVersion: "research-evidence.v1", decision: "searched", reason: "Supplement", queries: ["supplement"], capturedAt: "2026-07-31T00:01:00.000Z", items: [{ ...v3Input.researchEvidence.items[0], id: uid(7), url: "https://example.com/supplement" }] };
const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

function html() {
  const body = "독자가 바로 적용할 수 있는 구체적인 판단 기준과 설명입니다. ".repeat(85);
  return `<article><h1>좋은 글은 어떻게 구성할까요?</h1><section data-summary="true"><p>핵심부터 답합니다.</p><p>근거를 연결합니다.</p><p>실행 기준을 제시합니다.</p></section><section><h2>무엇부터 확인해야 할까요?</h2><p>${body}<a href="https://example.com/source" data-evidence-id="${uid(5)}">근거</a></p></section><section data-references="true"><h2>어떤 자료를 참고했나요?</h2><p>사용한 자료입니다.</p><ul><li><a href="https://example.com/source" data-evidence-id="${uid(5)}">Source</a></li></ul></section></article>`;
}

async function output(plan: Record<string, unknown>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "blog-v3-test-")); temporary.push(dir);
  await writeFile(path.join(dir, "blog-plan.json"), JSON.stringify(plan));
  return { outputDir: dir, cleanup: vi.fn(async () => undefined) };
}

function plan(htmlTemplate = html()) {
  return { contractVersion: "blog-plan-draft.v1", content: { title: "좋은 글 구조", htmlTemplate, metaTitle: "좋은 글 구조 가이드", metaDescription: "좋은 글 구조를 구체적으로 설명합니다.", usedEvidenceIds: [uid(5)] }, imageDraft: null };
}

function v3Job(extraPayload: Record<string, unknown> = {}): BlogJob {
  return { id: "job-v3", generationId: uid(1), outputId: uid(9), workspaceId: "w", brandId: "b", jobType: "generate", outputFormat: "blog", status: "processing", payload: { contentGenerationInput: v3Input, ...extraPayload }, leaseToken: "lease" };
}

function clientFor(job: BlogJob, order: string[] = []) {
  return { claim: vi.fn(async () => job), heartbeat: vi.fn(async () => undefined), complete: vi.fn(async () => { order.push("complete"); }), completeResearch: vi.fn(async () => { order.push("freeze"); }), fail: vi.fn(async () => undefined), acquire: vi.fn(async () => ({ id: "resource", leaseToken: "resource-lease" })), heartbeatResource: vi.fn(async () => undefined), releaseResource: vi.fn(async () => undefined) } as unknown as BlogClient;
}

describe("blog worker attachment preflight", () => {
  it("cancels planning and publishes no terminal result after the job lease is lost", async () => {
    vi.useFakeTimers();
    const job = v3Job();
    const client = clientFor(job);
    client.heartbeat = vi.fn(async () => { throw new Error("worker_api_failed:409"); });
    const runner = { run: vi.fn((_job: BlogJob, _prompt: string, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) };

    const running = runOnce({
      workerId: "worker",
      client,
      runner,
      research: { assess: vi.fn(async () => ({ decision: "not_needed" as const, reason: "enough" })), search: vi.fn() },
    });
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await running;

    expect(result).toEqual({ status: "lease_lost", jobId: job.id });
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("writes HTML directly with zero images when supplemental research is not needed", async () => {
    const job = v3Job(); const client = clientFor(job);
    const runner = { run: vi.fn(async () => output(plan())) };
    const research = { assess: vi.fn(async () => ({ decision: "not_needed" as const, reason: "enough" })), search: vi.fn() };
    const result = await runOnce({ workerId: "worker", client, runner, research });
    expect(client.fail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "completed" });
    expect(research.search).not.toHaveBeenCalled();
    expect(client.completeResearch).not.toHaveBeenCalled();
    expect(client.complete).toHaveBeenCalledWith(job.id, expect.objectContaining({
      jobType: "generate",
      planDraft: expect.objectContaining({ contractVersion: "blog-plan-draft.v1", imageDraft: null }),
    }));
    expect(client.complete.mock.calls[0]?.[1]).not.toHaveProperty("plan");
  });

  it("freezes one controlled supplement before the network-disabled writer runs", async () => {
    const order: string[] = []; const job = v3Job(); const client = clientFor(job, order);
    const runner = { run: vi.fn(async () => { order.push("writer"); return output(plan()); }) };
    const research = { assess: vi.fn(async () => ({ decision: "needed" as const, reason: "gap" })), search: vi.fn(async () => { order.push("search"); return supplemental; }) };
    await runOnce({ workerId: "worker", client, runner, research });
    expect(order).toEqual(["search", "freeze", "writer", "complete"]);
    expect(research.search).toHaveBeenCalledTimes(1);
    expect(client.completeResearch).toHaveBeenCalledWith(job, supplemental);
  });

  it("does not assess, search, or store again when a retry payload already has supplemental research", async () => {
    const job = v3Job({ supplementalResearch: supplemental }); const client = clientFor(job);
    const research = { assess: vi.fn(), search: vi.fn() };
    await runOnce({ workerId: "worker", client, runner: { run: vi.fn(async () => output(plan())) }, research });
    expect(research.assess).not.toHaveBeenCalled();
    expect(research.search).not.toHaveBeenCalled();
    expect(client.completeResearch).not.toHaveBeenCalled();
  });

  it("repairs an invalid HTML plan exactly once with the validator error list", async () => {
    const job = v3Job(); const client = clientFor(job);
    const bad = plan(html().replace('<section data-summary="true">', "<div>"));
    const runner = { run: vi.fn().mockImplementationOnce(async () => output(bad)).mockImplementationOnce(async () => output(plan())) };
    await runOnce({ workerId: "worker", client, runner, research: { assess: vi.fn(async () => ({ decision: "not_needed", reason: "enough" })), search: vi.fn() } });
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(runner.run.mock.calls[1]?.[1]).toContain("blog_html_summary_invalid");
    expect(client.complete).toHaveBeenCalledTimes(1);
  });

  it("fails after one targeted repair without truncation, synthetic paragraphs, or a cover fallback", async () => {
    const job = v3Job(); const client = clientFor(job); const invalid = plan("<article><h1>짧음</h1></article>");
    const runner = { run: vi.fn(async () => output(invalid)) };
    await runOnce({ workerId: "worker", client, runner, research: { assess: vi.fn(async () => ({ decision: "not_needed", reason: "enough" })), search: vi.fn() } });
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).toHaveBeenCalledWith(job.id, expect.objectContaining({ errorCode: expect.stringMatching(/^blog_(?:html|plan)_/) }));
  });

  it("cancels a conflicting completion without re-planning or publishing failure", async () => {
    const job = v3Job();
    const client = clientFor(job);
    const conflict = await contentWorkerApiError(new Response(
      JSON.stringify({ error: "ai_content_job_lease_invalid" }),
      { status: 409, headers: { "content-type": "application/json" } },
    ));
    client.complete = vi.fn(async () => {
      throw conflict;
    });
    const runner = { run: vi.fn(async () => output(plan())) };

    const result = await runOnce({
      workerId: "worker",
      client,
      runner,
      research: { assess: vi.fn(async () => ({ decision: "not_needed" as const, reason: "enough" })), search: vi.fn() },
    });

    expect(result).toEqual({ status: "lease_lost", jobId: job.id });
    expect(runner.run).toHaveBeenCalledOnce();
    expect(client.complete).toHaveBeenCalledOnce();
    expect(client.fail).not.toHaveBeenCalled();
  });
});
