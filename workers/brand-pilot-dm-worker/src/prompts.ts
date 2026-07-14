import type { WikiSearchChunk } from "./db.js";

export function buildDmPrompt(input: {
  question: string;
  history: Array<{ direction: string; body: string | null }>;
  chunks: WikiSearchChunk[];
}) {
  return `당신은 브랜드의 Instagram DM에 답하는 담당자입니다. 반드시 $dm-human-response Skill을 사용해 자연스러운 한국어 답변을 작성하세요. 제공된 최근 대화와 근거 문서만 사용하고, 추측하거나 실제 조치를 완료했다고 말하지 마세요. 근거가 충분하면 answer, 부족하면 fallback, 답변하지 않아야 하는 시스템 이벤트만 ignore를 선택하세요. 아래 계약을 정확히 지킨 JSON만 출력하고 설명, Markdown, 코드 펜스는 출력하지 마세요.\n\n질문:\n${input.question}\n\n최근 대화:\n${JSON.stringify(input.history)}\n\n근거 문서:\n${JSON.stringify(input.chunks)}\n\n출력 JSON 계약:\n{"decision":"answer|fallback|ignore|error","answer":"answer일 때만 비어 있지 않은 문자열, 그 외 null","wikiChunkIds":["answer에 실제 사용한 근거 문서 UUID"],"knowledgeEntryId":"제공된 직접 FAQ UUID 또는 null","confidence":"0~1 숫자 또는 null","reasonCode":"direct_faq|wiki_answer|restricted_action|complaint|knowledge_gap|low_confidence|processing_error|system_event","needsAttention":"boolean","reason":"비어 있지 않은 짧은 이유"}\n\nanswer에는 wikiChunkIds가 하나 이상 있거나 knowledgeEntryId가 있어야 합니다. answer가 아니면 answer는 null, wikiChunkIds는 빈 배열, knowledgeEntryId는 null이어야 합니다. 현재 제공되지 않은 ID를 만들지 마세요. JSON만 출력하세요.`;
}
