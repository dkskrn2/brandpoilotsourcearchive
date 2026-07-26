import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type {
  Avatar,
  LibraryGateway,
} from "../../features/libraries/libraryGateway";
import { FocusTrap } from "../ui/FocusTrap";
import {
  AvatarImageUploader,
  type AvatarImageUploaderHandle,
  type StagedAvatarImage,
} from "./AvatarImageUploader";

interface Props {
  brandId: string;
  gateway: LibraryGateway;
  returnFocus: HTMLElement | null;
  onClose(): void;
  onSaved(avatar: Avatar): void;
}

export function AvatarEditorDialog({ brandId, gateway, returnFocus, onClose, onSaved }: Props) {
  const [avatarId] = useState(() => crypto.randomUUID());
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<StagedAvatarImage[]>([]);
  const [representativeId, setRepresentativeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploaderRef = useRef<AvatarImageUploaderHandle>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocus?.focus();
    };
  }, [returnFocus]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const uploaded = images.filter((image) => image.status === "uploaded" && image.sessionId);
    const representative = uploaded.find((image) => image.id === representativeId);
    if (!name.trim()) {
      setError("이름을 입력해 주세요.");
      return;
    }
    if (uploaded.length < 1 || uploaded.length !== images.length || !representative?.sessionId) {
      setError("이미지 업로드를 모두 완료하고 대표 이미지를 선택해 주세요.");
      return;
    }
    setSaving(true);
    try {
      const saved = await gateway.createAvatar(brandId, {
        avatarId,
        name: name.trim(),
        description: description.trim(),
        imageSessionIds: uploaded.map((image) => image.sessionId!),
        representativeSessionId: representative.sessionId,
      });
      uploaderRef.current?.markCommitted();
      setSaving(false);
      onSaved(saved);
      onClose();
    } catch {
      setError("아바타를 저장하지 못했습니다. 입력과 업로드 상태를 확인해 주세요.");
      setSaving(false);
    }
  }

  async function requestClose() {
    if (saving) return;
    setSaving(true);
    setError(null);
    const cleaned = await uploaderRef.current?.cancelAll();
    setSaving(false);
    if (cleaned === false) {
      setError("업로드 정리를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    onClose();
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !saving) void requestClose();
      }}
    >
      <FocusTrap
        active
        initialFocusSelector="[name='avatar-name']"
        className="modal-panel avatar-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-editor-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !saving) {
            event.preventDefault();
            void requestClose();
          }
        }}
      >
        <form onSubmit={submit}>
          <header className="avatar-editor-header">
            <div>
              <h2 id="avatar-editor-title">아바타 등록</h2>
              <p>정적 콘텐츠에서 재사용할 이름, 설명, 이미지만 저장합니다.</p>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="아바타 등록 닫기"
              disabled={saving}
              onClick={() => void requestClose()}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="avatar-editor-body">
            <label>
              이름
              <input
                name="avatar-name"
                value={name}
                maxLength={120}
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              설명
              <textarea
                value={description}
                maxLength={2_000}
                disabled={saving}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <fieldset disabled={saving}>
              <legend>이미지</legend>
              <AvatarImageUploader
                ref={uploaderRef}
                brandId={brandId}
                avatarId={avatarId}
                gateway={gateway}
                onChange={(nextImages, nextRepresentative) => {
                  setImages(nextImages);
                  setRepresentativeId(nextRepresentative);
                }}
              />
            </fieldset>
            {error ? <p className="field-error" role="alert">{error}</p> : null}
          </div>
          <footer className="avatar-editor-footer">
            <button className="button" type="button" disabled={saving} onClick={() => void requestClose()}>취소</button>
            <button className="button primary" type="submit" disabled={saving}>
              {saving ? "저장 중…" : "아바타 저장"}
            </button>
          </footer>
        </form>
      </FocusTrap>
    </div>
  );
}
