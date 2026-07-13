import type { Channel, SourceType } from "./types.js";

export interface MasterDraftInput {
  brandProfile: {
    name: string;
    industry: string | null;
    primaryCustomer: string | null;
    serviceDescription: string | null;
    tone: string | null;
  };
  topicMaterial?: {
    topicTitle: string;
    topicAngle: string;
    targetCustomer: string | null;
    region: string | null;
    season: string | null;
    referenceUrl: string | null;
    notes: string | null;
  };
  sourceMaterials: {
    sourceType: SourceType;
    contentUrl: string;
    content?: string | null;
  }[];
}

export interface PromptSpec {
  id: string;
  title: string;
  api: "openai.responses";
  responseName: string;
  schema: Record<string, unknown>;
}

export interface PromptMessages {
  system: string;
  user: string;
}

export interface MasterDraft {
  title: string;
  contentTheme: string;
  coreMessage: string;
  targetAudience: string;
  customerProblem: string;
  keyPoints: string[];
  supportingEvidence: string[];
}

export interface GeneratedChannelOutput {
  channel: Channel;
  title: string;
  previewTitle: string;
  previewBody: string;
  sourceSummary: string;
  outputJson: Record<string, unknown>;
  blockReasons: string[];
}

export const MASTER_DRAFT_PROMPT_SPEC: PromptSpec = Object.freeze({
  id: "draft.master.v1",
  title: "Master draft generation",
  api: "openai.responses",
  responseName: "brand_pilot_master_draft",
  schema: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["title", "contentTheme", "coreMessage", "targetAudience", "customerProblem", "keyPoints", "supportingEvidence"],
    properties: {
      title: { type: "string" },
      contentTheme: { type: "string" },
      coreMessage: { type: "string" },
      targetAudience: { type: "string" },
      customerProblem: { type: "string" },
      keyPoints: { type: "array", items: { type: "string" } },
      supportingEvidence: { type: "array", items: { type: "string" } }
    }
  })
});

const PROMPT_REGISTRY = Object.freeze({
  [MASTER_DRAFT_PROMPT_SPEC.id]: MASTER_DRAFT_PROMPT_SPEC
});

export function getPromptSpec(id: string): PromptSpec | null {
  return PROMPT_REGISTRY[id as keyof typeof PROMPT_REGISTRY] ?? null;
}

export function buildMasterDraftPrompt(input: MasterDraftInput): PromptMessages {
  const brand = input.brandProfile;
  const topic = input.topicMaterial;
  return {
    system: [
      "당신은 한국어 마케팅 콘텐츠 초안을 만드는 작성자입니다.",
      "이 초안은 url 및 정보를 확인해 보는 사람들로 하여금 인사이트를 주기 위함입니다.",
      "",
      "브랜드 프로필은 콘텐츠를 발행하는 브랜드의 정체성과 사업 맥락입니다.",
      "소스 자료는 등록된 소스 URL에서 크롤링으로 발견한 콘텐츠입니다.",
      "",
      "소스 사용 규칙:",
      "- owned 소스는 브랜드의 자사 콘텐츠를 의미합니다. 가장 우선적인 사실 근거로 사용하세요.",
      "- reference 소스는 외부 참고 콘텐츠를 의미합니다. 시장 맥락, 주제 발견, 콘텐츠 각도 발견에만 사용하세요.",
      "- reference 소스의 문장이나 표현을 직접 복제하지 마세요.",
      "- reference 소스의 의미를 상세하게 요약하고 재구성해서 사용하세요.",
      "- owned 소스와 reference 소스의 내용이 충돌하면 owned 소스를 우선하세요.",
      "",
      "누락 정보 처리 규칙:",
      "- 일부 필드는 비어 있거나 없을 수 있습니다.",
      "- 사용 가능한 브랜드 프로필과 소스 자료 안에서만 추론하세요.",
      "- 입력에 근거가 없는 구체적 사실, 숫자, 가격, 사건, 보장, 효능 주장은 만들지 마세요.",
      "",
      "콘텐츠 구성 규칙:",
      "- 소스 자료를 그대로 요약하는 데 그치지 말고, 필요한 경우 표현과 구조를 변형해도 됩니다.",
      "- 읽는 사람이 명확한 판단 기준과 인사이트를 얻을 수 있도록 작성하세요.",
      "- 첫 장에는 강한 훅을 넣으세요.",
      "- 이후 내용은 소스와 브랜드 맥락에 맞춰 공감, 정보성, 사례 정리, 문제 인식, 실용 인사이트 중 가장 적절한 방식으로 구성하세요.",
      "- 필요한 경우 놀라움, 공감, 불안, 욕망 같은 심리적 동기를 활용해도 됩니다.",
      "- 다만 과장, 공포 조장, 클릭베이트는 피하세요.",
      "",
      "작성 품질 규칙:",
      "- 정확성 > 명확성 > 구체성 > 말투 > 스타일 순서로 우선하세요.",
      "- 쉬운 단어와 능동형 문장을 사용하고, 한 문장에는 하나의 핵심 생각만 담으세요.",
      "- 추상적인 표현보다 입력에서 확인되는 구체적인 상황과 기준을 사용하세요.",
      "- 제목과 첫 훅은 주제 명확성, 대상 적합성, 다음 내용을 읽게 만드는 궁금증을 갖춰야 합니다.",
      "- 의미 없는 반전 문장, 과도한 의미 부여, 근거 없는 권위 표현, 같은 길이의 반복 문장을 피하세요.",
      "- 실제 사례 정보가 입력에 있을 때만 이야기 구조를 사용하세요. 인물, 사건, 결과를 만들어내지 마세요.",
      "",
      "출력 규칙:",
      "- JSON만 반환하세요.",
      "- 한국어로 작성하세요.",
      "- 마크다운은 사용하지 마세요.",
      "- 최종 카드뉴스 레이아웃이 아니라 여러 게시 위치에서 재사용 가능한 콘텐츠 기획 초안을 만드세요.",
      "- 최종 콘텐츠 문안에 로고 삽입 지시나 브랜드명을 직접 노출하는 문구를 넣지 마세요.",
      "- 출력에는 반드시 다음 필드만 포함하세요:",
      "  title, contentTheme, coreMessage, targetAudience, customerProblem, keyPoints, supportingEvidence."
    ].join("\n"),
    user: [
      "브랜드 프로필:",
      `- name: ${brand.name}`,
      `- industry: ${brand.industry ?? ""}`,
      `- primaryCustomer: ${brand.primaryCustomer ?? ""}`,
      `- serviceDescription: ${brand.serviceDescription ?? ""}`,
      `- tone: ${brand.tone ?? ""}`,
      "",
      ...(topic
        ? [
            "주제표 자료:",
            `- topicTitle: ${topic.topicTitle}`,
            `- topicAngle: ${topic.topicAngle}`,
            `- targetCustomer: ${topic.targetCustomer ?? ""}`,
            `- region: ${topic.region ?? ""}`,
            `- season: ${topic.season ?? ""}`,
            `- referenceUrl: ${topic.referenceUrl ?? ""}`,
            `- notes: ${topic.notes ?? ""}`,
            ""
          ]
        : []),
      "소스 자료:",
      ...(input.sourceMaterials.length > 0
        ? input.sourceMaterials.flatMap((material, index) => [
            `${index + 1}.`,
            `- sourceType: ${material.sourceType}`,
            `- contentUrl: ${material.contentUrl}`,
            `- content: ${material.content ?? ""}`
          ])
        : ["- 제공된 소스 자료 없음"])
    ].join("\n")
  };
}

function short(value: string | null | undefined, maxLength: number) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

export function buildMasterDraft(input: MasterDraftInput): MasterDraft {
  const brand = input.brandProfile;
  const topic = input.topicMaterial;
  const audience = topic?.targetCustomer?.trim() || brand.primaryCustomer?.trim() || "브랜드 고객";
  const service = brand.serviceDescription?.trim() || brand.industry?.trim() || brand.name;
  const supportingEvidence = input.sourceMaterials
    .filter((material) => material.contentUrl.trim())
    .slice(0, 5)
    .map((material) => `${material.sourceType} 소스: ${material.contentUrl} / ${short(material.content, 220)}`);
  const topicEvidence = topic
    ? [`주제표에서 확인한 내용: ${[topic.topicTitle, topic.topicAngle, topic.region, topic.season, topic.notes].filter(Boolean).join(" / ")}`]
    : [];
  const evidence = supportingEvidence.length > 0 ? supportingEvidence : topicEvidence;

  return {
    title: topic?.topicTitle?.trim() || `${brand.name} 콘텐츠 인사이트`,
    contentTheme: topic?.topicAngle?.trim() || `${service} 관련 인사이트`,
    coreMessage: topic
      ? `${topic.topicTitle}에 대해 ${audience}이 바로 판단할 수 있는 기준을 정리합니다.`
      : `${service}을 확인하는 사람에게 실행 가능한 판단 기준을 정리합니다.`,
    targetAudience: audience,
    customerProblem: topic
      ? `${audience}은 ${topic.topicTitle}을 준비할 때 무엇을 먼저 확인해야 하는지 판단하기 어렵습니다.`
      : `${audience}은 관련 정보를 확인할 때 핵심 기준과 근거를 빠르게 파악하기 어렵습니다.`,
    keyPoints: [
      `${brand.name}의 사업 맥락에 맞춰 핵심 정보를 정리합니다.`,
      "자사 소스를 우선 근거로 사용하고 참고 소스는 맥락 파악에 활용합니다.",
      "구체적인 주장과 근거를 구분해 여러 게시 위치에서 재사용할 수 있게 구성합니다."
    ],
    supportingEvidence: evidence.length > 0
      ? evidence
      : ["제공된 소스 자료가 없어 브랜드 프로필을 기준으로 초안을 구성했습니다."]
  };
}

export function buildChannelOutputs({
  brandName: _brandName,
  defaultCta: _defaultCta,
  masterDraft
}: {
  brandName: string;
  defaultCta: string | null;
  masterDraft: MasterDraft;
}): GeneratedChannelOutput[] {
  const sourceSummary = masterDraft.supportingEvidence[0] || "브랜드 프로필과 소스 자료를 기반으로 생성했습니다.";
  return [
    {
      channel: "threads",
      title: short(masterDraft.title || masterDraft.coreMessage, 72),
      previewTitle: short(masterDraft.coreMessage, 120),
      previewBody: short(masterDraft.customerProblem, 180),
      sourceSummary,
      blockReasons: [],
      outputJson: {
        body: `${masterDraft.coreMessage}\n\n${masterDraft.keyPoints.join("\n")}`,
        linkPolicy: "brand_link_optional"
      }
    }
  ];
}

export interface OpenAIMasterDraftOptions {
  apiKey: string;
  model: string;
  input: MasterDraftInput;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface OpenAIMasterDraftResult {
  draft: MasterDraft;
  responseId: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  requestMetadata: Record<string, unknown>;
  responseMetadata: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function extractOpenAIError(payload: unknown) {
  const record = asRecord(payload);
  const error = asRecord(record?.error);
  return typeof error?.message === "string" ? error.message : "unknown_error";
}

async function fetchWithTimeout(url: string, init: RequestInit, fetchImpl: typeof fetch, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("openai_response_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractOpenAIOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const itemRecord = asRecord(item);
    const content = Array.isArray(itemRecord?.content) ? itemRecord.content : [];
    for (const contentItem of content) {
      const contentRecord = asRecord(contentItem);
      if (typeof contentRecord?.text === "string") return contentRecord.text;
    }
  }
  throw new Error("openai_response_missing_output_text");
}

function parseMasterDraftJson(text: string): MasterDraft {
  const parsed = asRecord(JSON.parse(text));
  if (!parsed) throw new Error("openai_response_invalid_master_draft");
  const keyPoints = Array.isArray(parsed.keyPoints) ? parsed.keyPoints.filter((item): item is string => typeof item === "string") : [];
  const supportingEvidence = Array.isArray(parsed.supportingEvidence)
    ? parsed.supportingEvidence.filter((item): item is string => typeof item === "string")
    : [];
  const draft = {
    title: typeof parsed.title === "string" ? parsed.title : "",
    contentTheme: typeof parsed.contentTheme === "string" ? parsed.contentTheme : "",
    coreMessage: typeof parsed.coreMessage === "string" ? parsed.coreMessage : "",
    targetAudience: typeof parsed.targetAudience === "string" ? parsed.targetAudience : "",
    customerProblem: typeof parsed.customerProblem === "string" ? parsed.customerProblem : "",
    keyPoints,
    supportingEvidence
  } satisfies MasterDraft;
  if (!draft.title || !draft.contentTheme || !draft.coreMessage || !draft.targetAudience || !draft.customerProblem) {
    throw new Error("openai_response_invalid_master_draft");
  }
  return draft;
}

export async function generateMasterDraftWithOpenAI(options: OpenAIMasterDraftOptions): Promise<OpenAIMasterDraftResult> {
  const prompt = buildMasterDraftPrompt(options.input);
  const requestMetadata = {
    api: MASTER_DRAFT_PROMPT_SPEC.api,
    responseName: MASTER_DRAFT_PROMPT_SPEC.responseName,
    prompt,
    schema: MASTER_DRAFT_PROMPT_SPEC.schema
  };
  const body = {
    model: options.model,
    input: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user }
    ],
    text: {
      format: {
        type: "json_schema",
        name: MASTER_DRAFT_PROMPT_SPEC.responseName,
        schema: MASTER_DRAFT_PROMPT_SPEC.schema,
        strict: true
      }
    }
  };
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }, fetchImpl, options.timeoutMs ?? 30000);
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`openai_response_failed:${response.status}:${extractOpenAIError(payload)}`);
  }
  const draft = parseMasterDraftJson(extractOpenAIOutputText(payload));
  const usage = asRecord(payload.usage) ?? {};
  const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0) || 0;
  const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0) || 0;
  return {
    draft,
    responseId: typeof payload.id === "string" ? payload.id : null,
    usage: { inputTokens, outputTokens },
    requestMetadata,
    responseMetadata: {
      responseId: typeof payload.id === "string" ? payload.id : null,
      usage: { inputTokens, outputTokens },
      draft
    }
  };
}
