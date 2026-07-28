import type { ContentFamily } from "../../features/ai-content/types";

export function ContentFamilyStep({ value, onChange, onComplete }: {
  value: ContentFamily | null;
  onChange(value: ContentFamily): void;
  onComplete(): void;
}) {
  return <div className="content-wizard-options">
    <label className="content-choice">
      <input type="radio" name="content-family" checked={value === "informational"} onChange={() => onChange("informational")} />
      <strong>정보성</strong><span>브랜드의 지식과 근거를 이해하기 쉽게 전달합니다.</span>
    </label>
    <label className="content-choice">
      <input type="radio" name="content-family" checked={value === "marketing"} onChange={() => onChange("marketing")} />
      <strong>마케팅성</strong><span>브랜드 가치와 제품·서비스의 이점을 행동으로 연결합니다.</span>
    </label>
    <button type="button" className="button primary" disabled={!value} onClick={onComplete}>목적 완료</button>
  </div>;
}
