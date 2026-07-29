import {
  libraryGateway,
  type LibraryGateway,
  type ManualWikiItemType,
} from "../../features/libraries/libraryGateway";
import {
  WikiLibraryPanel,
  type KnowledgeApi,
} from "./WikiLibraryPanel";

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
  return <WikiLibraryPanel
    brandId={brandId}
    category={kind}
    title={title}
    gateway={gateway}
    knowledgeApi={knowledgeApi}
    initialIssueId={initialIssueId}
    onCloseIssue={onCloseIssue}
    onDirtyChange={onDirtyChange}
  />;
}
