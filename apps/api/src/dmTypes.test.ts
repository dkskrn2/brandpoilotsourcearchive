import { describe, expect, it } from "vitest";
import { parseDmWorkerResult } from "./dmTypes";

const sourceId = "00000000-0000-4000-8000-000000000001";

describe("DM worker result contract", () => {
  it("accepts an answer only when it has a nonempty answer and a UUID source", () => {
    expect(parseDmWorkerResult({
      decision: "answer",
      answer: "평일 오전 9시부터 오후 6시까지 운영합니다.",
      wikiChunkIds: [sourceId],
      knowledgeEntryId: null,
      confidence: 0.8,
      reasonCode: "wiki_answer",
      needsAttention: false,
      reason: "FAQ 운영시간 항목"
    })).toEqual({
      decision: "answer",
      answer: "평일 오전 9시부터 오후 6시까지 운영합니다.",
      wikiChunkIds: [sourceId],
      knowledgeEntryId: null,
      confidence: 0.8,
      reasonCode: "wiki_answer",
      needsAttention: false,
      reason: "FAQ 운영시간 항목"
    });
  });

  it("rejects an answer without source UUIDs", () => {
    expect(() => parseDmWorkerResult({
      decision: "answer",
      answer: "근거 없는 답변",
      wikiChunkIds: [],
      knowledgeEntryId: null,
      confidence: 0.8,
      reasonCode: "wiki_answer",
      needsAttention: false,
      reason: "근거 없음"
    })).toThrow("dm_answer_sources_required");
  });

  it("accepts the required operational decision fields", () => {
    expect(parseDmWorkerResult({
      decision: "fallback",
      answer: null,
      wikiChunkIds: [],
      knowledgeEntryId: null,
      confidence: null,
      reasonCode: "restricted_action",
      needsAttention: true,
      reason: "쿠폰 발급 실행 요청",
    })).toMatchObject({
      decision: "fallback",
      reasonCode: "restricted_action",
      needsAttention: true,
    });
  });

  it("validates knowledge entry UUIDs and operational decision fields", () => {
    const result = {
      decision: "fallback",
      answer: null,
      wikiChunkIds: [],
      knowledgeEntryId: null,
      confidence: null,
      reasonCode: "knowledge_gap",
      needsAttention: true,
      reason: "근거 부족",
    };

    expect(() => parseDmWorkerResult({ ...result, knowledgeEntryId: "not-a-uuid" }))
      .toThrow("dm_knowledge_entry_id_invalid");
    expect(() => parseDmWorkerResult({ ...result, reasonCode: "unknown" }))
      .toThrow("dm_reason_code_invalid");
    expect(() => parseDmWorkerResult({ ...result, needsAttention: "yes" }))
      .toThrow("dm_needs_attention_invalid");
  });

  it("keeps fallback, ignore, and error results safe", () => {
    expect(parseDmWorkerResult({
      decision: "fallback",
      answer: null,
      wikiChunkIds: [],
      knowledgeEntryId: null,
      confidence: null,
      reasonCode: "low_confidence",
      needsAttention: false,
      reason: "근거 부족"
    })).toMatchObject({ decision: "fallback", answer: null });

    expect(() => parseDmWorkerResult({
      decision: "ignore",
      answer: "보내면 안 되는 답변",
      wikiChunkIds: [],
      knowledgeEntryId: null,
      confidence: null,
      reasonCode: "system_event",
      needsAttention: false,
      reason: "에코"
    })).toThrow("dm_non_answer_must_not_include_answer");
  });
});
