import { describe, expect, it } from "vitest";
import {
  parseCreateWikiItem,
  parseResolveWikiIssue,
  parseUpdateWikiItem,
} from "./wikiManagementContracts.js";

describe("Wiki management contracts", () => {
  it.each(["faq", "policy", "how_to", "guide"] as const)(
    "accepts a manual %s draft without an import",
    (itemType) => {
      expect(parseCreateWikiItem({
        contractVersion: "wiki-item.v1",
        itemType,
        title: "배송 안내",
        content: "결제 후 영업일 2일 안에 발송합니다.",
        provenance: { note: "고객지원 검토" },
      })).toEqual({
        contractVersion: "wiki-item.v1",
        itemType,
        title: "배송 안내",
        content: "결제 후 영업일 2일 안에 발송합니다.",
        provenance: { note: "고객지원 검토" },
      });
    },
  );

  it("rejects product and service facts as manual Wiki items", () => {
    expect(() => parseCreateWikiItem({
      contractVersion: "wiki-item.v1",
      itemType: "product",
      title: "정기 구독",
      content: "월 10만원",
    })).toThrow("wiki_item_validation_failed:itemType");
    expect(() => parseCreateWikiItem({
      contractVersion: "wiki-item.v1",
      itemType: "service",
      title: "운영 대행",
      content: "콘텐츠 운영",
    })).toThrow("wiki_item_validation_failed:itemType");
  });

  it("accepts draft edits and explicit activation or deactivation", () => {
    expect(parseUpdateWikiItem({
      title: "수정된 안내",
      content: "수정된 내용",
      status: "active",
    })).toEqual({
      title: "수정된 안내",
      content: "수정된 내용",
      status: "active",
    });
    expect(parseUpdateWikiItem({ status: "inactive" })).toEqual({ status: "inactive" });
  });

  it("requires a supported supplemental source when resolving an issue", () => {
    expect(parseResolveWikiIssue({
      sourceKind: "product_service",
      sourceId: "44444444-4444-4444-8444-444444444444",
    })).toEqual({
      sourceKind: "product_service",
      sourceId: "44444444-4444-4444-8444-444444444444",
    });
    expect(() => parseResolveWikiIssue({
      sourceKind: "owned_snapshot",
      sourceId: "not-a-uuid",
    })).toThrow("wiki_issue_validation_failed:sourceId");
    expect(() => parseResolveWikiIssue({
      sourceKind: "service",
      sourceId: "44444444-4444-4444-8444-444444444444",
    })).toThrow("wiki_issue_validation_failed:sourceKind");
  });
});
