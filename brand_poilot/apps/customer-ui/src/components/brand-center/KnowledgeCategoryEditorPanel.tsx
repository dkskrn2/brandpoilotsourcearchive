import { useState } from "react";
import {
  libraryGateway,
  type LibraryGateway,
  type ManualWikiItemType,
} from "../../features/libraries/libraryGateway";
import {
  WikiLibraryPanel,
  type KnowledgeApi,
} from "./WikiLibraryPanel";
import { FaqSuggestionPreviewPanel } from "./FaqSuggestionPreviewPanel";

interface Props {
  brandId: string;
  kind: Extract<ManualWikiItemType, "faq" | "how_to" | "guide">;
  title: string;
  gateway?: LibraryGateway;
  knowledgeApi?: KnowledgeApi;
  initialIssueId?: string | null;
  onCloseIssue?(): void;
  onDirtyChange?(dirty: boolean): void;
}

export function KnowledgeCategoryEditorPanel({
  brandId,
  kind,
  title,
  gateway = libraryGateway,
  knowledgeApi,
  initialIssueId,
  onCloseIssue,
  onDirtyChange,
}: Props) {
  const [faqRefreshToken, setFaqRefreshToken] = useState(0);
  return <div className="knowledge-category-stack">
    {kind === "faq" ? <FaqSuggestionPreviewPanel
      brandId={brandId}
      gateway={gateway}
      onApproved={() => setFaqRefreshToken((current) => current + 1)}
    /> : null}
    <WikiLibraryPanel
      brandId={brandId}
      category={kind}
      title={title}
      gateway={gateway}
      knowledgeApi={knowledgeApi}
      initialIssueId={initialIssueId}
      onCloseIssue={onCloseIssue}
      onDirtyChange={onDirtyChange}
      refreshToken={faqRefreshToken}
    />
  </div>;
}
