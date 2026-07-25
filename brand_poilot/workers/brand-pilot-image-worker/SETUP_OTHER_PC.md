# Image Worker: Other-PC Setup

Copy the entire `brand-pilot-image-worker` directory to the PC that will generate images. Do not copy `.env` from another PC and do not copy central API, Supabase, or Meta credentials.

## What Must Be Prepared First

| Owner | Item | Purpose |
| --- | --- | --- |
| Central server operator | Public HTTPS API address | The worker claims jobs and reports results to the central API. `127.0.0.1` only works when the API is on the same PC. |
| Central server operator | `WORKER_API_TOKEN` | A separately generated shared secret. The identical value is configured on the central API and this worker. |
| Vercel project owner | `BLOB_READ_WRITE_TOKEN` | Read/write token for the existing `brandpilot` Blob store. The worker uploads rendered PNG files and a manifest containing the final Instagram copy. |
| Worker-PC operator | Standalone Codex CLI and login | Allows the renderer wrapper to request the built-in `image_gen` tool. The VS Code bundled executable is not a substitute for the standalone npm installation. |
| Worker-PC operator | Node.js 20 or later | Runs the worker and its scripts. |

The worker does not need `SUPABASE_DATABASE_URL`, Supabase service keys, Meta App secrets, Instagram tokens, or image-generation API keys.

## Required Codex Skills and Guidance

Copy the worker directory as-is. These files are part of the worker contract and must remain at their current relative paths.

| Item | Location | Required on the worker PC | Role |
| --- | --- | --- | --- |
| Image-render skill | `.codex/skills/image-render/SKILL.md` | Yes | Restricts Codex to the built-in `imagegen` tool and prevents code, credential, database, or publishing changes during rendering. |
| Worker guidance | `AGENTS.md` | Yes | Makes the image-only trust boundary explicit to Codex. |
| Built-in `image_gen` tool | Provided by the logged-in Codex environment | Yes | Creates the actual image files. It is not an npm package and does not use an image API key. |
| `content-skills` (`dumbify`, `viral-hooks`, `storytelling`, `anti-ai-writing`) | Do not install in this worker | No | Their relevant writing rules are incorporated into the central server's LLM draft prompt, not the image renderer. |
| Voice-DNA | Do not install in this worker | No | This will be brand-specific data sent by the central API to the draft-generation step, not a global worker skill. |

No additional Codex skill is required for the current image worker. Future workers that create blog HTML will have their own dedicated skill and must not reuse the image-render skill.

Before starting the worker on another PC, confirm the included files exist:

```powershell
Test-Path .\AGENTS.md
Test-Path .\.codex\skills\image-render\SKILL.md
```

Both commands must return `True`.

## 1. Install on the Worker PC

Open PowerShell in the copied folder.

```powershell
node --version
npm install
Copy-Item .env.example .env
```

Use Node.js 20 LTS or newer. This copied standalone worker does not include the repository root lockfile, so install its declared dependencies with `npm install`.

## 2. Authenticate Codex

Install Codex CLI if `codex --version` is not available, then authenticate the Windows user that will run the worker.

```powershell
npm install -g @openai/codex
codex login
codex login status
codex features list
```

`codex login status` must report that the CLI is logged in, and `codex features list` must show `image_generation` enabled before the worker is started. Do not put any Codex credential into `.env`.

## 3. Configure `.env`

Open `.env` and set every value below. Keep this file only on the worker PC; `.gitignore` excludes it.

```env
# Public central API endpoint. Use HTTPS for a worker on another PC.
BRAND_PILOT_API_URL=https://your-central-api.example.com

# Must exactly match the WORKER_API_TOKEN configured on the central API.
WORKER_API_TOKEN=replace-with-a-long-random-secret

# Unique for each worker PC. Do not reuse on another worker.
WORKER_ID=image-worker-pc-01

# Vercel Blob read/write token for the existing brandpilot store.
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_token

IMAGE_PROVIDER=command
IMAGE_RENDER_COMMAND=node scripts/run-codex-image-render.mjs --job "{{jobFile}}" --output "{{outputDir}}"
IMAGE_MODEL=codex-imagegen

# Retry only retryable rendering or upload failures after five minutes.
IMAGE_RETRY_DELAY_MS=300000
POLL_INTERVAL_MS=10000
HEARTBEAT_INTERVAL_MS=300000

# Local-only worker control app. Defaults to http://127.0.0.1:4174.
WORKER_CONTROL_PORT=4174
```

Generate the shared worker token on the central-server side, for example:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Set the generated value as `WORKER_API_TOKEN` both in the central API environment and in this worker's `.env`. Never commit or send this value through source control.

## 4. Preflight Checks

Run these before starting the watch process.

```powershell
# Type check and unit tests
npm run build
npm test

# Central API must answer from this PC.
Invoke-WebRequest "$env:BRAND_PILOT_API_URL/health" -UseBasicParsing

# Process at most one available job.
npm run run-once
```

The health endpoint verifies network reachability but does not prove worker authorization. `run-once` verifies the real claim/upload/report path when a queued image job exists.

## 5. Run Continuously

```powershell
npm run dev
```

Run one worker process per Codex login. Codex decides whether a job needs one to five cards, creates the final title, caption, up to five hashtags, and card copy, then creates the corresponding PNG files in one CLI task. The worker claims the next job only after the current upload and completion report finish. A retryable failure returns the job to the queue after `IMAGE_RETRY_DELAY_MS`; permanent configuration and authorization failures remain failed.

### Optional local control app

For normal operation, launch the worker control app on the same worker PC instead:

```powershell
npm run control
```

Open `http://127.0.0.1:4174` locally. Use `계속 실행` for watch mode, `한 번 실행` for one job only, and `중지` to terminate the worker and its child Codex process. The app deliberately binds to localhost and has no remote-control endpoint. Do not expose this port through a router, tunnel, or firewall rule.

## Operational Checks

| Symptom | Check |
| --- | --- |
| `401` or `403` from the worker API | Confirm `WORKER_API_TOKEN` is identical on the API and worker, then restart both processes after editing environment variables. |
| Blob upload access denied | Obtain a current `BLOB_READ_WRITE_TOKEN` for the `brandpilot` store. Store ID or webhook key alone is insufficient. |
| API cannot be reached from another PC | `BRAND_PILOT_API_URL` must be the public HTTPS central API URL, not a local `127.0.0.1` address. Check the deployment health endpoint from the worker PC. |
| `codex` command not found | Install Codex globally for the same Windows account that runs `npm run dev`, then open a new PowerShell window. |
| No image appears in `$CODEX_HOME/generated_images` | Stop the worker and verify that non-interactive `codex exec` can call the built-in `image_gen` tool in that installed CLI version. Interactive access alone is insufficient for this worker. Do not replace this with a direct image API key. |
| Jobs retry repeatedly | Inspect the error stored on the central API. Fix the cause before the next retry; each job has a finite maximum-attempt count. |

## Files and Trust Boundaries

| Location | Contains | May Leave the Worker PC? |
| --- | --- | --- |
| `.env` | Worker token and Vercel Blob read/write token | No |
| `$CODEX_HOME/generated_images/` | Codex-generated image files detected by the wrapper | No; worker uploads normalized final assets to Blob |
| `output/` | Temporary PNGs and final `content.json` | No |
| Vercel Blob | Final images and manifest, including title/caption/hashtags/card copy | Yes, through the returned public asset URLs |
| Central API | Queue state and publish orchestration | Yes, it is the worker's only remote control plane |

## Before Moving the Folder Again

1. Stop `npm run dev` cleanly.
2. Do not include `.env`, `output/`, or `node_modules/` in the copy.
3. On the next PC, repeat this document from step 1 and use a new `WORKER_ID`.
