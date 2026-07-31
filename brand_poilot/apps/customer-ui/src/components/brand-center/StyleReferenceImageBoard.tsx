import { useEffect, useMemo, useRef, useState } from "react";
import type { BrandRules } from "../../features/brand-center/types";
import type { LibraryGateway } from "../../features/libraries/libraryGateway";
import type { ReferenceItem } from "../../types";
import { Alert } from "../ui/Alert";

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type StyleReference = BrandRules["designRules"]["referenceImages"][number];

interface PreviewImage {
  id: string;
  title: string;
  previewUrl: string | null;
}

interface PendingUpload {
  localId: string;
  fileName: string;
  previewUrl: string | null;
  progress: number;
}

interface UploadAttempt {
  localId: string;
  previewUrl: string | null;
  sessionId: string | null;
  generation: number;
}

export function validateStyleReferenceFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type.toLowerCase())) {
    return "PNG, JPEG, WebP 이미지만 등록할 수 있습니다.";
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return "이미지는 한 장당 5MB 이하여야 합니다.";
  }
  return null;
}

function sameReferences(left: StyleReference[], right: StyleReference[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function previewFromReference(reference: ReferenceItem): PreviewImage {
  return {
    id: reference.id,
    title: reference.title,
    previewUrl: reference.previewUrl ?? reference.sourceUrl,
  };
}

export function StyleReferenceImageBoard({
  brandId,
  gateway,
  rules,
  onSave,
  onDirtyChange,
}: {
  brandId: string;
  gateway: LibraryGateway;
  rules: BrandRules;
  onSave(rules: BrandRules): Promise<void>;
  onDirtyChange?(dirty: boolean): void;
}) {
  const persisted = rules.designRules.referenceImages;
  const [draft, setDraft] = useState<StyleReference[]>(persisted);
  const [previews, setPreviews] = useState<Record<string, PreviewImage>>({});
  const [tagInputs, setTagInputs] = useState<Record<string, string>>(
    Object.fromEntries(persisted.map((item) => [item.referenceItemId, item.tags.join(", ")])),
  );
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const uploadAttempts = useRef(new Map<AbortController, UploadAttempt>());
  const cancelledSessions = useRef(new Set<string>());
  const editGeneration = useRef(0);
  const dirty = editing && (
    pendingUploads.length > 0
    || !sameReferences(draft, persisted)
  );

  const visibleReferences = useMemo(
    () => draft.map((item) => ({ ...item, preview: previews[item.referenceItemId] })),
    [draft, previews],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const [controller, attempt] of uploadAttempts.current) {
        controller.abort();
        if (attempt.previewUrl) URL.revokeObjectURL(attempt.previewUrl);
        if (attempt.sessionId && !cancelledSessions.current.has(attempt.sessionId)) {
          cancelledSessions.current.add(attempt.sessionId);
          void gateway.cancelReferenceUpload(brandId, attempt.sessionId).catch(() => undefined);
        }
      }
      uploadAttempts.current.clear();
    };
  }, [brandId, gateway]);

  useEffect(() => {
    if (!editing) {
      setDraft(persisted);
      setTagInputs(Object.fromEntries(
        persisted.map((item) => [item.referenceItemId, item.tags.join(", ")]),
      ));
    }
  }, [editing, persisted]);

  useEffect(() => {
    let cancelled = false;
    const missing = draft
      .map((item) => item.referenceItemId)
      .filter((id) => !previews[id]);
    if (!missing.length) return () => {
      cancelled = true;
    };
    void Promise.all(missing.map(async (id) => {
      try {
        const detail = await gateway.getReference(brandId, id);
        return previewFromReference(detail);
      } catch {
        return { id, title: "참고 이미지", previewUrl: null };
      }
    })).then((loaded) => {
      if (cancelled || !mounted.current) return;
      setPreviews((current) => Object.fromEntries([
        ...Object.entries(current),
        ...loaded.map((item) => [item.id, item] as const),
      ]));
    });
    return () => {
      cancelled = true;
    };
  }, [brandId, draft, gateway, previews]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  async function uploadFiles(files: File[]) {
    setError(null);
    if (uploadAttempts.current.size > 0 || uploading) {
      setError("진행 중인 이미지 등록이 끝난 뒤 다시 시도해 주세요.");
      return;
    }
    const remaining = MAX_IMAGES - draft.length;
    if (files.length > remaining) {
      setError(`참고 이미지는 최대 ${MAX_IMAGES}장까지 등록할 수 있습니다.`);
      return;
    }
    const invalid = files.map(validateStyleReferenceFile).find(Boolean);
    if (invalid) {
      setError(invalid);
      return;
    }
    setUploading(true);
    const generation = editGeneration.current;
    for (const [index, file] of files.entries()) {
      if (!mounted.current || generation !== editGeneration.current) break;
      const controller = new AbortController();
      const localId = `style-upload-${generation}-${Date.now()}-${index}`;
      const previewUrl = typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : null;
      const attempt: UploadAttempt = {
        localId,
        previewUrl,
        sessionId: null,
        generation,
      };
      uploadAttempts.current.set(controller, attempt);
      setPendingUploads((current) => [...current, {
        localId,
        fileName: file.name,
        previewUrl,
        progress: 0,
      }]);
      try {
        const result = await gateway.uploadReferenceFile(brandId, file, {
          signal: controller.signal,
          onSession: (value) => {
            attempt.sessionId = value;
          },
          onProgress: (value) => {
            if (mounted.current && generation === editGeneration.current) {
              setProgress(value);
              setPendingUploads((current) => current.map((item) => (
                item.localId === localId ? { ...item, progress: value } : item
              )));
            }
          },
        });
        if (
          !mounted.current
          || generation !== editGeneration.current
          || controller.signal.aborted
        ) continue;
        const next = {
          referenceItemId: result.reference.id,
          description: "",
          tags: [],
        };
        setDraft((current) => [...current, next]);
        setTagInputs((current) => ({ ...current, [result.reference.id]: "" }));
        setPreviews((current) => ({
          ...current,
          [result.reference.id]: previewFromReference(result.reference),
        }));
      } catch (uploadError) {
        if (attempt.sessionId && !cancelledSessions.current.has(attempt.sessionId)) {
          cancelledSessions.current.add(attempt.sessionId);
          await gateway.cancelReferenceUpload(brandId, attempt.sessionId).catch(() => undefined);
        }
        if (
          mounted.current
          && generation === editGeneration.current
          && !(uploadError instanceof DOMException && uploadError.name === "AbortError")
        ) {
          setError("이미지를 업로드하지 못했습니다.");
        }
      } finally {
        uploadAttempts.current.delete(controller);
        if (attempt.previewUrl) {
          URL.revokeObjectURL(attempt.previewUrl);
          attempt.previewUrl = null;
        }
        if (mounted.current) {
          setPendingUploads((current) => current.filter((item) => item.localId !== localId));
        }
      }
    }
    if (mounted.current && generation === editGeneration.current) {
      setUploading(false);
      setProgress(null);
    }
  }

  function updateReference(id: string, patch: Partial<StyleReference>) {
    setDraft((current) => current.map((item) => (
      item.referenceItemId === id ? { ...item, ...patch } : item
    )));
  }

  async function save() {
    if (draft.some((item) => item.tags.some((tag) => tag.length > 40))) {
      setError("태그는 각각 40자 이하여야 합니다.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        ...rules,
        designRules: {
          ...rules.designRules,
          referenceImages: draft,
        },
      });
      if (!mounted.current) return;
      setEditing(false);
      setNotice("디자인 스타일을 저장했습니다.");
    } catch {
      if (mounted.current) setError("디자인 스타일을 저장하지 못했습니다.");
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  function cancel() {
    editGeneration.current += 1;
    const sessions: string[] = [];
    for (const [controller, attempt] of uploadAttempts.current) {
      controller.abort();
      if (attempt.previewUrl) {
        URL.revokeObjectURL(attempt.previewUrl);
        attempt.previewUrl = null;
      }
      if (attempt.sessionId && !cancelledSessions.current.has(attempt.sessionId)) {
        cancelledSessions.current.add(attempt.sessionId);
        sessions.push(attempt.sessionId);
      }
    }
    uploadAttempts.current.clear();
    setPendingUploads([]);
    setUploading(false);
    setProgress(null);
    void Promise.all(sessions.map((sessionId) => (
      gateway.cancelReferenceUpload(brandId, sessionId).catch(() => undefined)
    )));
    setDraft(persisted);
    setTagInputs(Object.fromEntries(
      persisted.map((item) => [item.referenceItemId, item.tags.join(", ")]),
    ));
    setEditing(false);
    setError(null);
  }

  return (
    <section className="panel style-reference-board">
      <header className="panel-head style-reference-header">
        <div>
          <p className="brand-center-eyebrow">DESIGN REFERENCES</p>
          <h2>디자인 스타일</h2>
          <p>콘텐츠 디자인이 따라야 할 이미지 분위기와 표현 기준을 등록합니다.</p>
        </div>
        {!editing ? (
          <button className="button primary" type="button" onClick={() => {
            editGeneration.current += 1;
            setEditing(true);
            setNotice(null);
          }}>
            스타일 이미지 수정
          </button>
        ) : null}
      </header>
      <div className="panel-body style-reference-body">
        {notice ? <Alert title="저장 완료" variant="ok">{notice}</Alert> : null}
        {error ? (
          <div role="alert">
            <Alert title="등록 오류" variant="bad">{error}</Alert>
          </div>
        ) : null}
        {visibleReferences.length || pendingUploads.length ? (
          <div className="style-reference-grid">
            {visibleReferences.map((item) => (
              <article className="style-reference-card" key={item.referenceItemId}>
                {item.preview?.previewUrl ? (
                  <img
                    src={item.preview.previewUrl}
                    alt={item.description || item.preview.title}
                  />
                ) : (
                  <div className="style-reference-placeholder">미리보기 없음</div>
                )}
                <div className="style-reference-card-body">
                  {editing ? (
                    <>
                      <label>
                        이미지 설명
                        <input
                          aria-label="이미지 설명"
                          maxLength={240}
                          value={item.description}
                          onChange={(event) => updateReference(item.referenceItemId, {
                            description: event.currentTarget.value,
                          })}
                        />
                      </label>
                      <label>
                        이미지 태그
                        <input
                          aria-label="이미지 태그"
                          placeholder="쉼표로 구분"
                          value={tagInputs[item.referenceItemId] ?? item.tags.join(", ")}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setTagInputs((current) => ({
                              ...current,
                              [item.referenceItemId]: value,
                            }));
                            updateReference(item.referenceItemId, {
                              tags: value
                                .split(",")
                                .map((tag) => tag.trim())
                                .filter(Boolean)
                                .slice(0, 10),
                            });
                          }}
                        />
                      </label>
                      <button
                        className="button"
                        type="button"
                        onClick={() => setDraft((current) => current.filter(
                          (candidate) => candidate.referenceItemId !== item.referenceItemId,
                        ))}
                      >
                        보드에서 제외
                      </button>
                    </>
                  ) : (
                    <>
                      <strong>{item.description || item.preview?.title || "참고 이미지"}</strong>
                      {item.tags.length ? (
                        <div className="style-reference-tags">
                          {item.tags.map((tag) => <span key={tag}>{tag}</span>)}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </article>
            ))}
            {pendingUploads.map((item) => (
              <article className="style-reference-card is-uploading" key={item.localId}>
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt={item.fileName} />
                ) : (
                  <div className="style-reference-placeholder">미리보기 준비 중</div>
                )}
                <div className="style-reference-card-body">
                  <strong>{item.fileName}</strong>
                  <span>등록 중 · {item.progress}%</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="brand-center-empty">
            <strong>등록된 디자인 스타일 이미지가 없습니다.</strong>
            <p>브랜드의 색감, 구도, 분위기를 잘 보여주는 이미지를 등록해 주세요.</p>
          </div>
        )}
        {editing ? (
          <>
            <label
              className={`style-reference-dropzone${dragging ? " is-dragging" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                event.preventDefault();
                if (event.currentTarget === event.target) setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!uploading) void uploadFiles(Array.from(event.dataTransfer.files));
              }}
            >
              <strong>참고 이미지 드래그 앤 드롭</strong>
              <span>PNG, JPEG, WebP · 장당 5MB · 최대 5장</span>
              <input
                aria-label="스타일 참고 이미지 선택"
                accept=".png,.jpg,.jpeg,.webp"
                disabled={uploading || draft.length >= MAX_IMAGES}
                multiple
                type="file"
                onChange={(event) => {
                  void uploadFiles(Array.from(event.currentTarget.files ?? []));
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {uploading ? (
              <p className="style-reference-progress" role="status">
                이미지를 등록하는 중입니다{progress === null ? "" : ` · ${progress}%`}
              </p>
            ) : null}
            <div className="form-actions">
              <button
                className="button primary"
                type="button"
                disabled={saving || uploading || !dirty}
                onClick={() => void save()}
              >
                {saving ? "저장 중..." : "변경사항 저장"}
              </button>
              <button className="button" type="button" disabled={saving} onClick={cancel}>
                변경 취소
              </button>
              {dirty ? <span className="brand-center-dirty">저장하지 않은 변경</span> : null}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
