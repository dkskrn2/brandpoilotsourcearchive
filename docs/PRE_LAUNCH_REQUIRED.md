# Pre-Launch Required Work

The following items are intentionally deferred during the local pilot. They must be completed before any public user access.

## Security and access control

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

## Input and cost controls

- Add URL allow/deny rules that block loopback, private networks, link-local ranges, and cloud metadata endpoints before crawling.
- Add maximum response sizes and explicit source-content/LLM input limits.
- Add API rate limits and request body limits for source crawling, topic uploads, LLM generation, and publishing.
