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
  AiContentReference,
  ContentChannelTarget,
  ContentFamily,
  ContentOrchestration,
  ContentOutputFormat,
  ContentProposalBatch,
  ContentProposalRecord,
  ContentSetupSection,
} from "../../features/ai-content/types";
import { createContentWizardState, transitionContentWizard } from "../../features/ai-content/contentWizardMachine";
import { contentGenerationFieldError } from "../../features/ai-content/aiContentApiGateway";
import { ContentFamilyStep } from "./ContentFamilyStep";
import { ContentSubjectStep, type ContentSubjectMode } from "./ContentSubjectStep";
import { ContentStrategyStep } from "./ContentStrategyStep";
import { ContentProposalComparison } from "./ContentProposalComparison";
import { ReferenceAvatarStep, type SelectedReference } from "./ReferenceAvatarStep";
import { ReferenceUploadDialog } from "../references/ReferenceUploadDialog";
import { AvatarEditorDialog } from "../brand-center/AvatarEditorDialog";
import type { ReferenceItem } from "../../types";
import { PageGuideButton } from "../layout/PageHeader";

const phases = ["콘텐츠 생성", "구현안 선택", "생성", "변경·검토·보완"];
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
  const mapped = contentGenerationFieldError(error);
  return mapped ? `${validationFieldLabels[mapped.field]} 입력을 확인해 주세요.` : null;
}

type ContentLibraries = Pick<LibraryGateway, "listProductServices" | "listWikiItems" | "listAvatars">;
type ChannelCapabilityGateway = ReturnType<typeof createChannelCapabilityGateway>;

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
  initialAnalyzedSubjectId = null,
  initialSetup,
}: {
  brandId: string;
  gateway: AiContentGateway;
  libraries?: ContentLibraries;
  channelCapabilities?: ChannelCapabilityGateway;
  initialBatchId?: string | null;
  initialSeedReferenceId?: string | null;
  onSeedReferenceInvalid?(): void;
  assetGateway?: LibraryGateway;
  initialAnalyzedSubjectId?: string | null;
  initialSetup?: {
    family: ContentFamily | null;
    topic: string;
    format: ContentOutputFormat | null;
    channels: ContentChannelTarget[];
    brief: string;
  };
}) {
  const navigate = useNavigate();
  const capabilityGateway = useRef(channelCapabilities ?? createChannelCapabilityGateway());
  const [machine, setMachine] = useState(createContentWizardState);
  const [family, setFamily] = useState<ContentFamily | null>(initialSetup?.family ?? null);
  const [subjectMode, setSubjectMode] = useState<ContentSubjectMode>("brand_topic");
  const [topic, setTopic] = useState(initialSetup?.topic ?? "");
  const [analyzedSubjectId, setAnalyzedSubjectId] = useState<string | null>(null);
  const [analyzedSubjectTitle, setAnalyzedSubjectTitle] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedWikiIds, setSelectedWikiIds] = useState<string[]>([]);
  const [products, setProducts] = useState<Awaited<ReturnType<ContentLibraries["listProductServices"]>>>([]);
  const [wikiItems, setWikiItems] = useState<Awaited<ReturnType<ContentLibraries["listWikiItems"]>>>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [format, setFormat] = useState<ContentOutputFormat>(initialSetup?.format ?? "" as ContentOutputFormat);
  const [channels, setChannels] = useState<ContentChannelTarget[]>(initialSetup?.channels ?? []);
  const [brief, setBrief] = useState(initialSetup?.brief ?? "");
  const [batch, setBatch] = useState<ContentProposalBatch | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<ContentProposalRecord | null>(null);
  const [references, setReferences] = useState<AiContentReference[]>([]);
  const [avatars, setAvatars] = useState<Awaited<ReturnType<LibraryGateway["listAvatars"]>>>([]);
  const [selectedReferences, setSelectedReferences] = useState<SelectedReference[]>([]);
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(null);
  const [oneTimeAvatar, setOneTimeAvatar] = useState<File | null>(null);
  const [oneTimeReceipt, setOneTimeReceipt] = useState<{
    generationId: string;
    attachment: Awaited<ReturnType<AiContentGateway["uploadAttachment"]>>;
  } | null>(null);
  const [loadingProposal, setLoadingProposal] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingReference, setAddingReference] = useState(false);
  const [addingAvatar, setAddingAvatar] = useState(false);
  const [assetReturnFocus, setAssetReturnFocus] = useState<HTMLElement | null>(null);
  const [capabilityState, setCapabilityState] = useState<ChannelCapabilityState>(
    capabilityGateway.current.getState(),
  );
  const idempotencyKey = useRef(crypto.randomUUID());
  const selectionKey = useRef(crypto.randomUUID());

  function uploadedReference(item: ReferenceItem): AiContentReference {
    const format = item.format === "card_news" || item.format === "blog" || item.format === "marketing"
      ? item.format
      : "image";
    return {
      id: item.id,
      title: item.title,
      previewUrl: item.previewUrl,
      source: "uploaded",
      format,
      primaryCategory: null,
      subcategory: null,
      appealIds: [],
      comparableMetric: null,
    };
  }

  const proposals = batch?.proposals ?? [];
  const selectedProduct = products.find((item) => item.id === selectedProductId);
  const summary = useMemo(() => [
    family === "informational" ? "정보성" : family === "marketing" ? "마케팅성" : "목적 미정",
    subjectMode === "product_service" ? selectedProduct?.displayName ?? "제품·서비스 미정" : topic || "주제 미정",
    format || "형식 미정",
    channels.length ? channels.join(", ") : "채널 미정",
  ], [channels, family, format, selectedProduct?.displayName, subjectMode, topic]);

  async function loadBatch(batchId: string, signal?: AbortSignal) {
    const next = await gateway.getProposalBatch(brandId, batchId, signal);
    const request = requestRecord(next.request);
    const subjectInput = requestRecord(request.subjectInput);
    if (request.contentFamily === "informational" || request.contentFamily === "marketing") {
      setFamily(request.contentFamily);
    } else {
      setFamily(next.contentFamily);
    }
    if (typeof subjectInput.topic === "string") setTopic(subjectInput.topic);
    if (subjectInput.mode === "new_subject" && typeof subjectInput.subjectAnalysisId === "string") {
      setSubjectMode("new_subject");
      setAnalyzedSubjectId(subjectInput.subjectAnalysisId);
    } else if (subjectInput.mode === "product_service" && typeof subjectInput.productServiceId === "string") {
      setSubjectMode("product_service");
      setSelectedProductId(subjectInput.productServiceId);
    } else {
      setSubjectMode("brand_topic");
      setSelectedWikiIds(Array.isArray(subjectInput.wikiItemIds)
        ? subjectInput.wikiItemIds.filter((item): item is string => typeof item === "string")
        : []);
    }
    const outputFormat = Array.isArray(request.outputFormats) ? request.outputFormats[0] : null;
    if (outputFormat === "card_news" || outputFormat === "blog" || outputFormat === "single_image" || outputFormat === "channel_text") {
      setFormat(outputFormat);
    }
    if (Array.isArray(request.channelTargets)) {
      setChannels(request.channelTargets.filter((item): item is ContentChannelTarget =>
        typeof item === "string" && ["instagram", "threads", "x", "linkedin", "youtube", "tiktok", "blog_export"].includes(item),
      ));
    }
    if (typeof request.brief === "string") setBrief(request.brief);
    setBatch(next);
    if (next.status === "failed") throw new Error(next.errorCode ?? "proposal_failed");
    if (next.status === "ready") {
      setLoadingProposal(false);
      setMachine((current) => ({ ...current, phase: "proposal_selection", completedSections: ["intent", "sources", "delivery"] }));
      return;
    }
    window.setTimeout(() => { if (!signal?.aborted) void loadBatch(batchId, signal).catch(handleBatchError); }, 900);
  }

  function handleBatchError() {
    setLoadingProposal(false);
    setError("AI 구성안을 불러오지 못했습니다. 입력을 유지한 채 다시 시도해 주세요.");
    setMachine((current) => transitionContentWizard(current, { type: "resume_batch_failed" }));
  }

  useEffect(() => {
    if (!initialBatchId) return;
    const controller = new AbortController();
    setLoadingProposal(true);
    void loadBatch(initialBatchId, controller.signal).catch(handleBatchError);
    return () => controller.abort();
  // initialBatchId identifies the one resumable request; gateway identity must not restart polling.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, initialBatchId]);

  useEffect(() => {
    if (!initialAnalyzedSubjectId) return;
    let current = true;
    void gateway.getSubjectAnalysis(brandId, initialAnalyzedSubjectId).then((analysis) => {
      if (!current || (analysis.status !== "ready" && analysis.status !== "partial")) return;
      setAnalyzedSubjectId(analysis.id);
      setAnalyzedSubjectTitle(analysis.input.name || analysis.sourceUrl || "새 제품·서비스 분석");
      setSubjectMode("new_subject");
      setMachine((state) => ({ ...state, activeSection: "sources", completedSections: ["intent"] }));
    }).catch(() => {
      if (current) setError("완료한 새 분석을 불러오지 못했습니다. 다시 분석해 주세요.");
    });
    return () => { current = false; };
  }, [brandId, gateway, initialAnalyzedSubjectId]);

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
    setLoadingSubjects(true);
    void Promise.all([
      libraries.listProductServices(brandId),
      libraries.listWikiItems(brandId),
    ]).then(([nextProducts, nextWikiItems]) => {
      if (!current) return;
      setProducts(nextProducts);
      setWikiItems(nextWikiItems);
      setLoadingSubjects(false);
    }).catch(() => {
      if (!current) return;
      setLoadingSubjects(false);
      setError("제품·서비스와 Wiki를 불러오지 못했습니다. 다시 단계를 열어 시도해 주세요.");
    });
    return () => { current = false; };
  }, [brandId, libraries, machine.activeSection, machine.phase]);

  const complete = (section: ContentSetupSection) => setMachine((current) =>
    transitionContentWizard(current, { type: "complete_section", section }),
  );

  async function createProposal() {
    if (
      !family
      || (subjectMode === "brand_topic"
        ? !topic.trim()
        : subjectMode === "product_service"
          ? !selectedProductId
          : !analyzedSubjectId)
      || !format
      || channels.length === 0
    ) return;
    setLoadingProposal(true);
    setError(null);
    try {
      const created = await gateway.createProposalBatch(brandId, {
        idempotencyKey: idempotencyKey.current,
        request: {
          contractVersion: "content-proposal-request.v1",
          contentFamily: family,
          subjectInput: subjectMode === "product_service"
            ? { mode: "product_service", productServiceId: selectedProductId, brief }
            : subjectMode === "new_subject"
              ? { mode: "new_subject", subjectAnalysisId: analyzedSubjectId, brief }
              : { mode: "brand_topic", topic: topic.trim(), wikiItemIds: selectedWikiIds, brief },
          channelTargets: channels,
          outputFormats: [format],
          sourceSnapshotIds: [],
          performanceSnapshotIds: [],
        },
      });
      await loadBatch(created.batchId);
    } catch (caught) {
      const mapped = validationMessage(caught);
      if (mapped) {
        setLoadingProposal(false);
        setError(mapped);
      } else {
        handleBatchError();
      }
    }
  }

  async function chooseProposal(item: ContentProposalRecord) {
    setSelectedProposal(item);
    setMachine((current) => transitionContentWizard(current, { type: "select_proposal", proposalId: item.id }));
    setLoadingAssets(true);
    setError(null);
    try {
      const [nextReferences, nextAvatars] = await Promise.all([
        gateway.listReferences(brandId, item.proposal.recommendedReferenceQuery),
        libraries.listAvatars(brandId),
      ]);
      setReferences(nextReferences);
      setAvatars(nextAvatars);
      if (initialSeedReferenceId && selectedReferences.length === 0) {
        const seed = nextReferences.find((reference) => reference.id === initialSeedReferenceId);
        if (seed) {
          setSelectedReferences([{ referenceItemId: seed.id, roles: ["planning"] }]);
          setNotice(`보관함에서 가져온 ${seed.title} 레퍼런스를 먼저 선택했습니다.`);
        } else {
          setNotice("요청한 자료가 현재 브랜드의 활성 레퍼런스가 아니어서 선택에서 제거했습니다.");
          onSeedReferenceInvalid?.();
        }
      }
    } catch {
      setError("레퍼런스 또는 아바타를 불러오지 못했습니다. 다시 선택해 주세요.");
    } finally {
      setLoadingAssets(false);
    }
  }

  async function generate() {
    if (!selectedProposal || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const [activeReferences, activeAvatars] = await Promise.all([
        gateway.listReferences(brandId),
        libraries.listAvatars(brandId),
      ]);
      const activeReferenceIds = new Set(activeReferences.map((item) => item.id));
      const missingReference = selectedReferences.find((item) => !activeReferenceIds.has(item.referenceItemId));
      const activeAvatar = selectedAvatarId
        ? activeAvatars.find((item) => item.id === selectedAvatarId && item.status === "active")
        : null;
      if (missingReference || selectedAvatarId && !activeAvatar) {
        setError("선택한 레퍼런스 또는 아바타가 보관되었거나 찾을 수 없습니다. 해당 항목을 교체하거나 제거한 뒤 다시 시도해 주세요.");
        setSubmitting(false);
        return;
      }
      const generation = await gateway.selectProposal(brandId, selectedProposal.id, selectionKey.current);
      const selectedAvatar = activeAvatar ?? null;
      let preparedOneTimeReceipt = oneTimeAvatar && oneTimeReceipt?.generationId === generation.id
        ? oneTimeReceipt
        : null;
      if (oneTimeAvatar && !preparedOneTimeReceipt) {
        const attachment = await gateway.uploadAttachment(brandId, generation.id, {
          id: crypto.randomUUID(),
          role: "person",
          fileName: oneTimeAvatar.name,
          mimeType: oneTimeAvatar.type,
          size: oneTimeAvatar.size,
          file: oneTimeAvatar,
          uploadStatus: "pending",
        });
        preparedOneTimeReceipt = { generationId: generation.id, attachment };
        setOneTimeReceipt(preparedOneTimeReceipt);
      }
      const orchestration: ContentOrchestration = {
        contractVersion: "content-orchestration.v1",
        contentFamily: selectedProposal.proposal.contentFamily,
        subject: subjectMode === "product_service" && selectedProductId
          ? { mode: "product_service", productServiceId: selectedProductId }
          : subjectMode === "new_subject" && analyzedSubjectId
            ? { mode: "new_subject", subjectAnalysisId: analyzedSubjectId }
            : { mode: "brand_topic", topic, wikiItemIds: selectedWikiIds },
        target: { id: null, snapshot: selectedProposal.proposal.target },
        strategy: selectedProposal.proposal.messageStrategy,
        outputFormat: selectedProposal.proposal.outputFormat,
        channelTargets: selectedProposal.proposal.channelTargets,
        brief: { instruction: brief },
        references: selectedReferences,
        avatar: preparedOneTimeReceipt ? {
          mode: "one_time",
          id: preparedOneTimeReceipt.attachment.id,
          snapshot: {
            fileName: preparedOneTimeReceipt.attachment.fileName,
            mimeType: preparedOneTimeReceipt.attachment.mimeType,
            size: preparedOneTimeReceipt.attachment.size,
            storageUrl: preparedOneTimeReceipt.attachment.storageUrl ?? null,
            storagePath: preparedOneTimeReceipt.attachment.storagePath ?? null,
          },
        } : selectedAvatar ? {
          mode: "library",
          id: selectedAvatar.id,
          snapshot: {
            name: selectedAvatar.name,
            description: selectedAvatar.description,
            representativeImageUrl: (selectedAvatar.images.find((item) => item.representative) ?? selectedAvatar.images[0])?.storageUrl ?? null,
          },
        } : null,
      };
      await gateway.updateGeneration(brandId, generation.id, {
        draft: generation.draft,
        referenceIds: selectedReferences.map((item) => item.referenceItemId),
        orchestration,
      });
      await gateway.startGeneration(brandId, generation.id, {
        idempotencyKey: selectionKey.current,
        outputCount: 1,
        orchestration,
      });
      setMachine((current) => transitionContentWizard(current, { type: "start_generation" }));
      navigate(`/ai-content/${generation.id}`);
    } catch (caught) {
      setError(validationMessage(caught) ?? "선택한 구현안으로 생성을 시작하지 못했습니다. 다시 시도해 주세요.");
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
            {section === "intent" ? <ContentFamilyStep value={family} onChange={setFamily} onComplete={() => complete("intent")} /> : null}
            {section === "sources" ? <ContentSubjectStep
              mode={subjectMode}
              topic={topic}
              products={products}
              wikiItems={wikiItems}
              selectedWikiIds={selectedWikiIds}
              selectedProductId={selectedProductId}
              analyzedSubjectTitle={analyzedSubjectTitle}
              loading={loadingSubjects}
              onModeChange={(next) => {
                setSubjectMode(next);
                if (next === "brand_topic") setSelectedProductId(null);
              }}
              onTopicChange={setTopic}
              onWikiIdsChange={setSelectedWikiIds}
              onProductChange={setSelectedProductId}
              onStartNewAnalysis={() => navigate(`/ai-content/new?${new URLSearchParams({
                type: family === "marketing" ? "marketing" : "blog",
                returnTo: "content-proposal",
                proposalFamily: family ?? "",
                proposalTopic: topic,
                proposalFormat: format,
                proposalChannels: channels.join(","),
                proposalBrief: brief,
              }).toString()}`)}
              onComplete={() => complete("sources")}
            /> : null}
            {section === "delivery" ? <ContentStrategyStep
              outputFormat={format}
              channelTargets={channels}
              brief={brief}
              loading={loadingProposal}
              capabilityState={capabilityState}
              onFormatChange={(next) => {
                setFormat(next);
                setChannels((current) => current.filter((channel) => channel === "blog_export" && next === "blog"));
              }}
              onChannelsChange={setChannels}
              onBriefChange={setBrief}
              onSubmit={() => void createProposal()}
            /> : null}
          </div> : null}
        </section>;
      })}</main>
      <aside className="content-input-summary"><h2>입력 요약</h2><ul>{summary.map((item) => <li key={item}>{item}</li>)}</ul>{loadingProposal ? <p>사용 가능한 crawl snapshot으로 구성안을 만들고 있습니다.</p> : null}</aside>
    </div> : null}
    {machine.phase === "proposal_selection" && proposals.length
      ? <><aside className="content-input-summary proposal-input-summary" aria-label="복원된 입력 요약">
          <h2>입력 요약</h2><ul>{summary.map((item) => <li key={item}>{item}</li>)}</ul>
        </aside>
        <div data-guide="content-proposal-selection"><ContentProposalComparison proposals={proposals} selectedId={selectedProposal?.id ?? null} onSelect={(item) => void chooseProposal(item)} /></div>
        {selectedProposal ? <ReferenceAvatarStep
          references={references}
          avatars={avatars}
          selectedReferences={selectedReferences}
          selectedAvatarId={selectedAvatarId}
          oneTimeAvatar={oneTimeAvatar}
          loading={loadingAssets}
          submitting={submitting}
          onReferencesChange={setSelectedReferences}
          onAvatarChange={setSelectedAvatarId}
          onOneTimeAvatarChange={(file) => {
            setOneTimeAvatar(file);
            if (file) setSelectedAvatarId(null);
            if (!file && oneTimeReceipt) {
              void gateway.removeAttachment(brandId, oneTimeReceipt.generationId, oneTimeReceipt.attachment.id)
                .then(() => setOneTimeReceipt(null))
                .catch(() => setError("이번 생성용 아바타를 취소하지 못했습니다. 다시 시도해 주세요."));
            }
          }}
          onAddReference={() => {
            setAssetReturnFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null);
            setAddingReference(true);
          }}
          onAddAvatar={() => {
            setAssetReturnFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null);
            setAddingAvatar(true);
          }}
          onGenerate={() => void generate()}
        /> : null}</>
      : null}
    {addingReference ? <ReferenceUploadDialog
      brandId={brandId}
      gateway={assetGateway}
      onClose={() => {
        setAddingReference(false);
        queueMicrotask(() => assetReturnFocus?.focus());
      }}
      onUploaded={(item) => {
        const mapped = uploadedReference(item);
        setReferences((current) => [mapped, ...current.filter((reference) => reference.id !== mapped.id)]);
        setSelectedReferences((current) => current.some((reference) => reference.referenceItemId === mapped.id)
          ? current
          : [...current, { referenceItemId: mapped.id, roles: ["planning"] }]);
        setNotice(`${mapped.title} 파일을 업로드하고 레퍼런스로 선택했습니다.`);
      }}
    /> : null}
    {addingAvatar ? <AvatarEditorDialog
      brandId={brandId}
      gateway={assetGateway}
      returnFocus={assetReturnFocus}
      onClose={() => setAddingAvatar(false)}
      onSaved={(saved) => {
        setAvatars((current) => [saved, ...current.filter((avatar) => avatar.id !== saved.id)]);
        setSelectedAvatarId(saved.id);
        setNotice(`${saved.name} 아바타를 저장하고 선택했습니다.`);
      }}
    /> : null}
    {notice ? <p className="wizard-notice" role="alert">{notice}</p> : null}
    {error ? <p className="wizard-error" role="alert">{error}</p> : null}
  </div>;
}
