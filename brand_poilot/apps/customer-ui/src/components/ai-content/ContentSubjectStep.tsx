import type { ReactNode } from "react";
import type { ContentPurposeV2 } from "../../features/ai-content/types";
import type { ProductServiceItem } from "../../features/libraries/libraryGateway";

export type ContentSubjectMode = "topic_text" | "topic_url" | "reference";

export function isApprovedActiveProduct(item: ProductServiceItem) {
  return item.status === "active"
    && Boolean(item.activeVersionId)
    && item.activeVersion?.status === "approved";
}

function isHttpUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value.trim()).protocol);
  } catch {
    return false;
  }
}

export function ContentSubjectStep({
  purpose,
  mode,
  topicText,
  topicUrl,
  contentInstruction,
  products,
  selectedProductId,
  referencePicker,
  referenceValid,
  loading,
  onModeChange,
  onTopicTextChange,
  onTopicUrlChange,
  onContentInstructionChange,
  onProductChange,
  onComplete,
}: {
  purpose: ContentPurposeV2;
  mode: ContentSubjectMode;
  topicText: string;
  topicUrl: string;
  contentInstruction: string;
  products: ProductServiceItem[];
  selectedProductId: string | null;
  referencePicker: ReactNode;
  referenceValid: boolean;
  loading: boolean;
  onModeChange(value: ContentSubjectMode): void;
  onTopicTextChange(value: string): void;
  onTopicUrlChange(value: string): void;
  onContentInstructionChange(value: string): void;
  onProductChange(value: string | null): void;
  onComplete(): void;
}) {
  const approvedActiveProducts = products.filter(isApprovedActiveProduct);
  const materialValid = mode === "topic_text"
    ? Boolean(topicText.trim())
    : mode === "topic_url"
      ? isHttpUrl(topicUrl)
      : referenceValid;
  const selectedProductValid = approvedActiveProducts.some((item) => item.id === selectedProductId);
  const valid = materialValid && (purpose === "informational" || selectedProductValid);

  return <div className="content-subject-step">
    <div className="content-entry-tabs" role="group" aria-label="소재 선택 방식">
      <button type="button" aria-pressed={mode === "topic_text"} onClick={() => onModeChange("topic_text")}>직접 입력</button>
      <button type="button" aria-pressed={mode === "topic_url"} onClick={() => onModeChange("topic_url")}>URL</button>
      <button type="button" disabled aria-disabled="true" title="준비 중">오늘의 주제 <small>준비 중</small></button>
      <button type="button" aria-pressed={mode === "reference"} onClick={() => onModeChange("reference")}>레퍼런스</button>
    </div>

    {mode === "topic_text" ? <label>콘텐츠 주제
      <input
        value={topicText}
        onChange={(event) => onTopicTextChange(event.target.value)}
        placeholder="예: 여름 피부 관리"
      />
    </label> : null}
    {mode === "topic_url" ? <label>주제 URL
      <input
        type="url"
        value={topicUrl}
        onChange={(event) => onTopicUrlChange(event.target.value)}
        placeholder="https://example.com/article"
      />
    </label> : null}
    {mode === "reference" ? referencePicker : null}

    {purpose === "marketing" ? <label>제품·서비스
      <select
        required
        value={selectedProductId ?? ""}
        onChange={(event) => onProductChange(event.target.value || null)}
      >
        <option value="">승인된 제품·서비스 선택</option>
        {approvedActiveProducts.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
      </select>
    </label> : null}
    {purpose === "marketing" && loading ? <p>승인된 제품·서비스를 불러오는 중입니다.</p> : null}
    {purpose === "marketing" && !loading && approvedActiveProducts.length === 0
      ? <p>사용할 수 있는 승인·활성 제품·서비스가 없습니다.</p>
      : null}

    <label>콘텐츠 지시 (선택)
      <textarea
        value={contentInstruction}
        onChange={(event) => onContentInstructionChange(event.target.value)}
        placeholder="구성안에서 꼭 고려할 내용을 입력하세요."
      />
    </label>
    <button type="button" className="button primary" disabled={!valid || loading} onClick={onComplete}>주제·자료 완료</button>
  </div>;
}
