# Pre-Launch Required Work

The following items are intentionally deferred during the local pilot. They must be completed before any public user access.

## Security and access control

- Generate a long random `ADMIN_SERVICE_TOKEN` for the Brand Pilot API and store the same value as `BRAND_PILOT_ADMIN_API_TOKEN` only on the `dkskrn2/main` server. Never expose it through browser-prefixed environment variables, customer UI, or workers. Rotate both values together before launch and after any suspected exposure.
- Verify the implemented Kakao session and workspace-membership checks with production integration tests. The current `Meta` development callback remains exempt and must not be used as production login.
- Replace the `/auth/meta/dev-complete` development callback with a production OAuth callback using state validation, PKCE, and server-side session binding.
- Set `NODE_ENV=production` and a unique `CREDENTIAL_ENCRYPTION_KEY` before storing or using any production channel credential.
- Replace `ssl.rejectUnauthorized: false` for Supabase with CA-verified TLS.

## Product tenancy

- Add workspace and brand selection when a user owns more than one workspace or brand. First Kakao login currently creates one personal workspace and one `내 브랜드` brand.

## Worker and publishing operations

- Set the same long random `WORKER_API_TOKEN` on the central API and the worker PC. Without it, worker claim, completion, and failure routes return `503`.
- Issue a valid read-write `BLOB_READ_WRITE_TOKEN` for the `brandpilot` Vercel Blob store and set it only on the worker PC. `BLOB_STORE_ID` identifies a store but cannot upload files; a token from another store or a revoked token returns `Access denied` before the worker can call the completion route.
- Deploy the central API to a public HTTPS URL reachable from the worker PC; `127.0.0.1` cannot be used across PCs.
- Verify the production worker PC can invoke Codex CLI `image_gen` non-interactively and produce one to five separate PNG files for a claimed job.
- Replace mock publishing with explicit failures for disabled or unimplemented channels.
- Restrict the fixture renderer to automated tests and send worker heartbeats while long rendering commands are running.
- Implement the actual Threads publisher before marking that channel as published.
- Add a durable scheduler/worker that triggers scheduled queue rows at `scheduled_for`; the current API only schedules rows and exposes a manual publish endpoint.

### Subject analysis worker launch checks

- Run exactly one `brand-pilot-subject-analysis-worker` process initially. The same process must handle both `analysis` and `appeal` phases with the four pinned prompts: `product-analysis.v2-ko`, `service-analysis.v2-ko`, `product-appeal.v2-ko`, and `service-appeal.v2-ko`.
- Copy the complete `SUBJECT_ANALYSIS_*` contract from the worker `.env.example` to the server secret store. Local and server deployments must use the same variable names and semantics; only endpoint, token, worker ID, and tuning values may differ.
- Confirm the central API and worker use the same `WORKER_API_TOKEN`, then run `npm run env:check -- --process=subject-analysis-worker` on the target host.
- Verify the 900-second lease, 30-second heartbeat, 300-second API timeout, 900-second Codex timeout, and maximum three attempts under process termination and transient network failure. Contract validation failures must remain non-retryable.
- Verify upload enforcement before launch: PNG/JPEG up to 5 MB; TXT/Markdown/CSV up to 5 MB; PDF/XLSX up to 10 MB. MIME, size, Blob metadata, signature, and generation ownership checks must all remain enabled.
- Keep `subject-analysis.v1` records readable. New v2 requests must remain generation-scoped with no cross-generation URL-cache reuse; v2 full `force` reanalysis stays disabled and only appeal regeneration is allowed.

## Input and cost controls

- Add URL allow/deny rules that block loopback, private networks, link-local ranges, and cloud metadata endpoints before crawling.
- Add maximum response sizes and explicit source-content/LLM input limits.
- Add API rate limits and request body limits for source crawling, topic uploads, LLM generation, and publishing.
