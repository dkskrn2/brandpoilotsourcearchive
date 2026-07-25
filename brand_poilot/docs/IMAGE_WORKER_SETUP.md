# Image Worker Setup

## Responsibility boundary

The central API owns Supabase, content status, Meta OAuth credentials, Instagram publishing, and artifact validation. The image worker PC owns only rendering, its worker API token, and Blob upload access.

Do not copy `DATABASE_URL`, `SUPABASE_DATABASE_URL`, `META_APP_SECRET`, or Instagram access tokens to the worker PC.

## Central API environment

Add a long random value to `apps/api/.env` and restart the API:

```env
WORKER_API_TOKEN=replace-with-a-long-random-secret
```

The same value must be placed in the worker PC environment. It is not a Meta or database credential.

## Worker PC environment

Copy `workers/brand-pilot-image-worker` to the worker PC. Then copy `.env.example` to `.env` inside that directory and set:

```env
BRAND_PILOT_API_URL=https://your-central-api.example.com
WORKER_API_TOKEN=the-same-value-as-the-central-api
WORKER_ID=worker-pc-1
BLOB_READ_WRITE_TOKEN=a-valid-token-for-the-brandpilot-Blob-store
IMAGE_PROVIDER=command
IMAGE_RENDER_COMMAND=node scripts/run-codex-image-render.mjs --job "{{jobFile}}" --output "{{outputDir}}"
IMAGE_MODEL=codex-imagegen
```

`BLOB_READ_WRITE_TOKEN` is the worker PC's storage connection. It must be a valid **read-write** token for the existing `brandpilot` Vercel Blob store. The token is store-scoped, so it grants writes to that Blob store. Do not use a database credential in its place.

## Codex CLI

Install Codex on the worker PC, then authenticate it interactively before configuring its command as `IMAGE_RENDER_COMMAND`:

```powershell
npm install -g @openai/codex
codex login
```

Sign in with the intended OpenAI account. For each claimed job, Codex uses the built-in `image_gen` tool to create one to five images under `$CODEX_HOME/generated_images`. The existing `run-codex-image-render.mjs` wrapper finds the images for that Codex task and copies them into the job output directory as sequential `slide-XX.png` files; the wrapper also writes the final response to `content.json`.

## Commands

```powershell
cd workers/brand-pilot-image-worker
npm install
npm run run-once
npm run dev
```

`run-once` claims at most one job. `dev` continuously polls for jobs. A worker success uploads slides and `manifest.json` to Blob, then calls the central API. The central API validates the manifest before it schedules the Instagram queue row.

## Fixture test mode

For a no-model smoke test, use `IMAGE_PROVIDER=fixture`. It produces tiny valid PNG files, but still requires a valid Blob write token because the central API validates the public manifest URL.
