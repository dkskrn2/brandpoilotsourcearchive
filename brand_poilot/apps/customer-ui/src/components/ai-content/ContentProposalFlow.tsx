import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LibraryGateway } from "../../features/libraries/libraryGateway";
import { libraryGateway } from "../../features/libraries/libraryGateway";
import type {
  AiContentGateway,
  AiContentReference,
  ContentChannelTarget,
  ContentFamily,
  ContentOutputFormat,
  ContentProposalBatch,
  ContentProposalRecord,
  ContentSetupSection,
} from "../../features/ai-content/types";
import { createContentWizardState, transitionContentWizard } from "../../features/ai-content/contentWizardMachine";
import { ContentFamilyStep } from "./ContentFamilyStep";
import { ContentSubjectStep } from "./ContentSubjectStep";
import { ContentStrategyStep } from "./ContentStrategyStep";
import { ContentProposalComparison } from "./ContentProposalComparison";
import { ReferenceAvatarStep, type SelectedReference } from "./ReferenceAvatarStep";

const phases = ["콘텐츠 생성", "구현안 선택", "생성", "변경·검토·보완"];
const sections: Array<[ContentSetupSection, string]> = [
  ["intent", "1. 목적"], ["sources", "2. 주제·자료"], ["delivery", "3. 채널·형식"],
];

export function ContentProposalFlow({ brandId, gateway, libraries = libraryGateway, initialBatchId = null }: {
  brandId: string;
  gateway: AiContentGateway;
  libraries?: Pick<LibraryGateway, "listAvatars">;
  initialBatchId?: string | null;
}) {
  const navigate = useNavigate();
  const [machine, setMachine] = useState(createContentWizardState);
  const [family, setFamily] = useState<ContentFamily | null>(null);
  const [topic, setTopic] = useState("");
  const [format, setFormat] = useState<ContentOutputFormat>("" as ContentOutputFormat);
  const [channels, setChannels] = useState<ContentChannelTarget[]>([]);
  const [brief, setBrief] = useState("");
  const [batch, setBatch] = useState<ContentProposalBatch | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<ContentProposalRecord | null>(null);
  const [references, setReferences] = useState<AiContentReference[]>([]);
  const [avatars, setAvatars] = useState<Awaited<ReturnType<LibraryGateway["listAvatars"]>>>([]);
  const [selectedReferences, setSelectedReferences] = useState<SelectedReference[]>([]);
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(null);
  const [loadingProposal, setLoadingProposal] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const selectionKey = useRef(crypto.randomUUID());

  const proposals = batch?.proposals ?? [];
  const summary = useMemo(() => [
    family === "informational" ? "정보성" : family === "marketing" ? "마케팅성" : "목적 미정",
    topic || "주제 미정",
    format || "형식 미정",
    channels.length ? channels.join(", ") : "채널 미정",
  ], [channels, family, format, topic]);

  async function loadBatch(batchId: string, signal?: AbortSignal) {
    const next = await gateway.getProposalBatch(brandId, batchId, signal);
    if (next.status === "failed") throw new Error(next.errorCode ?? "proposal_failed");
    setBatch(next);
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

  const complete = (section: ContentSetupSection) => setMachine((current) =>
    transitionContentWizard(current, { type: "complete_section", section }),
  );

  async function createProposal() {
    if (!family || !topic.trim() || !format || channels.length === 0) return;
    setLoadingProposal(true);
    setError(null);
    try {
      const created = await gateway.createProposalBatch(brandId, {
        idempotencyKey: idempotencyKey.current,
        request: {
          contractVersion: "content-proposal-request.v1",
          contentFamily: family,
          subjectInput: { mode: "brand_topic", topic: topic.trim(), brief },
          channelTargets: channels,
          outputFormats: [format],
          sourceSnapshotIds: [],
          performanceSnapshotIds: [],
        },
      });
      await loadBatch(created.batchId);
    } catch {
      handleBatchError();
    }
  }

  async function chooseProposal(item: ContentProposalRecord) {
    setSelectedProposal(item);
    setMachine((current) => transitionContentWizard(current, { type: "select_proposal", proposalId: item.id }));
    setLoadingAssets(true);
    setError(null);
    try {
      const [nextReferences, nextAvatars] = await Promise.all([
        gateway.listReferences(brandId),
        libraries.listAvatars(brandId),
      ]);
      setReferences(nextReferences);
      setAvatars(nextAvatars);
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
      const generation = await gateway.selectProposal(brandId, selectedProposal.id, selectionKey.current);
      const selectedAvatar = avatars.find((item) => item.id === selectedAvatarId) ?? null;
      await gateway.updateGeneration(brandId, generation.id, {
        draft: generation.draft,
        referenceIds: selectedReferences.map((item) => item.referenceItemId),
        orchestration: {
          contractVersion: "content-orchestration.v1",
          contentFamily: selectedProposal.proposal.contentFamily,
          subject: { mode: "brand_topic", topic, wikiItemIds: [] },
          target: { id: null, snapshot: selectedProposal.proposal.target },
          strategy: selectedProposal.proposal.messageStrategy,
          outputFormat: selectedProposal.proposal.outputFormat,
          channelTargets: selectedProposal.proposal.channelTargets,
          brief: { instruction: brief },
          references: selectedReferences,
          avatar: selectedAvatar ? {
            mode: "library",
            id: selectedAvatar.id,
            snapshot: {
              name: selectedAvatar.name,
              description: selectedAvatar.description,
              representativeImageUrl: (selectedAvatar.images.find((item) => item.representative) ?? selectedAvatar.images[0])?.storageUrl ?? null,
            },
          } : null,
        },
      });
      await gateway.startGeneration(brandId, generation.id, { idempotencyKey: selectionKey.current, outputCount: 1 });
      setMachine((current) => transitionContentWizard(current, { type: "start_generation" }));
      navigate(`/ai-content/${generation.id}`);
    } catch {
      setError("선택한 구현안으로 생성을 시작하지 못했습니다. 다시 시도해 주세요.");
      setSubmitting(false);
    }
  }

  return <div className="content ai-content-wizard content-proposal-flow">
    <header className="wizard-header"><div><p>AI 콘텐츠 스튜디오</p><h1>새 AI 콘텐츠</h1></div></header>
    <ol className="content-phase-progress" aria-label="콘텐츠 생성 단계">{phases.map((phase, index) =>
      <li key={phase} aria-current={phases[index] === (machine.phase === "setup" ? phases[0] : machine.phase === "proposal_selection" ? phases[1] : machine.phase === "generating" ? phases[2] : phases[3]) ? "step" : undefined}>
        <span>{index + 1}</span>{phase}
      </li>,
    )}</ol>
    {machine.phase === "setup" ? <div className="content-setup-layout">
      <main className="content-setup-accordions">{sections.map(([section, title]) => {
        const open = machine.activeSection === section;
        const completeSection = machine.completedSections.includes(section);
        return <section className={`content-setup-section${open ? " is-open" : ""}`} key={section}>
          <button type="button" className="content-accordion-trigger" aria-expanded={open} onClick={() => setMachine((current) => transitionContentWizard(current, { type: "open_section", section }))}>
            <span>{title}</span>{completeSection ? <small>완료 · 수정 가능</small> : null}
          </button>
          {open ? <div className="content-accordion-panel">
            {section === "intent" ? <ContentFamilyStep value={family} onChange={setFamily} onComplete={() => complete("intent")} /> : null}
            {section === "sources" ? <ContentSubjectStep topic={topic} onTopicChange={setTopic} onComplete={() => complete("sources")} /> : null}
            {section === "delivery" ? <ContentStrategyStep outputFormat={format} channelTargets={channels} brief={brief} loading={loadingProposal} onFormatChange={setFormat} onChannelsChange={setChannels} onBriefChange={setBrief} onSubmit={() => void createProposal()} /> : null}
          </div> : null}
        </section>;
      })}</main>
      <aside className="content-input-summary"><h2>입력 요약</h2><ul>{summary.map((item) => <li key={item}>{item}</li>)}</ul>{loadingProposal ? <p>사용 가능한 crawl snapshot으로 구성안을 만들고 있습니다.</p> : null}</aside>
    </div> : null}
    {machine.phase === "proposal_selection" && proposals.length
      ? <><ContentProposalComparison proposals={proposals} selectedId={selectedProposal?.id ?? null} onSelect={(item) => void chooseProposal(item)} />
        {selectedProposal ? <ReferenceAvatarStep references={references} avatars={avatars} selectedReferences={selectedReferences} selectedAvatarId={selectedAvatarId} loading={loadingAssets} submitting={submitting} onReferencesChange={setSelectedReferences} onAvatarChange={setSelectedAvatarId} onGenerate={() => void generate()} /> : null}</>
      : null}
    {error ? <p className="wizard-error" role="alert">{error}</p> : null}
  </div>;
}
