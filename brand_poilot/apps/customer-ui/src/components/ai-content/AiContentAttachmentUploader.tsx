import { FileText, Image, Package, User, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AiContentGateway, GenerationAttachment } from "../../features/ai-content/types";
import { attachmentErrorGuidance } from "../../features/ai-content/attachmentErrors";
import { FileUploadButton } from "../ui/FileUploadButton";
import { UploadProgress } from "../ui/UploadProgress";

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
  totalAttachmentCount?: number;
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

const documentMimeByExtension: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function normalizedMimeType(role: GenerationAttachment["role"], file: File) {
  if (role !== "document") return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return documentMimeByExtension[extension] ?? file.type;
}

function validateFile(role: GenerationAttachment["role"], file: File, attachments: GenerationAttachment[], attachmentCount: number) {
  const isDocument = role === "document";
  const mimeType = normalizedMimeType(role, file);
  if (isDocument ? !documentMimeTypes.has(mimeType) : !["image/png", "image/jpeg"].includes(mimeType)) {
    return isDocument ? "PDF, TXT, MD, CSV, XLSX 파일만 첨부할 수 있습니다." : "PNG, JPEG 파일만 첨부할 수 있습니다.";
  }
  const maxBytes = mimeType === "application/pdf" || mimeType.includes("spreadsheetml") ? 10_000_000 : 5_000_000;
  if (file.size > maxBytes) return isDocument ? "문서는 형식에 따라 5~10MB 이하여야 합니다." : "이미지는 5MB 이하여야 합니다.";
  if (attachmentCount >= 5) return "첨부 파일은 최대 5개입니다.";
  if (attachments.some((item) => item.uploadStatus !== "failed" && item.fileName === file.name && item.size === file.size)) return "같은 파일이 이미 첨부되어 있습니다.";
  return null;
}

export function AiContentAttachmentUploader({ gateway, brandId, generationId, attachments, totalAttachmentCount, allowedRoles, onChange }: Props) {
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const attachmentsRef = useRef(attachments);
  const mountedRef = useRef(true);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  function changeAttachments(update: (current: GenerationAttachment[]) => GenerationAttachment[]) {
    if (!mountedRef.current) return;
    const next = update(attachmentsRef.current);
    attachmentsRef.current = next;
    onChange(next);
  }

  async function uploadAttachment(local: GenerationAttachment) {
    if (!generationId || !local.file) return;
    if (mountedRef.current) setProgress((current) => ({ ...current, [local.id]: 0 }));
    try {
      const uploaded = await gateway.uploadAttachment(brandId, generationId, local, (percentage) => {
        if (mountedRef.current) setProgress((current) => ({ ...current, [local.id]: percentage }));
      });
      changeAttachments((current) => [
        ...current.filter((item) => item.id !== local.id),
        { ...uploaded, uploadStatus: "confirmed" },
      ]);
    } catch (cause) {
      changeAttachments((current) => current.map((item) => item.id === local.id
        ? { ...item, file: local.file, uploadStatus: "failed" }
        : item));
      if (mountedRef.current) setError(attachmentErrorGuidance(cause, local.fileName));
    } finally {
      if (mountedRef.current) {
        setProgress((current) => {
          const next = { ...current };
          delete next[local.id];
          return next;
        });
      }
    }
  }

  async function upload(role: GenerationAttachment["role"], files: File[]) {
    const file = files[0];
    if (!file) return;
    const attachmentCount = totalAttachmentCount === undefined
      ? attachmentsRef.current.filter((item) => item.uploadStatus !== "failed").length
      : totalAttachmentCount + attachmentsRef.current.length - attachments.length;
    const validationError = validateFile(
      role,
      file,
      attachmentsRef.current,
      attachmentCount,
    );
    if (validationError) return setError(validationError);
    const mimeType = normalizedMimeType(role, file);
    const localId = `${role}-${file.name}-${file.size}-${crypto.randomUUID()}`;
    const local: GenerationAttachment = {
      id: localId,
      role,
      fileName: file.name,
      mimeType,
      size: file.size,
      file,
      uploadStatus: generationId ? "pending" : undefined,
    };
    setError(null);
    if (!generationId) {
      changeAttachments((current) => [...current, local]);
      return;
    }
    changeAttachments((current) => [...current, local]);
    await uploadAttachment(local);
  }

  async function retry(attachmentId: string) {
    const attachment = attachmentsRef.current.find((item) => item.id === attachmentId);
    if (!attachment?.file || attachment.uploadStatus !== "failed") return;
    setError(null);
    const pending = { ...attachment, uploadStatus: "pending" as const };
    changeAttachments((current) => current.map((item) => item.id === attachmentId ? pending : item));
    await uploadAttachment(pending);
  }

  async function remove(attachmentId: string) {
    const attachment = attachmentsRef.current.find((item) => item.id === attachmentId);
    if (!attachment) return;
    setError(null);
    if (generationId && attachment.storagePath) {
      try {
        await gateway.removeAttachment(brandId, generationId, attachment.id);
      } catch {
        setError(`${attachment.fileName} 파일을 삭제하지 못했습니다. 다시 시도해 주세요.`);
        return;
      }
    }
    changeAttachments((current) => current.filter((item) => item.id !== attachmentId));
  }

  return <div className="ai-content-attachment-uploader">
    <div className="attachment-grid">
      {fields.filter(([role]) => !allowedRoles || allowedRoles.includes(role)).map(([role, label, Icon]) => <div className="attachment-picker" key={role}>
        <div className="attachment-picker__label"><Icon size={18} aria-hidden="true" /><span>{label}</span></div>
        <FileUploadButton
          inputLabel={label}
          buttonLabel={`${label} 추가`}
          accept={role === "document" ? ".pdf,.txt,.md,.csv,.xlsx,application/pdf,text/plain,text/markdown,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "image/png,image/jpeg"}
          items={attachments.filter((item) => item.role === role).map((item) => ({
            id: item.id,
            name: item.fileName,
            size: item.size,
            status: item.uploadStatus === "failed"
              ? "failed"
              : item.uploadStatus === "pending"
                ? "uploading"
                : item.uploadStatus === "confirmed" || generationId
                  ? "uploaded"
                  : "selected",
          }))}
          onFiles={(files) => void upload(role, files)}
          onRemove={(id) => void remove(id)}
          onRetry={(id) => void retry(id)}
        />
      </div>)}
    </div>
    {error ? <p role="alert" className="wizard-error">{error}</p> : null}
    {Object.entries(progress).map(([id, percentage]) => <UploadProgress key={id} value={percentage} label="첨부 파일 업로드" />)}
  </div>;
}
