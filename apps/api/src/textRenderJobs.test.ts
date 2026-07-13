import { describe, expect, it } from "vitest";
import { buildThreadsRenderJobPayload, parseThreadsRenderJobResult } from "./textRenderJobs";

const topic = {
  title: "판매 전에 확인할 것",
  angle: "고객이 이해하는 순서",
  targetCustomer: "소규모 사업자",
  region: null,
  season: null,
  notes: null
};

const brand = {
  name: "Growth Line",
  industry: "마케팅",
  primaryCustomer: "사업자",
  description: "콘텐츠 자동화 서비스",
  tone: "명확함",
  brandColor: "파란색"
};

describe("Threads text render contracts", () => {
  it("passes the representative URL and source context to the Codex worker", () => {
    expect(buildThreadsRenderJobPayload({
      topic,
      brand,
      crawlContentUrl: "https://example.com/article",
      referenceUrl: "https://fallback.example.com/article"
    })).toEqual({
      deliveryFormat: "threads_text",
      promptVersion: "worker-threads.v1",
      topic,
      brand,
      representativeUrl: "https://example.com/article"
    });
  });

  it("accepts a validated Threads result tied to the claimed job", () => {
    expect(parseThreadsRenderJobResult({
      jobId: "job-1",
      channelOutputId: "output-1",
      deliveryFormat: "threads_text",
      promptVersion: "worker-threads.v1",
      title: "판매 전에 확인할 것",
      text: "고객은 상품보다 이해할 수 있는 설명을 먼저 봅니다.",
      sourceMode: "direct_url",
      fetchStatus: "fetched",
      model: "codex-cli"
    }, { jobId: "job-1", channelOutputId: "output-1" })).toMatchObject({
      deliveryFormat: "threads_text",
      title: "판매 전에 확인할 것",
      sourceMode: "direct_url"
    });
  });

  it("rejects empty text and mismatched job identities", () => {
    expect(() => parseThreadsRenderJobResult({
      jobId: "other-job",
      channelOutputId: "output-1",
      deliveryFormat: "threads_text",
      promptVersion: "worker-threads.v1",
      title: "제목",
      text: "",
      sourceMode: "direct_url",
      fetchStatus: "fetched",
      model: "codex-cli"
    }, { jobId: "job-1", channelOutputId: "output-1" })).toThrow("text_manifest_job_mismatch");
  });
});
