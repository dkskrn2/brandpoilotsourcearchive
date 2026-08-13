import { describe, expect, it } from "vitest";
import { parseClaimedDmJob } from "./client.js";

const base = {
  id: "job-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  leaseToken: "lease-1",
  attemptCount: 1,
  payload: {
    conversationId: "conversation-1",
    turnId: "00000000-0000-4000-8000-000000000001",
    senderId: "sender-1",
    messageId: "message-1",
    question: "배송 문의",
    route: "knowledge",
    policyReasonCode: "wiki_answer",
    forceAttentionType: null,
  },
};

describe("parseClaimedDmJob", () => {
  it("accepts a complete fixed clarification payload", () => {
    expect(parseClaimedDmJob({
      ...base,
      payload: {
        ...base.payload,
        route: "faq_clarification",
        policyReasonCode: "faq_clarification",
        fixedReplyText: "배송 문의가 맞을까요?",
        confirmationId: "00000000-0000-4000-8000-000000000002",
        exactFaqId: "00000000-0000-4000-8000-000000000003",
      },
    })).toMatchObject({ payload: { route: "faq_clarification" } });
  });

  it("rejects unknown routes and incomplete clarification payloads", () => {
    expect(() => parseClaimedDmJob({
      ...base,
      payload: { ...base.payload, route: "unknown" },
    })).toThrow("dm_claim_route_invalid");
    expect(() => parseClaimedDmJob({
      ...base,
      payload: { ...base.payload, route: "faq_clarification" },
    })).toThrow("dm_claim_clarification_invalid");
  });
});
