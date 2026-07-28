import type { ContentProposalRecord } from "../../features/ai-content/types";
import { ContentProposalCard } from "./ContentProposalCard";

export function ContentProposalComparison({ proposals, selectedId, onSelect }: {
  proposals: ContentProposalRecord[];
  selectedId: string | null;
  onSelect(item: ContentProposalRecord): void;
}) {
  return <section className="proposal-comparison" aria-label="AI 구현안 비교">
    <header><p>AI 구현안 {proposals.length}개</p><h2>어떤 방향으로 만들까요?</h2></header>
    <div className="proposal-grid">{proposals.map((item) =>
      <ContentProposalCard key={item.id} item={item} selected={selectedId === item.id} onSelect={() => onSelect(item)} />,
    )}</div>
  </section>;
}
