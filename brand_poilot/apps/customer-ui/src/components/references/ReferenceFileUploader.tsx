import { useEffect, useRef, useState } from "react";
import type { LibraryGateway } from "../../features/libraries/libraryGateway";
import type { ReferenceItem } from "../../types";
import { UploadProgress } from "../ui/UploadProgress";

type UploadStatus = "hashing" | "ready" | "uploading" | "uploaded" | "canceling" | "error";
interface UploadItem {
  id: string;
  file: File;
  checksum: string | null;
  sessionId: string | null;
  status: UploadStatus;
  progress: number;
  error: string | null;
  reference: ReferenceItem | null;
}

const accept = [
  "image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain",
  "text/markdown", "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
].join(",");

export function ReferenceFileUploader({
  brandId,
  gateway,
}: {
  brandId: string;
  gateway: LibraryGateway;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const itemsRef = useRef(items);
  const controllers = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);

  function commit(next: UploadItem[]) {
    itemsRef.current = next;
    if (mounted.current) setItems(next);
  }
  function update(id: string, patch: Partial<UploadItem>) {
    commit(itemsRef.current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function cancel(item: UploadItem) {
    controllers.current.get(item.id)?.abort();
    if (!item.sessionId || item.reference) return true;
    update(item.id, { status: "canceling", error: null });
    try {
      await gateway.cancelReferenceUpload(brandId, item.sessionId);
      return true;
    } catch {
      update(item.id, { status: "error", error: "업로드 정리를 완료하지 못했습니다." });
      return false;
    }
  }

  useEffect(() => () => {
    mounted.current = false;
    for (const controller of controllers.current.values()) controller.abort();
    for (const item of itemsRef.current) {
      if (item.sessionId && !item.reference) {
        void gateway.cancelReferenceUpload(brandId, item.sessionId);
      }
    }
  }, [brandId, gateway]);

  async function upload(item: UploadItem, checksum: string) {
    const controller = new AbortController();
    controllers.current.set(item.id, controller);
    update(item.id, { status: "uploading", progress: 0, error: null, checksum });
    try {
      const result = await gateway.uploadReferenceFile(brandId, item.file, {
        checksum,
        signal: controller.signal,
        onSession: (sessionId) => update(item.id, { sessionId }),
        onProgress: (progress) => update(item.id, { progress }),
      });
      update(item.id, {
        status: "uploaded", progress: 100, sessionId: result.sessionId,
        reference: result.reference, error: null,
      });
    } catch {
      if (!controller.signal.aborted) {
        update(item.id, { status: "error", error: "파일을 업로드하지 못했습니다." });
      }
    } finally {
      controllers.current.delete(item.id);
    }
  }

  async function addFiles(files: File[]) {
    setNotice(null);
    const staged = files.map((file): UploadItem => ({
      id: crypto.randomUUID(), file, checksum: null, sessionId: null,
      status: "hashing", progress: 0, error: null, reference: null,
    }));
    commit([...itemsRef.current, ...staged]);
    const known = new Set(itemsRef.current
      .filter((item) => !staged.some((candidate) => candidate.id === item.id))
      .map((item) => item.checksum)
      .filter((value): value is string => Boolean(value)));
    for (const item of staged) {
      try {
        const checksum = await gateway.hashReferenceFile(
          item.file,
          undefined,
          (progress) => update(item.id, { progress }),
        );
        if (known.has(checksum)) {
          setNotice("내용이 같은 파일은 한 번만 추가할 수 있습니다.");
          commit(itemsRef.current.filter((candidate) => candidate.id !== item.id));
          continue;
        }
        known.add(checksum);
        update(item.id, { checksum, status: "ready", progress: 100 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        update(item.id, {
          status: "error",
          error: message === "reference_upload_mime_invalid"
            ? "지원하지 않는 파일 형식입니다."
            : message === "reference_upload_size_invalid"
              ? "파일 크기 제한을 초과했습니다."
              : "파일 내용을 확인하지 못했습니다.",
        });
      }
    }
  }

  async function remove(item: UploadItem) {
    if (!(await cancel(item))) return;
    commit(itemsRef.current.filter((candidate) => candidate.id !== item.id));
  }

  async function retry(item: UploadItem) {
    if (!(await cancel(item))) return;
    update(item.id, { sessionId: null, reference: null, error: null });
    if (item.checksum) await upload({ ...item, sessionId: null }, item.checksum);
    else await addFiles([item.file]);
  }

  async function confirm() {
    const ready = itemsRef.current.filter(
      (item) => item.status === "ready" && item.checksum,
    );
    await Promise.all(ready.map((item) => upload(item, item.checksum!)));
  }

  return (
    <div className="reference-file-uploader">
      <label className="button">
        파일 선택
        <input
          className="sr-only"
          aria-label="레퍼런스 파일 선택"
          type="file"
          accept={accept}
          multiple
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void addFiles(files);
          }}
        />
      </label>
      <p className="field-help">PNG, JPEG, WebP, PDF, TXT, Markdown, CSV, XLSX, DOCX만 지원합니다.</p>
      <button
        className="button primary"
        type="button"
        disabled={!items.some((item) => item.status === "ready")}
        onClick={() => void confirm()}
      >
        업로드 확인
      </button>
      {notice ? <p className="field-error" role="alert">{notice}</p> : null}
      {items.length ? <ul className="reference-upload-list">{items.map((item) => {
        const metadata = item.reference?.metadata ?? {};
        const mimeType = typeof metadata.mimeType === "string" ? metadata.mimeType : item.file.type;
        const sizeBytes = typeof metadata.sizeBytes === "number" ? metadata.sizeBytes : item.file.size;
        return <li key={item.id}>
          {item.reference?.previewUrl
            ? <img src={item.reference.previewUrl} alt={`${item.file.name} 미리보기`} />
            : <span className="reference-upload-file" aria-label={`${item.file.name} 파일`}>{item.file.name}</span>}
          <span>{mimeType} · {sizeBytes} B</span>
          {item.status === "hashing" ? <UploadProgress value={item.progress} label={`${item.file.name} 내용 확인`} /> : null}
          {item.status === "ready" ? <span>업로드 준비 완료</span> : null}
          {item.status === "uploading" ? <UploadProgress value={item.progress} label={`${item.file.name} 업로드`} /> : null}
          {item.status === "uploaded" ? <span>업로드 완료</span> : null}
          {item.status === "canceling" ? <span>업로드 정리 중…</span> : null}
          {item.status === "error" ? <span role="alert">{item.error}
            <button className="button" type="button" onClick={() => void retry(item)}>다시 시도</button>
          </span> : null}
          <button className="button" type="button" aria-label={`${item.file.name} 제거`} onClick={() => void remove(item)}>제거</button>
        </li>;
      })}</ul> : null}
    </div>
  );
}
