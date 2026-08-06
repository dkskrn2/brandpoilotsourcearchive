// The legacy CLI used direct generation V1 routes that no longer exist.
// Production generation verification now runs through the authenticated
// /ai-content/new browser flow so proposal V2, selection, V3 start, and the
// rendered V3 manifest are exercised as one customer-visible transaction.
process.stderr.write(`${JSON.stringify({
  error: "ai_content_smoke_replaced_by_authenticated_browser_canary",
  safety: "zero_writes",
  replacement: "authenticated /ai-content/new browser canary",
})}\n`);
process.exitCode = 2;
