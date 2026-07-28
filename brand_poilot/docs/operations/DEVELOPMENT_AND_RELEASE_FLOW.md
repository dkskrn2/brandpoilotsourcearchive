# 개발 및 릴리스 흐름

이 문서는 Brand Pilot을 반복 개발하고 Vercel 및 Ubuntu에 릴리스하는 단일 기준을 정의합니다. 실제 Ubuntu 배포 명령과 초기 구축 절차는 [Ubuntu API 배포 런북](UBUNTU_DEPLOYMENT.md)을 따릅니다.

## 1. 단일 source of truth

- GitHub [`dkskrn2/main`](https://github.com/dkskrn2/main)의 `main` 브랜치가 코드와 릴리스 커밋의 유일한 source of truth입니다.
- Windows 개발 PC의 작업 디렉터리, Vercel 배포 결과, GHCR 이미지 또는 Ubuntu 파일을 원본으로 간주하지 않습니다.
- 모든 변경은 Windows의 `codex/*` feature branch와 별도 worktree에서 개발하고 테스트한 뒤 PR로 `main`에 merge합니다.
- Ubuntu에서 애플리케이션 소스를 수정하거나 이미지를 build하지 않습니다. 운영 릴리스의 애플리케이션 입력은 GitHub Actions가 만든 release manifest와 digest로 고정된 image입니다.
- Tailscale은 `bpdeploy` SSH를 통해 deploy command, log, health를 관리하는 private management plane입니다. 소스 동기화나 public ingress에 사용하지 않습니다.

## 2. Windows 개발에서 merge까지

저장소 최상위 디렉터리에서 최신 `origin/main`을 기준으로 worktree를 만듭니다. `<FEATURE>`와 `<WORKTREE_PATH>`는 작업별 값으로 바꿉니다.

```powershell
git fetch origin
git worktree add -b "codex/<FEATURE>" "<WORKTREE_PATH>" origin/main
Set-Location "<WORKTREE_PATH>\brand_poilot"
npm ci
```

작업 범위에 맞는 테스트를 먼저 실행하고, PR 전에는 최소 공통 계약과 변경한 workspace의 테스트·build를 실행합니다.

```powershell
npm run test:contract
npm run test --workspace @brand-pilot/customer-ui
npm run test --workspace @brand-pilot/api
npm run build
git diff --check
```

변경하지 않은 무거운 workspace까지 매 커밋마다 반복할 필요는 없지만, PR의 필수 CI와 최종 regression gate는 생략하지 않습니다.

```powershell
git push -u origin "codex/<FEATURE>"
gh pr create --base main --head "codex/<FEATURE>"
gh pr checks <PR_NUMBER> --watch
```

PR이 merge된 뒤에는 merge commit의 40자 SHA를 릴리스 식별자로 기록합니다.

```powershell
git fetch origin
$releaseSha = git rev-parse origin/main
$releaseSha
```

같은 릴리스에서 frontend와 server가 모두 바뀌면 둘 다 이 SHA로 추적합니다.

## 3. 배포 책임 경계

### Frontend: Vercel

`brand_poilot/vercel.json`은 repository checkout에서 `npm ci` 후 아래 build를 수행합니다.

```powershell
npm run build --workspace @brand-pilot/customer-ui
```

Vercel은 merge된 repository commit을 build하고 배포합니다. Windows가 생성한 `dist`를 업로드하거나 Ubuntu를 경유하지 않습니다. GitHub commit status에서 Vercel 배포가 정확한 merge SHA에 연결됐는지 확인합니다.

### Server: GitHub Actions와 GHCR

`.github/workflows/publish-brand-pilot-server-images.yml`은 `main`의 `brand_poilot/**` 변경을 검증하고 Linux/amd64 API image를 다음 immutable tag로 GHCR에 게시합니다.

```text
ghcr.io/dkskrn2/brand-pilot-api:sha-<40-character-commit>
```

즉 릴리스 표기 규칙은 `sha-<commit>`입니다. workflow가 만드는 `release.env`에는 실제 배포에 사용하는 `API_IMAGE=...@sha256:...`가 들어갑니다. tag는 추적용이고, Ubuntu의 실행 단위는 digest입니다. `latest`만 가리키는 image 또는 digest가 없는 manifest로 배포하지 않습니다.

현재 workflow artifact는 다음 두 파일입니다.

```text
brand-pilot-api-release-<RELEASE_SHA>/
  release.env
  release.env.sha256
```

### Ubuntu와 Tailscale

Ubuntu에서는 Tailscale을 통한 `bpdeploy` SSH로 검증된 manifest를 받고, deploy script가 manifest의 digest를 pull합니다. `/opt/brand-pilot/shared/env/api.env`는 release directory 밖의 mode `600` 파일이며 Git checkout, manifest 교체, Docker image pull의 영향을 받지 않습니다.

Tailscale SSH 세션에서 log와 health를 볼 때도 release manifest만 참조하고 환경값을 출력하지 않습니다.

```bash
release_sha="$(cat /opt/brand-pilot/state/current)"
release_dir="/opt/brand-pilot/releases/$release_sha"
docker compose -p brand-pilot -f "$release_dir/compose.production.yml" --env-file "$release_dir/release.env" ps
docker compose -p brand-pilot -f "$release_dir/compose.production.yml" --env-file "$release_dir/release.env" logs --tail 200 api-primary
curl --fail https://api.danbammsg.co.kr/ready
```

다음 행위는 금지합니다.

- Ubuntu에서 애플리케이션 코드 수정 또는 Docker image build
- Tailscale, `scp`, 공유 폴더로 개발 source tree 동기화
- 개발 `.env`를 Ubuntu로 복사하거나 기존 운영 env를 release 파일로 덮어쓰기
- `docker compose config`처럼 secret-bearing resolved environment를 출력하는 명령
- `latest` 단독 배포 또는 기존 release directory 수정

현재 Ubuntu 런북은 deploy script와 Compose/Caddy 파일을 얻기 위해 `/opt/brand-pilot/repo`를 정확한 `RELEASE_SHA`에 detached checkout하는 단계가 있습니다. 이 checkout은 애플리케이션 build나 코드 동기화 경로가 아니라, 현재 release artifact에 포함되지 않은 배포 도구를 읽기 위한 의존성입니다. 서버가 manifest와 image digest만으로 완전히 동작하려면 workflow artifact에 검증된 deploy bundle을 포함하고 그 무결성을 검증하는 후속 작업이 필요합니다.

## 4. 릴리스 유형별 검증

아래 명령은 별도 표시가 없으면 `brand_poilot` 루트에서 실행합니다. 비밀값은 출력하거나 문서·PR·로그에 붙이지 않습니다.

### Frontend-only release

Windows feature worktree:

```powershell
npm run test --workspace @brand-pilot/customer-ui
npm run build --workspace @brand-pilot/customer-ui
npm run test:e2e
git diff --check
```

merge 뒤에는 GitHub에서 Vercel status가 동일 SHA에 성공했는지 확인하고 실제 frontend가 응답하는지 확인합니다.

```powershell
git fetch origin
$releaseSha = git rev-parse origin/main
gh api "repos/dkskrn2/main/commits/$releaseSha/status" --jq '.statuses[] | [.context, .state, .target_url] | @tsv'
curl.exe --fail --location https://app.danbammsg.co.kr/
```

Vercel status가 없거나 다른 SHA를 가리키면 성공으로 처리하지 않습니다. Frontend-only release는 GHCR 또는 Ubuntu 배포를 요구하지 않습니다.

### Server-only release

Windows feature worktree:

```powershell
npm run test:contract
node --test scripts/migrationRunner.test.mjs
npm run test:migrations
npm run test --workspace @brand-pilot/api
npm run test --workspace @brand-pilot/dm-worker
npm run build --workspace @brand-pilot/api
npm run test:deployment
git diff --check
```

merge된 `main`의 workflow를 확인합니다. 자동 실행이 없을 때만 같은 workflow를 수동 실행합니다.

```powershell
gh run list --workflow publish-brand-pilot-server-images.yml --branch main --limit 10
gh run watch <RUN_ID> --exit-status
```

trusted operator machine의 Git Bash 또는 WSL에서 exact-SHA artifact를 검증합니다.

```bash
gh run download <RUN_ID> \
  --name "brand-pilot-api-release-<RELEASE_SHA>" \
  --dir ./brand-pilot-release-download
cd ./brand-pilot-release-download
sha256sum --check release.env.sha256
grep -Fx "RELEASE_SHA=<RELEASE_SHA>" release.env
grep -E '^API_IMAGE=ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$' release.env
```

검증된 두 파일만 `/opt/brand-pilot/incoming/`으로 전송합니다. 이후 `[bpdeploy Tailscale SSH]`에서 Ubuntu 런북의 canary, verify, prepare, commit 순서를 사용합니다.

```bash
cd /opt/brand-pilot/repo/brand_poilot/deploy
./scripts/deploy.sh /opt/brand-pilot/incoming/release.env --phase canary
./scripts/verify-canary.sh https://canary-api.danbammsg.co.kr https://app.danbammsg.co.kr
./scripts/promote.sh --prepare
./scripts/promote.sh --commit --dns-cutover-confirmed
curl --fail https://api.danbammsg.co.kr/health
curl --fail https://api.danbammsg.co.kr/ready
```

`--dns-cutover-confirmed`는 실제 DNS cutover를 확인한 작업자만 사용합니다. 장애 시 새 image를 다시 build하거나 `latest`를 당겨오지 않고 저장된 immutable SHA로 되돌립니다.

```bash
cd /opt/brand-pilot/repo/brand_poilot/deploy
./scripts/rollback.sh --previous --phase production
curl --fail https://api.danbammsg.co.kr/ready
```

### Migration 포함 release

현재 GitHub Actions와 Ubuntu deploy script는 운영 DB migration을 자동 적용하지 않습니다. 따라서 migration은 자동 server release로 간주하지 않고 별도 승인 단계로 처리합니다.

Windows feature worktree에서 전체 migration과 runner 계약을 먼저 검증합니다.

```powershell
node --test scripts/migrationRunner.test.mjs
npm run test:migrations
npm run test:contract
```

merge된 exact-SHA의 깨끗한 trusted checkout에서 승인된 운영 DB 연결을 사용해 pending 목록을 확인합니다. `--dry-run`은 schema를 변경하지 않습니다.

```powershell
git fetch origin
git switch --detach origin/main
$releaseSha = git rev-parse HEAD
npm ci
npm run db:migrate -- --dry-run
```

pending migration ID, 대상 DB, backup/PITR 상태, 호환성 및 작업자를 기록하고 승인을 받은 뒤에만 적용합니다.

```powershell
npm run db:migrate
npm run db:migrate -- --dry-run
```

두 번째 dry-run 결과의 `applied`가 빈 배열이어야 합니다. 그 뒤 동일 `$releaseSha`의 server workflow artifact를 사용해 server-only canary와 health 검증을 수행합니다.

이 흐름에서 DB migration은 forward-only입니다. image rollback은 schema를 되돌리지 않으므로 기존 image와 호환되는 확장형 migration만 허용합니다. 파괴적 변경이나 기존 image와 호환되지 않는 migration은 별도 expand/migrate/contract 계획과 복구 리허설 없이는 배포하지 않습니다.

## 5. 현재 자동화 의존성

2026-07-28 기준으로 아래 항목은 아직 자동화되지 않았습니다.

- 운영 DB migration 승인·실행 workflow
- release artifact만으로 동작하기 위한 deploy script/Compose/Caddy bundle과 무결성 검증
- API 외 DM, Wiki, content worker의 동일 SHA GHCR image 게시 및 Ubuntu 배포

이 의존성이 구현되기 전에는 현재 [Ubuntu API 배포 런북](UBUNTU_DEPLOYMENT.md)의 API+Caddy safe-mode 범위를 넘겨 배포하지 않습니다.
