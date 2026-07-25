# 저장소 워크스페이스 정리 설계

## 목표

Brand Pilot의 기존 세 애플리케이션 구조는 유지하면서, 저장소 루트에서 전체 구성과 실행 방법을 쉽게 이해하고 관리할 수 있게 한다. 운영 데이터베이스는 Supabase PostgreSQL을 기본으로 사용한다.

## 현재 상태

- `apps/api`, `apps/customer-ui`, `workers/brand-pilot-image-worker`가 각각 별도 npm 프로젝트와 잠금 파일을 사용한다.
- 루트에 `README.md`와 `package.json`이 없다.
- API의 `build` 명령은 타입 검사만 하지만 `start` 명령은 `dist/index.js`가 있다고 가정한다.
- API는 `DATABASE_URL`보다 `SUPABASE_DATABASE_URL`을 우선 사용하며, Docker PostgreSQL은 개발 환경의 예비 연결 대상이다.
- 마이그레이션 파일에 `002`와 `007` 접두사가 중복된다.
- 실행 로그, 생성 이미지, Playwright 결과, Vercel 로컬 상태와 Supabase 이전 전 데이터베이스 덤프가 저장소 안에 있다.

## 구조

기존 애플리케이션 경계를 유지하고 루트에 얇은 npm 워크스페이스 계층을 추가한다. 루트 워크스페이스가 의존성 설치, 단일 잠금 파일과 통합 명령을 관리한다. 각 애플리케이션은 런타임 설정과 애플리케이션별 명령을 계속 소유한다.

중앙 API는 계속 Vercel에 배포할 수 있어야 한다. 일반 Node.js 실행을 위해 `tsup`으로 `src/index.ts`와 내부 모듈을 `dist/index.js`로 묶는다. `npm start`는 이 결과물을 실행하고 타입 검사는 빌드 전에 별도 명령으로 수행한다.

Supabase PostgreSQL을 문서상 기본 데이터베이스로 지정한다. 연결 주소 우선순위는 `SUPABASE_DATABASE_URL`, `DATABASE_URL`, 비운영 환경의 로컬 Docker PostgreSQL 순서로 유지한다.

## 워크스페이스 파일과 명령

비공개 루트 `package.json`을 만들고 `apps/*`, `workers/*`를 워크스페이스로 등록한다. 루트에 단일 `package-lock.json`을 만들고 세 하위 프로젝트의 잠금 파일은 제거한다.

루트 명령은 다음 작업을 제공한다.

- `npm install`을 통한 전체 의존성 설치
- `npm run build`를 통한 전체 타입 검사와 빌드
- `npm test`를 통한 전체 단위 테스트
- API, 고객 UI, 이미지 워커별 개발 실행
- 고객 UI 종단 간 테스트
- 선택적인 로컬 PostgreSQL 시작과 종료

루트 `README.md`에는 필수 도구, 저장소 구조, 최초 설치, 환경 파일, Supabase 연결 우선순위, 로컬 Docker PostgreSQL 사용법, 개발 명령, 테스트, 빌드와 이미지 워커의 책임 범위를 설명한다.

## API 빌드 규약

API 개발 의존성에 `tsup`을 추가한다. `typecheck`와 `build` 명령을 분리한다. API 빌드는 먼저 타입을 검사한 다음 Node.js 20용 ESM 형식의 `dist/index.js`를 생성한다. 기존 `start` 명령은 계속 `node dist/index.js`를 실행한다.

빌드 결과물에는 환경 변수의 비밀값이 포함되면 안 된다. 런타임 환경 변수는 계속 `dotenv`와 호스팅 환경에서 읽는다.

## 마이그레이션 순서

SQL 내용은 바꾸지 않고 다음과 같이 파일 이름만 변경한다.

1. `001_initial_schema.sql`
2. `002_source_content_items.sql`
3. `003_topic_rows_duplicate_policy.sql`
4. `004_channel_connection_requests.sql`
5. `005_content_topic_source_url_unique.sql`
6. `006_image_render_jobs.sql`
7. `007_kakao_auth.sql`
8. `008_auto_approval_default.sql`
9. `009_support_requests.sql`
10. `010_remove_webflow.sql`
11. `011_add_social_channels.sql`

마이그레이션 파일을 직접 언급하는 운영 문서도 함께 수정한다. 저장소 파일 이름 변경은 이미 적용된 Supabase 스키마에 영향을 주지 않는다. 기존 Supabase 데이터베이스에는 이 파일들을 무조건 다시 실행하지 않는다. 새 데이터베이스를 구성할 때만 파일 이름순으로 한 번씩 적용한다.

## 생성 파일 관리 정책

현재 저장된 다음 생성 파일과 로컬 전용 데이터를 제거한다.

- Supabase 이전 전 `.dump` 백업을 포함한 `artifacts/`
- 루트 `output/`과 Playwright 결과 디렉터리
- 애플리케이션과 워커의 `*.log` 파일
- 워커 `output/`의 실행 결과
- API의 `storage/rendered-content/` 결과물
- 애플리케이션 내부의 `.vercel/` 로컬 상태
- 그 밖의 일반적인 커버리지, 캐시와 빌드 디렉터리

이 파일들이 다시 저장소에 들어오지 않도록 `.gitignore`를 확장한다. 소스에 포함되어야 하는 테스트 픽스처, 프로토타입 자산, 테스트 코드와 `.env.example` 파일은 유지한다. 실제 `.env` 파일은 계속 무시하며 문서나 빌드 결과에 비밀값을 기록하지 않는다.

운영 데이터베이스 복구는 Supabase에서 설정한 백업 또는 특정 시점 복구 정책으로 관리한다. 이 저장소 자체에서는 데이터베이스 백업을 자동 생성하지 않는다.

## 검증 기준

다음 조건을 검증한다.

- 루트 워크스페이스 설치로 유효한 단일 잠금 파일이 생성된다.
- 루트 명령으로 전체 단위 테스트가 통과한다.
- 루트 명령으로 세 프로젝트의 타입 검사와 빌드가 통과한다.
- API 빌드가 `apps/api/dist/index.js`를 생성한다.
- API 결과물이 모듈 해석 오류 없이 설정을 불러오는 단계까지 실행된다.
- 마이그레이션 번호가 중복 없이 순서대로 존재한다.
- 정리 대상 런타임 파일이 제거되고 `.gitignore` 규칙과 일치한다.

## 제외 범위

- 기존 Supabase 스키마나 운영 데이터는 변경하지 않는다.
- Turborepo, Nx 또는 별도 작업 실행 도구를 도입하지 않는다.
- Vercel 배포 방식을 교체하지 않는다.
- 자동 데이터베이스 백업 시스템을 추가하지 않는다.
- 제품 기능, 인증, 게시 또는 이미지 생성 로직을 변경하지 않는다.

