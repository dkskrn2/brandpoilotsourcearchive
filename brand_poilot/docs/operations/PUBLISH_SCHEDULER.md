# 게시 스케줄러 활성화·중지 런북

이 문서는 `publish-scheduler-1`을 **처음 활성화하거나 그 이미지 하나만 교체할 때** 사용하는 운영 게이트다. 스케줄러는 `api-primary`의 인증된 게시 due 엔드포인트만 호출한다. canary, 고객 UI, DB, Caddy, 다른 worker를 활성화하거나 교체하지 않는다.

이 변경에는 운영 활성화가 포함되지 않는다. 전체 배포 테스트가 오래 실행되어 통과했다는 사실도 스케줄러 활성화 증거가 아니다. 아래의 현재 운영 기준선, 실제 digest, preview ID, 통제된 게시 결과, heartbeat를 별도로 확인해야 한다.

## 불변 조건

- `LOCAL_SCHEDULER_ENABLED=false`를 유지한다.
- 외부에서 `/internal/cron/publish-due`를 호출하는 cron, GitHub schedule, ChatGPT/Codex 자동화, systemd timer는 **0개**여야 한다.
- `publish-scheduler-1`은 정확히 1개만 실행한다.
- `PRIMARY_API_INTERNAL_URL=http://api-primary:4000`이며 canary URL은 사용하지 않는다.
- `PUBLISH_SCHEDULER_IMAGE`와 API/다른 worker image는 모두 `@sha256:`로 고정한다. `latest`는 사용하지 않는다.
- migration `091_publish_calendar_weekly_schedule.sql`의 승인된 `applied` 또는 `already_applied` 증거가 이미 있어야 한다. 이 활성화 절차에서는 migration을 실행하지 않는다.
- Wiki worker가 disabled/not_required이면 실제 운영 digest를 유지한다. manifest 불일치를 이유로 기동하거나 교체하지 않는다.
- 고객 제목, 본문, 프롬프트, 쿠키, 토큰, DB URL, provider 응답 본문은 명령 출력이나 증거 파일에 남기지 않는다.

## 1. 변경 전 기준선 고정

운영 변경을 시작하기 전에 담당자가 아래 값을 같은 작업 기록에 저장한다.

1. 원격 `main` SHA
2. Ubuntu `/opt/brand-pilot/state/current` SHA
3. GitHub Actions variable `PRODUCTION_RELEASE_SHA`
4. 실행 중인 API, Caddy, 모든 worker의 실제 immutable image digest와 restart count
5. 스케줄러의 현재 상태: `disabled` 또는 실행 중인 정확한 digest
6. DB 백업/PITR 식별자와 복구 가능 시각
7. 외부 due 호출자 수 `0`

세 SHA가 같지 않거나, 새 hotfix/digest가 발견되거나, release manifest가 실행 중인 무관 서비스 digest를 보존하지 않으면 중지한다. 전체 manifest를 억지로 맞추지 않는다.

Ubuntu의 migration 증거는 파일을 출력하지 않고 다음 조건으로 확인한다.

```bash
migration_evidence=/opt/brand-pilot/state/post-075-schema-migrations/091_publish_calendar_weekly_schedule.sql.json
state_directory=/opt/brand-pilot/state/post-075-schema-migrations
test -d "$state_directory" && test ! -L "$state_directory"
test "$(stat -c '%a' -- "$state_directory")" = 700
test "$(stat -c '%U' -- "$state_directory")" = bpdeploy
test -f "$migration_evidence" && test ! -L "$migration_evidence"
test "$(stat -c '%a' -- "$migration_evidence")" = 600
test "$(stat -c '%U' -- "$migration_evidence")" = bpdeploy
jq -e '
  .post075SchemaMigration |
  .contractVersion == "post-075-schema-migration-evidence.v1" and
  .providerRoleName == "postgres" and
  .migrationId == "091_publish_calendar_weekly_schedule.sql" and
  .migrationSha256 == "c1bf905666ce4dabac137c0522fa0dc0300f574eda6d1e9648283f00b2af4d2b" and
  (.status == "applied" or .status == "already_applied")
' "$migration_evidence" >/dev/null
```

실패하면 migration을 여기서 재실행하지 말고 배포를 중지한다.

## 2. 승인할 due ID 만들기

첫 실행은 provider에 게시할 due queue ID만 있는 조용한 시간대에 수행한다. preview에 복구, 만료, 지연 항목이 하나라도 섞여 있으면 이 스모크로 한꺼번에 처리하지 않는다.

1. 인증된 primary preview를 읽는다.
2. `counts`가 각 ID 배열 길이와 정확히 같은지 확인한다.
3. 운영자가 게시를 허용한 `providerCandidateQueueIds`만 아래 파일에 옮긴다.
4. 다른 배열은 모두 빈 배열이어야 한다.

승인 파일에는 고객 텍스트나 토큰을 넣지 않는다.

```json
{
  "recovery": {
    "publishedQueueIds": [],
    "resultUnknownQueueIds": []
  },
  "expiry": {
    "targetQueueIds": [],
    "slotIds": []
  },
  "delayedQueueIds": [],
  "providerCandidateQueueIds": ["<APPROVED_QUEUE_ID>"]
}
```

파일은 작업자만 읽을 수 있게 보관하고, 승인 ID와 DB 백업 식별자를 함께 기록한다. 예상하지 않은 ID, 빈 승인 목록, quota 불일치, `result_unknown`이 보이면 중지한다.

## 3. 스케줄러 시작 전 통제 실행

병합된 정확한 source checkout에서 실행한다. 스크립트는 public primary인 `https://api.danbammsg.co.kr` 또는 Compose 내부의 정확한 `http://api-primary:4000`만 허용하며 canary와 유사 호스트를 거부한다. 비밀값은 환경값이 아니라 mode-0600 파일에서 읽는다.

```bash
export PUBLISH_SCHEDULER_PRIMARY_URL=https://api.danbammsg.co.kr
export PUBLISH_SCHEDULER_APPROVED_PREVIEW_FILE=/path/to/approved-publish-preview.json
export CRON_SECRET_FILE=/opt/brand-pilot/shared/secrets/cron-secret
npm run smoke:publish-scheduler -- --phase=execution
```

이 단계는 다음을 순서대로 강제한다.

1. 같은 preview를 두 번 읽고 count/ID가 승인 파일과 정확히 같은지 확인한다. 두 번째 preview가 같아야 preview의 무변경 계약을 충족한다.
2. 승인 preview의 `providerCandidateQueueIds`를 `expectedProviderCandidateQueueIds` allowlist로 authenticated primary에 1회 POST한다. API는 advisory lock/transaction 안에서 현재 후보 집합이 이 allowlist와 다르면 409로 원자적으로 거부하며 아무 queue도 claim하지 않는다.
3. 응답의 selected/processed queue ID가 승인 ID와 정확히 같고, 실행 count도 승인 ID 수와 같으며 `failed=0`, `resultUnknown=0`인지 확인한다.
4. 다음 preview에서 후보가 0인지 확인한다.
5. 빈 `expectedProviderCandidateQueueIds` allowlist로 한 번 더 POST해 selected/processed ID와 모든 변경 count가 0인지 확인한다. 그 사이 새 후보가 생기면 409로 중지하며 새 후보를 게시하지 않는다.
6. 마지막 preview도 후보 0인지 확인한다.

성공 출력은 이벤트명, 승인 preview의 정확한 count/ID, 최종 게시 count만 포함한다. HTTP 오류는 상태 코드만 남기며 응답 body는 출력하지 않는다. 이 단계가 실패하면 스케줄러를 시작하지 않는다.

## 4. 정확히 한 스케줄러 시작

현재 release bundle과 `state/current`가 같은 상태에서 전용 component 경로만 사용한다.

```bash
release_sha="$(cat /opt/brand-pilot/state/current)"
release_dir="/opt/brand-pilot/releases/$release_sha"
"$release_dir/deploy/scripts/deploy.sh" \
  "$release_dir/release.env" --component publish-scheduler
```

이 경로는 `publish-scheduler-1`만 pull/recreate하고, 실행 중인 `api-primary`의 image/revision과 scheduler source revision이 일치하는지 확인하며 container가 정확히 하나인지 검사한다. API, Caddy, DB, UI, 다른 worker를 재시작하지 않는다.

시작 직후 실행 container ID를 한 개만 얻고 세 번의 성공 tick을 관측한다.

```bash
scheduler_container="$(docker compose -p brand-pilot \
  -f "$release_dir/compose.production.yml" \
  --env-file "$release_dir/release.env" \
  --profile publish-scheduler ps -q publish-scheduler-1)"
test "$scheduler_container" != "" && test "${scheduler_container#*$'\n'}" = "$scheduler_container"

export PUBLISH_SCHEDULER_CONTAINER_ID="$scheduler_container"
export PUBLISH_SCHEDULER_HEARTBEAT_TICKS=3
npm run smoke:publish-scheduler -- --phase=heartbeat
```

heartbeat 검사는 PID나 고객 데이터를 로그에 복사하지 않고 서로 다른 `lastSuccessAt` 갱신 3회와 그 세 번째 성공의 `inFlightSince=null` 정착 상태까지 요구한다. 각 파일 읽기와 `docker exec`도 전체 남은 deadline으로 제한한다. timeout, malformed heartbeat, in-flight 고착은 실패다.

## 5. 활성화 후 확인

아래 항목이 모두 확인된 뒤에만 활성화를 완료로 기록한다.

- 승인 queue ID만 target/attempt/provider 결과가 전진했다.
- 해당 attempt는 한 번뿐이며 provider 결과가 `published`로 확정됐다.
- `result_unknown`, 중복 attempt, 승인 외 queue 변경이 없다.
- 스케줄러 heartbeat가 세 번 연속 갱신됐고 최근 오류가 없다.
- `publish-scheduler-1`은 1개이며 restart count가 증가하지 않았다.
- API `/health`, `/ready`가 정상이고 API restart count가 변하지 않았다.
- 고객 앱의 게시 목록/캘린더/예약 상세가 같은 공통 게시 항목을 정상 표시한다.
- Caddy와 무관 worker의 실행 digest/restart count가 기준선과 같다.

마지막에만 release state를 갱신한다. `state/current`와 GitHub `PRODUCTION_RELEASE_SHA`는 전체 release 승격이 실제로 끝났을 때만 새 SHA로 기록한다. scheduler profile을 켠 사실만으로 두 값을 바꾸지 않는다.

## 즉시 중지 조건

다음 중 하나라도 보이면 후속 tick을 기다리지 않고 scheduler만 중지한다.

- preview 또는 실행에서 승인하지 않은 candidate ID
- plan quota/count 불일치
- provider `result_unknown` 또는 결과 미확정
- 같은 queue의 중복 attempt
- stale/in-flight heartbeat 또는 heartbeat schema 오류
- scheduler restart loop 또는 두 개 이상의 scheduler container
- canary mutation/호출 흔적
- API/Caddy/UI/무관 worker digest 또는 restart count 변화
- API health/ready 실패 또는 고객 게시 화면 회귀

## 롤백

가장 먼저 scheduler만 끈다.

```bash
release_sha="$(cat /opt/brand-pilot/state/current)"
release_dir="/opt/brand-pilot/releases/$release_sha"
"$release_dir/deploy/scripts/rollback.sh" --component publish-scheduler --disable
```

첫 활성화의 롤백 목표는 disabled profile이다. 기존 scheduler를 교체한 경우에는 변경 전에 기록한 실제 immutable digest가 들어 있는 서명된 release bundle로 scheduler 하나만 복원한다. manifest를 손으로 편집하거나 `latest`를 사용하지 않는다.

롤백 중에도 API/UI/DB/Caddy/다른 worker는 그대로 유지한다. migration 091을 되돌리지 않고, 완료된 게시·예약·attempt를 삭제하거나 재작성하지 않는다. 중지 후 heartbeat, 마지막 attempt와 provider 결과, 승인 ID를 보존한 채 원인을 조사한다.
