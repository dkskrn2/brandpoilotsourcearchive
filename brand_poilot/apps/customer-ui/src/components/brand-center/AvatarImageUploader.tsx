import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { LibraryGateway } from "../../features/libraries/libraryGateway";
import { FileUploadButton } from "../ui/FileUploadButton";
import { UploadProgress } from "../ui/UploadProgress";

const allowedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const maximumBytes = 5 * 1024 * 1024;

export interface StagedAvatarImage {
  id: string;
  file: File;
  status: "hashing" | "uploading" | "uploaded" | "canceling" | "error";
  progress: number;
  checksum: string | null;
  sessionId: string | null;
  error: string | null;
}
export interface AvatarImageUploaderHandle {
  cancelAll(): Promise<boolean>;
  markCommitted(): void;
}
interface Props {
  brandId: string;
  avatarId: string;
  gateway: LibraryGateway;
  onChange(images: StagedAvatarImage[], representativeId: string | null): void;
}

export const AvatarImageUploader = forwardRef<AvatarImageUploaderHandle, Props>(
function AvatarImageUploader({ brandId, avatarId, gateway, onChange }, ref) {
  const [items, setItems] = useState<StagedAvatarImage[]>([]);
  const [representativeId, setRepresentativeId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  const representativeRef = useRef(representativeId);
  const controllers = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  const committed = useRef(false);

  useEffect(() => () => {
    mounted.current = false;
    for (const controller of controllers.current.values()) controller.abort();
  }, []);

  function commit(next: StagedAvatarImage[], nextRepresentative = representativeRef.current) {
    if (!mounted.current) return;
    itemsRef.current = next;
    representativeRef.current = nextRepresentative;
    setItems(next);
    setRepresentativeId(nextRepresentative);
    onChange(next, nextRepresentative);
  }
  function updateItem(id: string, update: Partial<StagedAvatarImage>) {
    if (!mounted.current || !itemsRef.current.some((item) => item.id === id)) return;
    commit(itemsRef.current.map((item) => item.id === id ? { ...item, ...update } : item));
  }

  async function upload(item: StagedAvatarImage, checksum = item.checksum) {
    if (!checksum) return;
    const controller = new AbortController();
    controllers.current.set(item.id, controller);
    updateItem(item.id, { status: "uploading", progress: 0, error: null, checksum });
    try {
      const staged = await gateway.uploadAvatarImage(brandId, avatarId, item.file, {
        checksum, signal: controller.signal,
        onProgress: (progress) => updateItem(item.id, { progress }),
        onSession: (sessionId) => updateItem(item.id, { sessionId }),
      });
      updateItem(item.id, { status: "uploaded", progress: 100, sessionId: staged.sessionId, error: null });
    } catch {
      if (!controller.signal.aborted) updateItem(item.id, { status: "error", error: "업로드하지 못했습니다." });
    } finally {
      controllers.current.delete(item.id);
    }
  }

  async function hashAndUpload(accepted: StagedAvatarImage[]) {
    const hashed = await Promise.all(accepted.map(async (item) => {
      const controller = new AbortController();
      controllers.current.set(item.id, controller);
      try {
        const checksum = await gateway.hashAvatarImage(item.file, controller.signal,
          (progress) => updateItem(item.id, { progress }));
        return { item, checksum };
      } catch {
        if (!controller.signal.aborted) updateItem(item.id, { status: "error", error: "이미지 내용을 확인하지 못했습니다." });
        return null;
      } finally {
        controllers.current.delete(item.id);
      }
    }));
    if (!mounted.current) return;
    const batchIds = new Set(accepted.map((item) => item.id));
    const known = new Set(itemsRef.current.filter((item) => !batchIds.has(item.id))
      .map((item) => item.checksum).filter((value): value is string => Boolean(value)));
    const uploadable: Array<{ item: StagedAvatarImage; checksum: string }> = [];
    let duplicate = false;
    for (const result of hashed) {
      if (!result) continue;
      if (known.has(result.checksum)) {
        duplicate = true;
        const next = itemsRef.current.filter((item) => item.id !== result.item.id);
        commit(next, representativeRef.current === result.item.id ? next[0]?.id ?? null : representativeRef.current);
      } else {
        known.add(result.checksum);
        updateItem(result.item.id, { checksum: result.checksum });
        uploadable.push(result);
      }
    }
    if (duplicate) setValidationError("이미 추가한 이미지와 내용이 같습니다.");
    await Promise.all(uploadable.map(({ item, checksum }) => upload(item, checksum)));
  }

  function addFiles(files: File[]) {
    setValidationError(null);
    if (itemsRef.current.length + files.length > 5) {
      setValidationError("아바타 이미지는 최대 5장까지 추가할 수 있습니다.");
      return;
    }
    const accepted: StagedAvatarImage[] = [];
    for (const file of files) {
      if (!allowedMimeTypes.has(file.type.toLowerCase())) {
        setValidationError("PNG, JPEG, WebP 이미지만 추가할 수 있습니다.");
      } else if (file.size > maximumBytes) {
        setValidationError("이미지는 한 장당 5MB 이하여야 합니다.");
      } else {
        accepted.push({ id: crypto.randomUUID(), file, status: "hashing", progress: 0,
          checksum: null, sessionId: null, error: null });
      }
    }
    if (!accepted.length) return;
    const nextRepresentative = representativeRef.current ?? accepted[0].id;
    commit([...itemsRef.current, ...accepted], nextRepresentative);
    void hashAndUpload(accepted);
  }

  async function remove(id: string): Promise<boolean> {
    const item = itemsRef.current.find((candidate) => candidate.id === id);
    if (!item) return true;
    controllers.current.get(id)?.abort();
    if (item.sessionId && !committed.current) {
      updateItem(id, { status: "canceling", error: null });
      try {
        await gateway.cancelAvatarUpload(brandId, avatarId, item.sessionId);
      } catch {
        updateItem(id, { status: "error", error: "업로드 정리를 완료하지 못했습니다. 다시 시도해 주세요." });
        return false;
      }
    }
    const next = itemsRef.current.filter((candidate) => candidate.id !== id);
    commit(next, representativeRef.current === id ? next[0]?.id ?? null : representativeRef.current);
    return true;
  }
  async function retry(item: StagedAvatarImage) {
    if (item.sessionId) {
      updateItem(item.id, { status: "canceling", error: null });
      try {
        await gateway.cancelAvatarUpload(brandId, avatarId, item.sessionId);
        updateItem(item.id, { sessionId: null });
      } catch {
        updateItem(item.id, { status: "error", error: "이전 업로드를 정리하지 못했습니다. 다시 시도해 주세요." });
        return;
      }
    }
    if (item.checksum) {
      await upload({ ...item, sessionId: null });
    } else {
      await hashAndUpload([{ ...item, sessionId: null, status: "hashing" }]);
    }
  }
  async function cancelAll() {
    const outcomes = await Promise.all([...itemsRef.current].map((item) => remove(item.id)));
    return outcomes.every(Boolean);
  }
  useImperativeHandle(ref, () => ({
    cancelAll,
    markCommitted() { committed.current = true; },
  }));

  return <div className="avatar-image-uploader">
    <FileUploadButton inputLabel="아바타 이미지 선택" buttonLabel="이미지 추가"
      accept="image/png,image/jpeg,image/webp" multiple disabled={items.length >= 5}
      items={items.map((item) => ({ id: item.id, name: item.file.name, size: item.file.size,
        status: item.status === "uploaded" ? "uploaded" : "selected" }))}
      onFiles={addFiles} onRemove={(id) => void remove(id)} />
    <p className="field-help">PNG, JPEG, WebP · 장당 5MB 이하 · 최대 5장</p>
    {validationError ? <p className="field-error" role="alert">{validationError}</p> : null}
    {items.length ? <ul className="avatar-upload-status">{items.map((item) => <li key={item.id}>
      <label><input type="radio" name="representative-avatar-image" checked={representativeId === item.id}
        onChange={() => commit(itemsRef.current, item.id)} aria-label={`${item.file.name} 대표 이미지로 설정`} />대표 이미지</label>
      {item.status === "hashing" ? <UploadProgress value={item.progress} label={`${item.file.name} 내용 확인`} /> : null}
      {item.status === "uploading" ? <UploadProgress value={item.progress} label={`${item.file.name} 업로드`} /> : null}
      {item.status === "canceling" ? <span>업로드 정리 중…</span> : null}
      {item.status === "uploaded" ? <span className="avatar-upload-success">업로드 완료</span> : null}
      {item.status === "error" ? <span className="avatar-upload-error">{item.error}
        <button className="button" type="button" aria-label={`${item.file.name} 다시 업로드`}
          onClick={() => void retry(item)}>다시 시도</button></span> : null}
    </li>)}</ul> : null}
  </div>;
});
