import { useEffect, useRef, useState } from "react";
import { Alert } from "../ui/Alert";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/LoadingState";
import {
  classifyLibraryError,
  libraryGateway,
  type Avatar,
  type LibraryGateway,
} from "../../features/libraries/libraryGateway";
import { AvatarEditorDialog } from "./AvatarEditorDialog";
import { aiContentApiGateway } from "../../features/ai-content/aiContentApiGateway";
import type { AiContentDraftReference, AiContentGateway } from "../../features/ai-content/types";
import { AssetArchiveDialog } from "../ai-content/AssetArchiveDialog";

interface Props {
  brandId: string;
  title?: string;
  gateway?: LibraryGateway;
  draftReferences?: Pick<AiContentGateway, "listDraftReferences">;
  showDefaultControl?: boolean;
}

export function AvatarLibraryPanel({
  brandId,
  title = "모델·아바타",
  gateway = libraryGateway,
  draftReferences = aiContentApiGateway,
  showDefaultControl = true,
}: Props) {
  const [items, setItems] = useState<Avatar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ReturnType<typeof classifyLibraryError> | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<Avatar | null>(null);
  const [archiveReferences, setArchiveReferences] = useState<AiContentDraftReference[]>([]);
  const [archiveLookup, setArchiveLookup] = useState<"idle" | "loading" | "failed">("idle");
  const mounted = useRef(true);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const archiveTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    void gateway.listAvatars(brandId).then(
      (next) => {
        if (!current || !mounted.current) return;
        setItems(next);
        setLoading(false);
      },
      (cause) => {
        if (!current || !mounted.current) return;
        setItems([]);
        setError(classifyLibraryError(cause, "collection"));
        setLoading(false);
      },
    );
    return () => { current = false; };
  }, [brandId, gateway]);

  async function setDefault(item: Avatar) {
    setActionError(null);
    try {
      const saved = await gateway.setDefaultAvatar(brandId, item.id);
      if (!mounted.current) return;
      setItems((current) => current.map((candidate) => ({
        ...candidate,
        isDefault: candidate.id === saved.id,
      })));
    } catch {
      if (mounted.current) setActionError("기본 아바타를 변경하지 못했습니다.");
    }
  }

  async function checkArchive(item: Avatar, trigger?: HTMLElement) {
    if (trigger) archiveTriggerRef.current = trigger;
    setPendingArchive(item);
    setArchiveLookup("loading");
    setActionError(null);
    try {
      const references = await draftReferences.listDraftReferences(brandId, "avatar", item.id);
      if (!mounted.current) return;
      setArchiveReferences(references);
      setArchiveLookup("idle");
    } catch {
      if (mounted.current) setArchiveLookup("failed");
    }
  }

  function closeArchive() {
    setPendingArchive(null);
    setArchiveReferences([]);
    setArchiveLookup("idle");
    queueMicrotask(() => archiveTriggerRef.current?.focus());
  }

  async function confirmArchive() {
    if (!pendingArchive) return;
    setActionError(null);
    try {
      await gateway.archiveAvatar(brandId, pendingArchive.id);
      if (mounted.current) setItems((current) => current.filter((candidate) => candidate.id !== pendingArchive.id));
      closeArchive();
    } catch {
      if (mounted.current) setActionError("아바타를 보관 처리하지 못했습니다.");
    }
  }

  if (loading) return <ListSkeleton rows={4} columns={4} label="아바타 보관함을 불러오는 중입니다." />;
  if (error === "unavailable") {
    return (
      <Alert title="아바타 보관함 배포 순서 안내" variant="info">
        서버의 아바타 보관함 배포가 먼저 필요합니다. API와 저장소 배포 후 다시 확인해 주세요.
      </Alert>
    );
  }

  return (
    <section className="avatar-library panel">
      <header className="panel-header avatar-library-header">
        <div>
          <h2>{title}</h2>
          <p>정적 콘텐츠에서 재사용할 승인된 이미지 자산을 관리합니다.</p>
        </div>
        <button ref={createButtonRef} className="button primary" type="button" onClick={() => setCreating(true)}>
          아바타 등록
        </button>
      </header>
      <div className="panel-body">
        {error ? (
          <Alert title="아바타를 불러오지 못했습니다" variant="warn">
            연결 상태를 확인한 뒤 다시 시도해 주세요.
          </Alert>
        ) : null}
        {actionError ? <Alert title="작업을 완료하지 못했습니다" variant="warn">{actionError}</Alert> : null}
        {!error && items.length === 0 ? (
          <EmptyState
            title="저장된 아바타가 없습니다"
            description="이름과 설명, 1–5장의 이미지를 등록해 첫 아바타를 만드세요."
          />
        ) : null}
        <div className="avatar-card-grid">
          {items.map((item) => {
            const representative = item.images.find((image) => image.representative) ?? null;
            return (
              <article className="avatar-card" aria-label={item.name} key={item.id}>
                {representative ? (
                  <img src={representative.storageUrl} alt={`${item.name} 대표 이미지`} />
                ) : (
                  <div className="avatar-card-empty">대표 이미지 없음</div>
                )}
                <div className="avatar-card-body">
                  <div className="avatar-card-title">
                    <h3>{item.name}</h3>
                    <span>{item.status === "active" ? "활성" : "보관됨"}</span>
                  </div>
                  {item.description ? <p>{item.description}</p> : null}
                  <div className="avatar-card-badges">
                    {showDefaultControl && item.isDefault ? <strong>기본 아바타</strong> : null}
                    <span>이미지 {item.images.length}장</span>
                  </div>
                  <div className="avatar-card-actions">
                    {showDefaultControl && !item.isDefault ? (
                      <button
                        className="button"
                        type="button"
                        aria-label={`${item.name}를 기본 아바타로 설정`}
                        onClick={() => void setDefault(item)}
                      >
                        기본으로 설정
                      </button>
                    ) : null}
                    <button className="button" type="button" onClick={(event) => void checkArchive(item, event.currentTarget)}>
                      보관
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      {creating ? (
        <AvatarEditorDialog
          brandId={brandId}
          gateway={gateway}
          returnFocus={createButtonRef.current}
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
          }}
        />
      ) : null}
      {pendingArchive ? <AssetArchiveDialog
        assetName={pendingArchive.name}
        references={archiveReferences}
        loading={archiveLookup === "loading"}
        failed={archiveLookup === "failed"}
        onRetry={() => void checkArchive(pendingArchive)}
        onCancel={closeArchive}
        onConfirm={() => void confirmArchive()}
      /> : null}
    </section>
  );
}
