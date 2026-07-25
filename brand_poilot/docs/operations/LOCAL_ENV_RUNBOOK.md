# Local Environment Runbook

Brand Pilot 로컬 개발은 `.env` 파일을 하나로 합치지 않는다. 대신 아래 값들이 모든 프로세스에서 같은 기준을 바라보도록 맞춘다.

## 기준값

| 항목 | 로컬 기준 |
|---|---|
| API | `http://localhost:4000` |
| Frontend | `http://localhost:5173` |
| Worker token | API, DM worker, image worker가 같은 `WORKER_API_TOKEN` 사용 |
| Database | API와 DM worker가 같은 DB 사용 |
| OAuth redirect | Kakao/Meta redirect URI는 API 기준 URL 사용 |

## 파일별 역할

| 파일 | 역할 |
|---|---|
| `apps/api/.env` | 중앙 API, OAuth, DB, worker token 기준 |
| `apps/customer-ui/.env.local` | 프론트가 호출할 API 주소 |
| `workers/brand-pilot-image-worker/.env` | 이미지 워커가 호출할 API 주소와 worker token |
| `workers/brand-pilot-dm-worker/.env` | DM 워커가 호출할 API 주소, worker token, DB, OpenAI 설정 |

## 로컬 env 검사

값을 출력하지 않고 일치 여부만 검사한다.

```powershell
npm run env:check
```

다른 폴더의 env를 기준으로 검사해야 하면 `--env-root`를 사용한다.

```powershell
npm run env:check -- --env-root="C:\Users\dkskr\OneDrive\111\brand_poilot"
```

## 자주 나는 문제

- `WORKER_API_TOKEN`이 API와 워커에서 다르면 워커 요청이 거부된다.
- `localhost`와 `127.0.0.1`을 섞으면 OAuth state/cookie 문제가 날 수 있다.
- Vite 프론트는 `.env.local` 변경 후 재시작해야 한다.
- API와 워커도 `.env` 변경 후 재시작해야 한다.
- Vercel 환경변수는 로컬 `.env`와 별개다.

## 변경 후 재시작 순서

1. API 종료 후 재시작
2. 프론트 종료 후 재시작
3. 이미지 워커 종료 후 재시작
4. DM 워커 종료 후 재시작
5. `npm run env:check` 재실행
