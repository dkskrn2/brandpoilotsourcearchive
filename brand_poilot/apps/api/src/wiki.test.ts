import { describe, expect, it } from "vitest";
import { buildWikiChunks } from "./wiki.js";

describe("buildWikiChunks", () => {
  it("uses enabled FAQ entries and only the latest successful owned snapshot", () => {
    const chunks = buildWikiChunks({
      faqEntries: [{ id: "faq-1", question: "환불", answer: "결제 후 7일 이내", enabled: true }],
      sourceSnapshots: [
        { id: "old-owned", sourceUrlId: "source-1", sourceType: "owned", status: "succeeded", title: "오래된 소개", content: "오래된 내용", fetchedAt: "2026-07-01T00:00:00.000Z" },
        { id: "new-owned", sourceUrlId: "source-1", sourceType: "owned", status: "succeeded", title: "최신 소개", content: "최신 내용", fetchedAt: "2026-07-02T00:00:00.000Z" },
        { id: "reference", sourceUrlId: "source-2", sourceType: "reference", status: "succeeded", title: "외부", content: "제외", fetchedAt: "2026-07-03T00:00:00.000Z" },
        { id: "failed", sourceUrlId: "source-3", sourceType: "owned", status: "failed", title: "실패", content: "제외", fetchedAt: "2026-07-04T00:00:00.000Z" },
      ],
    });

    expect(chunks.map((chunk) => [chunk.sourceKind, chunk.sourceId, chunk.content])).toEqual([
      ["faq", "faq-1", "질문: 환불\n\n답변: 결제 후 7일 이내"],
      ["owned_snapshot", "new-owned", "최신 내용"],
    ]);
  });

  it("limits chunks to 800 characters with a 120 character overlap", () => {
    const chunks = buildWikiChunks({
      faqEntries: [{ id: "faq-1", question: "긴 답변", answer: "가".repeat(900), enabled: true }],
      sourceSnapshots: [],
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toHaveLength(800);
    expect(chunks[1].content).toContain(chunks[0].content.slice(-120));
  });
});
