import { Link2 } from "lucide-react";
import { useState } from "react";
import { FileUploadButton } from "../ui/FileUploadButton";
import type { PreviewFile } from "../../features/brand-center-preview/types";

interface SourceIntakeStepProps {
  url: string;
  files: PreviewFile[];
  error: string | null;
  onUrlChanged(url: string): void;
  onFilesAdded(files: PreviewFile[]): void;
  onFileRemoved(id: string): void;
  onAnalyze(): void;
}

export function SourceIntakeStep({
  url,
  files,
  error,
  onUrlChanged,
  onFilesAdded,
  onFileRemoved,
  onAnalyze,
}: SourceIntakeStepProps) {
  const hasSource = Boolean(url.trim() || files.length);
  const [dragging, setDragging] = useState(false);

  function addSelectedFiles(selectedFiles: File[]) {
    onFilesAdded(selectedFiles.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      size: file.size,
      status: "selected",
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
          <span>PDF, DOC, DOCX, PPT, PPTX</span>
        </div>

        <FileUploadButton
          inputLabel="브랜드 자료 파일 선택"
          buttonLabel="문서 파일 선택"
          accept=".pdf,.doc,.docx,.ppt,.pptx"
          multiple
          items={files}
          onFiles={addSelectedFiles}
          onRemove={onFileRemoved}
        />

        {error ? (
          <p id="brand-preview-source-error" className="brand-center-preview__field-error">
            {error}
          </p>
        ) : null}
      </div>

      <div className="brand-center-preview__card-footer">
        <p>자료 내용은 전송하거나 저장하지 않습니다.</p>
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
