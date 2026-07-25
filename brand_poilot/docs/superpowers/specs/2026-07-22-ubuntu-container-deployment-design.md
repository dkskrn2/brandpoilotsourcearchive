# Ubuntu 컨테이너 배포 설계

## 목표

Brand Pilot의 개발은 현재 Windows 작업공간에서 계속하고, 검증된 서버 구성만 Ubuntu 중앙 서버로 반복 배포한다. 고객 프론트는 Vercel에서 `apps/customer-ui`를 빌드하며, Ubuntu 서버는 중앙 API와 상시 DM/Wiki 워커만 실행한다. Supabase PostgreSQL과 외부 Object Storage는 이번 이관에서 유지한다.

## 결정한 방식

검토한 배포 방식은 다음 세 가지다.

1. 서버에서 저장소 전체를 pull하고 직접 빌드: 가장 단순하지만 서버가 프론트 소스와 개발 의존성까지 받고, 빌드 결과가 서버 환경에 좌우된다.
2. API와 워커 이미지를 개발 PC에서 직접 빌드해 복사: 초기에는 가능하지만 버전 추적과 반복 배포가 불편하다.
3. GitHub Actions가 이미지를 빌드해 GHCR에 게시하고 서버는 이미지만 pull: 서버가 소스를 빌드하지 않으며, 커밋 SHA로 배포와 롤백을 재현할 수 있다.

3번을 채택한다. 모노레포는 분리하지 않는다. Vercel은 프론트 경로만, 이미지 빌드 작업은 API와 DM/Wiki 워커 경로만 사용한다. Ubuntu에는 Git sparse checkout으로 `deploy/`만 내려받아 프론트와 서버 소스가 작업 디렉터리에 생기지 않게 한다.

## 1차 배포 범위

Ubuntu 중앙 서버에서 다음 컨테이너를 실행한다.

- `caddy`: 공개 80/443 포트를 받고 HTTPS를 종료한 뒤 API로 전달한다.
- `api`: 내부 4000 포트에서만 요청을 받는다. 처음에는 스케줄러와 Instagram 게시를 비활성화한다.
- `dm-worker-1`, `dm-worker-2`: 동일 이미지에 서로 다른 고정 `WORKER_ID`를 설정한다.
- `wiki-worker-1`: DM 워커 이미지의 wiki 모드로 실행한다.

이미지·영상, 카드뉴스, 블로그, 마케팅 등 생성 워커는 별도 생성 PC에 유지한다. PostgreSQL 컨테이너도 운영 Compose에 포함하지 않는다.

## 저장소와 이미지 흐름

`main` 또는 명시적으로 선택한 배포 브랜치의 커밋이 GitHub Actions에 전달되면 다음을 수행한다.

1. API 테스트와 빌드를 실행한다.
2. DM/Wiki 워커 테스트와 빌드를 실행한다.
3. 멀티 스테이지 Dockerfile로 런타임 이미지를 만든다.
4. GHCR에 커밋 SHA 태그로 게시한다.
5. 기본 브랜치의 성공 빌드에는 `stable` 태그도 추가한다.

Ubuntu 배포는 `IMAGE_TAG`를 특정 SHA로 지정한 뒤 `docker compose pull`과 `docker compose up -d`를 실행한다. 배포 스크립트는 이전 SHA를 로컬 상태 파일에 보관한다. 롤백 스크립트는 그 SHA로 Compose를 다시 올린다. `latest`에만 의존하지 않는다.

## 파일 경계

- 루트 `.dockerignore`: Git 정보, 환경변수, 테스트 산출물, 프론트 빌드 산출물과 로컬 임시 파일이 이미지 컨텍스트에 들어가지 않게 한다.
- `apps/api/Dockerfile`: npm lockfile 기반으로 API를 빌드하고 비-root 사용자로 `dist/index.js`를 실행한다.
- `workers/brand-pilot-dm-worker/Dockerfile`: 워커를 실행 가능한 JavaScript로 빌드하고 Codex CLI를 포함한다.
- `deploy/compose.production.yml`: 네트워크, 서비스 수, healthcheck, 재시작과 로그 제한을 정의한다.
- `deploy/Caddyfile`: `${API_HOST}`의 HTTPS와 API reverse proxy만 담당한다.
- `deploy/env/*.example`: API와 워커별로 필요한 환경변수 이름만 제공하며 실제 값은 포함하지 않는다.
- `deploy/scripts/bootstrap-ubuntu.sh`: Docker 설치 여부, 디렉터리, sparse checkout과 파일 권한을 준비한다.
- `deploy/scripts/deploy.sh`: 선택 SHA의 이미지를 pull하고 API health를 확인한 후 선택한 워커를 올린다.
- `deploy/scripts/rollback.sh`: 마지막 정상 SHA로 되돌린다.
- `.github/workflows/publish-server-images.yml`: 테스트, 빌드, GHCR 게시를 담당한다.

## 런타임과 비밀값

실제 환경변수는 `/opt/brand-pilot/shared/env/`에 다음처럼 분리한다.

- `api.env`: Supabase, OAuth, webhook, 암호화 키, 관리자·worker 토큰, 스케줄러 설정
- `dm-worker-1.env`, `dm-worker-2.env`: API URL, worker 토큰, 제한된 DB URL, OpenAI embedding 값과 고유 ID
- `wiki-worker-1.env`: wiki 모드 값, API URL, worker 토큰, 제한된 DB URL과 고유 ID

파일 권한은 배포 계정만 읽을 수 있는 `0600`으로 둔다. Compose와 Git에는 실제 값이 들어가지 않는다. Codex CLI 인증은 `/opt/brand-pilot/shared/codex/`에 별도로 두고 워커 컨테이너에 읽기 전용으로 마운트한다. 워커 이미지나 로그에 인증 파일 내용을 복사하지 않는다.

## 네트워크와 웹 보안

Caddy만 호스트의 80/443 포트를 연다. API의 4000 포트와 데이터베이스 포트는 공개하지 않는다. API 컨테이너는 Caddy와 worker가 공유하는 내부 Docker 네트워크에 연결한다.

현재 Vercel 여부로 결정되는 쿠키 보안은 배포 플랫폼과 분리한다. `COOKIE_SECURE=true`이면 세션과 OAuth state 쿠키에 `Secure`를 붙이고 운영 cross-site 프론트에 맞는 SameSite 정책을 사용한다. 기존 Vercel 동작은 유지한다. CORS는 새 `CORS_ALLOWED_ORIGINS` 목록을 사용해 운영 프론트 origin만 허용하며, 로컬 개발에서는 기존 동작을 보존한다.

API는 컨테이너에서 `0.0.0.0`에 바인딩하도록 `HOST=0.0.0.0`을 설정한다. Caddy는 API health가 정상인 경우에만 외부 요청을 전달한다. OAuth callback 주소는 모두 `https://${API_HOST}` 기준으로 각 공급자 콘솔과 일치시킨다.

## 시작과 중복 방지

첫 배포에서는 `LOCAL_SCHEDULER_ENABLED=false`, `INSTAGRAM_PUBLISH_ENABLED=false`로 API만 시작한다. 내부와 외부 `/health`가 정상이고 DB 연결, 로그인, OAuth 복호화, 읽기 요청을 확인한 뒤 기존 워커를 중지한다. 기존 heartbeat와 lease가 만료된 것을 확인한 후 새 DM 워커를 하나씩 올리고 마지막에 Wiki 워커를 올린다.

스케줄러는 기존 Vercel Cron 또는 구 서버 실행이 중지된 것을 확인한 뒤 API 한 개에서만 활성화한다. Instagram 게시 역시 테스트 계정으로 중복 claim이 없음을 확인한 후 활성화한다.

## 장애 처리와 관찰성

API healthcheck는 `/health` 응답과 DB 상태를 검사한다. API와 워커는 `restart: unless-stopped`를 사용하며 Docker JSON 로그는 파일 크기와 개수를 제한한다. 워커의 실제 정상성은 프로세스 생존뿐 아니라 API에 기록되는 heartbeat와 큐 oldest age로 판단한다.

배포가 실패하면 새 컨테이너를 계속 재시작하지 않고 이전 SHA로 롤백한다. OAuth 지속 실패, credential 복호화 실패, DM·게시 중복, 5분 이상 API 중단은 즉시 롤백 조건이다. Supabase와 Blob을 유지하므로 롤백은 실행 위치와 이미지 버전만 되돌린다.

## 검증 기준

구현은 다음 검사를 통과해야 한다.

- API 및 DM/Wiki 워커의 기존 단위 테스트와 타입 검사
- Docker 이미지 빌드
- `docker compose config`를 통한 환경변수와 서비스 정의 검증
- 컨테이너 API `/health` 응답과 DB 상태 확인
- HTTPS 쿠키 설정 및 허용·비허용 CORS origin 회귀 테스트
- 배포·롤백 스크립트의 `shellcheck`
- 시크릿 문자열이 이미지 레이어, Compose 렌더링 결과와 Git diff에 포함되지 않았는지 확인

## 이번 작업에서 제외하는 항목

- Supabase PostgreSQL을 로컬 PostgreSQL로 이전
- Vercel 프론트를 Ubuntu에서 정적 호스팅
- 이미지·영상·카드뉴스·블로그·마케팅 생성 워커의 컨테이너화
- Kubernetes, Swarm, 무중단 다중 API 배포
- 자동 운영 배포 승인과 상시 self-hosted GitHub Actions runner

이 항목들은 1차 운영 안정화 후 별도 설계로 다룬다.
