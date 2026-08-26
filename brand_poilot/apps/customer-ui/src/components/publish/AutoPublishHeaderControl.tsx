import { useState } from "react";
import type { Ref } from "react";

type ToggleResult = { ok: true } | { ok: false; message?: string };

export function AutoPublishHeaderControl({
  enabled,
  canEnable,
  disabledReason,
  onToggle,
  onEdit,
  editButtonRef,
}: {
  enabled: boolean;
  canEnable: boolean;
  disabledReason?: string | null;
  onToggle(enabled: boolean): Promise<ToggleResult>;
  onEdit(): void;
  editButtonRef?: Ref<HTMLButtonElement>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = pending || (!enabled && !canEnable);

  async function toggle() {
    if (disabled) return;
    setPending(true);
    setError(null);
    try {
      const result = await onToggle(!enabled);
      if (!result.ok) {
        setError(result.message ?? "자동 게시 상태를 변경하지 못했습니다. 잠시 후 다시 시도하세요.");
      }
    } catch {
      setError("자동 게시 상태를 변경하지 못했습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setPending(false);
    }
  }

  const stateLabel = enabled ? "ON" : "OFF";
  return (
    <div className="auto-publish-header-control">
      <div className="auto-publish-header-control__main">
        <span className="auto-publish-header-control__label">자동 게시</span>
        <button
          className={`auto-publish-header-control__switch${enabled ? " is-on" : ""}`}
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`자동 게시 ${stateLabel}`}
          aria-describedby={!enabled && !canEnable && disabledReason ? "auto-publish-disabled-reason" : undefined}
          aria-busy={pending}
          disabled={disabled}
          onClick={() => void toggle()}
        >
          <span aria-hidden="true" className="auto-publish-header-control__switch-knob" />
          <span>{stateLabel}</span>
        </button>
        <button ref={editButtonRef} className="button" type="button" aria-label="자동 게시 수정" onClick={onEdit}>수정</button>
      </div>
      {!enabled && !canEnable && disabledReason ? <small id="auto-publish-disabled-reason">{disabledReason}</small> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
