import { FileText, Image, Package, Trash2, User, ZoomIn } from "lucide-react";
import { useState } from "react";
import type { AiContentGateway, GenerationAttachment } from "../../features/ai-content/types";

const fields: Array<[GenerationAttachment["role"], string, typeof Package]> = [
  ["product", "제품 이미지", Package],
  ["person", "인물 이미지", User],
  ["scale", "크기·비율 참고 이미지", ZoomIn],
  ["visual_reference", "시각 참고 이미지", Image],
  ["document", "문서", FileText],
];

interface Props {
  gateway: AiContentGateway;
  brandId: string;
  generationId: string | null;
  attachments: GenerationAttachment[];
  allowedRoles?: GenerationAttachment["role"][];
  onChange(attachments: GenerationAttachment[]): void;
}

const documentMimeTypes = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function validateFile(role: GenerationAttachment["role"], file: File, attachments: GenerationAttachment[]) {
  const isDocument = role === "document";
  if (isDocument ? !documentMimeTypes.has(file.type) : !["image/png", "image/jpeg"].includes(file.type)) {
    return isDocument ? "PDF, TXT, MD, CSV, XLSX 파일만 첨부할 수 있습니다." : "PNG, JPEG 파일만 첨부할 수 있습니다.";
  }
  const maxBytes = file.type === "application/pdf" || file.type.includes("spreadsheetml") ? 10_000_000 : 5_000_000;
  if (file.size > maxBytes) return isDocument ? "문서는 형식에 따라 5~10MB 이하여야 합니다." : "이미지는 5MB 이하여야 합니다.";
  if (attachments.length >= 5) return "첨부 파일은 최대 5개입니다.";
  if (attachments.some((item) => item.fileName === file.name && item.size === file.size)) return "같은 파일이 이미 첨부되어 있습니다.";
  return null;
}

export function AiContentAttachmentUploader({ gateway, brandId, generationId, attachments, allowedRoles, onChange }: Props) {
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  async function upload(role: GenerationAttachment["role"], files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const validationError = validateFile(role, file, attachments);
    if (validationError) return setError(validationError);
    const localId = `${role}-${file.name}-${file.size}`;
    setError(null);
    if (!generationId) {
      onChange([...attachments, { id: localId, role, fileName: file.name, mimeType: file.type, size: file.size, file }]);
      return;
    }
    setProgress((current) => ({ ...current, [localId]: 0 }));
    try {
      const uploaded = await gateway.uploadAttachment(brandId, generationId, {
        id: localId,
        role,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        file,
      }, (percentage) => setProgress((current) => ({ ...current, [localId]: percentage })));
      onChange([...attachments, uploaded]);
    } catch {
      setError(`${file.name} 파일을 업로드하지 못했습니다. 다시 시도해 주세요.`);
    } finally {
      setProgress((current) => {
        const next = { ...current };
        delete next[localId];
        return next;
      });
    }
  }

  return <div className="ai-content-attachment-uploader">
    <div className="attachment-grid">
      {fields.filter(([role]) => !allowedRoles || allowedRoles.includes(role)).map(([role, label, Icon]) => <label key={role}>
        <Icon size={18} /><span>{label}</span>
        <input
          type="file"
          accept={role === "document" ? ".pdf,.txt,.md,.csv,.xlsx,application/pdf,text/plain,text/markdown,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "image/png,image/jpeg"}
          onChange={(event) => { void upload(role, event.target.files); event.currentTarget.value = ""; }}
        />
      </label>)}
    </div>
    {error ? <p role="alert" className="wizard-error">{error}</p> : null}
    {Object.entries(progress).map(([id, percentage]) => <div key={id} className="attachment-progress" role="status"><progress max="100" value={percentage} /> 업로드 {Math.round(percentage)}%</div>)}
    {attachments.length ? <ul className="attachment-list">{attachments.map((item) => <li key={item.id}>
      <span>{item.fileName}</span><span>업로드 완료</span>
      <button type="button" className="icon-button" title="첨부 제거" aria-label={`${item.fileName} 첨부 제거`} onClick={() => onChange(attachments.filter((row) => row.id !== item.id))}><Trash2 size={16} /></button>
    </li>)}</ul> : null}
  </div>;
}
