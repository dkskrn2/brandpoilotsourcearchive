# All-CLI Worker Runtime Design

**Status:** Approved by the user's 2026-07-30 instruction to use Codex CLI for every AI operation and remove direct model APIs.

## Goal

Run every Brand Pilot generation and analysis job through a logged-in Codex CLI worker. The production runtime must not require an OpenAI API key for text generation, image generation, Wiki compilation, DM answers, proposal generation, embeddings, or retrieval.

## Existing problem

- `brand-pilot-content-proposal-worker` calls `https://api.openai.com/v1/responses` directly.
- DM/Wiki retrieval calls `https://api.openai.com/v1/embeddings` directly.
- Ubuntu Compose contains only optional DM, Wiki, and content-proposal workers.
- The brand-intelligence worker that powers onboarding is not deployed on Ubuntu.
- Ubuntu has no Codex CLI installation, no `CODEX_HOME`, and no persisted ChatGPT login.
- The current worker env files contain a disabled marker in `OPENAI_API_KEY`, not a usable key.

## Approaches considered

### A. Per-worker `codex exec` with one persisted login directory — selected

Each worker claims jobs from the API and starts an ephemeral `codex exec`. All containers use the same tightly permissioned authentication directory. Resource leases bound simultaneous CLI work.

This preserves the existing worker/job architecture, keeps HTTP requests short, and needs no new model gateway.

### B. One central Codex gateway

A separate daemon would receive prompts from all workers and serialize CLI calls. This would centralize authentication but introduce a new privileged network service, another protocol, and a single failure domain.

### C. Retain generation PCs

Ubuntu would run only the API while separate PCs execute the CLI workers. This preserves some historical setup but leaves onboarding unavailable whenever the PC is offline and makes deployment health difficult to verify.

## Runtime architecture

1. Customer/API actions enqueue immutable jobs and return without waiting for the model.
2. A job-specific worker claims the job with the existing worker token and lease.
3. The worker builds a bounded prompt from the server-provided snapshot.
4. The worker invokes `codex exec --ephemeral` with a pinned model, reasoning effort, timeout, sandbox, and output contract.
5. The worker validates the final JSON or file manifest before completing the job.
6. Lease loss aborts the Codex child and prevents stale completion.

The API must never invoke Codex directly and must never receive the persisted Codex credential.

## Worker mapping

| Job | Runtime |
|---|---|
| Brand Core and market analysis | Codex CLI, read-only sandbox, web search enabled |
| Product/service subject analysis | Codex CLI, read-only sandbox |
| Content proposals | Codex CLI, read-only sandbox, JSON Schema output |
| DM answer | Exact FAQ or deterministic retrieval, then Codex CLI for grounded answer |
| Wiki collection/compilation/maintenance | Codex CLI, read-only sandbox |
| Card-news planning | Codex CLI, read-only sandbox, JSON Schema output |
| Card-news rendering | Codex CLI with built-in image generation and bounded output directory |
| Blog generation | Codex CLI with built-in image generation and bounded output directory |
| Marketing generation | Codex CLI with built-in image generation and bounded output directory |
| Single-image and Threads text generation | Codex CLI with built-in image generation or read-only text mode |

## Retrieval without an embedding API

Embedding creation and query embedding calls are removed. DM retrieval uses:

1. exact approved FAQ matching;
2. PostgreSQL full-text ranking over enabled chunks;
3. deterministic normalized phrase, query-token, alias, keyword, title, category, stable-key, and verified offering-page boosts;
4. guaranteed Brand Core page inclusion;
5. a bounded 8–12 chunk, 12–16K character candidate packet passed to the existing single Codex answer call.

Wiki pages and chunks remain valid without an embedding. Existing vector columns and historical values are retained for backward compatibility, but activation and search must not require them. A forward-only migration replaces vector-required search/activation functions with keyword-only equivalents. It does not delete existing data or the pgvector extension.

## Authentication and secret handling

- Persistent host path: `/opt/brand-pilot/shared/codex/`
- The one-time provisioning command performs ChatGPT browser OAuth and writes the login there.
- Worker containers mount it at `/codex` and set `CODEX_HOME=/codex`.
- Worker containers run with the deploy account UID/GID so mode `0700`/`0600` login files remain readable only by that identity.
- The mount is writable because ChatGPT access-token refresh can rotate persisted credentials. It is mounted only into worker containers, never into the API or Caddy.
- Generated images and job outputs use separate tmpfs work directories instead of writing into the authentication directory.
- `OPENAI_API_KEY`, `CONTENT_PROPOSAL_MODEL`, and embedding API variables are removed from worker requirements.
- The login directory is never copied into an image, release artifact, log, or Git repository.
- Deployment preflight checks only directory/file existence, ownership, permissions, and `codex login status`; it never prints credential contents.

## Deployment

Ubuntu publishes and can run images for brand intelligence, subject analysis, content proposal, DM, Wiki, card news, blog, marketing, and image generation. Each remains an explicit Compose profile so deployment does not accidentally start duplicate consumers.

Initial rollout order:

1. verify the persisted ChatGPT login;
2. deploy but do not start all worker profiles;
3. start brand intelligence and complete one onboarding job;
4. start subject analysis and content proposal;
5. start Wiki, then DM;
6. start generation workers one at a time;
7. verify leases, heartbeats, completion, and restart recovery.

## Failure handling

- Missing or expired ChatGPT login: fail readiness before claiming jobs.
- CLI non-zero exit, timeout, or invalid output: fail the leased job using existing bounded retry rules.
- Lease loss: terminate the process tree and do not submit completion.
- Login expiry after startup: stop claiming new work, retain queued jobs, and expose an actionable health error.
- Keyword retrieval with no grounded candidate: return the existing knowledge-gap response without inventing an answer.

## Verification

- Source scan has no production call to `api.openai.com`.
- Worker tests prove the CLI command, model, sandbox, timeout, and strict output parsing.
- Migration tests prove Wiki activation and retrieval work with null embeddings.
- Compose validation proves every worker receives the read-only `CODEX_HOME` mount.
- Ubuntu `codex login status` reports ChatGPT login from the same mounted directory.
- Browser onboarding produces a job transition from `queued` to `running` to `completed`.
- Content proposal, Wiki/DM, and one content-generation job complete without `OPENAI_API_KEY`.
