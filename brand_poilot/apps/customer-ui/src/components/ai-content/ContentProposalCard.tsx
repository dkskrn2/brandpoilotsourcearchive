import type { ContentProposalRecord } from "../../features/ai-content/types";

const strategyLabel: Record<string, string> = {
  problem_solution: "문제 해결", how_to: "방법 안내", comparison: "비교", faq: "FAQ",
  insight: "인사이트", benefit: "효익", social_proof: "사회적 증거", brand_story: "브랜드 스토리", cta: "행동 유도",
};

export function ContentProposalCard({ item, selected, onSelect }: {
  item: ContentProposalRecord;
  selected: boolean;
  onSelect(): void;
}) {
  const proposal = item.proposal;
  return <article className={`content-proposal-card${selected ? " is-selected" : ""}`}>
    <header><span>{strategyLabel[proposal.messageStrategy] ?? proposal.messageStrategy}</span><h3>{proposal.title}</h3></header>
    <p className="proposal-reason">{proposal.reasonToCreateNow}</p>
    <dl>
      <div><dt>주제</dt><dd>{proposal.topic}</dd></div>
      <div><dt>훅</dt><dd>{proposal.hook}</dd></div>
      <div><dt>핵심 메시지</dt><dd>{proposal.keyMessage}</dd></div>
      <div><dt>형식·채널</dt><dd>{proposal.outputFormat} · {proposal.channelTargets.join(", ")}</dd></div>
    </dl>
    {proposal.evidence.length ? <div><strong>근거</strong><ul>{proposal.evidence.map((item) => <li key={item.sourceSnapshotId}>{item.summary}</li>)}</ul></div> : null}
    <ol className="proposal-outline">{proposal.outline.map((item) => <li key={`${item.heading}-${item.purpose}`}><strong>{item.heading}</strong><span>{item.purpose}</span></li>)}</ol>
    <button type="button" className="button primary" aria-pressed={selected} onClick={onSelect}>구현안 선택: {proposal.title}</button>
  </article>;
}
