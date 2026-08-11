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
  onAvatarStyleImageChange(value: string | null): void;
  onUserImageInstructionChange(value: string): void;
  onRetry(): void;
  onGenerate(): void;
}) {
  return <section className="reference-avatar-step">
    <header>
      <p>선택한 구성안의 장수와 순서를 유지해 최종 콘텐츠 패키지 하나를 만듭니다.</p>
      <h2>브랜드 스타일과 이미지 설정</h2>
    </header>

    {loading ? <p>승인된 브랜드 스타일 이미지를 불러오는 중입니다.</p> : null}
    {loadError ? <div className="wizard-error" role="alert">
      <p>{loadError}</p>
      <button type="button" className="button" onClick={onRetry}>브랜드 스타일 다시 불러오기</button>
    </div> : null}

    {!loading && !loadError ? <>
      <section aria-labelledby="brand-style-images-title">
        <h3 id="brand-style-images-title">자동 적용할 브랜드 스타일</h3>
        {styleImages.length ? <div className="brand-style-preview-grid">{styleImages.map((image) => <article key={image.referenceItemId}>
          <span className="brand-style-auto-badge">자동 적용</span>
          {image.previewUrl
            ? <img src={image.previewUrl} alt={image.title} />
            : <p>미리보기를 표시할 수 없습니다.</p>}
          <h4>{image.title}</h4>
          {image.description ? <p>{image.description}</p> : null}
          {image.tags.length ? <small>{image.tags.join(" · ")}</small> : null}
        </article>)}</div> : <p>등록된 브랜드 스타일 이미지 없이 생성합니다</p>}
      </section>

      {styleImages.length ? <fieldset className="avatar-style-options">
        <legend>아바타 역할로 사용할 스타일 이미지 (선택)</legend>
        <label><input
          type="radio"
          name="avatar-style-image"
          checked={selectedAvatarStyleImageId === null}
          onChange={() => onAvatarStyleImageChange(null)}
        />아바타 사용 안 함</label>
        {styleImages.map((image) => <label key={image.referenceItemId}>
          <input
            type="radio"
            name="avatar-style-image"
            checked={selectedAvatarStyleImageId === image.referenceItemId}
            onChange={() => onAvatarStyleImageChange(image.referenceItemId)}
          />
          {image.title}{image.description ? ` · ${image.description}` : ""}
        </label>)}
      </fieldset> : null}

      <label className="common-image-instruction">
        모든 생성 이미지에 공통 적용할 프롬프트
        <textarea
          value={userImageInstruction}
          maxLength={4_000}
          placeholder="예: 밝고 정돈된 편집 디자인"
          onChange={(event) => onUserImageInstructionChange(event.target.value)}
        />
      </label>

      <section aria-labelledby="final-attachments-title">
        <h3 id="final-attachments-title">첨부 이미지 (선택)</h3>
        {attachmentUploader}
      </section>
    </> : null}

    {outputFormat === "blog" ? <p className="wizard-notice">
      브랜드 스타일, 아바타와 공통 이미지 프롬프트는 블로그 작성 중 이미지가 필요하다고 판단한 경우에만 적용됩니다.
    </p> : null}

    <button
      type="button"
      className="button primary"
      disabled={loading || Boolean(loadError) || submitting || !attachmentsReady}
      onClick={onGenerate}
    >
      {submitting ? "생성을 준비하는 중" : "최종 콘텐츠 1개 생성"}
    </button>
  </section>;
}
