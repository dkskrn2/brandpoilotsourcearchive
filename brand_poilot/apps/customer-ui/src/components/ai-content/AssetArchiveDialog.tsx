import type { AiContentDraftReference } from "../../features/ai-content/types";
import { FocusTrap } from "../ui/FocusTrap";

export function AssetArchiveDialog({
  assetName,
  references,
  loading,
  failed,
  onRetry,
  onCancel,
  onConfirm,
}: {
  assetName: string;
  references: AiContentDraftReference[];
  loading: boolean;
  failed: boolean;
  onRetry(): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.currentTarget === event.target && !loading) onCancel();
  }}>
    <FocusTrap
      active
      className="modal-panel asset-archive-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="asset-archive-title"
      initialFocusSelector=".asset-archive-cancel"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !loading) onCancel();
      }}
    >
      <header><h2 id="asset-archive-title">{assetName} 보관 확인</h2></header>
      {loading ? <p>미완료 콘텐츠 초안의 참조를 확인하고 있습니다.</p> : null}
      {failed ? <p role="alert">미완료 초안 참조를 조회하지 못해 보관을 중단했습니다.</p> : null}
      {!loading && !failed && references.length > 0 ? <>
        <p>다음 미완료 초안이 이 자산을 사용 중입니다. 보관하면 생성 전에 교체하거나 제거해야 합니다.</p>
        <ul>{references.map((reference) => <li key={reference.generationId}>{reference.title}</li>)}</ul>
      </> : null}
      {!loading && !failed && references.length === 0 ? <p>이 자산을 사용하는 미완료 초안이 없습니다.</p> : null}
      <footer>
        <button className="button asset-archive-cancel" type="button" onClick={onCancel}>취소</button>
        {failed ? <button className="button primary" type="button" onClick={onRetry}>참조 다시 조회</button> : null}
        {!loading && !failed ? <button className="button primary" type="button" onClick={onConfirm}>보관 계속</button> : null}
      </footer>
    </FocusTrap>
  </div>;
}
