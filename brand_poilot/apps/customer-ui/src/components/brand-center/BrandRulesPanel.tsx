import { useEffect, useState } from "react";
import type { BrandRules } from "../../features/brand-center/types";

type RawRuleFields = {
  requiredPhrases: string;
  forbiddenPhrases: string;
  exaggerationRules: string;
  allowedCtas: string;
  channelRules: string;
  colors: string;
  fonts: string;
  notes: string;
  autoApprovalConditions: string;
};

const join = (items: string[]) => items.join("\n");
const split = (value: string) => value
  .split("\n")
  .map((item) => item.trim())
  .filter(Boolean);

function rawFields(rules: BrandRules): RawRuleFields {
  return {
    requiredPhrases: join(rules.requiredPhrases),
    forbiddenPhrases: join(rules.forbiddenPhrases),
    exaggerationRules: join(rules.exaggerationRules),
    allowedCtas: join(rules.ctaRules.allowed),
    channelRules: JSON.stringify(rules.channelRules, null, 2),
    colors: join(rules.designRules.colors),
    fonts: join(rules.designRules.fonts),
    notes: join(rules.designRules.notes),
    autoApprovalConditions: join(rules.autoApprovalRules.conditions),
  };
}

function parseChannelRules(value: string): Record<string, string[]> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
  for (const entries of Object.values(parsed)) {
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")) {
      throw new Error();
    }
  }
  return parsed as Record<string, string[]>;
}

export function BrandRulesPanel({
  rules,
  saving,
  onChange,
  onDirty,
  onSave,
  onApprove,
  onEdit,
  onCancel,
  editing,
  dirty,
  canApprove,
}: {
  rules: BrandRules;
  saving: boolean;
  onChange(rules: BrandRules): void;
  onDirty(): void;
  onSave(rules: BrandRules): void;
  onApprove(): void;
  onEdit(): void;
  onCancel(): void;
  editing: boolean;
  dirty: boolean;
  canApprove: boolean;
}) {
  const [raw, setRaw] = useState<RawRuleFields>(() => rawFields(rules));
  const [channelError, setChannelError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setRaw(rawFields(rules));
      setChannelError(null);
    }
  }, [editing, rules]);

  function changeRaw(field: keyof RawRuleFields, value: string) {
    setRaw((current) => ({ ...current, [field]: value }));
    if (field === "channelRules") setChannelError(null);
    onDirty();
  }

  function nextRules(): BrandRules | null {
    let channelRules: Record<string, string[]>;
    try {
      channelRules = parseChannelRules(raw.channelRules);
    } catch {
      setChannelError("채널별 규칙은 올바른 JSON 객체여야 하며, 각 값은 문자열 목록이어야 합니다.");
      return null;
    }
    setChannelError(null);
    return {
      ...rules,
      requiredPhrases: split(raw.requiredPhrases),
      forbiddenPhrases: split(raw.forbiddenPhrases),
      exaggerationRules: split(raw.exaggerationRules),
      ctaRules: { ...rules.ctaRules, allowed: split(raw.allowedCtas) },
      channelRules,
      designRules: {
        ...rules.designRules,
        colors: split(raw.colors),
        fonts: split(raw.fonts),
        notes: split(raw.notes),
      },
      autoApprovalRules: {
        ...rules.autoApprovalRules,
        conditions: split(raw.autoApprovalConditions),
      },
    };
  }

  function commitRaw() {
    const next = nextRules();
    if (next) onChange(next);
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div><span className="brand-center-eyebrow">EXECUTION RULES</span><h2>운영 규칙</h2></div>
        {!editing ? (
          <div className="form-actions">
            <button className="button" type="button" disabled={saving} onClick={onEdit}>규칙 수정</button>
            {canApprove ? (
              <button className="button primary" type="button" disabled={saving} onClick={onApprove}>
                규칙 승인
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="panel-body brand-rules-form">
        <label>반드시 포함할 문구<textarea disabled={!editing} value={raw.requiredPhrases} onChange={(event) => changeRaw("requiredPhrases", event.target.value)} onBlur={commitRaw} /></label>
        <label>사용 금지 문구<textarea disabled={!editing} value={raw.forbiddenPhrases} onChange={(event) => changeRaw("forbiddenPhrases", event.target.value)} onBlur={commitRaw} /></label>
        <label>과장 표현 제한<textarea disabled={!editing} value={raw.exaggerationRules} onChange={(event) => changeRaw("exaggerationRules", event.target.value)} onBlur={commitRaw} /></label>
        <label>기본 CTA<input disabled={!editing} value={rules.ctaRules.defaultCta} onChange={(event) => onChange({ ...rules, ctaRules: { ...rules.ctaRules, defaultCta: event.target.value } })} /></label>
        <label>허용 CTA<textarea disabled={!editing} value={raw.allowedCtas} onChange={(event) => changeRaw("allowedCtas", event.target.value)} onBlur={commitRaw} /></label>
        <label>채널별 규칙<textarea aria-label="채널별 규칙" aria-invalid={Boolean(channelError)} disabled={!editing} value={raw.channelRules} onChange={(event) => changeRaw("channelRules", event.target.value)} onBlur={commitRaw} /></label>
        {channelError ? <p className="form-hint" role="alert">{channelError}</p> : null}
        <label>디자인 색상<textarea disabled={!editing} value={raw.colors} onChange={(event) => changeRaw("colors", event.target.value)} onBlur={commitRaw} /></label>
        <label>디자인 폰트<textarea disabled={!editing} value={raw.fonts} onChange={(event) => changeRaw("fonts", event.target.value)} onBlur={commitRaw} /></label>
        <label>디자인 메모<textarea disabled={!editing} value={raw.notes} onChange={(event) => changeRaw("notes", event.target.value)} onBlur={commitRaw} /></label>
        <label className="toggle-row">
          <input type="checkbox" disabled={!editing} checked={rules.autoApprovalRules.enabled} onChange={(event) => onChange({ ...rules, autoApprovalRules: { ...rules.autoApprovalRules, enabled: event.target.checked } })} />
          <span>조건 충족 시 검토 승인 제안</span>
        </label>
        <label>승인 제안 조건<textarea disabled={!editing} value={raw.autoApprovalConditions} onChange={(event) => changeRaw("autoApprovalConditions", event.target.value)} onBlur={commitRaw} /></label>
        <p className="form-hint">이 설정은 검토 제안 조건이며 자동 게시나 Instagram 자동답변을 켜지 않습니다.</p>
        {editing ? (
          <div className="form-actions">
            <button className="button primary" type="button" disabled={saving || !dirty} onClick={() => {
              const next = nextRules();
              if (next) onSave(next);
            }}>규칙 저장</button>
            <button className="button" type="button" disabled={saving} onClick={onCancel}>규칙 취소</button>
            {dirty ? <span className="brand-center-dirty">저장하지 않은 변경</span> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
