# Image Generation Worker Split

## Purpose

Instagram card-news image generation will run on a separate PC/CLI worker instead of the Brand Pilot API server.

The Brand Pilot server remains the source of truth for content topics, LLM draft generation, channel outputs, publish queue state, Meta OAuth credentials, and final publishing. The separate PC only generates images, uploads them to public storage, and reports the result back to the server.

This split keeps expensive or GPU-dependent image work outside the main server while preserving a single publishing authority.

## Responsibility Split

| Area | Current Brand Pilot Server | Separate PC / CLI Worker |
|---|---|---|
| Source crawling | Owns crawling, dedupe, source queue, and DB writes | None |
| Topic selection | Owns selected source/topic rows | None |
| LLM draft generation | Owns master draft and channel-specific output generation | None |
| Instagram card text | Owns slide text, card count, prompt version, and output JSON | Reads job payload only |
| Image generation | Creates image job instead of generating inline | Generates 1-5 images from the job payload |
| Storage upload | Validates uploaded artifact and stores artifact metadata | Uploads generated images and manifest to Vercel Blob or configured storage |
| DB writes | Owns all DB writes | No direct DB access |
| Meta OAuth tokens | Stored and used only by server | No access |
| Instagram publishing | Publishes only after validated image artifact exists | None |
| Failure reporting | Stores worker errors and blocks publish when needed | Reports generation or upload failure |

## Target Flow

```text
source crawl / topic upload
-> publish management waiting row
-> LLM master draft generation
-> channel output generation
-> Instagram output creates image_generation_job
-> separate CLI worker claims job
-> worker generates card images
-> worker uploads images and manifest to public storage
-> worker reports completion to server
-> server validates manifest and image URLs
-> server links storage artifact to channel output
-> auto approval can schedule and publish
```

## Server-Side Changes

### 1. Replace Inline Image Generation With Jobs

Current behavior generates Instagram images inside the API process after channel output creation.

New behavior:

- When an Instagram `channel_output` is created, the server creates an image generation job.
- The server does not call the image model directly.
- `channel_outputs.rendered_artifact_id` stays null until the worker uploads a valid manifest.
- Instagram auto-publish must remain blocked while the image job is not validated.

Primary code area:

- `apps/api/src/repository.ts`
- `apps/api/src/instagramImageGenerator.ts`

### 2. Add Durable Image Job State

Add a dedicated table or extend the existing job model with image-specific payloads.

Recommended fields:

| Field | Meaning |
|---|---|
| `id` | Job ID |
| `workspace_id` | Workspace scope |
| `brand_id` | Brand scope |
| `channel_output_id` | Instagram channel output to render |
| `status` | `pending`, `claimed`, `uploaded`, `validated`, `failed` |
| `attempt_count` | Retry count |
| `locked_by` | Worker ID currently processing the job |
| `locked_until` | Lock expiry for crash recovery |
| `requested_payload` | Normalized slide data and rendering instructions |
| `prompt_version` | Prompt/template version used by server |
| `image_model` | Worker-reported model name after completion |
| `artifact_id` | Linked `storage_artifacts.id` after validation |
| `error_message` | Last worker/server validation error |
| `created_at` / `updated_at` | Audit timestamps |

### 3. Add Worker API

The worker should talk to the server API, not to the database.

Recommended endpoints:

```text
POST /worker/image-jobs/claim
POST /worker/image-jobs/:jobId/complete
POST /worker/image-jobs/:jobId/fail
```

Optional later endpoint:

```text
POST /worker/image-jobs/:jobId/heartbeat
```

Authentication:

- Add `WORKER_API_TOKEN`.
- The token should be separate from Meta tokens, DB credentials, and OpenAI keys.
- Worker endpoints should reject unauthenticated calls.

### 4. Define Job Payload Contract

The server should send normalized rendering instructions.

Example payload:

```json
{
  "jobId": "job-1",
  "channelOutputId": "output-instagram-1",
  "brandId": "brand-1",
  "channel": "instagram",
  "promptVersion": "instagram.card-image.v1",
  "templateVersion": "instagram.square-card.v1",
  "imageSize": "768x768",
  "outputFormat": "png",
  "slides": [
    {
      "index": 1,
      "role": "hook",
      "title": "첫 장 훅",
      "body": "공감, 정보성, 사례정리 중 적합한 방향으로 구성"
    }
  ],
  "storagePrefix": "rendered-content/instagram/brand-1/output-instagram-1/job-1"
}
```

### 5. Validate Worker Completion

The worker completion request should include a manifest URL or the manifest body.

The server should validate:

- Manifest is valid JSON.
- `jobId` and `channelOutputId` match the claimed job.
- Image count is between 1 and 5.
- Image URLs are HTTPS public URLs.
- Image URLs are reachable.
- Content type is an image MIME type.
- Width/height match the expected square format when metadata exists.
- All required slide indexes are present.

After validation:

- Insert or update `storage_artifacts`.
- Link `channel_outputs.rendered_artifact_id`.
- Mark image job as `validated`.
- Allow Instagram publish scheduling.

### 6. Keep Publishing Server-Side

The current Instagram publish logic should stay on the server.

The server owns:

- Meta OAuth credentials.
- Instagram Business Account ID.
- Container creation.
- Container status polling.
- Media publish.
- Publish attempts and failure history.

The worker must not publish to Instagram.

## Worker-Side Changes

### 1. CLI Configuration

The worker PC needs only worker and storage credentials.

Recommended environment variables:

```text
BRAND_PILOT_API_URL=http://127.0.0.1:4000
WORKER_API_TOKEN=...
BLOB_READ_WRITE_TOKEN=...
IMAGE_PROVIDER=...
IMAGE_MODEL=...
WORKER_ID=local-image-worker-1
```

The worker should not receive:

- Database credentials
- Meta app secret
- Meta user/page tokens
- Instagram access tokens

### 2. Worker Loop

Recommended loop:

```text
claim one image job
-> generate images from slides
-> upload images to storagePrefix
-> upload manifest.json
-> report complete
-> if any step fails, report fail
```

The worker can run manually at first:

```text
brand-pilot-image-worker run-once
```

Later it can run continuously:

```text
brand-pilot-image-worker watch
```

### 3. Storage Path Convention

Use job and output IDs to make retries traceable.

Example:

```text
rendered-content/instagram/{brandId}/{channelOutputId}/{jobId}/slide-01.png
rendered-content/instagram/{brandId}/{channelOutputId}/{jobId}/slide-02.png
rendered-content/instagram/{brandId}/{channelOutputId}/{jobId}/manifest.json
```

If retry attempts need to preserve old files:

```text
rendered-content/instagram/{brandId}/{channelOutputId}/{jobId}/attempt-2/slide-01.png
```

### 4. Manifest Contract

Example:

```json
{
  "jobId": "job-1",
  "channelOutputId": "output-instagram-1",
  "model": "external-cli-image-model",
  "promptVersion": "instagram.card-image.v1",
  "templateVersion": "instagram.square-card.v1",
  "images": [
    {
      "index": 1,
      "url": "https://blob.vercel-storage.com/rendered-content/instagram/brand-1/output-instagram-1/job-1/slide-01.png",
      "width": 768,
      "height": 768,
      "mimeType": "image/png"
    }
  ]
}
```

### 5. Idempotency and Retry

The worker should:

- Process one claimed job at a time.
- Use the server-provided job ID in all paths.
- Report failure instead of silently exiting.
- Let the server lock expire if the worker crashes.
- Avoid direct mutation of previous successful artifacts.

## Publish Queue State Impact

Instagram status should represent the image dependency clearly.

Suggested display states:

| Internal State | User-Facing State |
|---|---|
| No channel output yet | 생성 전 |
| Channel output exists, image job pending | 이미지 생성 대기 |
| Job claimed | 이미지 생성 중 |
| Manifest uploaded but not validated | 이미지 검증 중 |
| Manifest validated | 게시 준비 완료 |
| Publish scheduled | 예약 |
| Publishing | 게시 중 |
| Published | 성공 |
| Job or validation failed | 이미지 생성 실패 |
| Meta publish failed | 게시 실패 |

## Security Boundary

The split is only safe if credentials are separated.

Server keeps:

- Database credentials
- Meta app secret
- Meta OAuth tokens
- Instagram publishing credentials
- Publish queue mutation authority

Worker keeps:

- `WORKER_API_TOKEN`
- Storage upload token or signed upload permission
- Image provider credentials

The worker should never receive Meta publish credentials or direct DB credentials.

## Implementation Order

1. Add DB migration for image generation jobs.
2. Add repository tests for job creation when Instagram channel output is generated.
3. Add worker API tests for claim, complete, fail, and auth rejection.
4. Change `generateContent()` to create image jobs instead of inline OpenAI image calls.
5. Add manifest validation and artifact linking.
6. Block Instagram scheduling/publishing until a validated rendered artifact exists.
7. Update publish management UI to show image job states.
8. Build the separate CLI worker.
9. Run one end-to-end test: waiting row -> LLM output -> image job -> worker upload -> validation -> Instagram publish.

## Open Decisions

| Decision | Recommended Default |
|---|---|
| Does the worker build prompts or receive complete prompts? | Server owns prompt/template version; worker receives normalized slides and rendering rules. |
| Should worker upload directly to Vercel Blob? | Yes for pilot, using `BLOB_READ_WRITE_TOKEN`. Later, replace with signed upload URLs if needed. |
| Should worker write directly to DB? | No. Always report through server API. |
| Should image generation stay available on server as fallback? | Keep disabled by default. Add a manual fallback only after worker flow is stable. |
| Should Threads/Webflow use this worker? | Not initially. Start with Instagram card-news images only. |

## Current Code Hotspots

| File | Reason |
|---|---|
| `apps/api/src/repository.ts` | Currently creates channel outputs, inline image generation, artifacts, publish queue transitions |
| `apps/api/src/instagramImageGenerator.ts` | Current OpenAI image generation and Blob/local artifact writing |
| `apps/api/src/instagramPublisher.ts` | Should remain server-side; publishes validated image URLs to Meta |
| `apps/api/src/server.ts` | Needs worker endpoints |
| `apps/customer-ui/src/pages/PublishQueuePage.tsx` | Needs image job status display |
| `db/migrations` | Needs image job schema migration |

