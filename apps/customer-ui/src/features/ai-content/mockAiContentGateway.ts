import type {
  AiContentDraft,
  AiContentGateway,
  AiContentGeneration,
  AiContentReference,
  AiContentUsage,
  AiGenerationOutput,
  GenerationBrief,
  LegacySubjectAnalysisInput,
  AppealPreset,
  AudiencePreset,
  SubjectAnalysis,
  SubjectAnalysisInput,
} from "./types";
import type { PublishArtifactAsset } from "../../types";

const usage: AiContentUsage = {
  generationUsed: 2,
  generationLimit: 5,
  newDownloadUsed: 3,
  newDownloadLimit: 10,
  resetsAt: "2026-07-19T00:00:00+09:00"
};

const cardNewsImage: PublishArtifactAsset = {
  url: "https://picsum.photos/seed/card-news-preview/1200/1200",
  fileName: "card-news-cover.png",
  mimeType: "image/png",
  width: 1200,
  height: 1200
};

const emptyDraft = (type: AiContentDraft["type"]): AiContentDraft => ({
  type,
  subjectType: null,
  subjectInput: { sourceUrl: "", name: "", promotion: "", description: "" },
  subjectAnalysisId: null,
  subjectAnalysisVersion: null,
  selectedSubjectImageIds: [],
  selectedTarget: null,
  selectedAppeal: null,
  appealOverridesByTarget: {},
  referenceIds: [],
  brief: { purpose: "" as GenerationBrief["purpose"], emphasis: "", cta: "", additionalInstruction: "", selectedColor: "#0057B8", attachments: [], aspectRatio: "1:1", outputCount: 1, outputDirections: [""] },
  analysisSource: "owned",
  productUrl: "",
  selectedAnalysisImageIds: [],
  audience: null,
  coreAppeal: null,
  secondaryAppeals: [],
});

const artifact = (
  queueId: string,
  kind: "html" | "image" | "image_gallery",
  assets: PublishArtifactAsset[] = [],
  text = "카피: 핵심 메시지입니다."
): NonNullable<AiGenerationOutput["artifact"]> => ({
  queueId,
  kind,
  deliveryFormat: null,
  assets: assets.map((item) => ({ ...item, width: item.width ?? null, height: item.height ?? null })),
  posterUrl: null,
  html: kind === "html" ? "<article><h1>운영 가이드</h1></article>" : null,
  text
});

const jobs: AiContentGeneration[] = [
  {
    id: "generation-generating",
    brandId: "brand-demo",
    title: "여름 캠페인 카드뉴스",
    type: "card_news",
    status: "generating",
    currentStep: 5,
    draft: emptyDraft("card_news"),
    outputs: [{ id: "output-generating", generationId: "generation-generating", title: "카드뉴스", status: "generating", artifact: null, failureReason: null, downloadedAt: null }],
    createdAt: "2026-07-18T06:30:00.000Z",
    updatedAt: "2026-07-18T06:34:00.000Z"
  },
  {
    id: "generation-planning",
    brandId: "brand-demo",
    title: "마케팅 사전 기획",
    type: "marketing",
    status: "planning",
    currentStep: 3,
    draft: emptyDraft("marketing"),
    outputs: [{ id: "output-marketing-planning", generationId: "generation-planning", title: "시안 후보", status: "queued", artifact: null, failureReason: null, downloadedAt: null }],
    createdAt: "2026-07-18T03:20:00.000Z",
    updatedAt: "2026-07-18T03:40:00.000Z"
  },
  {
    id: "generation-completed",
    brandId: "brand-demo",
    title: "고객이 저장하는 운영 가이드",
    type: "blog",
    status: "completed",
    currentStep: 5,
    draft: emptyDraft("blog"),
    outputs: [{ id: "output-blog", generationId: "generation-completed", title: "운영 가이드", status: "completed", artifact: artifact("output-blog", "html"), failureReason: null, downloadedAt: null }],
    createdAt: "2026-07-17T02:00:00.000Z",
    updatedAt: "2026-07-17T02:08:00.000Z"
  },
  {
    id: "generation-card-complete",
    brandId: "brand-demo",
    title: "여름 추천 카드뉴스",
    type: "card_news",
    status: "completed",
    currentStep: 5,
    draft: emptyDraft("card_news"),
    outputs: [
      {
        id: "output-card-news",
        generationId: "generation-card-complete",
        title: "카드뉴스 표지",
        status: "completed",
        artifact: artifact("output-card-news", "image_gallery", [cardNewsImage], "핵심 메시지: 여름 캠페인 시작"),
        failureReason: null,
        downloadedAt: null
      }
    ],
    createdAt: "2026-07-17T01:00:00.000Z",
    updatedAt: "2026-07-17T01:17:00.000Z"
  },
  {
    id: "generation-partial",
    brandId: "brand-demo",
    title: "신제품 출시 마케팅 소재",
    type: "marketing",
    status: "partial_failed",
    currentStep: 5,
    draft: emptyDraft("marketing"),
    outputs: [
      { id: "output-marketing-1", generationId: "generation-partial", title: "혜택 강조형", status: "completed", artifact: artifact("output-marketing-1", "image"), failureReason: null, downloadedAt: null },
      { id: "output-marketing-2", generationId: "generation-partial", title: "문제 해결형", status: "failed", artifact: null, failureReason: "이미지 생성 실패", downloadedAt: null }
    ],
    createdAt: "2026-07-16T04:00:00.000Z",
    updatedAt: "2026-07-16T04:06:00.000Z"
  },
  {
    id: "generation-failed",
    brandId: "brand-demo",
    title: "브랜드 톤 실패 테스트",
    type: "blog",
    status: "failed",
    currentStep: 4,
    draft: emptyDraft("blog"),
    outputs: [{ id: "output-failed", generationId: "generation-failed", title: "실패 결과", status: "failed", artifact: null, failureReason: "내부 분석 데이터 오류", downloadedAt: null }],
    createdAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:04:00.000Z"
  }
];

const references: AiContentReference[] = [
  {
    id: "reference-owned-card",
    title: "고객이 저장한 체크리스트 카드뉴스",
    previewUrl: null,
    source: "owned",
    format: "card_news",
    primaryCategory: "마케팅",
    subcategory: "콘텐츠 운영",
    appealIds: [],
    comparableMetric: { label: "Instagram 노출", value: 12480 }
  },
  {
    id: "reference-owned-blog",
    title: "콘텐츠 운영 자동화 실무 가이드",
    previewUrl: null,
    source: "owned",
    format: "blog",
    primaryCategory: "마케팅",
    subcategory: "운영 자동화",
    appealIds: [],
    comparableMetric: { label: "블로그 조회", value: 2380 }
  }
];

function deterministicSubjectAnalysis(brandId: string, input: SubjectAnalysisInput, version = 1): SubjectAnalysis {
  const sourceUrl = input.sourceUrl ?? "";
  const analysisId = `subject-analysis-${brandId}-${input.subjectType}`;
  const targets = [1, 2, 3].map((index) => ({
    id: `target-${index}`,
    name: `${index === 1 ? "시간이 부족한" : index === 2 ? "비교 후 결정하는" : "처음 시작하는"} ${input.subjectType === "product" ? "제품 고객" : "서비스 고객"}`,
    traits: [`${index}번 추천 타깃의 생활 맥락`],
    painPoints: [`${index}번 타깃이 해결하려는 문제`],
    purchaseMotivations: [`${index}번 타깃의 선택 동기`],
    uspEvidence: [{ claim: "확인 가능한 핵심 특징", support: "분석 입력과 브랜드 정보에서 확인", sourceUrl }],
  })) as SubjectAnalysis["targets"];
  const appealsByTarget = Object.fromEntries(targets.map((target, targetIndex) => [target.id, [1, 2].map((appealIndex) => ({
    id: `${target.id}-appeal-${appealIndex}`,
    targetId: target.id,
    title: `${targetIndex + 1}-${appealIndex} 타깃에 맞는 소구점`,
    description: "제품·서비스의 확인 가능한 이점을 고객 상황과 연결합니다.",
    evidenceType: "product_fact" as const,
    connectionReason: `${target.name}의 문제와 직접 연결됩니다.`,
    sources: [{ title: "입력한 페이지", url: sourceUrl }],
  }))]));
  return {
    id: analysisId,
    workspaceId: "workspace-demo",
    brandId,
    subjectType: input.subjectType,
    sourceUrl,
    normalizedUrl: sourceUrl.replace(/#.*$/, ""),
    input: { ...input.manualInput },
    status: "ready",
    facts: [{ key: "입력 유형", value: input.subjectType === "product" ? "제품" : "서비스", sourceUrl }],
    structuredData: { name: input.manualInput.name || "분석 대상" },
    research: { summary: "결정론적 목 데이터" },
    targets,
    appealsByTarget,
    selectedImageId: "subject-image-1",
    images: [{ id: "subject-image-1", analysisId, sourceUrl, storageUrl: "https://blob.example.com/subject-image-1.png", storagePath: `subjects/${analysisId}/1.png`, width: 1024, height: 1024, mimeType: "image/png", altText: "대표 이미지", role: input.subjectType, selectionScore: 1, createdAt: "2026-07-20T00:00:00.000Z" }],
    analysisVersion: version,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    completedAt: "2026-07-20T00:00:00.000Z",
  };
}

function normalizeMockSubjectAnalysisInput(input: SubjectAnalysisInput | LegacySubjectAnalysisInput): SubjectAnalysisInput {
  if ("generationId" in input) return input;
  return {
    generationId: "00000000-0000-4000-8000-000000000001",
    subjectType: input.subjectType,
    sourceUrl: input.sourceUrl,
    attachmentIds: [],
    manualInput: {
      name: input.manualInput.name,
      promotionOrTerms: input.manualInput.promotion,
      description: input.manualInput.description,
    },
    idempotencyKey: input.idempotencyKey,
  };
}

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

export function createMockAiContentGateway(): AiContentGateway {
  const audienceByBrand = new Map<string, AudiencePreset[]>();
  const appealsByBrand = new Map<string, AppealPreset[]>();
  const generationRows = copy(jobs);
  const subjectRows = new Map<string, SubjectAnalysis>();

  return {
    async getUsage() {
      return copy(usage);
    },
    async getBrandContext() {
      return {
        ready: true,
        brandName: "Growthline",
        ownedUrl: "https://www.danbammsg.co.kr",
        sourceStatus: "crawled",
        lastCrawledAt: "2026-07-18T00:00:00.000Z",
        wikiVersionId: "wiki-version-1",
        wikiUpdatedAt: "2026-07-18T00:10:00.000Z",
        summary: "등록한 자사 사이트와 브랜드 정보를 정리한 최신 분석입니다.",
        pageCount: 6,
        brandColor: "#0057B8",
      };
    },
    async listGenerations(brandId) {
      return copy(generationRows.map((job) => ({ ...job, brandId })));
    },
    async getGeneration(_brandId, generationId) {
      const generation = generationRows.find((item) => item.id === generationId);
      if (!generation) throw new Error("ai_content_generation_not_found");
      return copy(generation);
    },
    async createAnalysis(brandId, input) {
      const created: AiContentGeneration = {
        id: `generation-${generationRows.length + 1}`,
        brandId,
        title: input.title,
        type: input.type,
        status: "analysis_ready",
        currentStep: 2,
        draft: copy(input.draft),
        analysis: {
          summary: "내부 확인 근거",
          evidence: [input.draft.productUrl || "등록된 자사 정보"]
        },
        outputs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      generationRows.push(created);
      return copy(created);
    },
    async updateGeneration(_brandId, generationId, input) {
      const generation = generationRows.find((item) => item.id === generationId);
      if (!generation) throw new Error("ai_content_generation_not_found");
      generation.draft = copy(input.draft);
      return copy(generation);
    },
    async startGeneration(_brandId, generationId, input) {
      const generation = generationRows.find((item) => item.id === generationId);
      if (!generation) throw new Error("ai_content_generation_not_found");
      generation.status = "queued";
      generation.outputs = Array.from({ length: input.outputCount }, (_, index) => ({ id: `output-${generationId}-${index + 1}`, generationId, title: `결과 ${index + 1}`, status: "queued", artifact: null, failureReason: null, downloadedAt: null }));
      return copy(generation);
    },
    async uploadAttachment(_brandId, _generationId, attachment) { return copy({ ...attachment, file: undefined, storageUrl: "https://blob.example.com/attachment", storagePath: "attachment" }); },
    async listAudiencePresets(brandId) {
      return copy(audienceByBrand.get(brandId) ?? []);
    },
    async saveAudiencePreset(brandId, input) {
      const rows = audienceByBrand.get(brandId) ?? [];
      const key = [input.name, input.situation, input.problem, input.motivation].map(normalize).join("|");
      const existing = rows.find((item) => [item.name, item.situation, item.problem, item.motivation].map(normalize).join("|") === key);
      if (existing) return copy(existing);
      const saved: AudiencePreset = { ...input, id: `audience-${rows.length + 1}`, useCount: 0, lastUsedAt: null };
      rows.push(saved);
      audienceByBrand.set(brandId, rows);
      return copy(saved);
    },
    async listAppealPresets(brandId) {
      return copy(appealsByBrand.get(brandId) ?? []);
    },
    async saveAppealPreset(brandId, input) {
      const rows = appealsByBrand.get(brandId) ?? [];
      const key = [input.title, input.description, input.evidenceType].map(normalize).join("|");
      const existing = rows.find((item) => [item.title, item.description, item.evidenceType].map(normalize).join("|") === key);
      if (existing) return copy(existing);
      const saved: AppealPreset = { ...input, id: `appeal-${rows.length + 1}`, useCount: 0, lastUsedAt: null };
      rows.push(saved);
      appealsByBrand.set(brandId, rows);
      return copy(saved);
    },
    async listReferences() {
      return copy(references);
    },
    async retryOutput(_brandId, outputId, reason) {
      if (!reason.trim()) throw new Error("retry_reason_required");
      const output = generationRows.flatMap((job) => job.outputs).find((item) => item.id === outputId);
      if (!output) throw new Error("ai_content_output_not_found");
      if (output.status !== "failed") throw new Error("ai_content_output_not_failed");
      output.status = "queued";
      output.failureReason = null;
      return copy(output);
    },
    async downloadOutput(_brandId, outputId) { return { blob: new Blob([outputId], { type: "application/zip" }), fileName: `${outputId}.zip` }; },
    async downloadGeneration(_brandId, generationId) { return { blob: new Blob([generationId], { type: "application/zip" }), fileName: `${generationId}.zip` }; },
    async publishOutput(_brandId, outputId, input) {
      return {
        outputId,
        publishGroupId: `publish-${outputId}`,
        targets: input.targets.map((target, index) => ({
          ...target,
          channelOutputId: `channel-output-${outputId}-${index}`,
          queueId: `queue-${outputId}-${index}`,
          status: "published" as const,
          publishedUrl: `https://example.com/published/${outputId}/${index}`,
          errorCode: null,
        })),
      };
    },
    async listChannels() {
      return [{
        type: "instagram" as const,
        label: "Instagram",
        enabled: true,
        oauthState: "connected" as const,
        status: "connected" as const,
        accountLabel: "@growthline352",
        lastHealthyAt: "2026-07-20T00:00:00.000Z",
        lastPublishedAt: "2026-07-20T00:00:00.000Z",
      }];
    },
    async getCachedSubjectAnalysis(brandId, subjectType, sourceUrl) {
      return copy(subjectRows.get(`${brandId}:${subjectType}:${sourceUrl}`) ?? null);
    },
    async requestSubjectAnalysis(brandId, input) {
      const key = `${brandId}:${input.subjectType}:${input.sourceUrl}`;
      const existing = subjectRows.get(key);
      if (existing && !("force" in input && input.force)) return copy(existing);
      const next = deterministicSubjectAnalysis(brandId, normalizeMockSubjectAnalysisInput(input), existing ? existing.analysisVersion + 1 : 1);
      subjectRows.set(key, next);
      return copy(next);
    },
    async getSubjectAnalysis(brandId, analysisId) {
      const analysis = [...subjectRows.values()].find((item) => item.brandId === brandId && item.id === analysisId);
      if (!analysis) throw new Error("subject_analysis_not_found");
      return copy(analysis);
    },
    async regenerateSubjectAppeals(brandId, analysisId) {
      const analysis = await this.getSubjectAnalysis(brandId, analysisId);
      analysis.appealsByTarget = Object.fromEntries(Object.entries(analysis.appealsByTarget).map(([targetId, appeals]) => [
        targetId,
        appeals.map((appeal, index) => ({ ...appeal, id: `${targetId}-regenerated-${index + 1}`, title: `${appeal.title} 새 추천` })),
      ]));
      subjectRows.set(`${brandId}:${analysis.subjectType}:${analysis.sourceUrl}`, analysis);
      return copy(analysis);
    },
    async reanalyzeSubject(brandId, analysisId, idempotencyKey) {
      const analysis = await this.getSubjectAnalysis(brandId, analysisId);
      const input: SubjectAnalysisInput = {
        generationId: analysis.generationId ?? "00000000-0000-4000-8000-000000000001",
        subjectType: analysis.subjectType,
        sourceUrl: analysis.sourceUrl || null,
        attachmentIds: [],
        manualInput: {
          name: analysis.input.name,
          promotionOrTerms: analysis.input.promotionOrTerms ?? analysis.input.promotion ?? "",
          description: analysis.input.description,
        },
        idempotencyKey,
      };
      const next = deterministicSubjectAnalysis(brandId, input, analysis.analysisVersion + 1);
      subjectRows.set(`${brandId}:${input.subjectType}:${input.sourceUrl}`, next);
      return copy(next);
    },
    async selectSubjectImage(brandId, analysisId, imageId) {
      const analysis = await this.getSubjectAnalysis(brandId, analysisId);
      if (!analysis.images.some((image) => image.id === imageId)) throw new Error("subject_analysis_image_not_found");
      analysis.selectedImageId = imageId;
      subjectRows.set(`${brandId}:${analysis.subjectType}:${analysis.sourceUrl}`, analysis);
      return copy(analysis);
    }
  };
}

export const mockAiContentGateway = createMockAiContentGateway();
