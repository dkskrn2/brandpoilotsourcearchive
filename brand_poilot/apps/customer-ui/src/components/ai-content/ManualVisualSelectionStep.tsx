import type {
  ProductServiceImageAsset,
  ProductServiceItem,
  VisualPreset,
} from "../../features/libraries/libraryGateway";
import { Alert } from "../ui/Alert";
import { InlineSpinner } from "../ui/LoadingState";

interface Props {
  product: ProductServiceItem | null;
  productImages: ProductServiceImageAsset[];
  visualPresets: VisualPreset[];
  selectedPresetId: string | null;
  userImageInstruction: string;
  loading: boolean;
  loadError: string | null;
  submitting: boolean;
  attachmentsReady: boolean;
  selectedProposalTitle: string;
  attachmentCount: number;
  attachmentUploader: React.ReactNode;
  onPresetChange(value: string | null): void;
  onUserImageInstructionChange(value: string): void;
  onRetry(): void;
  onGenerate(): void;
}

export function ManualVisualSelectionStep(props: Props) {
  const profile = props.product?.activeVersion?.profile ?? null;
  const choicesDisabled = props.loading || props.submitting || Boolean(props.loadError);
  return <section className="manual-visual-selection" aria-label="브랜드 스타일과 이미지 설정">
    <header className="library-editor-head">
      <div>
        <p className="eyebrow">VISUAL DIRECTION</p>
        <h2>제품 정보와 스타일을 확인하세요</h2>
        <p>선택한 정보는 원고 기획과 이미지 제작에 함께 사용됩니다.</p>
      </div>
    </header>
    {props.loadError ? <Alert title="브랜드 자료를 불러오지 못했습니다" variant="warn">
      {props.loadError}<button className="button" type="button" onClick={props.onRetry}>다시 시도</button>
    </Alert> : null}
    {props.loading ? <InlineSpinner label="브랜드 제품과 프리셋 불러오는 중" /> : <div className="manual-visual-grid">
      <section className="manual-visual-card" aria-label="선택 제품·서비스">
        <p className="eyebrow">제품·서비스</p>
        <h3>{profile?.name ?? "선택한 제품·서비스 없음"}</h3>
        {profile ? <>
          <p>{profile.description}</p>
          {profile.features.length ? <p><strong>기능</strong> {profile.features.join(" · ")}</p> : null}
          {profile.benefits.length ? <p><strong>효익</strong> {profile.benefits.join(" · ")}</p> : null}
          {props.productImages.length ? <div className="manual-product-images">{props.productImages.map((image) => <figure key={image.id}>
            <img src={image.storageUrl} alt={`${profile.name} ${image.role === "hero" ? "대표" : "상세"} 이미지`} />
            <figcaption>{image.role === "hero" ? "대표" : `상세 ${image.position}`}</figcaption>
          </figure>)}</div> : <p className="muted">등록된 제품 이미지가 없습니다. 설명 정보는 그대로 사용됩니다.</p>}
        </> : <p className="muted">정보성 콘텐츠는 제품 없이 생성합니다.</p>}
      </section>

      <fieldset className="manual-visual-card" disabled={choicesDisabled}>
        <legend>프리셋</legend>
        <label><input type="radio" name="manual-visual-preset" checked={props.selectedPresetId === null} onChange={() => props.onPresetChange(null)} />프리셋 사용 안 함</label>
        {props.visualPresets.map((preset) => <label key={preset.id} className={preset.id === props.selectedPresetId ? "is-selected" : ""} aria-disabled={!preset.usability.usable}>
          <input type="radio" name="manual-visual-preset" disabled={!preset.usability.usable} checked={preset.id === props.selectedPresetId} onChange={() => props.onPresetChange(preset.id)} />
          <span><strong>{preset.name}</strong>{preset.isDefault ? <small> 기본</small> : null}<small>{preset.usability.usable ? "사용 가능" : preset.usability.reason === "style_analyzing" ? "스타일 분석 중" : preset.usability.reason === "style_analysis_failed" ? "스타일 분석 실패" : "아바타 사용 불가"}</small></span>
        </label>)}
      </fieldset>
    </div>}

    <label className="manual-image-instruction">이미지 추가 요청 (선택)
      <textarea disabled={choicesDisabled} value={props.userImageInstruction} onChange={(event) => props.onUserImageInstructionChange(event.target.value)} placeholder="예: 숫자 비교를 가장 크게 보여 주세요." />
    </label>
    <div>{props.attachmentUploader}</div>
    <footer className="manual-visual-action-bar">
      <div><small>선택한 구성안</small><strong>{props.selectedProposalTitle}</strong><span>첨부 {props.attachmentCount}개</span></div>
      <button className="button primary" type="button" disabled={choicesDisabled || !props.attachmentsReady} onClick={props.onGenerate}>
        {props.submitting ? <InlineSpinner label="콘텐츠 생성 시작 중" /> : null}콘텐츠 생성 시작
      </button>
    </footer>
  </section>;
}
