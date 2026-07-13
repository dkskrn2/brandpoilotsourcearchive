interface FieldProps {
  label: string;
  children: React.ReactNode;
  full?: boolean;
  required?: boolean;
}

export function Field({ label, children, full = false, required = false }: FieldProps) {
  return (
    <label className={full ? "field full" : "field"}>
      <span className="field-label">
        <span>{label}</span>
        {required ? <span className="required-marker" aria-hidden="true">필수 입력</span> : null}
      </span>
      {children}
    </label>
  );
}
