# Brand Pilot 서버 마이그레이션 및 출시 체크리스트

이 체크리스트는 Brand Pilot을 현재 로컬 개발 환경에서 공개 서비스로 전환하는 절차를 다룬다. `공개 출시 전 필수 항목`을 모두 완료하기 전에는 고객 UI를 공개하지 않는다.

## 현재 상태

- Supabase를 중앙 PostgreSQL 데이터베이스로 사용한다.
- Vercel은 중앙 API와 정적 정책·서비스 페이지를 호스팅한다.
- Vercel Blob은 공개 생성 Instagram PNG 파일과 매니페스트를 저장한다.
- 별도의 Windows PC에서 Codex 이미지 워커를 실행한다.
- Kakao 테스트 앱 로그인 코드, 세션 저장, 최초 워크스페이스 생성, 로그인 페이지가 구현되어 있다.
- `db/migrations/007_kakao_auth.sql`을 포함한 각 마이그레이션의 적용 여부는 대상 데이터베이스의 적용 이력과 실제 스키마를 확인하여 판단한다.
- Threads 게시는 구현되지 않았다. 준비되기 전에는 사용 가능한 게시 채널로 표시하지 않는다.

## 공개 출시 전 필수 항목

| 담당 | 항목 | 완료 증빙 |
| --- | --- | --- |
| Codex | `docs/PRE_LAUNCH_REQUIRED.md`의 남은 코드 수정 사항을 적용한다: SSRF 방어 크롤러 입력 검증, 요청·응답 제한, 속도 제한, 운영 Meta OAuth 콜백, 예약 게시 실행기, Threads 게시 상태 처리. | 테스트와 운영 스모크 검사가 통과한다. |
| 사용자 | 운영 Supabase의 적용 이력과 실제 스키마를 먼저 확인한 뒤, 아직 적용되지 않은 마이그레이션만 파일명 순서대로 각 1회 적용한다. | 적용 전후 이력과 승인 기록이 남아 있고 스키마 스모크 검사가 통과한다. |
| 사용자 | `apps/api`를 배포하는 Vercel 프로젝트에 운영 API 환경 변수를 설정한다. 정적 `main` 프로젝트나 프런트엔드 Vite 변수에는 비밀 값을 넣지 않는다. | Vercel 배포가 성공하고 `/health`의 데이터베이스 상태가 `ok`이다. |
| 사용자 | Kakao 운영 앱을 설정하고 비즈니스·개인정보 검수를 완료한 뒤 운영 콜백 URL을 등록하고 테스트 앱 REST 키를 원본 앱 키로 교체한다. | 관리자가 아닌 공개 Kakao 계정이 가입하고 온보딩에 진입할 수 있다. |
| 사용자 | 법적 페이지에 실제 운영자명, 개인정보 연락처, 보유 기간, 데이터 삭제 연락처와 절차가 포함되어 있는지 확인한다. | 서비스 운영자가 공개 페이지를 검토한다. |
| 사용자 | API와 고객 UI 도메인의 DNS와 HTTPS를 설정한다. | 브라우저의 TLS가 유효하고 워커 PC가 HTTPS로 API 상태 엔드포인트에 접근한다. |
| 사용자 | `workers/brand-pilot-image-worker/SETUP_OTHER_PC.md`에 따라 운영 워커 PC와 로컬 자격증명을 설정한다. | 워커가 운영 외 큐 항목 하나를 가져와 렌더링하고 Blob 자산 업로드까지 완료한다. |
| 사용자 | 데이터베이스 백업, 비밀 값 교체 책임자, 운영 장애 연락처를 정한다. | 책임자와 연락처가 문서화되어 있고 복구 테스트 기록이 있다. |

## 운영 API 환경 변수

다음 값은 정적 마케팅 사이트 프로젝트가 아니라 `apps/api`를 배포하는 Vercel 프로젝트에 설정한다.

```env
NODE_ENV=production
SUPABASE_DATABASE_URL=postgresql://...
CREDENTIAL_ENCRYPTION_KEY=<unique-long-secret>
WORKER_API_TOKEN=<unique-long-secret>

KAKAO_REST_API_KEY=<original-kakao-app-rest-key>
KAKAO_CLIENT_SECRET=<only-if-enabled-in-kakao>
KAKAO_REDIRECT_URI=https://api.example.com/auth/kakao/callback
AUTH_FRONTEND_URL=https://app.example.com


INSTAGRAM_PUBLISH_ENABLED=true
META_GRAPH_VERSION=v23.0
```

규칙:

- OAuth 자격증명을 저장한 뒤에는 `CREDENTIAL_ENCRYPTION_KEY`를 변경하지 않는다. 변경하면 기존의 암호화된 채널 자격증명을 읽을 수 없다.
- `WORKER_API_TOKEN`은 API와 워커 PC에서 정확히 일치해야 한다.
- 중앙 API에 `BLOB_READ_WRITE_TOKEN`을 설정하지 않는다. 이 값은 워커 PC에만 둔다.
- 위 환경 변수를 `VITE_*`, 브라우저 코드, Git, 스크린샷, 채팅에 노출하지 않는다.
- 로컬 Kakao 테스트에서는 프런트엔드, API 기본 URL, 등록된 콜백 URI에 `localhost`를 일관되게 사용한다. 브라우저 쿠키는 서로 다른 호스트로 처리하므로 `localhost`와 `127.0.0.1`을 혼용하지 않는다.

## 데이터베이스 마이그레이션 절차

### 공통 원칙

- SQL을 실행하기 전에 대상 데이터베이스의 마이그레이션 적용 이력과 실제 스키마를 함께 확인한다.
- 기존 데이터베이스에는 아직 적용되지 않은 파일만 파일명 순서대로 각 1회 적용한다. 이미 적용된 파일은 다시 실행하지 않는다.
- `007_kakao_auth.sql`도 별도로 무조건 실행하지 않는다. 적용 이력과 스키마 확인 결과 누락된 경우에만 다른 누락 파일과 함께 파일명 순서대로 1회 적용한다.

### 신규 빈 로컬 DB

1. Docker Desktop을 시작하고 신규 빈 로컬 데이터베이스인지 확인한다.
2. `db/README.md`의 신규 로컬 DB 적용 절차에 따라 `001_initial_schema.sql`부터 `011_add_social_channels.sql`까지 전체 파일을 파일명 순서대로 각 1회 적용한다.
3. `db/smoke/001_schema_smoke.sql`로 스키마를 확인한다.

### 기존 로컬 DB 또는 운영 Supabase

1. 마이그레이션 적용 이력, SQL 실행 기록, 현재 테이블·열·제약 조건을 먼저 확인한다.
2. 확인 결과를 기준으로 아직 적용되지 않은 파일 목록을 만든다.
3. 누락된 파일만 파일명 순서대로 각 1회 적용한다.
4. 운영 Supabase에서 누락 목록에 `010_remove_webflow.sql`이 포함되면 아래 파괴적 마이그레이션 승인 절차를 모두 완료한 뒤 적용한다.
5. 적용 후 이력과 실제 스키마를 다시 확인하고 스키마 스모크 검사를 실행한다.
6. `007_kakao_auth.sql`이 이번 누락분에 포함된 경우 `user_identities`, `user_sessions`가 존재하고 `app_users.email`이 `NULL`을 허용하는지 확인한 뒤 배포 환경에서 Kakao 로그인을 테스트한다.

### `010_remove_webflow.sql` 운영 적용 승인 절차

`010_remove_webflow.sql`은 게시 데이터, 자격증명 데이터, Webflow 관련 데이터를 삭제하고 관련 테이블과 열을 제거하는 파괴적 마이그레이션이다. 운영 Supabase에 적용하기 전에 다음 조건을 모두 충족해야 한다.

1. Supabase 백업 또는 PITR(Point-in-Time Recovery) 사용 가능 여부와 복구 시점을 확인한다.
2. 삭제될 데이터와 제거될 테이블·열을 검토하고 보존이 필요한 데이터를 별도로 백업한다.
3. 서비스 운영 책임자의 명시적 운영 승인을 기록한다.
4. 실패 또는 롤백이 필요한 경우의 복구 절차와 담당자를 확인한다.

## Kakao 출시 절차

### Codex 구현 동작

- `GET /auth/kakao/login`은 OAuth 상태 쿠키를 만들고 Kakao로 리디렉션한다.
- `GET /auth/kakao/callback`은 서버에서 인증 코드를 교환하고 Kakao 사용자 ID를 조회하며, 최초 로그인 시 사용자·워크스페이스·브랜드를 생성한다.
- `GET /auth/me`는 현재 사용자, 워크스페이스, 활성 브랜드를 반환한다.
- `POST /auth/logout`은 서버 측 세션을 폐기한다.
- 고객 UI는 `/login`을 사용하며, 로그인 후 개발용 브랜드 ID 대신 새로 생성된 활성 브랜드를 사용한다.

### 사용자 설정

1. 로컬 테스트용으로 테스트 앱을 유지하고, 테스트할 모든 Kakao 계정을 테스트 앱 멤버로 추가한다.
2. 운영용 원본 Kakao 앱을 별도로 설정한다. 테스트 앱의 설정과 키는 자동으로 이전되지 않는다.
3. 원본 REST API 키 설정에 정확한 운영 콜백 URI를 등록한다.
4. Kakao 로그인을 활성화하고 동의 항목과 서비스 약관을 설정한 뒤, 검수 승인 후 Kakao Sync 간편 가입을 활성화한다.
5. 신규 계정, 재로그인, 선택 동의 거부, 로그아웃, 이메일 주소가 없는 사용자를 테스트한다.

## 워커 PC 출시 절차

워커 PC에는 워커 폴더, Node.js, Codex CLI 로그인, `WORKER_API_TOKEN`, `BLOB_READ_WRITE_TOKEN`, 공개 API URL만 필요하다. Supabase, Meta, Kakao, OpenAI API 자격증명은 전달하지 않는다.

1. `.env`, `node_modules`, 생성 결과물을 제외하고 `workers/brand-pilot-image-worker`를 복사한다.
2. `workers/brand-pilot-image-worker/SETUP_OTHER_PC.md`를 따른다.
3. `npm install`, `npm run build`, `npm test`를 실행한다.
4. 로컬 워커 컨트롤러를 실행하고 API 상태를 확인한다.
5. 제어된 Instagram 큐 항목 하나를 가져오기부터 Blob 업로드까지 처리한다. 매니페스트에 제목, 캡션, 최대 5개의 해시태그, 슬라이드, PNG URL이 포함되었는지 확인한다.
6. 이 검증을 마친 뒤에만 운영 자동 게시를 활성화한다.

## 공개 출시 스모크 테스트

1. 시크릿 창에서 공개 로그인 페이지를 연다.
2. 관리자가 아닌 Kakao 계정으로 가입한다.
3. 새 워크스페이스와 `내 브랜드`가 나타나는지 확인하고 브랜드 설정에서 이름을 변경한다.
4. 소스 하나를 추가해 크롤링하고, 콘텐츠가 다른 사용자 워크스페이스와 격리되는지 확인한다.
5. 워커 PC에서 이미지 작업 하나를 실행하고 공개 Blob 매니페스트를 확인한다.
6. 지정된 테스트 Instagram 계정에만 게시한다.
7. 로그아웃 후 접근 권한이 제거되고 세션 없는 직접 API 호출이 `401`을 반환하는지 확인한다.
8. 공개 도메인에서 개인정보 처리방침, 이용약관, 데이터 삭제 엔드포인트, 고객지원 연락처 URL을 확인한다.

## 잊지 말아야 할 보류 항목

- 상태 검증, PKCE, 사용자 세션 연결을 포함한 운영 Meta OAuth 콜백. 현재 Meta 개발 콜백은 공개 서비스에서 사용하지 않는다.
- `scheduled_for` 시각이 된 행을 처리하는 내구성 있는 예약 게시 서비스.
- Threads 게시 기능. 구현 전까지는 UI와 상태에서 명확히 비활성화한다.
- 크롤러 SSRF 방어, 페이로드 제한, 속도 제한, 악용 모니터링.
- 현재의 허용적인 Supabase TLS 대체 동작 대신 검증된 CA를 사용하는 데이터베이스 TLS.
- 나중에 여러 워크스페이스나 브랜드를 소유하는 사용자를 위한 워크스페이스·브랜드 전환 UI.
