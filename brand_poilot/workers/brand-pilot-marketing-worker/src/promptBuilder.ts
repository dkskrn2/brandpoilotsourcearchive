import { parseContentGenerationInput, type MarketingJob } from "./contracts.js";
import { requestedDimensions } from "./manifest.js";
import { buildAiContentRevisionInstruction } from "@brand-pilot/worker-runtime";
import type { ContentGenerationInputV3 } from "@brand-pilot/worker-runtime";

export const marketingSkillVersion = "marketing-creative-skill.v5";
export const marketingPlanSkillVersion = "marketing-plan-skill.v2";

const fixedLogoPolicy = {
  allowGeneratedLogo: false,
  allowReservedLogoArea: false,
  allowExternalReferenceLogo: false,
  allowExistingProductPackagingLogo: true,
} as const;

export function buildMarketingPlanPrompt(
  job: MarketingJob,
  input: ContentGenerationInputV3,
  repairError?: string,
): string {
  if (job.generationId !== input.generationId) throw new Error("content_generation_input_generation_mismatch");
  const lockedCount = input.selectedProposal.assetCount;
  if (lockedCount === null) throw new Error("marketing_plan_asset_count_invalid");
  const purposeRules = input.outputSettings.purpose === "informational"
    ? [
      "정보성 목적은 brandCore와 고정 researchEvidence를 사용해 정보 제공, 인지도, 참여 중심으로 기획하세요.",
      "제품을 언급하거나 판매 CTA를 작성하지 마세요. product는 반드시 null이며 저장, 공유, 질문 같은 비판매 참여 CTA만 허용됩니다.",
    ]
    : [
      "마케팅성 목적은 선택 proposal의 목적, 고객 상황과 니즈, 고정 제품 분석, 알려진 장점과 한계, 고효율 target segment, appeal, barrier, CTA를 구체화하세요.",
      "제품 사실은 고정 product 스냅샷만 사용하세요. researchEvidence나 시장 검색 근거로 제품 사실을 보강하거나 기능, 가격, 성과, 구매 조건을 추측하지 마세요.",
    ];
  const formatRules = input.outputSettings.outputFormat === "reel"
    ? [
      "릴스는 9:16 세로 장면 패키지입니다. 각 asset에 모바일 세로 구도를 명확히 하는 vertical visualDirection과 해당 장면 copy를 작성하세요.",
      "영상 길이, 전환, FFmpeg 조립은 후속 finalizer 책임이며 여기서는 이미지나 영상을 생성하지 마세요.",
    ]
    : [
      "marketing_content는 선택 채널에 바로 사용할 channel copy와 이미지 자산을 하나의 imagePackage로 기획하세요.",
      "이미지나 파일은 생성하지 말고 채널 caption, hashtags, CTA와 장면별 시각 지시만 반환하세요.",
    ];
  const fixedInput = {
    generationId: input.generationId,
    brandCore: input.brandCore,
    subject: input.subject,
    contentInstruction: input.contentInstruction,
    product: input.product,
    researchEvidence: input.researchEvidence,
    references: input.references,
    selectedProposal: input.selectedProposal,
    userImageInstruction: input.userImageInstruction,
    outputSettings: input.outputSettings,
    logoPolicy: fixedLogoPolicy,
  };
  return [
    "V3 릴스·마케팅 콘텐츠 상세 기획 규칙을 따르세요.",
    `계약 버전: ${marketingPlanSkillVersion}`,
    "응답은 marketing-plan.v2 JSON 하나만 반환하세요. 이미지, 영상, 텍스트 파일이나 다른 산출물은 만들지 마세요.",
    `선택 구성안에 잠긴 정확히 ${lockedCount}개 asset을 유지하고 outline의 index, role, order를 그대로 복사하세요. 장수를 다시 판단하거나 deterministic 장수 규칙을 적용하거나 장면을 추가·삭제·병합하지 마세요.`,
    ...purposeRules,
    ...formatRules,
    "각 장이 부실하지 않게 핵심 정보와 근거를 충분히 압축하되, 문장과 정보를 과밀하게 넣어 모바일 가독성을 해치지 마세요.",
    "각 사실, 수치, 최신 주장에는 researchEvidence.items에 실제 존재하는 UUID만 evidenceIds로 연결하고, 근거가 필요 없는 훅이나 CTA는 []를 사용하세요.",
    "제품 사실에는 evidenceIds를 발명하지 말고 product 스냅샷만 사용하세요.",
    "contentInstruction은 전체 카피, 메시지 구조와 채널 문구에 적용하세요.",
    "userImageInstruction은 모든 생성 이미지의 공통 시각 지시로 imagePackage에 그대로 복사하고, 카피 사실이나 전체 콘텐츠 지시로 해석하지 마세요.",
    "references.selected의 역할과 고정 스냅샷, 업로드 이미지인 brandStyleImages, avatarStyleImageId, attachments를 그대로 imagePackage에 복사하세요.",
    "각 asset에서 실제로 필요한 productImageAssetIds와 attachmentIds만 고정 목록에서 선택하세요.",
    "Wiki, FAQ, 브랜드 규칙의 색상, 폰트, 메모는 사용하지 마세요. 제공된 brandCore, product, researchEvidence, reference/style/avatar/attachment 스냅샷 외의 데이터는 조회하거나 추측하지 마세요.",
    "logoPolicy의 false/false/false/true literal을 그대로 유지하세요. 로고, 워드마크, 심볼, 워터마크, 가짜 로고, 로고용 빈 영역을 만들거나 외부 레퍼런스 로고를 복제하지 마세요. 실제 제품 포장에 원래 인쇄된 로고는 지우라고 요구하지 마세요.",
    "파일, 웹, shell, image_generation 도구를 호출하지 마세요. 제공된 고정 JSON만 사용하세요.",
    repairError
      ? `이전 출력 검증 오류: ${repairError}\n해당 오류를 고쳐 전체 JSON을 다시 반환하세요. 보정 기회는 이번 한 번뿐입니다.`
      : "첫 출력부터 exact schema와 잠긴 계약을 만족하세요.",
    "고정 입력(JSON):",
    JSON.stringify(fixedInput, null, 2),
  ].join("\n");
}

export function buildPrompt(job: MarketingJob) {
  const input = job.jobType === "generate" ? parseContentGenerationInput(job.payload.contentGenerationInput) : null;
  const dimensions = requestedDimensions((input ?? job.payload) as unknown as Record<string, unknown>);
  const outputFormat = input?.orchestration?.outputFormat ?? "single_image";
  const orchestration = input?.orchestration
    ? (({ avatar: _avatar, ...value }) => value)(input.orchestration)
    : null;
  const promptInput = input ? {
    ...input,
    orchestration,
    factualDirection: {
      brandContext: input.brandContext,
      subject: input.subject,
      target: input.message.target,
      appeal: input.message.appeal,
      qualityBrief: input.message.qualityBrief,
      orchestration,
    },
    ...(outputFormat === "single_image" && input.orchestration?.avatar
      ? { visualDirection: { avatar: input.orchestration.avatar } }
      : {}),
  } : null;
  const revisionInstruction = buildAiContentRevisionInstruction(job.payload.revision, "marketing");
  return [
    ".agents/skills/marketing-creative/SKILL.md를 읽고 따르세요.",
    `계약 버전: ${marketingSkillVersion}`,
    `현재 작업 유형: ${job.jobType}`,
    "입력 우선순위는 다음과 같이 고정합니다: 승인 Brand Core > 승인 제품·서비스 > 사용자가 확정한 target, strategy, brief > 선택 레퍼런스의 패턴 영감.",
    "마케팅성 콘텐츠는 효익·신뢰·CTA 톤을 사용하세요.",
    "generate 작업에서는 content-generation-input.v2 봉투만 입력으로 사용하세요.",
    "subject.analysisResult의 제품·서비스 프로필, subtype, 대안, 장벽과 VOC를 광고 가설의 맥락에 사용하세요.",
    "subject.facts만 제품·서비스의 사실 근거로 사용하세요. subject.research는 출처가 포함된 시장 맥락으로만 사용하세요.",
    "generate 작업에서는 message.qualityBrief.sourceGaps를 사실 근거가 부족한 금지 주장 목록으로 취급하고, 해당 내용을 사실·혜택·지원 범위로 단정하지 마세요.",
    "message.target 1개와 message.appeal 1개를 그대로 사용하세요. 타깃이나 소구점을 변경·추가하지 마세요.",
    "subject.selectedImages와 attachments의 선택된 제품·사용자 이미지를 반영하되 복제하지 마세요.",
    "references는 정보 위계, 색 대비, 시선 흐름과 표현 방식만 참고하고 문장, 인물, 로고, 고유 그래픽과 구도를 복제하지 마세요. 레퍼런스의 원문 문장을 그대로 복제하지 마세요.",
    "avatar snapshot은 single_image의 visualDirection에서만 사용하고 제품 사실, 카피 사실 또는 근거로 사용하지 마세요.",
    "creativeDirection.selectedColor를 반영하고 creativeDirection.prompts의 각 값을 해당 출력의 지시로 순서대로 보존해 사용하세요.",
    "제품 URL을 다시 가져오거나 공개 웹 검색을 수행하지 마세요. 입력 봉투에 없는 사실은 만들지 마세요.",
    "각 결과는 독립된 광고 1개와 메시지 가설 1개여야 합니다. 여러 결과는 색만 바꾸지 말고 서로 다른 메시지 가설을 사용하세요.",
    "한 명의 구체적인 대상, 하나의 핵심 혜택, 하나의 실제 행동만 전달하세요.",
    outputFormat === "channel_text"
      ? "channel_text 결과는 content.json과 UTF-8 channel-text.txt만 출력하고 이미지를 생성하지 마세요."
      : `creative.png는 정확히 ${dimensions.width}x${dimensions.height} PNG로 저장하세요. 요청된 비율에 맞춰 처음부터 구성하고 사후 크롭을 전제로 만들지 마세요.`,
    "이미지에 가짜 버튼, 플랫폼 UI, QR 코드 또는 출처 URL을 그리지 마세요.",
    "AI 광고 문구처럼 모호한 최상급 표현을 반복하지 말고 사람이 쓴 구체적인 한국어를 사용하세요.",
    "analyze 작업에서는 이미지 없이 analysis.json만 출력하세요. JSON은 반드시 {\"qualityBrief\":{\"version\":\"content-quality.v1\",\"hook\":\"...\",\"readerPayoff\":\"...\",\"whyNow\":\"...\",\"specificClaims\":[\"...\",\"...\"],\"evidence\":[{\"claim\":\"...\",\"support\":\"...\",\"sourceUrl\":\"https://...\"},{\"claim\":\"...\",\"support\":\"...\"}],\"sourceGaps\":[]}} 형태여야 하며 evidence는 2개 이상이어야 합니다.",
    outputFormat === "channel_text"
      ? "generate 작업에서는 text artifact인 channel-text.txt와 content.json만 출력하세요."
      : "generate 작업에서는 content.json과 요청 크기의 creative.png를 출력하세요.",
    "입력에 qualityBrief가 있으면 hook, readerPayoff, whyNow, specificClaims, evidence를 우선 반영하세요.",
    revisionInstruction,
    "작업 데이터(JSON):",
    JSON.stringify(promptInput ?? job.payload, null, 2),
  ].join("\n");
}
