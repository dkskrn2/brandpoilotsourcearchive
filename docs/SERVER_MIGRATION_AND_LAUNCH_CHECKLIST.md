# Brand Pilot 서버 마이그레이션 및 출시 체크리스트

이 체크리스트는 Brand Pilot을 현재 로컬 개발 환경에서 공개 서비스로 전환하는 절차를 다룬다. `공개 출시 전 필수 항목`을 모두 완료하기 전에는 고객 UI를 공개하지 않는다.

## 현재 상태

- Supabase를 중앙 PostgreSQL 데이터베이스로 사용한다.
- Vercel은 현재 중앙 API와 정적 정책·서비스 페이지를 호스팅한다.
- Vercel Blob은 공개 생성 Instagram PNG 파일과 매니페스트를 저장한다.
- 콘텐츠 생성, DM, Wiki, AI 카드뉴스, AI 블로그, AI 마케팅 작업은 각각의 워커 프로세스로 분리되어 있다.
- Kakao 테스트 앱 로그인 코드, 세션 저장, 최초 워크스페이스 생성, 로그인 페이지가 구현되어 있다.
- `db/migrations/007_kakao_auth.sql`을 포함한 각 마이그레이션의 적용 여부는 대상 데이터베이스의 적용 이력과 실제 스키마를 확인하여 판단한다.
- Instagram 외 채널은 OAuth와 게시 어댑터가 실제로 연결된 채널만 활성화한다.

## 로컬 중앙 서버 1차 이관 기준

1차 이관에서는 장애 범위를 줄이기 위해 **중앙 API와 일부 상시 워커만 로컬 서버로 옮긴다.** 데이터베이스와 Object Storage를 동시에 옮기지 않는다.

| 위치 | 구성 요소 | 초기 실행 수 | 비고 |
| --- | --- | ---: | --- |
| 로컬 중앙 서버 | 중앙 API | 1 | 인증, OAuth callback, Webhook, 큐, 게시, 관리자 API |
| 로컬 중앙 서버 | API 내부 로컬 스케줄러 | 1 | 현재 구현 기준. `LOCAL_SCHEDULER_ENABLED=true`인 API는 정확히 하나만 실행 |
| 로컬 중앙 서버 | DM 워커 | 2 | 서로 다른 `WORKER_ID`, 동일 공용 큐 사용 |
| 로컬 중앙 서버 | Wiki 워커 | 1 | 저우선순위 또는 야간 실행 |
| 별도 생성 PC | 자동 운영 콘텐츠 워커 | 1 | 이미지·영상 생성과 Blob 업로드 |
| 별도 생성 PC | 카드뉴스·블로그·마케팅 워커 | 유형별 0~1 | 요청이 있을 때 실행. 콘텐츠 lease를 공유 |
| 외부 유지 | Supabase PostgreSQL | 1 | 1차 이관 중 DB 이동 금지 |
| 외부 유지 | Vercel Blob/Object Storage | 1 | 생성 결과물 장기 저장, 로컬 임시 파일은 성공 후 삭제 |
| 외부 유지 | 고객·관리자 프론트 | 1 배포 | 공개 API URL만 로컬 중앙 API 주소로 변경 |

`I5 8세대`, RAM 16GB, SSD 1TB 서버는 트래픽이 낮은 초기 운영에서 위 구성을 실행할 수 있다. 다만 콘텐츠 이미지·영상 생성 워커는 별도 PC에 유지하고, 중앙 서버의 Codex CLI 전체 동시 실행은 `WORKER_CODEX_MAX_CONCURRENCY=2`, DM 예약 슬롯은 `WORKER_CODEX_DM_RESERVED_SLOTS=1`로 제한한다.

현재 루트 `docker-compose.yml`은 개발용 PostgreSQL 하나만 실행하며 개발 비밀번호를 사용한다. **중앙 API와 워커의 운영 배포 정의가 아니므로 그대로 운영 서버에 사용하지 않는다.** 컨테이너 이관을 선택할 경우 API·워커별 Dockerfile, healthcheck, 비밀값 주입, 로그·재시작 정책을 별도로 완성한 뒤 사용한다.

## 이관 전 결정 사항

- [ ] 공개 API 주소를 확정한다. 기존 API 도메인을 유지하고 DNS 대상만 로컬 서버로 바꾸는 방식이 OAuth 변경량이 가장 적다.
- [ ] 고정 공인 IP, DDNS 또는 outbound tunnel 중 공개 진입 방식을 하나로 정한다.
- [ ] HTTPS 종료 지점을 정한다. 외부에는 `443`만 열고 내부 API 포트 `4000`과 DB 포트는 공개하지 않는다.
- [ ] 프론트는 Vercel에 유지할지 같은 서버로 옮길지 확정한다. 1차 권장은 Vercel 유지다.
- [ ] Supabase와 Blob을 1차 이관에서 유지한다. 로컬 PostgreSQL 전환은 별도 이관 작업으로 분리한다.
- [ ] 이관 시간, 작업자, 롤백 결정자와 최대 허용 중단 시간을 정한다.

## 네트워크·도메인 확인

- [ ] 로컬 서버의 DHCP 주소를 고정하고 절전·최대 절전·자동 종료를 해제한다.
- [ ] 공유기에서 API 서버로 필요한 트래픽만 전달한다. RDP와 PostgreSQL은 인터넷에 직접 노출하지 않는다.
- [ ] Caddy, Nginx 또는 관리형 tunnel 중 하나로 HTTPS를 제공하고 인증서 자동 갱신을 확인한다.
- [ ] `GET /health`와 Meta Webhook 검증 경로를 외부 LTE 네트워크에서도 호출할 수 있는지 확인한다.
- [ ] 고객 UI의 API URL과 CORS 허용 origin을 실제 HTTPS 주소로 맞춘다.
- [ ] 쿠키 기반 로그인에서는 `localhost`, `127.0.0.1`, 운영 도메인을 혼용하지 않는다.
- [ ] Meta Webhook callback, Meta OAuth redirect, Meta Trends OAuth redirect, Kakao redirect URI를 실제 공개 API 주소와 정확히 일치시킨다.
- [ ] DNS 변경 전 TTL을 낮추고, 이관 완료 후 정상 값으로 되돌린다.

필수 공개 callback 예시:

```text
https://<api-host>/auth/kakao/callback
https://<api-host>/auth/meta/callback
https://<api-host>/auth/meta/trends/callback
https://<api-host>/<instagram-webhook-path>
```

실제 경로는 배포된 라우트와 개발자 콘솔 값을 대조한다. 예시를 그대로 등록하지 않는다.

## 환경변수 이관 원칙

환경변수 파일 하나를 모든 프로세스가 공유하지 않는다. 중앙 API, DM/Wiki 워커, 콘텐츠 생성 워커는 각 프로세스가 필요한 값만 가진다.

### 중앙 API

- DB·Storage: `SUPABASE_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, 버킷 설정
- 내부 인증: `WORKER_API_TOKEN`, `ADMIN_SERVICE_TOKEN`, `CRON_SECRET`
- 암호화: `CREDENTIAL_ENCRYPTION_KEY`
- OAuth·Webhook: Meta, Kakao 앱 ID·secret·redirect·verify token
- 공개 연결: `AUTH_FRONTEND_URL`, CORS와 artifact origin
- 스케줄러: `LOCAL_SCHEDULER_ENABLED`, 크롤링·성과·생성 제한

### DM·Wiki 워커

- `BRAND_PILOT_API_URL`, `WORKER_API_TOKEN`, 고유 `WORKER_ID`
- Wiki 검색에 필요한 제한된 DB URL과 embedding 설정
- Codex CLI 모델·timeout·poll·heartbeat 설정
- Meta access token, Meta app secret, Supabase service role key는 두지 않는다.

### 콘텐츠 생성 워커

- `BRAND_PILOT_API_URL`, `WORKER_API_TOKEN`, 고유 `WORKER_ID`
- Blob 쓰기 토큰, Codex·이미지 모델, Python·FFmpeg 경로
- DB URL, Meta credential, Kakao secret는 두지 않는다.

확인 절차:

- [ ] 기존 Vercel과 각 PC의 환경변수 **이름 목록**을 내보내되 값은 문서나 채팅에 기록하지 않는다.
- [ ] `apps/api/.env.example`과 각 워커 `.env.example`을 기준으로 누락·중복을 비교한다.
- [ ] `WORKER_API_TOKEN`, callback URL, 암호화 키가 필요한 프로세스에서만 일치하는지 확인한다.
- [ ] `CREDENTIAL_ENCRYPTION_KEY`는 기존 채널 credential을 복호화해야 하므로 임의로 재생성하지 않는다.
- [ ] 이관 후 교체할 secret와 유지할 암호화 키를 구분한다.
- [ ] `.env` ACL을 서버 실행 계정과 관리자만 읽을 수 있게 설정하고 Git·백업 로그에서 제외한다.
- [ ] API와 워커를 시작하기 전에 `npm run env:check`를 실행한다.

## 프로세스 운영 기준

- [ ] 개발용 `npm run dev` 대신 빌드 결과와 운영 실행 명령을 사용한다.
- [ ] 중앙 API, DM 워커 2개, Wiki 워커를 각각 독립 서비스로 등록한다.
- [ ] 모든 서비스에 부팅 후 자동 시작, 비정상 종료 재시작, 최대 재시작 횟수와 지연을 설정한다.
- [ ] 각 워커 `WORKER_ID`가 서버와 프로세스마다 유일한지 확인한다.
- [ ] stdout·stderr 로그를 파일 또는 수집기로 보내고 일별 rotation과 보존 기간을 설정한다.
- [ ] Windows Update 후 자동 재부팅 시간을 정하고 서비스 자동 복구를 실제로 시험한다.
- [ ] SSD 여유 공간 20% 미만, RAM 지속 85% 이상, CPU 지속 90% 이상을 경고 조건으로 둔다.
- [ ] 로컬 생성 임시 파일은 Blob 업로드와 manifest 반영 성공 후 삭제한다.
- [ ] 바이러스 검사·인덱싱이 워커 임시 폴더와 `node_modules`를 장시간 잠그지 않는지 확인한다.

## 중복 실행 방지

이관에서 가장 위험한 오류는 구 서버와 신 서버가 동시에 같은 큐를 처리하는 것이다.

- [ ] 새 API는 처음에 `LOCAL_SCHEDULER_ENABLED=false`, `INSTAGRAM_PUBLISH_ENABLED=false`로 시작한다.
- [ ] 새 서버 health, DB 연결, OAuth 복호화, 읽기 API를 먼저 확인한다.
- [ ] 기존 워커를 중지한 뒤 heartbeat가 stale로 바뀌고 lease가 만료된 것을 확인한다.
- [ ] 새 워커를 한 종류씩 시작하고 고유 `WORKER_ID`로 heartbeat가 기록되는지 확인한다.
- [ ] 기존 Vercel Cron 또는 구 서버 스케줄러가 더 이상 실행되지 않는 것을 확인한 뒤 새 API 한 곳만 스케줄러를 활성화한다.
- [ ] Instagram 게시 활성화는 큐 중복 claim과 예약 시간 검증 후 마지막에 켠다.
- [ ] 같은 DB를 사용하는 모든 서버에서 `worker_resource_leases`와 작업 claim이 단일 실행을 보장하는지 확인한다.

## 권장 이관 순서

1. 현재 Vercel API, Supabase, Blob, 워커의 정상 기준과 큐 건수를 기록한다.
2. DB 백업과 환경변수 이름 목록을 확보한다.
3. 로컬 서버에 Node.js, Git, Codex CLI와 필요한 런타임을 설치한다.
4. 저장소를 배포 전용 경로에 checkout하고 lockfile 기준으로 설치·빌드·테스트한다.
5. 중앙 API를 스케줄러·게시 비활성 상태로 시작한다.
6. 내부 URL과 공개 HTTPS URL에서 health, 로그인, 관리자 조회를 확인한다.
7. Meta·Kakao developer console의 callback을 새 공개 API로 변경하고 OAuth를 다시 연결한다.
8. 고객 UI의 API URL을 새 주소로 변경한다.
9. DM 워커 1개를 시작해 수신→검색→답변→발송 한 사이클을 시험한 뒤 두 번째 DM 워커를 시작한다.
10. Wiki 워커를 시작해 고객 한 곳의 Wiki 재생성과 검색 회귀를 확인한다.
11. 별도 생성 PC의 API URL·worker token을 변경하고 콘텐츠 생성 한 건을 완료한다.
12. 구 스케줄러와 Cron을 중지한 뒤 새 스케줄러를 활성화한다.
13. 예약 게시 한 건을 테스트 계정으로 실행한 뒤 Instagram 게시를 활성화한다.
14. 24시간 동안 큐 지연, worker heartbeat, 실패율, 디스크·메모리와 callback 오류를 집중 관찰한다.

## 기능별 이관 스모크 테스트

- [ ] Kakao 신규 로그인, 재로그인, 로그아웃과 세션 유지
- [ ] Meta OAuth 연결과 credential 복호화
- [ ] Instagram DM Webhook 수신, FAQ 직접 응답, Wiki 응답, fallback, 수동 응답
- [ ] 자사 URL 크롤링, source snapshot 저장, Wiki 반영
- [ ] 자동 운영 콘텐츠 생성과 검토·자동 승인 정책
- [ ] Instagram Feed, Story, Reel 테스트 계정 게시
- [ ] `share_to_feed=true` Reel 게시 결과
- [ ] 예약 게시, 실패 재시도, 취소와 중복 방지
- [ ] Instagram 해시태그 트렌드 검색
- [ ] 매일 03:00 KST 성과 수집 또는 수동 1회 실행
- [ ] AI 카드뉴스·블로그·마케팅 생성과 다운로드
- [ ] 고객 UI와 관리자 UI에서 API 오류·로그아웃 오판이 없는지 확인
- [ ] 서비스 토큰, access token, DB URL이 브라우저 응답과 로그에 없는지 확인

## 모니터링·백업

- [ ] API health를 외부 모니터가 1분 간격으로 확인한다.
- [ ] DM 수신부터 답변까지 시간, 큐 oldest age, 워커 heartbeat, stale lease를 수집한다.
- [ ] 게시 성공률, 중복 게시, OAuth 만료·권한 오류를 알림 대상으로 둔다.
- [ ] CPU, RAM, SSD 사용량, 네트워크 끊김과 프로세스 재시작 횟수를 기록한다.
- [ ] Supabase 자동 백업 정책과 복구 가능 시점을 확인하고 월 1회 복구 연습을 한다.
- [ ] 서버의 코드·설정 백업과 별도로 암호화된 환경변수 백업을 오프사이트에 보관한다.
- [ ] 정전 대비 UPS 또는 정상 종료 정책을 준비한다.

## 롤백 기준과 절차

다음 중 하나면 즉시 롤백한다: OAuth callback 지속 실패, DM 또는 게시 중복, DB 연결 불안정, 큐 claim 중복, 5분 이상 API 중단, credential 복호화 실패.

1. 로컬 스케줄러와 모든 로컬 워커를 중지한다.
2. 고객 UI API URL과 DNS를 기존 Vercel API로 되돌린다.
3. Meta·Kakao callback을 기존 주소로 복원한다.
4. 기존 API health와 OAuth state 저장소를 확인한 뒤 기존 워커를 순차 재시작한다.
5. 중단 시점의 `publishing`, `failed`, stale lease와 처리 중 DM을 점검한다.
6. 같은 작업을 임의로 재실행하지 말고 idempotency·외부 게시 결과를 먼저 확인한다.

Supabase와 Blob을 1차 이관에서 유지하면 데이터 롤백 없이 실행 위치만 되돌릴 수 있다.

## PostgreSQL도 로컬로 옮길 경우

DB 이관은 중앙 API 이관과 같은 날 진행하지 않는다.

- [ ] PostgreSQL 버전과 필요한 extension을 운영 Supabase와 맞춘다.
- [ ] `pg_dump`/`pg_restore` 리허설에서 행 수, 제약, 인덱스, migration history를 비교한다.
- [ ] 쓰기 중단 시간을 정하고 최종 dump 이후 API와 워커가 구 DB에 쓰지 못하게 한다.
- [ ] DB는 loopback 또는 사설망에서만 열고 인터넷에 `5432`를 노출하지 않는다.
- [ ] 매일 암호화 전체 백업과 더 짧은 주기의 WAL/PITR 대안을 외부 저장소에 보관한다.
- [ ] 디스크 장애와 서버 전체 손실을 가정해 다른 PC에서 복구한다.
- [ ] 로컬 DB 장애가 API·DM·게시 전체 장애가 된다는 점을 수용할 수 있을 때만 전환한다.

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
