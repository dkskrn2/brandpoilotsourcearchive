import type { ReactNode } from "react";
import type { ContentOutputFormatV2 } from "../../features/ai-content/types";

export interface BrandStyleImagePreview {
  referenceItemId: string;
  title: string;
  description: string;
  tags: string[];
  previewUrl: string | null;
}

export function ReferenceAvatarStep({
  styleImages,
  selectedAvatarStyleImageId,
  userImageInstruction,
  outputFormat,
  loading,
  loadError,
  submitting,
  attachmentsReady,
  attachmentUploader,
  selectedProposalTitle = "선택한 구성안",
  attachmentCount = 0,
  onAvatarStyleImageChange,
  onUserImageInstructionChange,
  onRetry,
  onGenerate,
}: {
  styleImages: BrandStyleImagePreview[];
  selectedAvatarStyleImageId: string | null;
  userImageInstruction: string;
  outputFormat: ContentOutputFormatV2;
  loading: boolean;
  loadError: string | null;
  submitting: boolean;
  attachmentsReady: boolean;
  attachmentUploader: ReactNode;
  selectedProposalTitle?: string;
  attachmentCount?: number;
  onAvatarStyleImageChange(value: string | null): void;
  onUserImageInstructionChange(value: string): void;
  onRetry(): void;
  onGenerate(): void;
}) {
  return <section className="reference-avatar-step style-panel">
    <header className="style-panel__heading">
      <div>
        <span className="style-panel__eyebrow">VISUAL DIRECTION</span>
        <h2>스타일과 참고 이미지를 확인하세요</h2>
        <p>선택한 구성안의 메시지는 유지하고, 아래 시각 자료는 전체 콘텐츠의 분위기를 맞추는 데 사용합니다.</p>
      </div>
      <span className="style-ready">{loading ? "불러오는 중" : loadError ? "확인 필요" : "선택 완료"}</span>
    </header>

    {loading ? <p>승인된 브랜드 스타일 이미지를 불러오는 중입니다.</p> : null}
    {loadError ? <div className="wizard-error" role="alert">
      <p>{loadError}</p>
      <button type="button" className="button" onClick={onRetry}>브랜드 스타일 다시 불러오기</button>
    </div> : null}

    {!loading && !loadError ? <div className="style-layout">
      <section className="style-block" aria-labelledby="brand-style-images-title">
        <div className="style-block__title"><div><h3 id="brand-style-images-title">브랜드 스타일</h3><small>승인된 스타일 {styleImages.length}개 · 모두 자동 적용</small></div></div>
        {styleImages.length ? <div className="brand-style-preview-grid">{styleImages.map((image) => <article className="brand-style-card" key={image.referenceItemId}>
          <span className="brand-style-auto-badge">자동 적용</span>
          {image.previewUrl
            ? <img src={image.previewUrl} alt={image.title} />
            : <p>미리보기를 표시할 수 없습니다.</p>}
          <h4>{image.title}</h4>
          {image.description ? <p>{image.description}</p> : null}
          {image.tags.length ? <small>{image.tags.join(" · ")}</small> : null}
        </article>)}</div> : <p>등록된 브랜드 스타일 이미지 없이 생성합니다</p>}
      </section>

      <section className="style-block avatar-style-block" aria-labelledby="avatar-style-images-title">
        <div className="style-block__title"><div><h3 id="avatar-style-images-title">아바타</h3><small>장면에 필요할 때만 활용</small></div></div>
        <div className="avatar-style-options">
          <label className={selectedAvatarStyleImageId === null ? "avatar-choice is-selected" : "avatar-choice"}>
            <input type="radio" name="avatar-style-image" checked={selectedAvatarStyleImageId === null} onChange={() => onAvatarStyleImageChange(null)} />
            <span className="avatar-choice__preview avatar-choice__none">—</span>
            <span><strong>아바타 사용 안 함</strong><small>정보와 타이포그래피 중심</small></span>
          </label>
          {styleImages.map((image) => <label className={selectedAvatarStyleImageId === image.referenceItemId ? "avatar-choice is-selected" : "avatar-choice"} key={image.referenceItemId}>
            <input type="radio" name="avatar-style-image" checked={selectedAvatarStyleImageId === image.referenceItemId} onChange={() => onAvatarStyleImageChange(image.referenceItemId)} />
            {image.previewUrl ? <img src={image.previewUrl} alt="" /> : <span className="avatar-choice__preview">이미지</span>}
            <span><strong>{image.title}</strong><small>{image.description || "승인된 브랜드 스타일"}</small></span>
          </label>)}
        </div>
      </section>

      <section className="style-block attachment-style-block" aria-labelledby="final-attachments-title">
        <div className="style-block__title"><div><h3 id="final-attachments-title">첨부 이미지</h3><small>모든 파일은 참고 자료로 전달</small></div></div>
        {attachmentUploader}
        <label className="common-image-instruction">
          이미지 추가 요청 <span>(선택)</span>
          <textarea
            value={userImageInstruction}
            maxLength={4_000}
            placeholder="예: 문구와 정보 위계가 먼저 보이도록 구성해 주세요."
            onChange={(event) => onUserImageInstructionChange(event.target.value)}
          />
        </label>
      </section>
    </div> : null}

    {outputFormat === "blog" ? <p className="wizard-notice">
      브랜드 스타일, 아바타와 공통 이미지 프롬프트는 블로그 작성 중 이미지가 필요하다고 판단한 경우에만 적용됩니다.
    </p> : null}

    <div className="selection-bar">
      <div><span className="selection-check" aria-hidden="true">✓</span><p><small>선택한 구성안</small><strong>{selectedProposalTitle}</strong></p></div>
      <div className="selection-summary"><span>스타일 {styleImages.length}개 자동 적용</span><span>첨부 {attachmentCount}개</span></div>
      <button
        type="button"
        className="button primary"
        aria-label="최종 콘텐츠 1개 생성"
        disabled={loading || Boolean(loadError) || submitting || !attachmentsReady}
        onClick={onGenerate}
      >
        {submitting ? "생성을 준비하는 중" : "콘텐츠 생성 시작"}<span aria-hidden="true"> →</span>
      </button>
    </div>
  </section>;
}
