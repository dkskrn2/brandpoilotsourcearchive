import type { BrandRules } from "../../features/brand-center/types";

export function BrandRulesPanel({
  rules,
  saving,
  onChange,
  onSave,
  onApprove,
}: {
  rules: BrandRules;
  saving: boolean;
  onChange(rules: BrandRules): void;
  onSave(): void;
  onApprove(): void;
}) {
  const join = (items: string[]) => items.join("\n");
  const split = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
  return (
    <section className="panel">
      <div className="panel-header"><div><span className="brand-center-eyebrow">EXECUTION RULES</span><h2>실행 규칙</h2></div></div>
      <div className="panel-body brand-rules-form">
        <label>반드시 포함할 문구<textarea value={join(rules.requiredPhrases)} onChange={(event) => onChange({ ...rules, requiredPhrases: split(event.target.value) })} /></label>
        <label>사용 금지 문구<textarea value={join(rules.forbiddenPhrases)} onChange={(event) => onChange({ ...rules, forbiddenPhrases: split(event.target.value) })} /></label>
        <label>과장 표현 제한<textarea value={join(rules.exaggerationRules)} onChange={(event) => onChange({ ...rules, exaggerationRules: split(event.target.value) })} /></label>
        <label>기본 CTA<input value={rules.ctaRules.defaultCta} onChange={(event) => onChange({ ...rules, ctaRules: { ...rules.ctaRules, defaultCta: event.target.value } })} /></label>
        <label>허용 CTA<textarea value={join(rules.ctaRules.allowed)} onChange={(event) => onChange({ ...rules, ctaRules: { ...rules.ctaRules, allowed: split(event.target.value) } })} /></label>
        <label>채널별 규칙<textarea aria-label="채널별 규칙" value={JSON.stringify(rules.channelRules, null, 2)} onChange={(event) => {
          try { onChange({ ...rules, channelRules: JSON.parse(event.target.value) as Record<string, string[]> }); } catch { /* keep the last valid structured value */ }
        }} /></label>
        <label>디자인 색상<textarea value={join(rules.designRules.colors)} onChange={(event) => onChange({ ...rules, designRules: { ...rules.designRules, colors: split(event.target.value) } })} /></label>
        <label>디자인 폰트<textarea value={join(rules.designRules.fonts)} onChange={(event) => onChange({ ...rules, designRules: { ...rules.designRules, fonts: split(event.target.value) } })} /></label>
        <label>디자인 메모<textarea value={join(rules.designRules.notes)} onChange={(event) => onChange({ ...rules, designRules: { ...rules.designRules, notes: split(event.target.value) } })} /></label>
        <label className="toggle-row">
          <input type="checkbox" checked={rules.autoApprovalRules.enabled} onChange={(event) => onChange({ ...rules, autoApprovalRules: { ...rules.autoApprovalRules, enabled: event.target.checked } })} />
          <span>조건 충족 시 검토 승인 제안</span>
        </label>
        <label>승인 제안 조건<textarea value={join(rules.autoApprovalRules.conditions)} onChange={(event) => onChange({ ...rules, autoApprovalRules: { ...rules.autoApprovalRules, conditions: split(event.target.value) } })} /></label>
        <p className="form-hint">이 설정은 검토 제안 조건이며 자동 게시나 Instagram 자동답변을 켜지 않습니다.</p>
        <div className="form-actions">
          <button className="button" type="button" disabled={saving} onClick={onSave}>규칙 초안 저장</button>
          <button className="button primary" type="button" disabled={saving} onClick={onApprove}>규칙 승인</button>
        </div>
      </div>
    </section>
  );
}
