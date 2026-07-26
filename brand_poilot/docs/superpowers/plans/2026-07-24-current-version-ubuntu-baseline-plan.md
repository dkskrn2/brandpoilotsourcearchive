# Current Brand Pilot Ubuntu Baseline Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this operational plan with a human operator at every STOP gate. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** D 하이브리드 개발을 시작하기 전에 현재 정상 Brand Pilot API SHA를 Ubuntu에 API+Caddy safe-mode canary로 올리고, Vercel을 건드리지 않은 상태에서 접속·복구 기준선을 만든다.

**Architecture:** GitHub `dkskrn2/main`을 source of truth로 사용하고 GitHub Actions가 만든 immutable `linux/amd64` GHCR image digest만 Ubuntu가 pull한다. Ubuntu는 소스를 수정하거나 image를 build하지 않는다. 첫 기준선은 `api-canary + Caddy`만 실행하며 migration, scheduler, publish, DM/Wiki/content worker를 모두 실행하지 않는다. Tailscale은 `bpdeploy` 관리 SSH에만 사용하고 공개 HTTPS는 DNS·router 80/443·Caddy를 사용한다.

**Tech Stack:** Git/GitHub Actions, GHCR, Ubuntu 24.04 amd64, Docker Compose, Caddy, Tailscale SSH, PostgreSQL/Supabase, Vercel.

---

## 0. 2026-07-24 사전 감사 결과와 STOP 조건

계획 실행자는 아래 값을 새로 측정해 증빙하고, 이 문단의 오래된 값을 그대로 신뢰하지 않는다.

- 로컬 tracked candidate는 감사 시점에 `0694cd99fcd04d827eb79d28430fa7bf1b120b35`였지만 `origin/main`은 `2b40f80`이었다. 따라서 `0694cd9`를 아직 배포 가능한 main SHA로 간주하지 않는다.
- image publish workflow는 로컬 feature branch에는 있지만 감사 시점의 default `main`에는 없어 수동 workflow 실행이 불가능했다.
- `api.danbammsg.co.kr`, `canary-api.danbammsg.co.kr`, `app.danbammsg.co.kr`은 감사 시점에 public DNS에서 NXDOMAIN이었다.
- Windows와 Ubuntu Tailscale node는 보였고 SSH TCP 22도 열렸지만, intended deploy identity인 `bpdeploy`의 existing private-key BatchMode login은 `Permission denied`였다. 일반 관리자/`chu1` 접속 성공을 `bpdeploy` 배포 경로 성공으로 대신하지 않는다.

다음 세 조건 중 하나라도 미충족이면 배포 명령으로 넘어가지 않는다.

1. `bpdeploy` public-key SSH를 새 두 번째 세션에서 확인했다.
2. 선택한 baseline commit과 workflow가 GitHub default `main`에 있고 CI가 통과했다.
3. canary DNS와 외부 TCP 80/443이 Ubuntu까지 도달한다.

## Task 1: 배포할 현재 SHA를 고정하고 main에 통합

**Files inspected, not modified by deployment:**

- `.github/workflows/publish-brand-pilot-server-images.yml`
- `brand_poilot/deploy/compose.production.yml`
- `brand_poilot/deploy/release.env.example`
- `brand_poilot/scripts/deployment-contract.test.mjs`

- [ ] D 하이브리드 계획 문서와 향후 기능 변경을 baseline source commit에 섞지 않는다.
- [ ] 현재 기능 기준선 branch에서 아래 검증을 실행한다.

```bash
npm ci
npm run test:deployment
npm test
npm run build
git diff --check
git status --short
```

- [ ] 테스트가 모두 통과한 tracked commit을 `BASELINE_SHA`로 기록한다.
- [ ] `BASELINE_SHA`와 image publish workflow를 review/PR을 거쳐 GitHub default `main`에 통합한다. force-push와 `latest` 단독 배포를 사용하지 않는다.
- [ ] 아래 세 값이 같은 commit인지 확인한다.

```bash
git rev-parse HEAD
git rev-parse origin/main
git ls-remote origin refs/heads/main
```

- [ ] GitHub Actions에서 `publish-brand-pilot-server-images.yml`이 default branch의 workflow 목록에 보이고, Ubuntu 24.04 job의 test/build가 통과하기 전에는 다음 task로 가지 않는다.
- [ ] CI artifact가 성공한 뒤에만 실제 main SHA에 annotated pre-D tag를 붙인다. PR이 squash/merge돼 SHA가 바뀌면 local candidate가 아니라 새 main SHA를 사용한다.

**STOP:** local-only SHA, 실패한 test/build, default branch에 없는 workflow 중 하나라도 있으면 중단한다.

## Task 2: `bpdeploy` Tailscale SSH 경로 복구

**Reference:** `docs/operations/UBUNTU_DEPLOYMENT.md`의 “3. Tailscale and OpenSSH”.

- [ ] Windows에서 기존 public key의 fingerprint만 기록하고 private key 내용은 출력·전송하지 않는다.
- [ ] Ubuntu 물리 콘솔 또는 이미 승인된 sudo 관리자 세션에서 `bpdeploy` 사용자, home, `.ssh`, `authorized_keys`의 owner/mode를 확인한다.
- [ ] Windows public key가 승인 목록에 없을 때만 그 public key 한 줄을 추가하고 다음 권한을 적용한다.

```bash
sudo install -d -m 700 -o bpdeploy -g bpdeploy /home/bpdeploy/.ssh
sudo touch /home/bpdeploy/.ssh/authorized_keys
sudo chown bpdeploy:bpdeploy /home/bpdeploy/.ssh/authorized_keys
sudo chmod 600 /home/bpdeploy/.ssh/authorized_keys
```

- [ ] `sshd -t`를 통과시킨 뒤 기존 관리자 세션을 닫지 않은 채 Windows의 새 두 번째 PowerShell에서 접속한다.

```powershell
ssh -o IdentitiesOnly=yes -i "$env:USERPROFILE\.ssh\brand-pilot-ubuntu" bpdeploy@brand-pilot-ubuntu
```

- [ ] 새 세션에서 `whoami`, `tailscale status`, `id`, `docker version`을 확인한다. `bpdeploy`가 광범위 sudo를 갖게 만들지 않는다.
- [ ] host key가 달라졌거나 public-key login이 실패하면 암호·사용자 이름을 추측하지 말고 Ubuntu 콘솔의 auth log와 key fingerprint를 점검한다.

**STOP:** `bpdeploy` public-key login을 두 번째 세션에서 확인하기 전에는 SSH hardening, artifact 전송, Docker 배포를 하지 않는다.

## Task 3: Ubuntu host와 영구 디렉터리 준비

**Files used:**

- `deploy/scripts/bootstrap-ubuntu.sh`
- `docs/operations/UBUNTU_DEPLOYMENT.md`

- [ ] Ubuntu 24.04, `amd64`, security update, 고정 LAN IP/DHCP reservation을 확인한다.
- [ ] Docker Engine과 Compose plugin을 공식 Docker repository에서 설치하고 서비스를 enable한다.
- [ ] `bpdeploy`의 Docker group membership은 root-equivalent임을 기록하고 key 접근을 제한한다.
- [ ] 검토한 `bootstrap-ubuntu.sh`를 root로 한 번 실행하고 재실행 안전성을 확인한다.
- [ ] 다음 경계가 기대 owner/mode인지 확인한다.

```text
/opt/brand-pilot/repo                 0750 bpdeploy:bpdeploy
/opt/brand-pilot/incoming             0750 bpdeploy:bpdeploy
/opt/brand-pilot/releases             0750 bpdeploy:bpdeploy
/opt/brand-pilot/state                0700 bpdeploy:bpdeploy
/opt/brand-pilot/shared/env           0700 bpdeploy:bpdeploy
```

- [ ] Ubuntu repository는 exact `BASELINE_SHA`를 detached checkout하고 로컬 수정이 없는지 확인한다.

```bash
git clone https://github.com/dkskrn2/main.git /opt/brand-pilot/repo
git -C /opt/brand-pilot/repo checkout --detach <BASELINE_SHA>
test "$(git -C /opt/brand-pilot/repo rev-parse HEAD)" = "<BASELINE_SHA>"
test -z "$(git -C /opt/brand-pilot/repo status --short)"
```

**STOP:** OS/architecture 불일치, managed path symlink, 잘못된 owner/mode, dirty checkout이면 중단한다.

## Task 4: 컨테이너 밖 production env 작성

**Files used:**

- `deploy/env/api.env.example`
- `deploy/scripts/preflight.sh`

- [ ] `/opt/brand-pilot/shared/env/api.env`를 example에서 새로 만들고 mode `600`, owner `bpdeploy`로 둔다.
- [ ] 개발 `.env`를 통째로 복사하지 않고 기존 운영값을 변수별로 검토한다.
- [ ] 기존 Kakao/Meta/Supabase/Blob key는 노출·폐기 사유가 없으면 재발급하지 않는다.
- [ ] 기존 `CREDENTIAL_ENCRYPTION_KEY`를 정확히 유지한다.
- [ ] 첫 기준선의 안전값을 고정한다.

```text
NODE_ENV=production
COOKIE_SECURE=true
DEV_AUTH_ENABLED=false
DB_POOL_MAX=3
LOCAL_SCHEDULER_ENABLED=false
INSTAGRAM_PUBLISH_ENABLED=false
```

- [ ] DM/Wiki/content worker container를 올리지 않으며 migration command도 실행하지 않는다.
- [ ] CORS와 frontend URL은 현재 실제 Vercel frontend origin을 허용하고 arbitrary origin을 넣지 않는다. `app.danbammsg.co.kr`이 실제 Vercel custom domain으로 준비된 경우에만 그 origin으로 교체한다.
- [ ] secret-bearing host에서 `docker compose config` 원문, `env`, `set`, shell xtrace를 출력하지 않는다. 검증은 `config --quiet`만 사용한다.
- [ ] env 파일 원문 대신 SHA-256 checksum과 mode/owner만 evidence에 기록한다.

**STOP:** encryption key 미확인, dev auth/publish/scheduler가 켜짐, env 권한 오류면 중단한다.

## Task 5: canary ingress만 준비

**Reference:** `docs/operations/UBUNTU_DEPLOYMENT.md`의 Sections 1, 2, 8.

- [ ] Release 0 canary에서는 production `api.danbammsg.co.kr`, Kakao/Meta callback, webhook, frontend API base URL을 바꾸지 않는다. 기존 Vercel API와 frontend가 계속 실제 사용 경로다.
- [ ] `api.danbammsg.co.kr` stable hostname과 provider callback 전환은 D rollout 또는 별도 primary cutover에서 검증한다. canary host만으로 실제 OAuth callback E2E를 증명했다고 기록하지 않는다.
- [ ] Ubuntu public IPv4와 router WAN IPv4를 비교해 CGNAT/double NAT 여부를 확인한다.
- [ ] router는 Ubuntu 고정 LAN IP로 TCP 80/443만 전달하고 22/4000/5432는 public에 열지 않는다.
- [ ] `canary-api.danbammsg.co.kr` A record만 Ubuntu public IPv4로 만들고 TTL 300을 사용한다. working IPv6가 없으면 AAAA를 만들지 않는다.
- [ ] public resolver와 실제 외부 네트워크에서 DNS, 80/443 도달성을 확인한다. Tailscale IP를 public DNS에 넣지 않는다.

**STOP:** NXDOMAIN, CGNAT/이중 NAT 미해결, 외부 80/443 차단, 잘못된 A/AAAA record면 canary를 시작하지 않는다.

## Task 6: immutable release artifact 생성·검증

**Files used:**

- `.github/workflows/publish-brand-pilot-server-images.yml`
- `deploy/release.env.example`

- [ ] default `main`의 exact `BASELINE_SHA`를 대상으로 workflow를 실행하고 성공 run ID를 기록한다.

```bash
gh workflow run publish-brand-pilot-server-images.yml --ref main
gh run list --workflow publish-brand-pilot-server-images.yml --limit 10
gh run watch <RUN_ID> --exit-status
```

- [ ] workflow에서 contract, migrations, API/DM tests, API build, shellcheck, deployment tests, `linux/amd64` image publish가 전부 성공했는지 확인한다. Windows에서 일부 deployment test가 통과한 사실만으로 대체하지 않는다.
- [ ] trusted Windows/WSL 또는 Git Bash에서 `brand-pilot-api-release-<BASELINE_SHA>` artifact만 내려받는다.
- [ ] `release.env.sha256`, `RELEASE_SHA`, `API_IMAGE@sha256`, `CADDY_IMAGE@sha256`를 검증한다.
- [ ] 검증된 `release.env`와 checksum 두 파일만 `/opt/brand-pilot/incoming`으로 전송하고 즉시 mode 600을 적용한다.
- [ ] Ubuntu에서 checksum, exact checkout SHA, image digest 형식을 다시 검증한다.
- [ ] private GHCR이면 command line/file에 남지 않는 short-lived read-only package token으로 login하고 사용 후 폐기한다.

**STOP:** mutable tag만 있음, SHA/digest/checksum 불일치, artifact owner/mode 오류면 배포하지 않는다.

## Task 7: API+Caddy canary만 배포하고 읽기 검증

**Files used:**

- `deploy/scripts/deploy.sh`
- `deploy/scripts/verify-canary.sh`
- `deploy/Caddyfile.canary`

- [ ] `bpdeploy` 세션에서 existing locked script를 사용한다.

```bash
cd /opt/brand-pilot/repo/brand_poilot/deploy
./scripts/deploy.sh /opt/brand-pilot/incoming/release.env --phase canary
./scripts/verify-canary.sh https://canary-api.danbammsg.co.kr <CURRENT_FRONTEND_ORIGIN>
```

- [ ] `api-canary`와 Caddy만 실행되고 `api-primary`, worker, scheduler, publisher가 생기지 않았는지 확인한다.
- [ ] `/health`, `/ready`, exact allowed CORS, denied foreign origin, secure cookie, dev auth route 404, DB read를 확인한다.
- [ ] canary에서 migration, 유료 AI 생성, 다운로드 차감, 실제 SNS 게시, 실제 DM 전송, webhook cutover를 실행하지 않는다.
- [ ] container environment를 출력하지 않고 bounded logs, image digest, restart count, `state/candidate`만 기록한다.
- [ ] 재부팅 후 Tailscale로 재접속해 canary health와 Docker restart policy를 다시 확인한다.
- [ ] 같은 candidate로 canary rollback 명령을 리허설하고 다시 verify한다.
- [ ] 첫 Ubuntu release에는 이전 SHA가 없으므로 이 명령은 실제 이전 버전 rollback이 아니라 rollback entrypoint/recovery rehearsal로 기록한다. 실제 사용자 rollback target은 계속 Vercel API다.
- [ ] 성공 상태가 아래와 일치하는지 확인한다.

```text
state/candidate = BASELINE_SHA
state/current 없음
state/previous 없음
state/prepared 없음
state/transition.journal 없음
실행 컨테이너 = api-canary, caddy
```

**STOP/ROLLBACK:** health/readiness 실패, CORS 누출, credential decryption 오류, DB write, unexpected worker/job이면 canary를 중지하고 Vercel만 유지한다.

## Task 8: 기준선 승인과 D 하이브리드 개발 시작

**Evidence file created during execution:**

- Create: `docs/operations/evidence/<date>-current-ubuntu-baseline.md`

- [ ] evidence에는 `BASELINE_SHA`, workflow run URL, image digest, env checksum, DNS 결과, health/readiness 결과, container 목록, rollback 결과만 기록한다. secret·token·cookie 원문은 기록하지 않는다.
- [ ] 현재 Vercel API와 frontend를 최소 48시간 유지하고 public `api.danbammsg.co.kr` production cutover는 별도 승인 전까지 하지 않는다.
- [ ] 기준선 승인 뒤 D 하이브리드 개발은 별도 `codex/*` branch/worktree에서 시작한다.
- [ ] 이후 변경은 `feature branch → test → PR/main → immutable image → Ubuntu canary → promote` 흐름을 따른다. Ubuntu source/env를 직접 수정해서 버전을 만들지 않는다.
- [ ] container 교체는 `/opt/brand-pilot/shared/env/api.env`를 바꾸지 않는다. env 변경이 필요한 release만 변수별로 별도 검토한다.

**완료 조건:** 현재 main SHA의 Ubuntu canary와 rollback entrypoint/recovery rehearsal이 증빙되고 Vercel rollback target이 살아 있다. 이 시점부터 D 하이브리드 구현을 시작해도 되지만, production DNS 전환과 자동 기능 활성화는 아직 하지 않는다.
