import { Link } from "react-router-dom";
import type { ContentProposalRecord } from "../../features/ai-content/types";

export function ContentProposalInbox({ proposals, dismissingId, onDismiss }: {
  proposals: ContentProposalRecord[];
  dismissingId: string | null;
  onDismiss(item: ContentProposalRecord): void;
}) {
  if (!proposals.length) return null;
  return <section className="content-proposal-inbox" aria-label="검토할 AI 제안">
    <header><div><h2>검토할 AI 제안</h2><p>새로 확보한 근거를 바탕으로 준비한 콘텐츠 방향입니다.</p></div><span>{proposals.length}개</span></header>
    <div>{proposals.map((item) => <article key={item.id}>
      <div><small>{item.proposal.contentFamily === "informational" ? "정보성" : "마케팅성"} · {item.proposal.outputFormat}</small>
        <h3>{item.proposal.title}</h3><p>{item.proposal.reasonToCreateNow}</p>
        {item.proposal.evidence[0] ? <span>근거: {item.proposal.evidence[0].summary}</span> : null}
      </div>
      <div className="proposal-inbox-actions">
        <Link className="button primary" to={`/ai-content/new?proposalBatch=${item.batchId}`}>제안 검토: {item.proposal.title}</Link>
        <button type="button" className="button" disabled={dismissingId === item.id} aria-label={`제안 닫기: ${item.proposal.title}`} onClick={() => onDismiss(item)}>
          {dismissingId === item.id ? "닫는 중" : "닫기"}
        </button>
      </div>
    </article>)}</div>
  </section>;
}
