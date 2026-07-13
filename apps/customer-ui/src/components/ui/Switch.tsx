interface SwitchProps {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
}

export function Switch({ label, checked, defaultChecked = false, onChange }: SwitchProps) {
  return (
    <label className="switch" aria-label={label}>
      <input
        role="switch"
        type="checkbox"
        checked={checked}
        defaultChecked={checked === undefined ? defaultChecked : undefined}
        onChange={(event) => onChange?.(event.currentTarget.checked)}
      />
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
    </label>
  );
}
