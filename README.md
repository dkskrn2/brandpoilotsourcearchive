# GROWTHLINE React

Next.js 기반 GROWTHLINE 사이트와 PostgreSQL 콘텐츠 관리자입니다. 공개 사이트는 Vercel에서 실행되고, `/admin`의 콘텐츠는 Vercel Marketplace에서 연결한 PostgreSQL에 저장됩니다.

## 배포 전 준비

1. Vercel에서 이 GitHub 저장소를 가져옵니다.
2. 프로젝트의 **Storage → Marketplace**에서 Neon, Supabase 또는 다른 PostgreSQL 제공자를 연결합니다.
3. 연결 문자열이 `DATABASE_URL`로 주입됐는지 확인합니다. 제공자가 `POSTGRES_URL`만 만드는 경우에도 애플리케이션은 이를 인식합니다.
4. Vercel의 Production, Preview, Development 환경에 아래 변수를 설정합니다.

| 환경변수 | 필수 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | 필수 | PostgreSQL 연결 문자열 |
| `ADMIN_USERNAME` | 필수 | 관리자 아이디. 요청된 값은 `ROOT` |
| `ADMIN_PASSWORD` | 필수 | 관리자 비밀번호. 요청된 값은 `ROOT` |
| `ADMIN_SESSION_SECRET` | 필수 | 세션 서명용 32자 이상 임의 문자열 |
| `GAS_WEBAPP_URL` | 필수 | 상담 폼 Google Apps Script URL |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | 선택 | GA4 측정 ID (`G-...`) |

`ADMIN_SESSION_SECRET` 예시 생성 명령:

```bash
openssl rand -base64 48
```

환경변수를 추가한 뒤 새 배포를 실행합니다. 첫 PostgreSQL 요청에서 `content_articles` 테이블과 인덱스가 자동 생성되고, 초기 예시 콘텐츠가 중복 없이 추가됩니다.

> `ROOT/ROOT`는 요청에 맞춰 예시에 넣었지만 공개된 관리자 화면에는 매우 약한 조합입니다. 정상 동작 확인 직후 `ADMIN_PASSWORD`를 긴 임의 비밀번호로 교체하는 것을 권장합니다.

## 로컬 실행

```bash
npm install
npm run dev
```

`.env.example`을 `.env.local`로 복사하고 필요한 값을 입력합니다. DB 연결 문자열이 없을 때 공개 콘텐츠는 시드 데이터를 읽기 전용으로 표시하지만 관리자 저장·수정·삭제는 실행되지 않습니다.

## 검증 명령

```bash
npm run lint
npm test
npm run build
```

## 관리자 보안

- `/admin` 전체에 서명된 8시간 세션 쿠키를 적용합니다.
- 쿠키는 `HttpOnly`, 운영 환경 `Secure`, `SameSite=Strict`로 설정됩니다.
- `proxy.ts`가 미인증 요청을 로그인 화면으로 보냅니다.
- 모든 콘텐츠 Server Action은 데이터 변경 직전에 세션을 다시 검증합니다.
- 관리자 계정과 세션 비밀값은 저장소에 포함하지 않고 Vercel 환경변수로만 관리합니다.
