import { useEffect, useRef, useState } from "react";
import type { LibraryGateway } from "../../features/libraries/libraryGateway";
import { FileUploadButton } from "../ui/FileUploadButton";
import { UploadProgress } from "../ui/UploadProgress";

const allowedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const maximumBytes = 5 * 1024 * 1024;

export interface StagedAvatarImage {
  id: string;
  file: File;
  status: "uploading" | "uploaded" | "error";
  progress: number;
  sessionId: string | null;
  error: string | null;
}

interface Props {
  brandId: string;
  avatarId: string;
  gateway: LibraryGateway;
  onChange(images: StagedAvatarImage[], representativeId: string | null): void;
}

function duplicateKey(file: File) {
  return `${file.name}\u0000${file.type}\u0000${file.size}\u0000${file.lastModified}`;
}

export function AvatarImageUploader({ brandId, avatarId, gateway, onChange }: Props) {
  const [items, setItems] = useState<StagedAvatarImage[]>([]);
  const [representativeId, setRepresentativeId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  const representativeRef = useRef(representativeId);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
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
    commit(itemsRef.current.map((item) => item.id === id ? { ...item, ...update } : item));
  }

  async function upload(item: StagedAvatarImage) {
    updateItem(item.id, { status: "uploading", progress: 0, error: null });
    try {
      const staged = await gateway.uploadAvatarImage(
        brandId,
        avatarId,
        item.file,
        (progress) => updateItem(item.id, { progress }),
      );
      updateItem(item.id, {
        status: "uploaded",
        progress: 100,
        sessionId: staged.sessionId,
        error: null,
      });
    } catch {
      updateItem(item.id, {
        status: "error",
        error: "업로드하지 못했습니다.",
      });
    }
  }

  function addFiles(files: File[]) {
    setValidationError(null);
    if (itemsRef.current.length + files.length > 5) {
      setValidationError("아바타 이미지는 최대 5장까지 추가할 수 있습니다.");
      return;
    }
    const known = new Set(itemsRef.current.map((item) => duplicateKey(item.file)));
    const accepted: StagedAvatarImage[] = [];
    for (const file of files) {
      if (!allowedMimeTypes.has(file.type.toLowerCase())) {
        setValidationError("PNG, JPEG, WebP 이미지만 추가할 수 있습니다.");
        continue;
      }
      if (file.size > maximumBytes) {
        setValidationError("이미지는 한 장당 5MB 이하여야 합니다.");
        continue;
      }
      const key = duplicateKey(file);
      if (known.has(key)) {
        setValidationError("이미 추가한 이미지입니다.");
        continue;
      }
      known.add(key);
      accepted.push({
        id: crypto.randomUUID(),
        file,
        status: "uploading",
        progress: 0,
        sessionId: null,
        error: null,
      });
    }
    if (accepted.length === 0) return;
    const nextRepresentative = representativeRef.current ?? accepted[0].id;
    commit([...itemsRef.current, ...accepted], nextRepresentative);
    for (const item of accepted) void upload(item);
  }

  function remove(id: string) {
    const next = itemsRef.current.filter((item) => item.id !== id);
    const nextRepresentative = representativeRef.current === id
      ? next[0]?.id ?? null
      : representativeRef.current;
    commit(next, nextRepresentative);
  }

  function selectRepresentative(id: string) {
    commit(itemsRef.current, id);
  }

  return (
    <div className="avatar-image-uploader">
      <FileUploadButton
        inputLabel="아바타 이미지 선택"
        buttonLabel="이미지 추가"
        accept="image/png,image/jpeg,image/webp"
        multiple
        disabled={items.length >= 5}
        items={items.map((item) => ({
          id: item.id,
          name: item.file.name,
          size: item.file.size,
          status: item.status === "error" ? "selected" : item.status,
        }))}
        onFiles={addFiles}
        onRemove={remove}
      />
      <p className="field-help">PNG, JPEG, WebP · 장당 5MB 이하 · 최대 5장</p>
      {validationError ? <p className="field-error" role="alert">{validationError}</p> : null}
      {items.length > 0 ? (
        <ul className="avatar-upload-status">
          {items.map((item) => (
            <li key={item.id}>
              <label>
                <input
                  type="radio"
                  name="representative-avatar-image"
                  checked={representativeId === item.id}
                  onChange={() => selectRepresentative(item.id)}
                  aria-label={`${item.file.name} 대표 이미지로 설정`}
                />
                대표 이미지
              </label>
              {item.status === "uploading" ? (
                <UploadProgress value={item.progress} label={`${item.file.name} 업로드`} />
              ) : null}
              {item.status === "uploaded" ? <span className="avatar-upload-success">업로드 완료</span> : null}
              {item.status === "error" ? (
                <span className="avatar-upload-error">
                  {item.error}
                  <button
                    className="button"
                    type="button"
                    aria-label={`${item.file.name} 다시 업로드`}
                    onClick={() => void upload(item)}
                  >
                    다시 시도
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
