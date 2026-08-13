import { describe, expect, it } from "vitest";
import { rankFaqCandidates } from "./faqMatcher.js";

const candidates = [
  {
    knowledgeEntryId: "shipping",
    question: "배송은 얼마나 걸리나요?",
    aliases: ["배송 기간", "택배 언제 와요", "배송 며칠 걸려요"],
  },
  {
    knowledgeEntryId: "hours",
    question: "운영시간이 어떻게 되나요?",
    aliases: ["몇 시에 열어요", "영업 시간"],
  },
  {
    knowledgeEntryId: "refund",
    question: "환불은 어떻게 하나요?",
    aliases: ["환불 방법", "돈 돌려받기"],
  },
];

describe("rankFaqCandidates", () => {
  it("returns normalized exact with score one", () => {
    expect(rankFaqCandidates("  택배 언제 와요?! ", candidates)).toEqual({
      kind: "candidate",
      knowledgeEntryId: "shipping",
      score: 1,
      matchedExpression: "택배 언제 와요",
    });
  });

  it("ranks a typo but never makes a direct-answer decision", () => {
    const result = rankFaqCandidates("배송 며칠 걸려용", candidates);
    expect(result).toMatchObject({ kind: "candidate", knowledgeEntryId: "shipping" });
    expect(result.kind === "candidate" && result.score).toBeLessThan(1);
  });

  it("returns conflict when the top candidates are too close", () => {
    const result = rankFaqCandidates("배송 문의요", [
      { knowledgeEntryId: "a", question: "배송 문의가", aliases: [] },
      { knowledgeEntryId: "b", question: "배송 문의는", aliases: [] },
    ]);
    expect(result).toEqual({ kind: "conflict", candidateIds: ["a", "b"] });
  });

  it.each(["", "?", "😀", "a", "https://example.com"])(
    "does not fuzzy-match an unsafe query: %s",
    (query) => expect(rankFaqCandidates(query, candidates)).toEqual({ kind: "none" }),
  );

  it("returns none for unrelated questions", () => {
    expect(rankFaqCandidates("오늘 날씨 어때요", candidates)).toEqual({ kind: "none" });
  });

  it("does not run fuzzy edit distance for an oversized DM", () => {
    const oversized = `배송 문의 ${"가".repeat(300)}`;
    expect(rankFaqCandidates(oversized, candidates)).toEqual({ kind: "none" });
  });

  it("stays within the local matcher budget for 200 FAQs and 100 queries", () => {
    const many = Array.from({ length: 200 }, (_, index) => ({
      knowledgeEntryId: `faq-${index}`,
      question: `상품 ${index} 배송 일정 문의`,
      aliases: [`상품 ${index} 언제 와요`, `상품 ${index} 발송일`],
    }));
    const started = performance.now();
    for (let index = 0; index < 100; index += 1) {
      rankFaqCandidates(`상품 ${index} 언제 와요`, many);
    }
    expect(performance.now() - started).toBeLessThan(2_500);
  });

  it("bounds adversarial fresh-candidate fuzzy matching work", () => {
    const started = performance.now();
    for (let pass = 0; pass < 20; pass += 1) {
      const fresh = Array.from({ length: 200 }, (_, index) => ({
        knowledgeEntryId: `faq-${pass}-${index}`,
        question: `${"가나다라마바사".repeat(12)} ${index}`,
        aliases: [`${"라마바사아자차".repeat(12)} ${index}`],
      }));
      rankFaqCandidates(`${"타파하가나다".repeat(10)} 문의`, fresh);
    }
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
