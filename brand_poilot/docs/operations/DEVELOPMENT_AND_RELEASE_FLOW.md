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

`.github/workflows/publish-brand-pilot-server-images.yml`은 PR에서는 변경 범위에 해당하는 검증만 수행하고, `main`에서는 현재 운영 SHA와 새 SHA 사이의 영향을 계산해 필요한 Linux/amd64 image만 GHCR에 게시합니다. 첫 schema-2 릴리스, 운영 기준 SHA를 알 수 없는 경우, root lockfile·공용 worker runtime·미분류 server 경로가 바뀐 경우에는 안전하게 전체 server image를 다시 만듭니다.

```text
ghcr.io/dkskrn2/brand-pilot-api:sha-<40-character-commit>
```

즉 릴리스 표기 규칙은 `sha-<commit>`입니다. workflow가 만드는 schema-2 `release.env`에는 API와 각 worker의 digest, 그 image를 실제로 만든 source SHA, 이번 릴리스에서 변경됐는지가 함께 들어갑니다. 변경되지 않은 구성요소는 직전 운영 manifest의 digest와 source SHA를 그대로 재사용합니다. tag는 추적용이고, Ubuntu의 실행 단위는 digest입니다. `latest`만 가리키는 image 또는 digest가 없는 manifest로 배포하지 않습니다.

현재 workflow artifact는 배포 정의와 manifest를 함께 고정한 bundle입니다.

```text
brand-pilot-release-<RELEASE_SHA>/
  release-bundle-<RELEASE_SHA>.tar.gz
  release-bundle-<RELEASE_SHA>.tar.gz.sha256
```

`RELEASE_SCHEMA=1` manifest는 기존 릴리스 롤백에만 계속 읽을 수 있습니다. 새 릴리스는 `RELEASE_SCHEMA=2`만 생성합니다. migration 경로가 감지되면 image와 검증 결과는 만들 수 있어도 운영 배포 단계는 차단되며, migration 승인·backup·적용은 기존 별도 절차를 따릅니다.

GitHub `Production` 환경의 `BRAND_PILOT_CD_ENABLED=true`와 전용 SSH·authenticated canary 자격 증명이 모두 준비되기 전에는 workflow가 운영 서버를 변경하지 않습니다. 현재 activation gate는 provider DB backup과 암호화된 Caddy backup의 외부 승인이 필요한 지점에서 의도적으로 중단됩니다. 이 gate를 제거하거나 변수를 켜는 것은 코드 merge와 별개의 운영 승인 작업입니다.

worker 배포 시 `rollout-workers.sh`는 schema-2 manifest에서 `*_CHANGED=true`이면서 현재 실제로 실행 중인 worker service만 digest로 pull하고 `--no-deps`로 재생성합니다. 변경되지 않은 worker는 재기동하지 않고, 비활성 profile을 새로 시작하지도 않습니다. 실행 직전 각 container의 실제 immutable image digest를 서비스별로 기록하고 로컬에 확보하며 운영 lock을 획득합니다. 별도 heartbeat 검증 실행 파일이 없거나 실제 image가 digest로 고정되지 않았으면 mutation 전에 실패합니다. 실행 후 service 상태나 heartbeat 검증이 실패하면 영향받은 worker만 기록한 실제 digest로 서비스별 복원합니다. 특정 릴리스에서 Wiki worker 등을 제외할 때만 `WORKER_ROLLOUT_EXCLUDED_SERVICES`를 명시하며 기본값은 제외 없음입니다. API/Caddy와 다른 worker를 함께 내리는 `docker compose down`은 사용하지 않습니다.

### Proposal prompt v3/v4 전환 순서

Proposal prompt v4 릴리스의 영향 계산은 반드시 전용 profile을 명시합니다. 이 profile에서 Proposal lineage 전용 catalog/generated 세 파일은 API와 Content Proposal Worker에만 영향을 주며, 최종 prompt 변경을 합치면 API, Content Proposal Worker, Card News Worker, Reel Worker만 새 image 대상입니다. Image Worker와 Blog Worker는 현재 검증된 digest를 재사용합니다.

```powershell
node scripts/release-impact.mjs --base <CURRENT_PRODUCTION_SHA> --head <RELEASE_SHA> --profile card-reel-editorial-prompt-quality
```

운영자는 다음 순서를 바꾸지 않습니다.

1. 원격 `main`, 릴리스 SHA, 현재 운영 SHA와 실제 API/Proposal/Card/Reel image digest, dirty worktree/hotfix, restart count, `/health`, `/ready`를 기록하고 서비스별 rollback digest를 보존합니다. 예상 운영 identity와 다르면 mutation 전에 중단합니다.
2. 정확한 릴리스 SHA에서 API, Content Proposal Worker, Card News Worker, Reel Worker image만 build/publish하고 digest와 embedded source revision을 검증합니다. Image/Blog digest는 재사용합니다.
3. 공유 API env의 유일한 `CONTENT_PROPOSALS_ENABLED` 행을 owner와 mode `0600`을 보존하며 `false`로 원자적으로 바꾸고, `AI_CONTENT_PROPOSAL_PROMPT_CUTOVER_MODE=true`로 preflight를 실행합니다. 실행 중인 v3 primary는 아직 재기동하지 않습니다.
4. migration 091의 정확한 ID/checksum 근거를 확인하고 v4 API canary를 배포합니다. canary의 Proposal 기능이 disabled인지 read-only로 확인하며 v3 worker가 실행 중일 때 v4 Proposal을 enqueue하지 않습니다.
5. 같은 cutover mode로 v4 API를 primary로 승격하고 health, ready, candidate digest, Proposal-disabled 응답을 확인합니다.
6. 기존 v3 Proposal worker로 `queued`와 `processing` job 및 만료되지 않은 lease가 모두 0이 될 때까지 drain합니다. job을 취소·재작성·재라벨링·마이그레이션하지 않습니다.
7. v3 queue와 lease가 0인 뒤 old Proposal worker를 중지하고 Content Proposal, Card News, Reel worker만 교체합니다. 세 서비스의 digest, running 상태, fresh heartbeat, restart count를 확인하며 Proposal 생성은 계속 disabled로 둡니다.
8. v4 API/Proposal-worker pair의 호환성이 검증된 뒤에만 `CONTENT_PROPOSALS_ENABLED=true`를 원자적으로 복원하고 cutover mode 없이 일반 preflight를 실행합니다. 모든 일반 API instance를 재생성한 후 `/health`, `/ready`, `features.contentProposals=enabled`, fresh v4 Proposal-worker heartbeat를 확인합니다.

Drain 상태 count는 read-only query로 확인합니다.

```sql
select status,count(*)::integer
from public.ai_content_proposal_jobs
where status in ('queued','processing')
group by status order by status;
```

어느 단계에서든 migration, API 승격, drain, worker rollout, heartbeat 또는 재활성화 검증이 실패하거나 작업이 중단되면 `CONTENT_PROPOSALS_ENABLED=false`를 유지합니다. v4 API+v4 Proposal worker 또는 모든 v4-bound job을 drain한 뒤의 v3 API+v3 Proposal worker처럼 호환되는 pair를 복구하고 검증하기 전에는 다시 활성화하지 않습니다. 스크립트가 종료됐다는 이유만으로 이 flag를 `true`로 되돌리지 않습니다. migration 091은 append-only이므로 설치된 상태로 유지합니다.

### 디자인 스타일 분석·프리셋 및 Proposal v5 개발 전환 순서

이 전환은 개발 환경에서 먼저 검증합니다. 스타일 분석은 새 서비스나 `STYLE_ANALYSIS_WORKER_IMAGE`를 만들지 않고 기존 Brand Intelligence Worker가 `design_style_analysis` 작업을 처리합니다. 변경 대상은 Customer UI, API, Brand Intelligence Worker, Content Proposal Worker, Card News Worker, Reel Worker, 호환 입력을 소비하는 Blog Worker와 Image Worker입니다.

```powershell
node scripts/release-impact.mjs --base <CURRENT_DEVELOPMENT_SHA> --head <RELEASE_SHA> --profile design-style-preset-editorial-cutover
```

개발 전환 순서는 다음과 같습니다.

1. 원격 `main`, 개발 release SHA, dirty/hotfix 상태, 위 여덟 구성요소의 현재 digest·source SHA·restart count·health/ready·heartbeat와 서비스별 rollback digest를 기록합니다. 실행 중인 image가 예상 개발 release와 다르거나 별도 hotfix를 덮게 되면 mutation 전에 중단합니다.
2. migration 전 스키마에서도 기동 가능한 새 API image를 먼저 `BRAND_CENTER_MUTATIONS_ENABLED=false`로 canary 검증한 뒤 모든 개발 API instance에 승격합니다. `DESIGN_STYLE_PRESET_CUTOVER_MODE=true`로 preflight를 실행하고, 운영규칙 draft/approve 및 디자인 스타일·프리셋 생성/수정/retry/default API가 실제로 `503 brand_center_mutations_disabled`를 반환하는지 확인합니다. 이때 브랜드센터의 다른 기능·운영규칙 조회와 이전 UI의 `/style-presets` 읽기 전용 호환 route는 유지하지만, 아직 093을 적용하지 않은 DB에서는 새 `/design-styles`·`/visual-presets` 조회를 점검 대상으로 사용하지 않습니다. Proposal 생성도 비활성화하고 `proposal.writer.v4`의 `queued`·`processing` job과 유효 lease가 모두 0이 될 때까지 기존 worker로 drain합니다. 기존 job의 version을 바꾸거나 재작성하지 않습니다.
3. 개발 DB의 backup/PITR 상태와 dry-run을 확인하고 migration 093, 이어서 migration 094를 정확한 checksum으로 적용합니다. 적용 후 dry-run의 `applied`가 빈 배열인지 확인합니다. `093`의 legacy preset 사전조건이나 `094`의 lineage 제약 검증이 실패하면 다음 단계로 가지 않습니다.
4. 정확한 release SHA에서 API와 일곱 worker image만 build/publish하고 digest와 embedded source revision을 확인합니다. API를 canary로 검증해 `/health`, `/ready`가 통과한 뒤 primary로 승격합니다.
5. 기존 Brand Intelligence Worker와 Proposal/Card/Reel/Blog/Image worker 중 실제 실행 중인 서비스만 새 digest로 교체합니다. 별도 style-analysis worker를 시작하지 않습니다. running 상태, fresh heartbeat, restart count와 최근 오류 로그를 확인합니다.
6. API와 Content Proposal Worker가 정확한 `proposal.writer.v5` source/catalog/schema tuple을 사용하는지 확인하고 새 API primary만 요청을 받는 것을 확인합니다. mutation gate는 아직 비활성 상태로 유지합니다.
7. 동일 SHA의 Customer UI를 게시한 뒤 `BRAND_CENTER_MUTATIONS_ENABLED=true`로 원자적으로 복원하고 cutover mode 없이 일반 preflight를 실행해 모든 API instance를 재생성합니다. 규칙·스타일·프리셋 mutation의 정상 응답을 확인한 뒤 Proposal 생성도 다시 활성화합니다. 로그인된 개발 브라우저에서 스타일 업로드의 대기/분석/사용 가능 상태, 분석 중 프리셋 선택 차단, 구성안 선택 뒤 프리셋 노출, 정보성 Card/Reel과 마케팅 Card/Reel 생성을 검증합니다. 실패하거나 중단되면 두 mutation gate를 비활성 상태로 유지합니다.

브라우저 결과에는 생성 ID, 스타일 분석 job ID·attempt, 장면별 이미지 호출, 적용된 preset/style/avatar snapshot, 각 서비스 digest와 rollback digest를 남깁니다. 이 개발 기능의 Production 배포는 통합 브라우저 결과에 대한 사용자 승인과 새로운 Production 영향도 확인 전까지 진행하지 않습니다.

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

새 schema-2 artifact는 deploy script와 Compose/Caddy 파일까지 포함하므로 새 릴리스는 Git checkout에서 배포 도구를 읽지 않습니다. 다만 기존 schema-1 릴리스의 롤백은 그 당시 서명된 파일 집합과 절차를 그대로 유지합니다.

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
  --name "brand-pilot-release-<RELEASE_SHA>" \
  --dir ./brand-pilot-release-download
cd ./brand-pilot-release-download
sha256sum --check "release-bundle-<RELEASE_SHA>.tar.gz.sha256"
mkdir verified-release
tar -xzf "release-bundle-<RELEASE_SHA>.tar.gz" -C verified-release
cd verified-release
sha256sum --check release.env.sha256
grep -Fx "RELEASE_SHA=<RELEASE_SHA>" release.env
grep -E '^API_IMAGE=ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$' release.env
```

검증된 bundle만 `/opt/brand-pilot/incoming/`으로 전송합니다. 이후 `[bpdeploy Tailscale SSH]`에서 checksum을 다시 확인하고 Ubuntu 런북의 canary, verify, backup, prepare, commit 순서를 사용합니다.

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

### 게시관리 동일 데이터 전환의 2단계 릴리스

- Release A는 운영의 `084_ai_content_usage_reversal_identity_invoker.sql`을 그대로 보존하고, `085_publish_calendar_idempotency_expand.sql`과 호환 API만 포함하는 별도 PR·승격입니다. 085는 트랜잭션 범위의 5초 lock timeout·60초 statement timeout 아래 nullable idempotency 컬럼, CHECK 제약과 unique index를 추가하며 기존 시간·generation index는 제거하지 않습니다.
- Release A가 운영 DB와 전체 API 컨테이너에 승격되고 keyed/no-key 호출 관측을 마치기 전에는 `086_publish_calendar_same_time_contract.sql`을 pending 상태로 만들거나 Release B를 배포하지 않습니다.
- Release B는 085와 공통 게시 항목 API/UI를 포함하는 별도 PR·승격입니다. same-time 허용 및 고객 30분 제한 제거는 이 단계에서만 활성화합니다.
- Release B 롤백 이미지는 Release A의 검증된 API digest로 고정합니다. 085 적용 후 schema 자체는 되돌리지 않으며, Release A API가 085 이후 중복·근접 자동 슬롯과 기존 no-key 요청을 모두 처리할 수 있음을 먼저 검증합니다.
- Release A 관측에는 기존 `/publish-calendar/slots` no-key 요청 body가 `scheduledFor`, `contentFormat`, `channels` 세 필드 그대로인지와 실제 호출량을 포함합니다.

## 5. 현재 자동화 의존성

2026-07-28 기준으로 아래 항목은 아직 자동화되지 않았습니다.

- 운영 DB migration 승인·실행 workflow
- release artifact만으로 동작하기 위한 deploy script/Compose/Caddy bundle과 무결성 검증
- API 외 DM, Wiki, content worker의 동일 SHA GHCR image 게시 및 Ubuntu 배포

이 의존성이 구현되기 전에는 현재 [Ubuntu API 배포 런북](UBUNTU_DEPLOYMENT.md)의 API+Caddy safe-mode 범위를 넘겨 배포하지 않습니다.
