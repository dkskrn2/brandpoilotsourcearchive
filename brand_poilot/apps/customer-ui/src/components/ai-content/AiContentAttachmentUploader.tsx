import { FileText, Image, Package, User, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AiContentGateway, AttachmentLifecycleAction, GenerationAttachment, GenerationAttachmentUpdate } from "../../features/ai-content/types";
import { attachmentErrorGuidance, attachmentLifecycleGuidance } from "../../features/ai-content/attachmentErrors";
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
  disabled?: boolean;
  onChange(update: GenerationAttachmentUpdate): void;
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

function validateFile(role: GenerationAttachment["role"], file: File, attachments: GenerationAttachment[], attachmentCount: number, replacingFailedId?: string) {
  const isDocument = role === "document";
  const mimeType = normalizedMimeType(role, file);
  if (isDocument ? !documentMimeTypes.has(mimeType) : !["image/png", "image/jpeg"].includes(mimeType)) {
    return isDocument ? "PDF, TXT, MD, CSV, XLSX 파일만 첨부할 수 있습니다." : "PNG, JPEG 파일만 첨부할 수 있습니다.";
  }
  const maxBytes = mimeType === "application/pdf" || mimeType.includes("spreadsheetml") ? 10_000_000 : 5_000_000;
  if (file.size > maxBytes) return isDocument ? "문서는 형식에 따라 5~10MB 이하여야 합니다." : "이미지는 5MB 이하여야 합니다.";
  if (attachmentCount >= 5 && !replacingFailedId) return "첨부 파일은 최대 5개입니다.";
  if (attachments.some((item) => item.uploadStatus !== "failed" && item.fileName === file.name && item.size === file.size)) return "같은 파일이 이미 첨부되어 있습니다.";
  return null;
}

export function AiContentAttachmentUploader({ gateway, brandId, generationId, attachments, totalAttachmentCount, allowedRoles, disabled = false, onChange }: Props) {
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<{ message: string; action: AttachmentLifecycleAction } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  function changeAttachments(update: (current: GenerationAttachment[]) => GenerationAttachment[]) {
    if (!mountedRef.current) return;
    onChange(update);
  }

  async function uploadAttachment(local: GenerationAttachment) {
    if (!generationId || !local.file) return;
    if (mountedRef.current) setProgress((current) => ({ ...current, [local.id]: 0 }));
    try {
      const uploaded = await gateway.uploadAttachment(brandId, generationId, local, (percentage) => {
        if (mountedRef.current) setProgress((current) => ({ ...current, [local.id]: percentage }));
      });
      changeAttachments((current) => [
        ...current.map((item) => item.id === local.id
          ? {
            ...uploaded,
            uploadStatus: "confirmed" as const,
            uploadAction: undefined,
            uploadRetryable: undefined,
          }
          : item),
      ]);
    } catch (cause) {
      const guidance = attachmentLifecycleGuidance(cause);
      changeAttachments((current) => current.map((item) => item.id === local.id
        ? {
          ...item,
          file: local.file,
          uploadStatus: "failed",
          uploadAction: guidance?.action ?? "retry",
          uploadRetryable: guidance?.retryable ?? true,
        }
        : item));
      if (mountedRef.current) {
        setError({
          message: guidance?.message ?? attachmentErrorGuidance(cause, local.fileName),
          action: guidance?.action ?? "retry",
        });
      }
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
    if (disabled) return;
    const file = files[0];
    if (!file) return;
    const failedMatch = attachments.find((item) => (
      item.role === role
      && item.uploadStatus === "failed"
      && item.fileName === file.name
      && item.size === file.size
    ));
    const externalAttachmentCount = totalAttachmentCount === undefined
      ? 0
      : Math.max(0, totalAttachmentCount - attachments.length);
    const attachmentCount = totalAttachmentCount === undefined
      ? attachments.length
      : externalAttachmentCount + attachments.length;
    const validationError = validateFile(
      role,
      file,
      attachments,
      attachmentCount,
      failedMatch?.id,
    );
    if (validationError) return setError({ message: validationError, action: "none" });
    const mimeType = normalizedMimeType(role, file);
    const localId = failedMatch?.id ?? `${role}-${file.name}-${file.size}-${crypto.randomUUID()}`;
    const local: GenerationAttachment = {
      id: localId,
      role,
      fileName: file.name,
      mimeType,
      size: file.size,
      file,
      uploadStatus: generationId ? "pending" : undefined,
      uploadAction: undefined,
      uploadRetryable: undefined,
    };
    setError(null);
    if (!generationId) {
      changeAttachments((current) => failedMatch
        ? current.map((item) => item.id === failedMatch.id ? local : item)
        : [...current, local]);
      return;
    }
    changeAttachments((current) => failedMatch
      ? current.map((item) => item.id === failedMatch.id ? local : item)
      : [...current, local]);
    await uploadAttachment(local);
  }

  async function retry(attachmentId: string) {
    if (disabled) return;
    const attachment = attachments.find((item) => item.id === attachmentId);
    if (!attachment?.file || attachment.uploadStatus !== "failed" || attachment.uploadRetryable === false) return;
    setError(null);
    const pending = {
      ...attachment,
      uploadStatus: "pending" as const,
      uploadAction: undefined,
      uploadRetryable: undefined,
    };
    changeAttachments((current) => current.map((item) => item.id === attachmentId ? pending : item));
    await uploadAttachment(pending);
  }

  async function remove(attachmentId: string) {
    if (disabled) return;
    const attachment = attachments.find((item) => item.id === attachmentId);
    if (!attachment) return;
    setError(null);
    if (generationId && attachment.storagePath) {
      try {
        await gateway.removeAttachment(brandId, generationId, attachment.id);
      } catch {
        setError({
          message: `${attachment.fileName} 파일을 삭제하지 못했습니다. 다시 시도해 주세요.`,
          action: "retry",
        });
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
          disabled={disabled}
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
            retryable: item.uploadRetryable,
          }))}
          onFiles={(files) => void upload(role, files)}
          onRemove={(id) => void remove(id)}
          onRetry={(id) => void retry(id)}
        />
      </div>)}
    </div>
    {error ? <p role="alert" className="wizard-error">
      {error.message}
      {error.action === "new_generation" ? <> <a href="/ai-content/new">새 콘텐츠 생성</a></> : null}
    </p> : null}
    {Object.entries(progress).map(([id, percentage]) => <UploadProgress key={id} value={percentage} label="첨부 파일 업로드" />)}
  </div>;
}
