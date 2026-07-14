export function buildDmPrompt(input: {
  question: string;
  history: Array<{ direction: string; body: string | null }>;
  chunks: Array<{ id: string; content: string; score: number }>;
}) {
  return `당신은 브랜드 Instagram DM FAQ 응답 도우미입니다. 제공된 근거만 사용해 한국어로 답합니다. 근거가 부족하면 fallback, 자동 답변하면 안 되는 요청이면 ignore를 선택하세요. 추측, 약속, 개인정보 요청을 하지 마세요. JSON만 출력하세요.\n\n질문:\n${input.question}\n\n최근 대화:\n${JSON.stringify(input.history)}\n\n근거 문서:\n${JSON.stringify(input.chunks)}\n\n출력 형식:\n{"decision":"answer|fallback|ignore|error","answer":"answer일 때만 문자열, 아니면 null","wikiChunkIds":["answer일 때 사용한 UUID"],"confidence":0~1 또는 null,"reason":"짧은 이유"}`;
}
