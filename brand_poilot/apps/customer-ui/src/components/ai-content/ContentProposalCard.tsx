import type {
  ContentProposalBatch,
  ContentProposalRecord,
  ContentProposalRecordV2,
  ContentProposalV2,
} from "../../features/ai-content/types";

const informationalTypeLabel: Record<NonNullable<ContentProposalV2["informationalType"]>, string> = {
  problem_solution: "문제 해결",
  how_to: "방법 안내",
  checklist: "체크리스트",
  comparison: "비교·선택 기준",
  trend_insight: "트렌드·인사이트",
  q_and_a: "질문과 답변",
  myth_fact: "오해와 사실",
};

const strategyLabel: Record<string, string> = {
  problem_solution: "문제 해결",
  how_to: "방법 안내",
  comparison: "비교",
  faq: "FAQ",
  insight: "인사이트",
  benefit: "효익",
  social_proof: "사회적 증거",
  brand_story: "브랜드 스토리",
  cta: "행동 유도",
};

const outputFormatLabel: Record<string, string> = {
  card_news: "카드뉴스",
  blog: "블로그",
  reel: "릴스",
};

const channelLabel: Record<string, string> = {
  instagram: "Instagram",
  blog_export: "블로그",
};

export function ContentProposalCard({
  item,
  position,
  selected,
  evidence,
  references,
  disabled = false,
  onSelect,
}: {
  item: ContentProposalRecord | ContentProposalRecordV2;
  position: number;
  selected: boolean;
  evidence: NonNullable<ContentProposalBatch["researchEvidence"]>["items"];
  references: NonNullable<ContentProposalBatch["selectedReferences"]>;
  disabled?: boolean;
  onSelect(): void;
}) {
  const proposal = item.proposal;
  if (!("conceptKey" in proposal)) {
    return <article className={`content-proposal-card${selected ? " is-selected" : ""}`}>
      <header><span>{strategyLabel[proposal.messageStrategy] ?? proposal.messageStrategy}</span><h3>{proposal.title}</h3></header>
      <p className="proposal-reason">{proposal.reasonToCreateNow}</p>
      <dl>
        <div><dt>주제</dt><dd>{proposal.topic}</dd></div>
        <div><dt>훅</dt><dd>{proposal.hook}</dd></div>
        <div><dt>핵심 메시지</dt><dd>{proposal.keyMessage}</dd></div>
        <div><dt>형식·채널</dt><dd>{proposal.outputFormat} · {proposal.channelTargets.join(", ")}</dd></div>
      </dl>
      {proposal.evidence.length ? <div><strong>근거</strong><ul>{proposal.evidence.map((source) => <li key={source.sourceSnapshotId}>{source.summary}</li>)}</ul></div> : null}
      <ol className="proposal-outline">{proposal.outline.map((outline) => <li key={`${outline.heading}-${outline.purpose}`}><strong>{outline.heading}</strong><span>{outline.purpose}</span></li>)}</ol>
      <button type="button" className="button primary" aria-pressed={selected} disabled={disabled} onClick={onSelect}>
        구성안 선택: {proposal.title}
      </button>
    </article>;
  }

  const details = proposal.purposeDetails;
  const isBlog = proposal.outputFormat === "blog";
  const typeLabel = details.kind === "informational"
    ? informationalTypeLabel[proposal.informationalType!]
    : "마케팅";
  const providedValue = details.kind === "informational" ? details.value : details.appeal;
  const previewCount = isBlog ? proposal.outline.length : proposal.assetCount ?? proposal.outline.length;
  const remainingOutlineCount = Math.max(0, proposal.outline.length - 3);

  return <article className={`content-proposal-card proposal-card${selected ? " is-selected" : ""}`}>
    <header className="proposal-card__header">
      <div>
        <span className="card-index">구성안 {position}</span>
        <span className={selected ? "selected-badge" : "quiet-badge"}>{selected ? "✓ 선택됨" : typeLabel}</span>
      </div>
      <h3>{proposal.title}</h3>
      <p>{proposal.oneLineIntent}</p>
    </header>
    <div className="proposal-meta" aria-label="구성안 형식 요약">
      <span>{outputFormatLabel[proposal.outputFormat] ?? proposal.outputFormat}</span>
      <span>{isBlog ? "글 구성" : `${proposal.assetCount}장`}</span>
      {proposal.channelTargets.map((target) => <span key={target}>{channelLabel[target] ?? target}</span>)}
    </div>
    <section className="message-block">
      <small>첫 화면 훅</small>
      <strong>{proposal.hook}</strong>
    </section>
    <section className="key-message">
      <small>핵심 메시지</small>
      <p>{proposal.keyMessage}</p>
    </section>
    <dl className="compact-facts" aria-label="핵심 비교 정보">
      <div><dt>대상</dt><dd>{proposal.target}</dd></div>
      <div><dt>제공 가치</dt><dd>{providedValue}</dd></div>
      <div><dt>차별점</dt><dd>{proposal.differentiator}</dd></div>
    </dl>
    <section className="outline-preview">
      <div><h4>{isBlog ? "글 흐름" : "장면 흐름"}</h4><span>{previewCount}개 {isBlog ? "섹션" : "장면"}</span></div>
      <ol aria-label={isBlog ? "글 흐름 미리보기" : "장면 흐름 미리보기"}>
        {proposal.outline.slice(0, 3).map((outline) => <li key={outline.index}>
          <b>{String(outline.index).padStart(2, "0")}</b>
          <span><strong>{outline.headline}</strong><small>{outline.purpose}</small></span>
        </li>)}
      </ol>
      {remainingOutlineCount ? <p>외 {remainingOutlineCount}개 {isBlog ? "섹션" : "장면"}</p> : null}
    </section>
    <button
      type="button"
      className="select-button"
      aria-label={`구성안 선택: ${proposal.title}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <span>{selected ? "선택한 구성안" : "이 구성안 선택"}</span><span aria-hidden="true">{selected ? "✓" : "→"}</span>
    </button>
  </article>;
}
