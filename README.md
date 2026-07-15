# Brand Pilot

Brand Pilot은 브랜드 콘텐츠의 수집, 생성, 이미지 렌더링, 검토, 소셜 채널 발행을 한 흐름으로 관리하는 자동화 서비스입니다.

현재는 **내부 파일럿 단계**입니다. 공개 출시 전에 반드시 완료해야 할 보안·운영 항목이 남아 있으므로, 외부 공개나 운영 전환 전에 [공개 출시 전 필수 항목](docs/PRE_LAUNCH_REQUIRED.md)을 확인하세요.

## 저장소 구조

- `apps/api`: 중앙 Fastify API, 데이터베이스 및 발행 오케스트레이션
- `apps/customer-ui`: React/Vite 고객 UI
- `workers/brand-pilot-image-worker`: 별도 PC에서도 실행할 수 있는 이미지 생성 워커와 로컬 제어 앱
- `db`: PostgreSQL 마이그레이션, 스모크 테스트, 로컬 DB 안내
- `docs`: 제품 명세, 배포·운영 절차, 출시 체크리스트

## 필수 도구

- Node.js `^20.19.0 또는 >=22.12.0`
- npm
- Docker Desktop 또는 Docker Engine(선택 사항, 로컬 PostgreSQL을 사용할 때만 필요)
- Python 3.11 이상, FFmpeg, ffprobe(Reel 렌더링을 사용할 때만 필요)

## 최초 설치

저장소 루트에서 의존성을 한 번 설치합니다.

```powershell
npm install
```

이 저장소는 npm workspaces를 사용합니다. 잠금 파일은 루트의 `package-lock.json` 하나만 유지하며, 각 앱이나 워커 디렉터리에 별도의 `package-lock.json`을 만들지 않습니다.

## 환경 설정

중앙 API와 이미지 워커는 각자의 예제 파일을 복사해 로컬 환경 파일을 만듭니다.

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item workers/brand-pilot-image-worker/.env.example workers/brand-pilot-image-worker/.env
Copy-Item workers/brand-pilot-dm-worker/.env.example workers/brand-pilot-dm-worker/.env
```

실제 `.env` 파일과 비밀값은 커밋하지 마세요. 비밀값을 소스 코드, 문서, 이슈, 로그에 붙여 넣지 말고 배포 환경의 비밀 관리 기능을 사용하세요. 필요한 변수와 역할은 각 `.env.example`에 정의되어 있습니다.

Supabase를 사용할 때는 `apps/api/.env`의 `SUPABASE_DATABASE_URL`을 해당 프로젝트의 연결 URL로 설정하세요. 로컬 Docker PostgreSQL을 사용할 때는 `SUPABASE_DATABASE_URL`을 비워 두고 `npm run db:up`을 실행한 뒤 [DB README](db/README.md)의 신규 빈 DB 마이그레이션 절차를 따르세요.

### 데이터베이스 연결 우선순위

중앙 API는 다음 순서로 데이터베이스 URL을 선택합니다.

1. `SUPABASE_DATABASE_URL`
2. `DATABASE_URL`
3. 비운영 환경에서만 로컬 Docker PostgreSQL fallback

**Supabase가 현재 기본 운영 데이터베이스입니다.** 운영 환경에서는 `SUPABASE_DATABASE_URL` 등 명시적인 운영 DB 연결 URL을 반드시 설정해야 하며, URL이 없으면 API가 시작되지 않습니다. 자동 로컬 fallback은 개발·테스트 같은 비운영 환경에서만 사용됩니다.

브랜드 로고를 사용하려면 Supabase Storage에 public `brand-assets` 버킷을 한 번 생성하고 중앙 API에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BRAND_ASSETS_BUCKET`을 설정합니다. 서비스 역할 키는 브라우저나 워커에 전달하지 않습니다. 로고 객체는 `{workspaceId}/{brandId}/logo-{uuid}.{extension}` 경로에 저장됩니다.

## 개발 실행

API와 UI는 저장소 루트의 서로 다른 터미널에서 실행합니다.

```powershell
# 터미널 1
npm run dev:api
```

```powershell
# 터미널 2
npm run dev:ui
```

이미지 워커는 중앙 API를 유일한 원격 제어면으로 사용하므로 API가 먼저 실행 중이거나 배포되어 있어야 합니다. 필요에 맞는 명령 하나를 선택하세요.

```powershell
# 작업 큐를 계속 폴링
npm run dev:worker

# 최대 한 건만 처리하고 종료
npm run worker:once

# 로컬 전용 제어 화면에서 계속 실행/한 번 실행/중지 관리
npm run worker:control
```

워커를 전용 PC에 설치하거나 제어 앱을 사용할 때는 [워커 README](workers/brand-pilot-image-worker/README.md)와 [이미지 워커 설정](docs/IMAGE_WORKER_SETUP.md)을 따르세요.

Instagram DM 자동답변 워커는 이미지 워커와 별도 PC 또는 별도 프로세스에서 실행합니다. `DM_WORKER_DATABASE_URL`은 Wiki 검색과 갱신에만 쓰며 Meta access token은 넣지 않습니다. DM, 발신자 프로필, Wiki 작업을 하나의 워커가 우선순위에 따라 처리합니다.

```powershell
# 작업 큐를 계속 폴링
npm run dev:dm-worker

# DM, 발신자 프로필, Wiki 작업을 한 번만 처리
npm run dm-worker:once
```

DM 운영 중 일시정지 대화, 확인 필요 항목, Wiki 실패, 발송 결과 불명확 상태를 처리하는 절차는 [Instagram DM 운영 런북](docs/operations/instagram-dm-operations-runbook.md)을 따릅니다.

## 검사와 빌드

다음 명령은 모두 저장소 루트에서 실행합니다.

```powershell
# 전체 워크스페이스 단위 테스트
npm test

# 전체 워크스페이스 빌드
npm run build

# 고객 UI Playwright E2E 테스트
npm run test:e2e

# 저장소 구조와 문서 계약 테스트
npm run test:contract
```

API의 `build` 스크립트는 타입 검사 후 `tsup`으로 `apps/api/dist/index.js`를 생성합니다. API의 `start` 스크립트는 `node dist/index.js`를 실행합니다. Vercel의 `vercel-build`는 번들을 만드는 대신 `npm run typecheck`를 실행하는 배포 타입 검사 경로입니다. 자세한 설정은 [Vercel 중앙 API 배포](docs/VERCEL_CENTRAL_API_DEPLOYMENT.md)를 참고하세요.

## 선택적 로컬 PostgreSQL

Docker가 준비된 경우 로컬 PostgreSQL을 시작하거나 중지할 수 있습니다.

```powershell
npm run db:up
npm run db:down
```

신규 빈 데이터베이스와 Supabase의 적용 이력은 한 가지 명령으로 관리합니다.

```powershell
npm run db:migrate
```

이미 스키마가 적용됐지만 이력이 없는 Supabase를 처음 전환하는 방법은 [DB README](db/README.md)에 있습니다. 운영 변경 전에는 적용 이력과 대상 환경을 먼저 확인해야 합니다.

## URL 자동 크롤링

URL을 새로 등록하면 해당 URL을 즉시 한 번 크롤링합니다. 이후 마지막 성공 시각으로부터 72시간이 지난 URL은 Vercel Cron이 15분마다 확인해 자동 실행 대상으로 선택합니다. 실패 시 15분, 1시간, 6시간 간격으로 최대 3회 재시도하며, 같은 URL의 실행은 동시에 하나만 허용합니다.

호출 한 번의 기본 한도는 URL 5개, URL당 발견 문서 20개, 총 실행 시간 45초입니다. 이 값은 `SOURCE_CRAWL_BATCH_SIZE`, `SOURCE_CRAWL_DISCOVERY_LIMIT`, `SOURCE_CRAWL_TIME_BUDGET_MS`로 조정할 수 있습니다. Cron 요청은 반드시 `CRON_SECRET`으로 인증합니다.

자동 운영은 다음 정책으로 동작합니다.

- URL 크롤링: 15분마다 실행 후보를 확인
- 콘텐츠 생성: 매일 오전 10시 KST, 브랜드별 1회만 생성
- 자동 게시: 브랜드 전체에서 하루 최대 4개 주제 그룹을 11:30, 14:30, 17:30, 20:30 KST 정책 슬롯에 배정
- 자동 승인: 검토만 건너뛰며 즉시 게시하지 않음. 이미지 렌더 완료 후에도 정책 슬롯까지 대기

같은 주제의 Instagram·Threads 결과물은 하나의 `topic_publish_group`으로 묶이며, 준비된 결과물 전체가 같은 슬롯과 `scheduled_for`를 공유합니다. 한도는 채널별 4개가 아니라 브랜드별 주제 그룹 4개입니다.

로컬 API에서 이 흐름을 켜려면 `LOCAL_SCHEDULER_ENABLED=true`를 설정합니다. 기본값은 꺼짐이며, 운영에서는 Vercel Cron이 `/internal/cron/*` 엔드포인트를 호출합니다.

자동 운영을 배포 환경에서 사용하려면 다음 순서를 따르세요.

1. `npm run db:migrate`로 Supabase 적용 이력을 확인하고 pending 마이그레이션을 적용합니다.
2. Vercel Production 환경에 충분히 긴 임의의 `CRON_SECRET`을 등록합니다.
3. API를 배포하고 `source-crawl`, `daily-generation`, `publish-due` Cron 호출을 확인합니다.

코드 변경만으로 운영 DB 마이그레이션이나 Vercel 배포가 자동 수행되지는 않습니다.

## Instagram 포맷 자동화

중앙 API는 주제와 활성 Instagram 포맷을 선택합니다. 포맷은 Feed 캐러셀 → Story → Reel 순서로 순환하며, 중앙 API는 storyboard나 최종 이미지·장면 수를 만들지 않고 상한 `maxImages: 5`만 작업 계약에 넣습니다. 기본값은 Feed만 활성이고 Story와 Reel은 비활성입니다.

이미지 워커는 대표 URL을 직접 읽되 HTTP(S), 공개 unicast 주소, DNS 고정, redirect·시간·응답 크기·MIME 제한을 적용합니다. 읽지 못하면 주제만으로 계속 진행합니다. Feed와 Reel은 필요한 최소 1~5개 자산을 워커가 결정하고 Story는 정확히 1장을 만듭니다. 브랜드 컬러는 강제 팔레트가 아닌 선택적 시각 힌트입니다.

Vercel Blob 공개 경로는 `brands/{brandId}/topics/{contentTopicId}/{deliveryFormat}/{jobId}/`입니다. Feed는 `card-XX.png`, Story는 `story.png`, Reel은 `scene-XX.png`, `cover.png`, `reel.mp4`를 저장하고 모든 형식이 `manifest.json`을 저장합니다. 중앙 API는 manifest의 작업·출력 ID, 포맷·프롬프트 버전, `selectedAssetCount`, URL 경로, MIME과 공개 접근 가능 여부를 검증한 뒤에만 산출물을 반영합니다.

Story는 연결 상태, Professional 계정 ID, 활성·미만료 credential, `instagram_basic`·`instagram_content_publish` scope, 현재 credential에 대한 scope/Story 게시 검증이 모두 충족되어 capability가 `available`일 때만 활성화·게시할 수 있습니다. Meta 게시 시 Feed 자식/부모 컨테이너, Story, Reel 모두 `status_code`가 `FINISHED`가 될 때까지 기본 5초 간격·최대 60회 폴링한 뒤 `media_publish`를 호출합니다.

Reel 워커는 Python 3.11 이상과 PATH에서 실행 가능한 `ffmpeg`, `ffprobe`가 필요합니다. 루트에서 다음 명령으로 확인합니다.

```powershell
node --version
python --version
ffmpeg -version
ffprobe -version
npm run verify:reel --workspace @brand-pilot/image-worker
```

2026-07-13 현재 이 로컬 PC는 Python 3.10.8이며 `ffmpeg`와 `ffprobe`가 없습니다. 따라서 Reel은 아직 활성화하지 않으며, Python/FFmpeg 검증과 비공개 Instagram 계정 E2E가 모두 통과한 뒤에만 rollout합니다.

실제 런타임이 읽는 환경 변수는 다음과 같습니다. 값은 `.env` 또는 배포 비밀 저장소에만 두고 문서에 기록하지 않습니다.

- 중앙 API: `SUPABASE_DATABASE_URL`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BRAND_ASSETS_BUCKET`, `WORKER_API_TOKEN`, `CRON_SECRET`, `LOCAL_SCHEDULER_ENABLED`, `SOURCE_CRAWL_BATCH_SIZE`, `SOURCE_CRAWL_DISCOVERY_LIMIT`, `SOURCE_CRAWL_TIME_BUDGET_MS`, `CREDENTIAL_ENCRYPTION_KEY`, `INSTAGRAM_PUBLISH_ENABLED`, `IMAGE_JOB_COOLDOWN_MS`, `META_GRAPH_VERSION`, `META_APP_ID`, `META_APP_SECRET`, `META_OAUTH_REDIRECT_URI`, `META_WEBHOOK_VERIFY_TOKEN`, `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_REDIRECT_URI`, `AUTH_FRONTEND_URL`, `BRAND_PILOT_DEV_BRAND_ID`, `PORT`, `HOST`, `NODE_ENV`, `VERCEL`
- 이미지 워커: `BRAND_PILOT_API_URL`, `WORKER_API_TOKEN`, `WORKER_ID`, `BLOB_READ_WRITE_TOKEN`, `IMAGE_PROVIDER`, `IMAGE_RENDER_COMMAND`, `IMAGE_MODEL`, `IMAGE_RETRY_DELAY_MS`, `POLL_INTERVAL_MS`, `HEARTBEAT_INTERVAL_MS`, `WORKER_CONTROL_PORT`, `PYTHON`, `CODEX_HOME`, `CODEX_COMMAND`, `APPDATA`, `NODE_ENV`
- DM 워커: `BRAND_PILOT_API_URL`, `WORKER_API_TOKEN`, `DM_WORKER_DATABASE_URL`, `WORKER_ID`, `POLL_INTERVAL_MS`, `DM_CLI_TIMEOUT_MS`, `DM_DIRECT_FAQ_MIN_SIMILARITY`, `DM_DIRECT_FAQ_MIN_MARGIN`, `KNOWLEDGE_CURATOR_TIMEOUT_MS`, `DM_PROFILE_REFRESH_AFTER_HOURS`, `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`

Rollout 기준은 Feed 활성 유지, Story capability 확인 후 활성화, Reel은 Python/FFmpeg와 비공개 계정 E2E 통과 후 활성화 순서입니다. 고객에게 Meta access token 입력을 요구하지 않으며, OAuth로 획득한 credential은 중앙 API가 암호화 저장합니다.

운영 서버 이전, 자격 증명 교체, 백업 및 출시 검증의 전체 순서는 [서버 이전 및 출시 체크리스트](docs/SERVER_MIGRATION_AND_LAUNCH_CHECKLIST.md)를 참고하세요.

## 이미지 워커 책임 경계

중앙 API는 Supabase 연결, 콘텐츠 상태, Meta OAuth 자격 증명, Instagram 발행, 산출물 검증을 소유합니다. 이미지 워커 PC는 중앙 API 호출, 이미지 렌더링, Blob 업로드만 담당합니다.

따라서 워커 PC에 `SUPABASE_DATABASE_URL`, `DATABASE_URL`, Supabase 키, Meta 자격 증명 또는 Instagram 액세스 토큰을 복사하지 마세요. 워커에는 중앙 API 주소·전용 토큰, 워커 식별자, Blob 쓰기 권한, 이미지 생성 명령과 모델 등 이미지 생성에 필요한 환경만 둡니다. 구체적인 전달·검증 절차는 [이미지 워커 설정](docs/IMAGE_WORKER_SETUP.md)에 있습니다.

## 주요 문서

- [관리형 콘텐츠 자동화 MVP](docs/specs/BRAND_PILOT_MANAGED_CONTENT_AUTOMATION_MVP.md)
- [데이터베이스 스키마 설계](docs/specs/BRAND_PILOT_DATABASE_SCHEMA_DESIGN.md)
- [공개 출시 전 필수 항목](docs/PRE_LAUNCH_REQUIRED.md)
- [서버 이전 및 출시 체크리스트](docs/SERVER_MIGRATION_AND_LAUNCH_CHECKLIST.md)
- [Vercel 중앙 API 배포](docs/VERCEL_CENTRAL_API_DEPLOYMENT.md)
- [이미지 워커 설정](docs/IMAGE_WORKER_SETUP.md)
- [이미지 워커 README](workers/brand-pilot-image-worker/README.md)
- [Instagram DM 자동응답 설계](docs/superpowers/specs/2026-07-14-instagram-dm-ai-auto-reply-design.md)
- [Instagram DM 운영 런북](docs/operations/instagram-dm-operations-runbook.md)

## 산출물과 백업

빌드 결과, 테스트 결과, 렌더링 이미지, 로그, 로컬 환경 파일 등 생성 파일은 루트 및 각 워크스페이스의 `.gitignore` 규칙으로 저장소 추적에서 제외합니다.

이 저장소는 데이터베이스 백업 파일을 자동으로 만들지 않습니다. 운영 데이터 보호와 복구는 Supabase의 백업 및 PITR(Point-in-Time Recovery) 정책으로 관리하고, 프로젝트 요금제와 보존 기간에 맞게 별도로 검증하세요. DB dump를 만들더라도 비밀값이나 운영 데이터가 저장소에 들어가지 않도록 하세요.
