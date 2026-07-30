import { useEffect, useRef, useState } from "react";
import { Alert } from "../ui/Alert";
import { FileUploadButton } from "../ui/FileUploadButton";

const acceptedExtensions = ["txt", "md", "pdf", "csv", "xlsx"];

interface SelectedEvidenceFile {
  id: string;
  file: File;
}

export function BrandEvidenceInputStep({
  busy,
  error,
  onSubmit,
  initialOwnedUrl = "",
  initialCompanyName = "",
}: {
  busy: boolean;
  error: string | null;
  initialOwnedUrl?: string;
  initialCompanyName?: string;
  onSubmit(input: { companyName: string; ownedUrl: string | null; files: File[] }): Promise<void>;
}) {
  const [companyName, setCompanyName] = useState(initialCompanyName);
  const [ownedUrl, setOwnedUrl] = useState(initialOwnedUrl);
  const [files, setFiles] = useState<SelectedEvidenceFile[]>([]);
  const [validation, setValidation] = useState<string | null>(null);
  const nextFileId = useRef(0);

  useEffect(() => {
    setOwnedUrl((current) => current || initialOwnedUrl);
  }, [initialOwnedUrl]);
  useEffect(() => {
    setCompanyName((current) => current || initialCompanyName);
  }, [initialCompanyName]);

  function chooseFiles(selected: File[]) {
    if (files.length + selected.length > 5) return setValidation("문서는 최대 5개까지 첨부할 수 있습니다.");
    const invalid = selected.find((file) => !acceptedExtensions.includes(file.name.split(".").pop()?.toLowerCase() ?? ""));
    if (invalid) return setValidation("TXT, MD, PDF, CSV, XLSX 파일만 첨부할 수 있습니다.");
    if (selected.some((file) => file.size > 10 * 1024 * 1024)) return setValidation("파일 하나의 크기는 10MB 이하여야 합니다.");
    if ([...files.map(({ file }) => file), ...selected]
      .reduce((total, file) => total + file.size, 0) > 25 * 1024 * 1024) {
      return setValidation("첨부 문서 전체 크기는 25MB 이하여야 합니다.");
    }
    setValidation(null);
    setFiles((current) => [
      ...current,
      ...selected.map((file) => ({ id: `evidence-file-${nextFileId.current++}`, file })),
    ]);
  }

  async function submit() {
    const normalizedCompanyName = companyName.normalize("NFKC").trim();
    if (!normalizedCompanyName) return setValidation("회사명을 입력하세요.");
    if (Array.from(normalizedCompanyName).length > 100
      || /[\u0000-\u001f\u007f]/.test(normalizedCompanyName)) {
      return setValidation("회사명을 100자 이내로 입력하세요.");
    }
    const normalizedUrl = ownedUrl.trim();
    if (!normalizedUrl && files.length === 0) return setValidation("자사 URL 또는 문서를 하나 이상 입력하세요.");
    if (normalizedUrl) {
      try {
        if (new URL(normalizedUrl).protocol !== "https:") throw new Error();
      } catch {
        return setValidation("자사 URL은 https:// 주소로 입력하세요.");
      }
    }
    setValidation(null);
    await onSubmit({
      companyName: normalizedCompanyName,
      ownedUrl: normalizedUrl || null,
      files: files.map((item) => item.file),
    });
  }

  return (
    <section className="panel brand-intelligence-step">
      <div className="panel-head"><h2>분석할 자사 자료</h2></div>
      <div className="panel-body brand-evidence-form">
        <label className="field-stack">
          <span className="field-label">회사명</span>
          <input
            type="text"
            aria-label="회사명"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            placeholder="회사명을 입력하세요"
            maxLength={100}
            disabled={busy}
          />
          <small>카카오 계정의 사람 이름이 아니라 실제 회사명을 입력하세요.</small>
        </label>

        <label className="field-stack">
          <span className="field-label">자사 URL</span>
          <input
            type="url"
            value={ownedUrl}
            onChange={(event) => setOwnedUrl(event.target.value)}
            placeholder="https://example.com"
            disabled={busy}
          />
          <small>회사나 서비스가 공개된 대표 사이트 한 곳을 입력하세요. 변경한 주소는 분석 결과를 확인하고 저장할 때 자사 URL에 반영됩니다.</small>
        </label>

        <div className="brand-document-drop">
          <span className="field-label">회사 문서</span>
          <span>TXT, MD, 텍스트 PDF, CSV, XLSX · 최대 5개 · 각 10MB</span>
          <FileUploadButton
            inputLabel="회사 문서 선택"
            buttonLabel="회사 문서 추가"
            multiple
            accept=".txt,.md,.pdf,.csv,.xlsx"
            disabled={busy}
            items={files.map(({ id, file }) => ({ id, name: file.name, size: file.size, status: "selected" }))}
            onFiles={chooseFiles}
            onRemove={(id) => setFiles((current) => current.filter((item) => item.id !== id))}
          />
        </div>
        {(validation || error) && <Alert title="자료를 확인해 주세요" variant="bad">{validation ?? error}</Alert>}
        <div className="form-actions">
          <button type="button" className="button primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "자료를 등록하는 중" : "분석 시작"}
          </button>
        </div>
      </div>
    </section>
  );
}
