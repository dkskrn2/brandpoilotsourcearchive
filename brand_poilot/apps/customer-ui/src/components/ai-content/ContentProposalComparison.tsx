import type { ContentProposalBatch, ContentProposalRecord, ContentProposalRecordV2 } from "../../features/ai-content/types";
import { ContentProposalCard } from "./ContentProposalCard";

export function ContentProposalComparison({ proposals, selectedId, evidence = [], references = [], disabled = false, onSelect }: {
  proposals: Array<ContentProposalRecord | ContentProposalRecordV2>;
  selectedId: string | null;
  evidence?: NonNullable<ContentProposalBatch["researchEvidence"]>["items"];
  references?: NonNullable<ContentProposalBatch["selectedReferences"]>;
  disabled?: boolean;
  onSelect(item: ContentProposalRecord | ContentProposalRecordV2): void;
}) {
  return <section className="proposal-comparison" aria-label="AI 구성안 비교">
    <div className="proposal-grid">{proposals.map((item, index) =>
      <ContentProposalCard
        key={item.id}
        item={item}
        position={index + 1}
        selected={selectedId === item.id}
        evidence={evidence}
        references={references}
        disabled={disabled}
        onSelect={() => onSelect(item)}
      />,
    )}</div>
  </section>;
}
