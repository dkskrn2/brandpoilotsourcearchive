import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LibraryGateway } from "../../features/libraries/libraryGateway";
import { libraryGateway } from "../../features/libraries/libraryGateway";
import {
  createChannelCapabilityGateway,
  type ChannelCapabilityState,
} from "../../features/channels/channelCapabilityGateway";
import type {
  AiContentGateway,
  ContentChannelTarget,
  ContentFamily,
  ContentOutputFormatV2,
  ContentProposalBatch,
  ContentProposalRecord,
  ContentProposalRecordV2,
  ContentReferenceSelectionV2,
  ContentSetupSection,
  GenerationAttachment,
} from "../../features/ai-content/types";
import { createContentWizardState, transitionContentWizard } from "../../features/ai-content/contentWizardMachine";
import { contentGenerationFieldError } from "../../features/ai-content/aiContentApiGateway";
import { ContentFamilyStep } from "./ContentFamilyStep";
import { ContentSubjectStep, isApprovedActiveProduct, type ContentSubjectMode } from "./ContentSubjectStep";
import { ContentReferenceSeedPicker } from "./ContentReferenceSeedPicker";
import { ContentStrategyStep } from "./ContentStrategyStep";
import { ContentProposalComparison } from "./ContentProposalComparison";
import { ReferenceAvatarStep, type BrandStyleImagePreview } from "./ReferenceAvatarStep";
import { AiContentAttachmentUploader } from "./AiContentAttachmentUploader";
import { PageGuideButton } from "../layout/PageHeader";
import { api, ApiRequestError } from "../../lib/apiClient";
import { brandCenterGateway } from "../../features/brand-center/brandCenterGateway";

const phases = ["콘텐츠 생성", "구성안 선택", "생성", "변경·검토·보완"];
const sections: Array<[ContentSetupSection, string]> = [
  ["intent", "1. 목적"], ["sources", "2. 주제·자료"], ["delivery", "3. 채널·형식"],
];

const validationFieldLabels = {
  contentFamily: "목적",
  subject: "주제·자료",
  channelTargets: "채널",
  outputFormat: "결과 형식",
  references: "레퍼런스",
  avatar: "아바타",
  outputCount: "생성 개수",
} as const;

function validationMessage(error: unknown) {
  if (error instanceof ApiRequestError && error.errorCode === "ai_content_limit_reached") {
    return "오늘 AI 콘텐츠 생성 10회를 모두 사용했습니다. 내일 00:00(KST)에 다시 사용할 수 있습니다.";
  }
  const mapped = contentGenerationFieldError(error);
  return mapped ? `${validationFieldLabels[mapped.field]} 입력을 확인해 주세요.` : null;
}

type ContentLibraries = Pick<LibraryGateway, "listProductServices">;
type ChannelCapabilityGateway = ReturnType<typeof createChannelCapabilityGateway>;
type ReferenceTrendGateway = Pick<typeof api, "searchInstagramTrends" | "saveInstagramTrendSource">;
type RulesGateway = Pick<typeof brandCenterGateway, "getRules">;
type StyleAssetGateway = Pick<LibraryGateway, "getReference">;

function requestRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function ContentProposalFlow({
  brandId,
  gateway,
  libraries = libraryGateway,
  channelCapabilities,
  initialBatchId = null,
  initialSeedReferenceId = null,
  onSeedReferenceInvalid,
  assetGateway = libraryGateway,
  rulesGateway = brandCenterGateway,
  initialAnalyzedSubjectId = null,
  initialSetup,
  referenceTrendGateway = api,
}: {
  brandId: string;
  gateway: AiContentGateway;
  libraries?: ContentLibraries;
  channelCapabilities?: ChannelCapabilityGateway;
  initialBatchId?: string | null;
  initialSeedReferenceId?: string | null;
  onSeedReferenceInvalid?(): void;
  assetGateway?: StyleAssetGateway;
  rulesGateway?: RulesGateway;
  initialAnalyzedSubjectId?: string | null;
  referenceTrendGateway?: ReferenceTrendGateway;
  initialSetup?: {
    family: ContentFamily | null;
    topic: string;
    format: ContentOutputFormatV2 | "single_image" | "channel_text" | null;
    channels: ContentChannelTarget[];
    brief: string;
  };
}) {
  const navigate = useNavigate();
  const capabilityGateway = useRef(channelCapabilities ?? createChannelCapabilityGateway());
  const [machine, setMachine] = useState(createContentWizardState);
  const [family, setFamily] = useState<ContentFamily | null>(initialSetup?.family ?? null);
  const [subjectMode, setSubjectMode] = useState<ContentSubjectMode>("topic_text");
  const [topic, setTopic] = useState(initialSetup?.topic ?? "");
  const [topicUrl, setTopicUrl] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [products, setProducts] = useState<Awaited<ReturnType<ContentLibraries["listProductServices"]>>>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [format, setFormat] = useState<ContentOutputFormatV2>(
    initialSetup?.format === "card_news" || initialSetup?.format === "blog" || initialSetup?.format === "reel" || initialSetup?.format === "marketing_content"
      ? initialSetup.format
      : "card_news",
  );
  const [channel, setChannel] = useState<ContentChannelTarget | null>(initialSetup?.channels[0] ?? null);
  const [contentInstruction, setContentInstruction] = useState(initialSetup?.brief ?? "");
  const [batch, setBatch] = useState<ContentProposalBatch | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<ContentProposalRecord | ContentProposalRecordV2 | null>(null);
  const [selectedReferences, setSelectedReferences] = useState<ContentReferenceSelectionV2[]>([]);
  const [selectedGenerationId, setSelectedGenerationId] = useState<string | null>(null);
  const [styleImages, setStyleImages] = useState<BrandStyleImagePreview[]>([]);
  const [selectedAvatarStyleImageId, setSelectedAvatarStyleImageId] = useState<string | null>(null);
  const [userImageInstruction, setUserImageInstruction] = useState("");
  const [attachments, setAttachments] = useState<GenerationAttachment[]>([]);
  const [styleLoadError, setStyleLoadError] = useState<string | null>(null);
  const [loadingProposal, setLoadingProposal] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [capabilityState, setCapabilityState] = useState<ChannelCapabilityState>(
    capabilityGateway.current.getState(),
  );
  const idempotencyKey = useRef(crypto.randomUUID());
  const selectionKey = useRef(crypto.randomUUID());
  const generationStartKey = useRef(crypto.randomUUID());
  const previousBrandId = useRef(brandId);
  const activeBrandId = useRef(brandId);
  const resumableBatchScope = useRef({ batchId: initialBatchId, brandId });
  activeBrandId.current = brandId;

  const proposals = batch?.proposals ?? [];
  const selectedProduct = products.find((item) => item.id === selectedProductId);
  const summary = useMemo(() => [
    family === "informational" ? "정보성" : family === "marketing" ? "마케팅성" : "목적 미정",
    subjectMode === "reference"
      ? `레퍼런스 ${selectedReferences.length}개`
      : subjectMode === "topic_url"
        ? topicUrl || "URL 미정"
        : topic || "주제 미정",
    family === "marketing" ? selectedProduct?.displayName ?? "제품·서비스 미정" : null,
    format || "형식 미정",
    channel ?? "업로드 방식 미정",
  ].filter((item): item is string => Boolean(item)), [channel, family, format, selectedProduct?.displayName, selectedReferences.length, subjectMode, topic, topicUrl]);

  async function loadBatch(batchId: string, signal?: AbortSignal, requestedBrandId = brandId) {
    const next = await gateway.getProposalBatch(requestedBrandId, batchId, signal);
    if (signal?.aborted || activeBrandId.current !== requestedBrandId) return;
    const request = requestRecord(next.request);
    if (request.contractVersion === "content-orchestration.v2") {
      if (request.purpose === "informational" || request.purpose === "marketing") setFamily(request.purpose);
      const seed = requestRecord(request.seed);
      if (seed.kind === "topic_text" && typeof seed.title === "string") {
        setSubjectMode("topic_text");
        setTopic(seed.title);
      } else if (seed.kind === "topic_url" && typeof seed.url === "string") {
        setSubjectMode("topic_url");
        setTopicUrl(seed.url);
      } else if (seed.kind === "reference" && Array.isArray(seed.items)) {
        setSubjectMode("reference");
        setSelectedReferences(seed.items.flatMap((item) => {
          const row = requestRecord(item);
          const roles = Array.isArray(row.roles)
            ? row.roles.filter((role): role is ContentReferenceSelectionV2["roles"][number] =>
              role === "planning" || role === "copy_pattern" || role === "visual_composition")
            : [];
          return typeof row.referenceId === "string" && roles.length > 0
            ? [{ referenceId: row.referenceId, roles }]
            : [];
        }));
      }
      if (typeof request.contentInstruction === "string") setContentInstruction(request.contentInstruction);
      else setContentInstruction("");
      setSelectedProductId(typeof request.productId === "string" ? request.productId : null);
      const settings = requestRecord(request.outputSettings);
      if (settings.outputFormat === "card_news" || settings.outputFormat === "blog" || settings.outputFormat === "reel" || settings.outputFormat === "marketing_content") {
        setFormat(settings.outputFormat);
      }
      if (Array.isArray(settings.channelTargets) && typeof settings.channelTargets[0] === "string") {
        setChannel(settings.channelTargets[0] as ContentChannelTarget);
      }
    } else {
      const subjectInput = requestRecord(request.subjectInput);
      setFamily(request.contentFamily === "informational" || request.contentFamily === "marketing" ? request.contentFamily : next.contentFamily);
      setSubjectMode("topic_text");
      if (typeof subjectInput.topic === "string") setTopic(subjectInput.topic);
      if (subjectInput.mode === "product_service" && typeof subjectInput.productServiceId === "string") setSelectedProductId(subjectInput.productServiceId);
      const outputFormat = Array.isArray(request.outputFormats) ? request.outputFormats[0] : null;
      if (outputFormat === "card_news" || outputFormat === "blog" || outputFormat === "reel" || outputFormat === "marketing_content") setFormat(outputFormat);
      if (Array.isArray(request.channelTargets) && typeof request.channelTargets[0] === "string") setChannel(request.channelTargets[0] as ContentChannelTarget);
      if (typeof request.brief === "string") setContentInstruction(request.brief);
    }
    setBatch(next);
    if (next.status === "failed") throw new Error(next.errorCode ?? "proposal_failed");
    if (next.status === "ready") {
      setLoadingProposal(false);
      setMachine((current) => ({ ...current, phase: "proposal_selection", completedSections: ["intent", "sources", "delivery"] }));
      return;
    }
    window.setTimeout(() => {
      if (!signal?.aborted && activeBrandId.current === requestedBrandId) {
        void loadBatch(batchId, signal, requestedBrandId).catch(() => handleBatchError(requestedBrandId));
      }
    }, 900);
  }

  function handleBatchError(requestedBrandId = brandId) {
    if (activeBrandId.current !== requestedBrandId) return;
    setLoadingProposal(false);
    setError("AI 구성안을 불러오지 못했습니다. 입력을 유지한 채 다시 시도해 주세요.");
    setMachine((current) => transitionContentWizard(current, { type: "resume_batch_failed" }));
  }

  useEffect(() => {
    if (previousBrandId.current === brandId) return;
    previousBrandId.current = brandId;
    capabilityGateway.current.cancel();
    setMachine(createContentWizardState());
    setFamily(null);
    setSubjectMode("topic_text");
    setTopic("");
    setTopicUrl("");
    setSelectedProductId(null);
    setProducts([]);
    setFormat("card_news");
    setChannel(null);
    setContentInstruction("");
    setBatch(null);
    setSelectedProposal(null);
    setSelectedReferences([]);
    setSelectedGenerationId(null);
    setStyleImages([]);
    setSelectedAvatarStyleImageId(null);
    setUserImageInstruction("");
    setAttachments([]);
    setStyleLoadError(null);
    setLoadingProposal(false);
    setLoadingSubjects(false);
    setLoadingAssets(false);
    setSubmitting(false);
    setError(null);
    setNotice(null);
    setCapabilityState(capabilityGateway.current.getState());
    idempotencyKey.current = crypto.randomUUID();
    selectionKey.current = crypto.randomUUID();
    generationStartKey.current = crypto.randomUUID();
  }, [brandId]);

  useEffect(() => {
    if (resumableBatchScope.current.batchId !== initialBatchId) {
      resumableBatchScope.current = { batchId: initialBatchId, brandId };
    }
    if (!initialBatchId) return;
    if (resumableBatchScope.current.brandId !== brandId) return;
    const controller = new AbortController();
    const requestedBrandId = brandId;
    setLoadingProposal(true);
    void loadBatch(initialBatchId, controller.signal, requestedBrandId).catch(() => handleBatchError(requestedBrandId));
    return () => controller.abort();
  // initialBatchId identifies the one resumable request; gateway identity must not restart polling.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, initialBatchId]);

  void initialAnalyzedSubjectId;

  useEffect(() => {
    if (machine.phase !== "setup" || machine.activeSection !== "delivery") return;
    let current = true;
    setCapabilityState(capabilityGateway.current.getState());
    void capabilityGateway.current.load(brandId).then(() => {
      if (current) setCapabilityState(capabilityGateway.current.getState());
    });
    return () => {
      current = false;
      capabilityGateway.current.cancel();
    };
  }, [brandId, machine.activeSection, machine.phase]);

  useEffect(() => {
    if (machine.phase !== "setup" || machine.activeSection !== "sources") return;
    let current = true;
    if (family !== "marketing") {
      setLoadingSubjects(false);
      return;
    }
    setLoadingSubjects(true);
    void libraries.listProductServices(brandId).then((nextProducts) => {
      if (!current) return;
      setProducts(nextProducts);
      setSelectedProductId((currentId) => currentId && !nextProducts.some((item) =>
        item.id === currentId && isApprovedActiveProduct(item),
      ) ? null : currentId);
      setLoadingSubjects(false);
    }).catch(() => {
      if (!current) return;
      setLoadingSubjects(false);
      setError("승인된 제품·서비스를 불러오지 못했습니다. 다시 단계를 열어 시도해 주세요.");
    });
    return () => { current = false; };
  }, [brandId, family, libraries, machine.activeSection, machine.phase]);

  const complete = (section: ContentSetupSection) => setMachine((current) =>
    transitionContentWizard(current, { type: "complete_section", section }),
  );

  async function createProposal() {
    const requestedBrandId = brandId;
    const approvedProduct = family === "marketing"
      ? products.find((item) => item.id === selectedProductId && isApprovedActiveProduct(item))
      : null;
    if (
      !family
      || (subjectMode === "topic_text"
        ? !topic.trim()
        : subjectMode === "topic_url"
          ? !topicUrl.trim()
          : selectedReferences.length === 0 || selectedReferences.some((item) => item.roles.length === 0))
      || (family === "marketing" && !approvedProduct)
      || !format
      || !channel
    ) return;
    setLoadingProposal(true);
    setError(null);
    try {
      const created = await gateway.createProposalBatch(requestedBrandId, {
        idempotencyKey: idempotencyKey.current,
        request: {
          contractVersion: "content-orchestration.v2",
          brandId,
          purpose: family,
          seed: subjectMode === "topic_text"
            ? { kind: "topic_text", title: topic.trim() }
            : subjectMode === "topic_url"
              ? { kind: "topic_url", url: topicUrl.trim() }
              : { kind: "reference", items: selectedReferences },
          contentInstruction: contentInstruction.trim() || null,
          productId: family === "marketing" ? approvedProduct?.id ?? null : null,
          outputSettings: {
            outputFormat: format,
            channelTargets: [channel],
            aspectRatio: format === "blog" ? null : format === "reel" ? "9:16" : "1:1",
            outputCount: 1,
          },
        },
      });
      if (activeBrandId.current !== requestedBrandId) return;
      await loadBatch(created.batchId, undefined, requestedBrandId);
    } catch (caught) {
      if (activeBrandId.current !== requestedBrandId) return;
      const mapped = validationMessage(caught);
      if (mapped) {
        setLoadingProposal(false);
        setError(mapped);
      } else {
        handleBatchError();
      }
    }
  }

  async function loadApprovedStyleImages(requestedBrandId = brandId) {
    setLoadingAssets(true);
    setStyleLoadError(null);
    try {
      const workspace = await rulesGateway.getRules(requestedBrandId);
      if (activeBrandId.current !== requestedBrandId) return;
      const rules = workspace.active?.status === "approved" ? workspace.active.rules : null;
      const configured = rules?.designRules.referenceImages ?? [];
      const candidates = await Promise.all(configured.map(async (style): Promise<BrandStyleImagePreview | null> => {
        const reference = await assetGateway.getReference(requestedBrandId, style.referenceItemId);
        if (
          reference.kind !== "upload"
          || reference.archivedAt !== null
          || typeof reference.previewUrl !== "string"
          || !reference.previewUrl.trim()
        ) return null;
        return {
          referenceItemId: style.referenceItemId,
          title: reference.title,
          description: style.description,
          tags: style.tags,
          previewUrl: reference.previewUrl,
        };
      }));
      const loaded = candidates.filter((image): image is BrandStyleImagePreview => image !== null);
      if (activeBrandId.current !== requestedBrandId) return;
      setStyleImages(loaded);
      setSelectedAvatarStyleImageId((current) => current && loaded.some((image) => image.referenceItemId === current) ? current : null);
    } catch {
      if (activeBrandId.current !== requestedBrandId) return;
      setStyleImages([]);
      setSelectedAvatarStyleImageId(null);
      setStyleLoadError("브랜드 스타일 이미지를 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (activeBrandId.current === requestedBrandId) setLoadingAssets(false);
    }
  }

  async function chooseProposal(item: ContentProposalRecord | ContentProposalRecordV2) {
    if (submitting || loadingAssets || selectedGenerationId) return;
    const requestedBrandId = brandId;
    setError(null);
    setLoadingAssets(true);
    try {
      const generation = await gateway.selectProposal(requestedBrandId, item.id, selectionKey.current);
      if (activeBrandId.current !== requestedBrandId) return;
      setSelectedProposal(item);
      setSelectedGenerationId(generation.id);
      setStyleImages([]);
      setSelectedAvatarStyleImageId(null);
      setUserImageInstruction("");
      setAttachments([]);
      setMachine((current) => transitionContentWizard(current, { type: "select_proposal", proposalId: item.id }));
      await loadApprovedStyleImages(requestedBrandId);
    } catch (caught) {
      if (activeBrandId.current !== requestedBrandId) return;
      setLoadingAssets(false);
      setError(validationMessage(caught) ?? "구성안을 선택하지 못했습니다. 입력을 유지한 채 다시 시도해 주세요.");
    }
  }

  const finalAttachmentRoles = new Set<GenerationAttachment["role"]>([
    "product_image", "visual_reference", "supporting_image",
  ]);
  const attachmentsReady = attachments.every((attachment) => (
    finalAttachmentRoles.has(attachment.role)
    && attachment.uploadStatus !== "pending"
    && attachment.uploadStatus !== "failed"
    && Boolean(attachment.storagePath && attachment.storageUrl)
  ));

  async function generate() {
    if (!selectedProposal || !selectedGenerationId || submitting || !attachmentsReady) return;
    const requestedBrandId = brandId;
    if (!gateway.updateFinalizationDraft || !gateway.startGenerationV2) {
      setError("최종 생성 API를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const attachmentIds = attachments
        .filter((attachment) => finalAttachmentRoles.has(attachment.role))
        .map((attachment) => attachment.id);
      await gateway.updateFinalizationDraft(requestedBrandId, selectedGenerationId, {
        contractVersion: "content-finalization-draft.v2",
        avatarStyleImageId: selectedAvatarStyleImageId,
        userImageInstruction: userImageInstruction.trim() || null,
        attachmentIds,
      });
      if (activeBrandId.current !== requestedBrandId) return;
      await gateway.startGenerationV2(requestedBrandId, selectedGenerationId, generationStartKey.current);
      if (activeBrandId.current !== requestedBrandId) return;
      setMachine((current) => transitionContentWizard(current, { type: "start_generation" }));
      navigate(`/ai-content/${selectedGenerationId}`);
    } catch (caught) {
      if (activeBrandId.current !== requestedBrandId) return;
      setError(validationMessage(caught) ?? "선택한 구성안으로 생성을 시작하지 못했습니다. 다시 시도해 주세요.");
      setSubmitting(false);
    }
  }

  return <div className="content ai-content-wizard content-proposal-flow">
    <header className="wizard-header" data-guide="content-proposal-header">
      <div><p>AI 콘텐츠 스튜디오</p><h1>새 AI 콘텐츠</h1></div>
      <PageGuideButton />
    </header>
    <ol className="content-phase-progress" aria-label="콘텐츠 생성 단계">{phases.map((phase, index) =>
      <li key={phase} aria-current={phases[index] === (machine.phase === "setup" ? phases[0] : machine.phase === "proposal_selection" ? phases[1] : machine.phase === "generating" ? phases[2] : phases[3]) ? "step" : undefined}>
        <span>{index + 1}</span>{phase}
      </li>,
    )}</ol>
    {machine.phase === "setup" ? <div className="content-setup-layout">
      <main className="content-setup-accordions" data-guide="content-setup">{sections.map(([section, title]) => {
        const open = machine.activeSection === section;
        const completeSection = machine.completedSections.includes(section);
        return <section className={`content-setup-section${open ? " is-open" : ""}`} key={section}>
          <button type="button" className="content-accordion-trigger" aria-expanded={open} onClick={() => setMachine((current) => transitionContentWizard(current, { type: "open_section", section }))}>
            <span>{title}</span>{completeSection ? <small>완료 · 수정 가능</small> : null}
          </button>
          {open ? <div className="content-accordion-panel">
            {section === "intent" ? <ContentFamilyStep value={family} onChange={(next) => {
              setFamily(next);
              if (next === "informational") setSelectedProductId(null);
            }} onComplete={() => complete("intent")} /> : null}
            {section === "sources" ? <ContentSubjectStep
              purpose={family ?? "informational"}
              mode={subjectMode}
              topicText={topic}
              topicUrl={topicUrl}
              contentInstruction={contentInstruction}
              products={products}
              selectedProductId={selectedProductId}
              referencePicker={<ContentReferenceSeedPicker
                key={`${brandId}:${format}`}
                brandId={brandId}
                format={format}
                selected={selectedReferences}
                onChange={setSelectedReferences}
                referenceGateway={gateway}
                trendGateway={referenceTrendGateway}
                initialReferenceId={initialSeedReferenceId}
                onInitialReferenceInvalid={() => {
                  setNotice("요청한 레퍼런스는 현재 사용할 수 없어 선택에서 제거했습니다.");
                  onSeedReferenceInvalid?.();
                }}
              />}
              referenceValid={selectedReferences.length > 0 && selectedReferences.every((item) => item.roles.length > 0)}
              loading={loadingSubjects}
              onModeChange={setSubjectMode}
              onTopicTextChange={setTopic}
              onTopicUrlChange={setTopicUrl}
              onContentInstructionChange={setContentInstruction}
              onProductChange={setSelectedProductId}
              onComplete={() => complete("sources")}
            /> : null}
            {section === "delivery" ? <ContentStrategyStep
              outputFormat={format}
              channelTarget={channel}
              loading={loadingProposal}
              capabilityState={capabilityState}
              onFormatChange={(next) => {
                if (next !== format && subjectMode === "reference") {
                  setSelectedReferences([]);
                  setMachine((current) => current.phase === "setup"
                    ? {
                      ...current,
                      activeSection: "sources",
                      completedSections: current.completedSections.filter((section) => section !== "sources" && section !== "delivery"),
                      selectedProposalId: null,
                    }
                    : current);
                }
                setFormat(next);
              }}
              onChannelChange={setChannel}
              onSubmit={() => void createProposal()}
            /> : null}
          </div> : null}
        </section>;
      })}</main>
      <aside className="content-input-summary"><h2>입력 요약</h2><ul>{summary.map((item) => <li key={item}>{item}</li>)}</ul>{loadingProposal ? <p>검증된 입력으로 구성안을 만들고 있습니다.</p> : null}</aside>
    </div> : null}
    {machine.phase === "proposal_selection" && proposals.length
      ? <><aside className="content-input-summary proposal-input-summary" aria-label="복원된 입력 요약">
          <h2>입력 요약</h2><ul>{summary.map((item) => <li key={item}>{item}</li>)}</ul>
        </aside>
        <div data-guide="content-proposal-selection"><ContentProposalComparison
          proposals={proposals}
          selectedId={selectedProposal?.id ?? null}
          evidence={batch?.researchEvidence?.items ?? []}
          references={batch?.selectedReferences ?? []}
          disabled={loadingAssets || submitting || Boolean(selectedGenerationId)}
          onSelect={(item) => void chooseProposal(item)}
        /></div>
        {selectedProposal ? <ReferenceAvatarStep
          styleImages={styleImages}
          selectedAvatarStyleImageId={selectedAvatarStyleImageId}
          userImageInstruction={userImageInstruction}
          outputFormat={"conceptKey" in selectedProposal.proposal ? selectedProposal.proposal.outputFormat : format}
          loading={loadingAssets}
          loadError={styleLoadError}
          submitting={submitting}
          attachmentsReady={attachmentsReady && Boolean(selectedGenerationId)}
          attachmentUploader={<AiContentAttachmentUploader
            gateway={gateway}
            brandId={brandId}
            generationId={selectedGenerationId}
            attachments={attachments}
            totalAttachmentCount={attachments.length}
            allowedRoles={["product_image", "visual_reference", "supporting_image"]}
            disabled={submitting || !selectedGenerationId}
            onChange={setAttachments}
          />}
          onAvatarStyleImageChange={setSelectedAvatarStyleImageId}
          onUserImageInstructionChange={setUserImageInstruction}
          onRetry={() => void loadApprovedStyleImages()}
          onGenerate={() => void generate()}
        /> : null}</>
      : null}
    {notice ? <p className="wizard-notice" role="alert">{notice}</p> : null}
    {error ? <p className="wizard-error" role="alert">{error}</p> : null}
  </div>;
}
