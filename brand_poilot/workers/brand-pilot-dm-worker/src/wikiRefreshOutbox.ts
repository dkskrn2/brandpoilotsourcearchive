export interface WikiRefreshOutboxDb {
  dispatchWikiRefreshOutboxOnce(workerId: string): Promise<
    | { status: "idle" }
    | { status: "completed"; eventId: string }
    | { status: "retry"; eventId: string | null; error: string }
  >;
}

export function runWikiRefreshOutboxOnce(input: {
  workerId: string;
  db: WikiRefreshOutboxDb;
}) {
  return input.db.dispatchWikiRefreshOutboxOnce(input.workerId);
}
