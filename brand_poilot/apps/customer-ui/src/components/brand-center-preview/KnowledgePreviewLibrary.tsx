import { useEffect, useId, useRef, useState } from "react";
import type {
  KnowledgeKind,
  PreviewKnowledgeItem,
} from "../../features/brand-center-preview/types";

const kinds: Array<{
  id: "all" | KnowledgeKind;
  label: string;
}> = [
  { id: "all", label: "전체" },
  { id: "faq", label: "FAQ" },
  { id: "how_to", label: "사용법" },
  { id: "guide", label: "가이드" },
  { id: "product_service", label: "제품·서비스" },
];

interface KnowledgePreviewLibraryProps {
  items: PreviewKnowledgeItem[];
  activeKind: "all" | KnowledgeKind;
  editingItem: PreviewKnowledgeItem | null;
  onKindChange(kind: "all" | KnowledgeKind): void;
  onEditingOpened(id: string): void;
  onEditingClosed(): void;
  onCreate(item: PreviewKnowledgeItem): void;
  onUpdate(item: PreviewKnowledgeItem): void;
  onDelete(id: string): void;
  onApproveAll(): void;
}

interface FormValues {
  kind: KnowledgeKind;
  title: string;
  content: string;
}

let fallbackKnowledgeId = 0;

function createKnowledgeId(items: PreviewKnowledgeItem[]): string {
  const existingIds = new Set(items.map((item) => item.id));
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) {
    const candidate = `knowledge-user-${randomId}`;
    if (!existingIds.has(candidate)) return candidate;
  }

  let candidate: string;
  do {
    fallbackKnowledgeId += 1;
    candidate = `knowledge-user-fallback-${fallbackKnowledgeId}`;
  } while (existingIds.has(candidate));
  return candidate;
}

function KnowledgeDialog({
  item,
  onClose,
  onSave,
}: {
  item: PreviewKnowledgeItem | null;
  onClose(): void;
  onSave(values: FormValues): void;
}) {
  const [values, setValues] = useState<FormValues>({
    kind: item?.kind ?? "faq",
    title: item?.title ?? "",
    content: item?.content ?? "",
  });
  const [errors, setErrors] = useState({ title: "", content: "" });
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValues({
      kind: item?.kind ?? "faq",
      title: item?.title ?? "",
      content: item?.content ?? "",
    });
    setErrors({ title: "", content: "" });
    titleRef.current?.focus();
  }, [item?.id]);

  function closeFromKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled)",
      ) ?? [],
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors = {
      title: values.title.trim() ? "" : "제목을 입력해 주세요.",
      content: values.content.trim() ? "" : "내용을 입력해 주세요.",
    };
    setErrors(nextErrors);
    if (nextErrors.title) {
      titleRef.current?.focus();
      return;
    }
    if (nextErrors.content) {
      dialogRef.current?.querySelector<HTMLTextAreaElement>("#knowledge-content")?.focus();
      return;
    }
    onSave({
      ...values,
      title: values.title.trim(),
      content: values.content.trim(),
    });
  }

  return (
    <div className="brand-center-preview__dialog-backdrop">
      <div
        ref={dialogRef}
        className="brand-center-preview__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="knowledge-dialog-title"
        onKeyDown={closeFromKeyboard}
      >
        <div className="brand-center-preview__dialog-heading">
          <h3 id="knowledge-dialog-title">{item ? "지식 항목 편집" : "지식 항목 추가"}</h3>
          <button type="button" aria-label="닫기" onClick={onClose}>×</button>
        </div>
        <form onSubmit={submit} noValidate>
          <label>
            <span>유형</span>
            <select
              value={values.kind}
              onChange={(event) => setValues((current) => ({
                ...current,
                kind: event.target.value as KnowledgeKind,
              }))}
            >
              {kinds.slice(1).map((kind) => (
                <option key={kind.id} value={kind.id}>{kind.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>제목</span>
            <input
              ref={titleRef}
              value={values.title}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? "knowledge-title-error" : undefined}
              onChange={(event) => {
                setErrors((current) => ({ ...current, title: "" }));
                setValues((current) => ({ ...current, title: event.target.value }));
              }}
            />
            {errors.title ? <small id="knowledge-title-error" className="brand-center-preview__field-error">{errors.title}</small> : null}
          </label>
          <label>
            <span>내용</span>
            <textarea
              id="knowledge-content"
              rows={6}
              value={values.content}
              aria-invalid={Boolean(errors.content)}
              aria-describedby={errors.content ? "knowledge-content-error" : undefined}
              onChange={(event) => {
                setErrors((current) => ({ ...current, content: "" }));
                setValues((current) => ({ ...current, content: event.target.value }));
              }}
            />
            {errors.content ? <small id="knowledge-content-error" className="brand-center-preview__field-error">{errors.content}</small> : null}
          </label>
          <div className="brand-center-preview__dialog-actions">
            <button type="button" onClick={onClose}>취소</button>
            <button className="brand-center-preview__primary-action" type="submit">저장</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function KnowledgePreviewLibrary({
  items,
  activeKind,
  editingItem,
  onKindChange,
  onEditingOpened,
  onEditingClosed,
  onCreate,
  onUpdate,
  onDelete,
  onApproveAll,
}: KnowledgePreviewLibraryProps) {
  const uid = useId();
  const [adding, setAdding] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const pendingDeleteFocus = useRef<string | "add" | null>(null);
  const pendingSaveFocus = useRef<string | "add" | null>(null);
  const visibleItems = items.filter((item) => item.kind !== "policy");
  const filteredItems = activeKind === "all"
    ? visibleItems
    : visibleItems.filter((item) => item.kind === activeKind);
  const dialogOpen = adding || Boolean(editingItem);

  useEffect(() => {
    const target = pendingDeleteFocus.current;
    if (!target) return;
    pendingDeleteFocus.current = null;
    if (target === "add") {
      addButtonRef.current?.focus();
    } else {
      rowRefs.current.get(target)?.focus();
    }
  }, [items]);

  useEffect(() => {
    const target = pendingSaveFocus.current;
    if (!target || dialogOpen) return;
    pendingSaveFocus.current = null;
    const row = target === "add" ? null : rowRefs.current.get(target);
    if (row?.isConnected) {
      row.focus();
    } else {
      addButtonRef.current?.focus();
    }
  }, [dialogOpen, items, activeKind]);

  function closeDialog(restoreTrigger = true) {
    setAdding(false);
    onEditingClosed();
    if (restoreTrigger) {
      triggerRef.current?.focus();
    }
  }

  function save(values: FormValues) {
    if (editingItem) {
      pendingSaveFocus.current = editingItem.id;
      onUpdate({ ...editingItem, ...values });
    } else {
      pendingSaveFocus.current = "add";
      onCreate({
        id: createKnowledgeId(items),
        ...values,
        origin: "user",
        reviewStatus: "confirmed",
      });
    }
    closeDialog(false);
  }

  return (
    <section className="brand-center-preview__review-section" aria-labelledby="knowledge-preview-title">
      <div className="brand-center-preview__section-heading">
        <div>
          <p className="brand-center-preview__eyebrow">KNOWLEDGE</p>
          <h3 id="knowledge-preview-title">브랜드 지식</h3>
        </div>
        <div className="brand-center-preview__section-actions">
          <button
            ref={addButtonRef}
            type="button"
            onClick={(event) => {
              triggerRef.current = event.currentTarget;
              setAdding(true);
            }}
          >
            항목 추가
          </button>
          <button type="button" onClick={onApproveAll}>브랜드 지식 승인</button>
        </div>
      </div>

      <div className="brand-center-preview__tabs" role="tablist" aria-label="지식 유형">
        {kinds.map((kind, index) => (
          <button
            key={kind.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            id={`${uid}-${kind.id}-tab`}
            type="button"
            role="tab"
            aria-selected={activeKind === kind.id}
            aria-controls={`${uid}-${kind.id}-panel`}
            tabIndex={activeKind === kind.id ? 0 : -1}
            onClick={() => onKindChange(kind.id)}
            onKeyDown={(event) => {
              let nextIndex: number | null = null;
              if (event.key === "ArrowRight") {
                nextIndex = (index + 1) % kinds.length;
              } else if (event.key === "ArrowLeft") {
                nextIndex = (index - 1 + kinds.length) % kinds.length;
              } else if (event.key === "Home") {
                nextIndex = 0;
              } else if (event.key === "End") {
                nextIndex = kinds.length - 1;
              }
              if (nextIndex === null) return;
              event.preventDefault();
              onKindChange(kinds[nextIndex].id);
              tabRefs.current[nextIndex]?.focus();
            }}
          >
            {kind.label}
          </button>
        ))}
      </div>
      {kinds.map((panelKind) => (
        <div
          key={panelKind.id}
          id={`${uid}-${panelKind.id}-panel`}
          role="tabpanel"
          aria-labelledby={`${uid}-${panelKind.id}-tab`}
          tabIndex={activeKind === panelKind.id ? 0 : -1}
          hidden={activeKind !== panelKind.id}
          className="brand-center-preview__library"
        >
          {activeKind === panelKind.id ? filteredItems.map((item, index) => {
          const kind = kinds.find((option) => option.id === item.kind)!;
          const status = item.reviewStatus === "approved"
              ? "승인됨"
              : item.reviewStatus === "confirmed"
                ? "확정됨"
                : null;
          return (
            <article
              key={item.id}
              ref={(node) => {
                if (node) rowRefs.current.set(item.id, node);
                else rowRefs.current.delete(item.id);
              }}
              aria-label={item.title}
              tabIndex={-1}
            >
              <header>
                <div>
                  <span>{kind.label}</span>
                  {status ? <strong>{status}</strong> : null}
                </div>
                <div className="brand-center-preview__item-actions">
                  <button
                    type="button"
                    aria-label={`${item.title} 편집`}
                    onClick={(event) => {
                      triggerRef.current = event.currentTarget;
                      onEditingOpened(item.id);
                    }}
                  >
                    편집
                  </button>
                  <button
                    type="button"
                    aria-label={`${item.title} 삭제`}
                    onClick={() => {
                      if (!window.confirm("이 지식 항목을 삭제할까요?")) return;
                      pendingDeleteFocus.current = filteredItems[index + 1]?.id
                        ?? filteredItems[index - 1]?.id
                        ?? "add";
                      onDelete(item.id);
                    }}
                  >
                    삭제
                  </button>
                </div>
              </header>
              <h4>{item.title}</h4>
              <p>{item.content}</p>
            </article>
          );
          }) : null}
        </div>
      ))}
      {dialogOpen ? (
        <KnowledgeDialog item={editingItem} onClose={closeDialog} onSave={save} />
      ) : null}
    </section>
  );
}
