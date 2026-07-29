import { BrandCorePreviewEditor } from "./BrandCorePreviewEditor";
import { KnowledgePreviewLibrary } from "./KnowledgePreviewLibrary";
import type {
  KnowledgeKind,
  PreviewBrandCore,
  PreviewKnowledgeItem,
} from "../../features/brand-center-preview/types";

interface ReviewApprovalStepProps {
  brandCore: PreviewBrandCore;
  brandCoreApproved: boolean;
  knowledge: PreviewKnowledgeItem[];
  activeKnowledgeKind: "all" | KnowledgeKind;
  editingKnowledgeId: string | null;
  approvalsComplete: boolean;
  onBrandCoreChange(brandCore: PreviewBrandCore): void;
  onBrandCoreApprove(): void;
  onKnowledgeKindChange(kind: "all" | KnowledgeKind): void;
  onKnowledgeEditingOpened(id: string): void;
  onKnowledgeEditingClosed(): void;
  onKnowledgeCreate(item: PreviewKnowledgeItem): void;
  onKnowledgeUpdate(item: PreviewKnowledgeItem): void;
  onKnowledgeDelete(id: string): void;
  onKnowledgeApproveAll(): void;
  onContinue(): void;
}

export function ReviewApprovalStep({
  brandCore,
  brandCoreApproved,
  knowledge,
  activeKnowledgeKind,
  editingKnowledgeId,
  approvalsComplete,
  onBrandCoreChange,
  onBrandCoreApprove,
  onKnowledgeKindChange,
  onKnowledgeEditingOpened,
  onKnowledgeEditingClosed,
  onKnowledgeCreate,
  onKnowledgeUpdate,
  onKnowledgeDelete,
  onKnowledgeApproveAll,
  onContinue,
}: ReviewApprovalStepProps) {
  const draftCount = knowledge.filter((item) => item.reviewStatus === "ai_draft").length;

  return (
    <section className="brand-center-preview__card">
      <div className="brand-center-preview__card-heading">
        <p className="brand-center-preview__eyebrow">STEP 3</p>
        <h2>검토·승인</h2>
        <p>콘텐츠 제작에 사용할 브랜드 기준과 지식을 확인해 주세요.</p>
        <div className="brand-center-preview__approval-summary" aria-label="승인 현황">
          <strong>
            {brandCoreApproved ? "Brand Core 승인됨" : "Brand Core 검토 필요"}
          </strong>
          <span>지식 초안 {draftCount}개</span>
        </div>
      </div>
      <div className="brand-center-preview__review-surface">
        <BrandCorePreviewEditor
          brandCore={brandCore}
          approved={brandCoreApproved}
          onChange={onBrandCoreChange}
          onApprove={onBrandCoreApprove}
        />
        <KnowledgePreviewLibrary
          items={knowledge}
          activeKind={activeKnowledgeKind}
          editingItem={knowledge.find((item) => item.id === editingKnowledgeId) ?? null}
          onKindChange={onKnowledgeKindChange}
          onEditingOpened={onKnowledgeEditingOpened}
          onEditingClosed={onKnowledgeEditingClosed}
          onCreate={onKnowledgeCreate}
          onUpdate={onKnowledgeUpdate}
          onDelete={onKnowledgeDelete}
          onApproveAll={onKnowledgeApproveAll}
        />
      </div>
      <footer className="brand-center-preview__card-footer">
        <p>
          {approvalsComplete
            ? "모든 검토가 완료되었습니다."
            : "Brand Core와 모든 AI 초안을 승인해 주세요."}
        </p>
        <button
          className="brand-center-preview__primary-action"
          type="button"
          disabled={!approvalsComplete}
          onClick={onContinue}
        >
          카드뉴스 만들기
        </button>
      </footer>
    </section>
  );
}
