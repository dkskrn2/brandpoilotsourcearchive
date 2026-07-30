# Instagram Hashtag Trends Operations

## Release Preconditions

Before enabling the trend explorer, confirm the Meta app has **Instagram Public Content Access** and **Advanced Access** for the permissions required by the connected account. The brand must have a connected Professional Instagram account and a separate Facebook Login trend connection. Publishing and DM use Instagram Login; hashtag search uses Facebook Login and stores its token in `instagram_trend_connections`.

Register the hosted HTTPS callback in the Meta app's valid Facebook Login redirect URIs. The current callback is `https://api-three-omega-89.vercel.app/auth/meta/trends/callback`, and the hosted API must set the same value in `META_TRENDS_OAUTH_REDIRECT_URI`. Meta blocks the local HTTP callback for this production app, so the local customer UI must set `VITE_META_TRENDS_CONNECT_URL=https://api-three-omega-89.vercel.app/auth/meta/trends/start` and enter OAuth through the hosted API. Do not point either variable at the Instagram Login callback.

The local API callback may remain available for unit tests or a separate development Meta app, but it is not the live OAuth entry point. Local UI and API may still read the resulting connection because the hosted and local APIs share the same database.

Meta enforces a **rolling seven-day 30 unique hashtag limit** per connected Instagram account. A cache hit does not consume a new hashtag entry. Use a low-risk hashtag that has not been searched in the current seven-day window for a live smoke test.

Fetched media is stored as raw Meta data first, then evaluated against the searched hashtag and the brand's representative category, subcategory, and recommended hashtag terms. Only rows marked `relevant` are exposed through the trend list. Missing captions, hashtag mismatches, and ambiguous short tags without category context are retained in raw storage for diagnosis but are not shown as references.

The customer browser receives only the Brand Pilot API response. There must be **no access token in browser/network responses**. The Meta access token remains in the central API credential store and must never appear in UI source, logs, smoke output, or error messages.

## Smoke Test

Set these variables in the shell running the smoke test. Keep the session cookie in the environment and use a redacted placeholder in shared command history or tickets:

```powershell
$env:BRAND_PILOT_API_URL='http://localhost:4000'
$env:BRAND_PILOT_SESSION_COOKIE='bp_session=REDACTED'
$env:BRAND_PILOT_SMOKE_BRAND_ID='REDACTED'
$env:BRAND_PILOT_SMOKE_HASHTAG='콘텐츠마케팅'
npm run smoke:instagram-trends
```

The script performs one authenticated hashtag search, repeats it to verify `source=cache` and `refreshed=false`, reads page 1, checks the first public permalink without sending the session cookie, and saves the first media twice to verify idempotency. It accepts at most 50 items and recursively rejects JSON keys containing `token`, `secret`, or `credential`. It prints only status summaries and stable error codes, never cookies or tokens.

Do not run this against Meta from CI. Live execution requires the release preconditions above and consumes the account's quota.

## Failure Handling

Treat `instagram_connection_required`, `instagram_trend_connection_required`, `instagram_trend_reconnect_required`, `instagram_permission_required`, and `hashtag_search_limit_reached` as release blockers. Treat `instagram_trend_fetch_failed` as a Meta/API availability failure and retain the cached result when the API provides one. Investigate non-2xx smoke responses using the method, endpoint, HTTP status, and stable error code only; do not copy response bodies or credentials into tickets.

## Rollback

If trend discovery causes operational problems, disable only the sidebar/route for trend discovery and its navigation entry, then redeploy the API/UI as needed. Do not remove or roll back category data, category recommendations, or the database migration; category data is independent of the trend explorer and remains required by brand profiles.
