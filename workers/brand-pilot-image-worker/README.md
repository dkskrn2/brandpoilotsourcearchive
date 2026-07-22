# 모종 Image Worker

This directory is intentionally self-contained. Copy this entire directory to the image-worker PC. Do not copy the central API, Supabase credentials, or Meta credentials.

For the complete handoff checklist, including central-server prerequisites and the required Codex skill files, read [SETUP_OTHER_PC.md](./SETUP_OTHER_PC.md).

## Install on the worker PC

```powershell
cd brand-pilot-image-worker
npm install
Copy-Item .env.example .env
```

Set the following values in `.env`:

```env
BRAND_PILOT_API_URL=https://your-central-api.example.com
WORKER_API_TOKEN=the-same-secret-configured-on-the-central-api
WORKER_ID=image-worker-pc-1
BLOB_READ_WRITE_TOKEN=valid-read-write-token-for-brandpilot-Blob-store
IMAGE_PROVIDER=command
IMAGE_RENDER_COMMAND=node scripts/run-codex-image-render.mjs --job "{{jobFile}}" --output "{{outputDir}}"
IMAGE_JOB_TIMEOUT_MS=1200000
IMAGE_MODEL=codex-imagegen
```

The rendering command is invoked once per claimed job. Codex decides whether the brief needs one to five cards, generates the final Instagram title, caption, up to five hashtags, and card-by-card copy, then creates each card as a separate PNG. The wrapper writes `slide-01.png` through the final card and `content.json` to `{{outputDir}}`. The worker uploads the images and a combined `manifest.json` to Vercel Blob, then reports the manifest URL to the central API.

The worker is sequential. It finishes the current job before claiming the next one. The central API also serializes image claims across every worker process and waits `IMAGE_JOB_COOLDOWN_MS` (60 seconds by default) after a completed or failed attempt before leasing another image job. Retryable Codex or Blob failures are requeued after `IMAGE_RETRY_DELAY_MS` (five minutes by default), while invalid job contracts and authentication failures are final. Run only one worker process for one Codex login.

## Run

```powershell
npm run run-once
npm run dev
```

`run-once` processes at most one job. `dev` continuously polls for jobs.

## Local control app

On the worker PC, start the local control app instead of managing `npm run dev` manually:

```powershell
npm run control
```

Open `http://127.0.0.1:4174` on that same PC. The app can start continuous processing, run one job, stop its managed worker process, and display central API health plus the most recent worker result. It binds only to `127.0.0.1`; it cannot be opened or controlled from another device. Set `WORKER_CONTROL_PORT` in `.env` only when port `4174` is already in use.

## Codex CLI and image generation

Install and authenticate Codex before using it inside `IMAGE_RENDER_COMMAND`:

```powershell
npm install -g @openai/codex
codex login
```

The worker starts one Codex CLI task for every claimed image job. The included `image-render` Skill instructs Codex to decide the required card count, create the final post copy, and call its built-in `image_gen` tool separately for each card inside that task. Codex writes the PNG results under `$CODEX_HOME/generated_images/`; its final JSON response is copied to `content.json`, and the wrapper copies the PNGs into the worker output directory before the Blob upload step. Codex login is the only image-generation authentication required by this worker.

On Windows, install the standalone npm CLI even if the VS Code extension already provides a `codex.exe`. The wrapper resolves the npm entrypoint first to avoid accidentally running an older extension binary.

This worker does not use an image-generation API key. It also does not receive database, Supabase, or Meta credentials.
