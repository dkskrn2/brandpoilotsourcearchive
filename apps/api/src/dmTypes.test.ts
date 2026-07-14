import { describe, expect, it } from "vitest";
import { parseDmWorkerResult } from "./dmTypes";

const sourceId = "00000000-0000-4000-8000-000000000001";

describe("DM worker result contract", () => {
  it("accepts an answer only when it has a nonempty answer and a UUID source", () => {
    expect(parseDmWorkerResult({
      decision: "answer",
      answer: "평일 오전 9시부터 오후 6시까지 운영합니다.",
      wikiChunkIds: [sourceId],
      confidence: 0.8,
      reason: "FAQ 운영시간 항목"
    })).toEqual({
      decision: "answer",
      answer: "평일 오전 9시부터 오후 6시까지 운영합니다.",
      wikiChunkIds: [sourceId],
      confidence: 0.8,
      reason: "FAQ 운영시간 항목"
    });
  });

  it("rejects an answer without source UUIDs", () => {
    expect(() => parseDmWorkerResult({
      decision: "answer",
      answer: "근거 없는 답변",
      wikiChunkIds: [],
      confidence: 0.8,
      reason: "근거 없음"
    })).toThrow("dm_answer_sources_required");
  });

  it("keeps fallback, ignore, and error results safe", () => {
    expect(parseDmWorkerResult({
      decision: "fallback",
      answer: null,
      wikiChunkIds: [],
      confidence: null,
      reason: "근거 부족"
    })).toMatchObject({ decision: "fallback", answer: null });

    expect(() => parseDmWorkerResult({
      decision: "ignore",
      answer: "보내면 안 되는 답변",
      wikiChunkIds: [],
      confidence: null,
      reason: "에코"
    })).toThrow("dm_non_answer_must_not_include_answer");
  });
});
