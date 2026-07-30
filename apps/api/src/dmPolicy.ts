import type { DmAttentionType, DmJobRoute, DmReasonCode, DmWorkerResult } from "./dmTypes.js";

export const dmFixedMessages = {
  restricted_action: "자동 처리할 수 없는 요청입니다. 담당자가 확인하겠습니다.",
  complaint: "불편을 드려 죄송합니다. 담당자가 내용을 확인하겠습니다.",
  knowledge_gap: "현재 확인 가능한 안내 자료가 부족합니다. 담당자가 확인 후 안내드리겠습니다.",
} as const;

export interface DmPolicyRoute {
  route: DmJobRoute;
  reasonCode: DmReasonCode;
  forceAttentionType: DmAttentionType | null;
}

const complaintPattern = /(최악|너무\s*불편|불만|화가\s*나|실망|항의|기분이\s*나쁘)/;
const protectedObjectPattern = /(개인\s*정보|저장\s*데이터|내\s*데이터|계정|권한|쿠폰|할인(?:\s*코드)?|프로모션(?:\s*코드)?|결제|주문|환불)/;
const restrictedActionPattern = /(삭제|수정|변경|생성|만들|발급|전달|취소|승인|환불|부여)/;
const informationalPattern = /(절차|방법|어떻게)/;
const completedActionPattern = /(삭제|수정|변경|생성|발급|전달|취소|승인|환불|부여)(?:해\s*드렸|했|하였|완료했|되었|드렸)습니다/;

export function routeDmMessage(message: string): DmPolicyRoute {
  const normalized = message.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (complaintPattern.test(normalized)) {
    return { route: "fixed_fallback", reasonCode: "complaint", forceAttentionType: "complaint" };
  }

  const isRestrictedAction = protectedObjectPattern.test(normalized) && restrictedActionPattern.test(normalized);
  if (!isRestrictedAction) {
    return { route: "knowledge", reasonCode: "wiki_answer", forceAttentionType: null };
  }
  if (informationalPattern.test(normalized)) {
    return { route: "knowledge", reasonCode: "wiki_answer", forceAttentionType: "restricted_action" };
  }
  return { route: "fixed_fallback", reasonCode: "restricted_action", forceAttentionType: "restricted_action" };
}

export function inspectDmAnswer(result: DmWorkerResult): DmWorkerResult {
  if (result.decision !== "answer" || !result.answer || !completedActionPattern.test(result.answer.normalize("NFKC"))) {
    return result;
  }
  return {
    decision: "fallback",
    answer: null,
    wikiChunkIds: [],
    knowledgeEntryId: null,
    confidence: null,
    reasonCode: "restricted_action",
    needsAttention: true,
    reason: "restricted_action_claim",
  };
}
