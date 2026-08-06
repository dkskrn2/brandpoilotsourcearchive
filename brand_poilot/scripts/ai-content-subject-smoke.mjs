// This script previously created a legacy generation merely to host a subject
// analysis, then called removed V1 generation routes. It is intentionally
// disabled until a standalone subject-analysis canary is designed. The current
// content cutover must test only the authenticated manual generation browser.
process.stderr.write(`${JSON.stringify({
  error: "ai_content_smoke_replaced_by_authenticated_browser_canary",
  safety: "zero_writes",
  replacement: "authenticated /ai-content/new browser canary",
})}\n`);
process.exitCode = 2;
