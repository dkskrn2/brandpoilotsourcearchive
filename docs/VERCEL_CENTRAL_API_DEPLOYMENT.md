# Vercel Central API Deployment

Deploy the central API as a separate Vercel project. Keep the existing website project and domain unchanged.

## Project Settings

| Setting | Value |
| --- | --- |
| Repository | `dkskrn2/brandpoilot` |
| Root Directory | `apps/api` |
| Framework Preset | Fastify or automatic detection |
| Build Command | Leave empty; `vercel-build` runs the TypeScript check |
| Output Directory | Leave empty |
| Node.js | 20 or later |
| Function Region | `bom1` (same AWS region as the current Supabase project) |

Do not attach `www.danbammsg.co.kr` to this project. Use the generated `*.vercel.app` URL first. A dedicated API subdomain can be added later without changing the website project.

## Production Environment Variables

Add these values to the Vercel project for Production and Preview when Preview deployments need to run against the shared pilot database.

| Variable | Required | Source |
| --- | --- | --- |
| `SUPABASE_DATABASE_URL` | Yes | Supabase Connect, pooler connection string |
| `WORKER_API_TOKEN` | Yes | Generate once; set the identical value on the worker PC |
| `CRON_SECRET` | Yes | Vercel Cron 요청을 인증하는 충분히 긴 임의 문자열 |
| `SOURCE_CRAWL_BATCH_SIZE` | Yes | 호출당 URL 수, 기본값 `5` |
| `SOURCE_CRAWL_DISCOVERY_LIMIT` | Yes | URL당 발견 문서 수, 기본값 `20` |
| `SOURCE_CRAWL_TIME_BUDGET_MS` | Yes | 호출당 실행 시간 제한, 기본값 `45000` |
| `CREDENTIAL_ENCRYPTION_KEY` | Yes | Generate once; changing it invalidates stored encrypted channel credentials |
| `OPENAI_LLM_ENABLED` | Yes | `true` when draft generation is enabled |
| `OPENAI_API_KEY` | Conditional | Required when `OPENAI_LLM_ENABLED=true` |
| `OPENAI_MODEL` | Yes | Current draft model name |
| `OPENAI_REQUEST_TIMEOUT_MS` | No | Current value is `500000` |
| `INSTAGRAM_PUBLISH_ENABLED` | Yes | `true` for real Meta publishing |
| `META_GRAPH_VERSION` | Yes | Current supported Graph API version |
| `BRAND_PILOT_DEV_BRAND_ID` | Pilot only | Current pilot brand UUID |

Do not configure `PORT`, `HOST`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, Meta access tokens, or Supabase browser keys in this API project. Vercel sets the port, the API prefers `SUPABASE_DATABASE_URL`, Blob writes occur on the worker, and Meta access tokens are encrypted in PostgreSQL.

Generate the two secrets locally without printing existing secrets:

```powershell
$workerToken = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$encryptionKey = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Store `$workerToken` as `WORKER_API_TOKEN` in Vercel and in the worker `.env`. Store `$encryptionKey` only as `CREDENTIAL_ENCRYPTION_KEY` in the central API environments.

## 자동 크롤링 배포 순서

1. Supabase 마이그레이션 적용 이력을 먼저 확인합니다.
2. `012_source_crawl_runs.sql`이 없다면 운영 Supabase에 해당 파일만 한 번 적용합니다.
3. Vercel Production 환경에 `CRON_SECRET`과 크롤링 제한 변수를 등록합니다.
4. API를 배포합니다. `vercel.json`은 `/internal/cron/source-crawl`을 15분마다 호출합니다.
5. 새 URL 등록 직후 초기 크롤링 이력이 생성되는지, 72시간이 지난 URL이 자동 실행되는지 확인합니다.

운영 DB 적용과 배포는 별도 승인 후 수행하세요. 로컬 개발 과정에서 운영 Supabase 스키마나 Vercel 배포를 자동으로 변경하지 않습니다.

Cron 인증을 수동으로 확인할 때는 실제 비밀값이 터미널 기록이나 문서에 남지 않게 환경 변수로 전달하세요.

```powershell
$headers = @{ Authorization = "Bearer $env:CRON_SECRET" }
Invoke-RestMethod -Headers $headers https://brand-pilot-api.example.vercel.app/internal/cron/source-crawl
```

## Verification

After deployment, set the worker's API URL to the deployment origin without a trailing path:

```env
BRAND_PILOT_API_URL=https://brand-pilot-api.example.vercel.app
```

Verify database connectivity:

```powershell
Invoke-RestMethod https://brand-pilot-api.example.vercel.app/health
```

Expected response:

```json
{"ok":true,"database":"ok"}
```

Verify worker authentication and queue access by running this from the worker directory:

```powershell
npm run run-once
```

An empty queue returns `{"status":"idle"}`. A `401` means the worker tokens differ. A `503` means `WORKER_API_TOKEN` is missing from the central API deployment.
