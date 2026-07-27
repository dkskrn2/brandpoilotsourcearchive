import { RotateCcw, Trash2, Upload } from "lucide-react";
import { useId, useRef } from "react";

export interface FileUploadItem {
  id: string;
  name: string;
  size: number;
  status?: "selected" | "uploading" | "uploaded" | "failed";
  retryable?: boolean;
}

interface FileUploadButtonProps {
  inputLabel: string;
  buttonLabel: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  items?: FileUploadItem[];
  onFiles(files: File[]): void;
  onRemove?(id: string): void;
  onRetry?(id: string): void;
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Number((size / 1024).toFixed(1))} KB`;
  return `${Number((size / 1024 / 1024).toFixed(1))} MB`;
}

const statusLabels: Record<NonNullable<FileUploadItem["status"]>, string> = {
  selected: "선택됨",
  uploading: "업로드 중",
  uploaded: "업로드 완료",
  failed: "업로드 실패",
};

export function FileUploadButton({ inputLabel, buttonLabel, accept, multiple = false, disabled = false, items = [], onFiles, onRemove, onRetry }: FileUploadButtonProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    if (!disabled) inputRef.current?.click();
  }

  return (
    <div className="file-upload">
      <input
        ref={inputRef}
        id={inputId}
        className="visually-hidden"
        aria-label={inputLabel}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          if (!disabled && files.length > 0) onFiles(files);
          event.currentTarget.value = "";
        }}
      />
      <label
        className={`file-upload__picker${disabled ? " is-disabled" : ""}`}
        htmlFor={inputId}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
      >
        <Upload size={17} aria-hidden="true" />
        <span>{buttonLabel}</span>
      </label>
      {items.length > 0 ? (
        <ul className="file-upload__items">
          {items.map((item) => (
            <li key={item.id}>
              <span className="file-upload__name" title={item.name}>{item.name}</span>
              <span
                className="file-upload__meta"
                role={item.status === "failed" ? "status" : undefined}
                aria-live={item.status === "failed" ? "polite" : undefined}
              >
                {formatFileSize(item.size)}
                {item.status ? ` · ${statusLabels[item.status]}` : ""}
              </span>
              {onRetry || onRemove ? <span className="file-upload__actions">
                {onRetry && item.status === "failed" && item.retryable !== false ? (
                  <button
                    type="button"
                    className="icon-button file-upload__retry"
                    aria-label={`${item.name} 다시 업로드`}
                    title="다시 업로드"
                    disabled={disabled}
                    onClick={() => { if (!disabled) onRetry(item.id); }}
                  >
                    <RotateCcw size={15} aria-hidden="true" />
                  </button>
                ) : null}
                {onRemove ? (
                  <button
                    type="button"
                    className="icon-button file-upload__remove"
                    aria-label={`${item.name} 삭제`}
                    title="파일 삭제"
                    disabled={disabled || item.status === "uploading"}
                    onClick={() => { if (!disabled) onRemove(item.id); }}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                ) : null}
              </span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
