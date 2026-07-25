interface SwitchProps {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  indeterminate?: boolean;
}

export function Switch({ label, checked, defaultChecked = false, onChange, disabled = false, indeterminate = false }: SwitchProps) {
  return (
    <label className="switch" aria-label={label} data-state={indeterminate ? "mixed" : checked ? "on" : "off"}>
      <input
        role="switch"
        type="checkbox"
        checked={checked}
        defaultChecked={checked === undefined ? defaultChecked : undefined}
        disabled={disabled}
        onChange={(event) => onChange?.(event.currentTarget.checked)}
      />
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
    </label>
  );
}
