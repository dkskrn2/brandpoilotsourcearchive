import { Link2 } from "lucide-react";
import { useState } from "react";
import { FileUploadButton } from "../ui/FileUploadButton";
import type { PreviewFile } from "../../features/brand-center-preview/types";

const MAX_FILES = 5;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["txt", "md", "pdf", "csv", "xlsx"]);

interface SourceIntakeStepProps {
  companyName?: string;
  url: string;
  files: PreviewFile[];
  error: string | null;
  onUrlChanged(url: string): void;
  onCompanyNameChanged?(companyName: string): void;
  onFilesAdded(files: PreviewFile[]): void;
  onFileRemoved(id: string): void;
  onAnalyze(): void;
}

export function SourceIntakeStep({
  url,
  companyName = "",
  files,
  error,
  onUrlChanged,
  onCompanyNameChanged,
  onFilesAdded,
  onFileRemoved,
  onAnalyze,
}: SourceIntakeStepProps) {
  const hasSource = Boolean(companyName.trim() && (url.trim() || files.length));
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  function addSelectedFiles(selectedFiles: File[]) {
    if (selectedFiles.some((file) => {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      return !ALLOWED_EXTENSIONS.has(extension);
    })) {
      setFileError("TXT, MD, PDF, CSV, XLSX 파일만 첨부할 수 있습니다.");
      return;
    }
    if (files.length + selectedFiles.length > MAX_FILES) {
      setFileError("문서는 최대 5개까지 첨부할 수 있습니다.");
      return;
    }
    if (selectedFiles.some((file) => file.size > MAX_FILE_SIZE_BYTES)) {
      setFileError("파일 하나의 크기는 10MB 이하여야 합니다.");
      return;
    }
    if ([...files.map(({ file }) => file), ...selectedFiles]
      .reduce((total, file) => total + file.size, 0) > 25 * 1024 * 1024) {
      setFileError("첨부 문서 전체 크기는 25MB 이하여야 합니다.");
      return;
    }
    setFileError(null);
    onFilesAdded(selectedFiles.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      size: file.size,
      status: "selected",
      file,
    })));
  }

  return (
    <section className="brand-center-preview__card" aria-labelledby="source-step-title">
      <div className="brand-center-preview__card-heading">
        <p className="brand-center-preview__eyebrow">STEP 1</p>
        <h2 id="source-step-title">분석할 브랜드 자료를 등록하세요</h2>
        <p>공식 웹사이트 또는 PDF 등 기존 문서를 선택할 수 있습니다.</p>
      </div>

      <div className="brand-center-preview__source-form">
        <label htmlFor="brand-preview-company-name">회사명</label>
        <input
          id="brand-preview-company-name"
          type="text"
          value={companyName}
          maxLength={100}
          placeholder="회사명을 입력하세요"
          onChange={(event) => onCompanyNameChanged?.(event.currentTarget.value)}
        />
        <small>카카오 계정의 사람 이름이 아니라 실제 회사명을 입력하세요.</small>

        <label htmlFor="brand-preview-url">브랜드 웹사이트 URL</label>
        <div className="brand-center-preview__url-field">
          <Link2 size={18} aria-hidden="true" />
          <input
            id="brand-preview-url"
            type="url"
            value={url}
            placeholder="https://brand.example"
            aria-describedby={error ? "brand-preview-source-error" : undefined}
            aria-invalid={error ? true : undefined}
            onChange={(event) => onUrlChanged(event.currentTarget.value)}
          />
        </div>

        <div className="brand-center-preview__divider"><span>또는</span></div>

        <div
          className="brand-center-preview__dropzone"
          role="button"
          tabIndex={0}
          aria-label="브랜드 자료 끌어다 놓기"
          data-dragging={dragging}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addSelectedFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <strong>파일을 끌어다 놓으세요</strong>
          <span>TXT, MD, PDF, CSV, XLSX · 파일당 최대 10MB · 최대 5개</span>
        </div>

        <FileUploadButton
          inputLabel="브랜드 자료 파일 선택"
          buttonLabel="문서 파일 선택"
          accept=".txt,.md,.pdf,.csv,.xlsx"
          multiple
          items={files}
          onFiles={addSelectedFiles}
          onRemove={onFileRemoved}
        />

        {fileError || error ? (
          <p
            id="brand-preview-source-error"
            className="brand-center-preview__field-error"
            role="alert"
          >
            {fileError ?? error}
          </p>
        ) : null}
      </div>

      <div className="brand-center-preview__card-footer">
        <p>등록한 자료는 AI 분석과 브랜드 정보 저장에 사용됩니다.</p>
        <button
          type="button"
          className="brand-center-preview__primary-action"
          disabled={!hasSource}
          onClick={onAnalyze}
        >
          AI 분석 시작
        </button>
      </div>
    </section>
  );
}
