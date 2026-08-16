import type { PublishCalendarNewContentSetup } from "../../types";

export type PublishCalendarBulkDraftRow = {
  clientRowId: string;
  scheduledFor: string;
  contentFormat: "card_news" | "reel";
  setup: PublishCalendarNewContentSetup;
  generationId: string | null;
};

export type PublishCalendarBulkDraft = {
  id: string;
  rows: PublishCalendarBulkDraftRow[];
};

const key = (id: string) => `brand-pilot:publish-calendar-bulk:${id}`;

export function loadPublishCalendarBulkDraft(id: string | null): PublishCalendarBulkDraft | null {
  if (!id) return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(key(id)) ?? "null") as PublishCalendarBulkDraft | null;
    return value?.id === id && Array.isArray(value.rows) ? value : null;
  } catch { return null; }
}

export function savePublishCalendarBulkDraft(draft: PublishCalendarBulkDraft) {
  window.localStorage.setItem(key(draft.id), JSON.stringify(draft));
}

export function clearPublishCalendarBulkDraft(id: string) {
  window.localStorage.removeItem(key(id));
}

export function completePublishCalendarBulkDraftRow(draft: PublishCalendarBulkDraft, rowId: string, generationId: string) {
  const next = { ...draft, rows: draft.rows.map((row) => row.clientRowId === rowId ? { ...row, generationId } : row) };
  savePublishCalendarBulkDraft(next);
  return next;
}
