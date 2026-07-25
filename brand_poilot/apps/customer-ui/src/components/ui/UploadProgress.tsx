interface UploadProgressProps {
  value: number;
  label?: string;
}

export function UploadProgress({ value, label = "파일 업로드" }: UploadProgressProps) {
  const percentage = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className="upload-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentage}
    >
      <span className="upload-progress__track" aria-hidden="true">
        <span className="upload-progress__bar" style={{ width: `${percentage}%` }} />
      </span>
      <span className="upload-progress__value">{percentage}%</span>
    </div>
  );
}
