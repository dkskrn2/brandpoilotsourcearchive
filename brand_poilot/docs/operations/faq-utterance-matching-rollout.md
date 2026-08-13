# FAQ 표현 예시 및 DM 매칭 운영 절차

## 변경 경계

이 기능은 FAQ 제안, 확장 exact, shadow matcher, 확인 질문을 단계적으로 활성화한다. fuzzy 후보를 직접 FAQ 답변으로 보내는 단계는 없다. onboarding worker, Wiki worker runtime, 콘텐츠 worker, Meta 앱 설정은 이 절차의 변경 대상이 아니다.

신규 FAQ 제안에서는 질문·답변·표현 예시를 한 카드에서 수정하고 `FAQ 승인` 한 번으로 원자적으로 저장한다. 표현 예시 전용 승인 상태나 별도 승인 요청은 없다. 기존 FAQ의 표현 예시 보강만 alias-only 실행과 적용 절차를 사용한다.

## 기본 환경값

```text
FAQ_UTTERANCE_SUGGESTIONS_ENABLED=false
FAQ_EXPANDED_EXACT_ENABLED=false
FAQ_MATCH_SHADOW_ENABLED=false
FAQ_CLARIFICATION_ENABLED=false
FAQ_MATCH_BRAND_ALLOWLIST=
FAQ_CLARIFY_THRESHOLD=0.78
FAQ_CONFIRMATION_TTL_SECONDS=300
```

allowlist가 비어 있으면 네 기능은 모든 브랜드에서 비활성이다. boolean은 소문자 `true|false`, threshold는 0~1, TTL은 30~900초만 허용한다.

## 출시 gate

다음을 로컬 release source에서 실행한다.

```bash
node --test scripts/faq-matcher-evaluation.test.mjs
node scripts/faq-matcher-evaluation.mjs
npm run test:deployment
```

필수 결과:

- curated fixture 60개 이상
- expanded-exact false positive 0
- expanded-exact precision 1.00
- clarification precision 0.90 이상
- 200 FAQ 후보 matcher p95 25ms 이하
- flags-off webhook 회귀 통과
- 빠른 후속응답·수동응답 경합 회귀 통과

## migration 078 적용 경계

일반 migration 계정의 DDL 차단을 우회하지 않는다. canary 배포 스크립트가 보호된 기존 provider URL 파일을 사용해 다음 순서를 강제한다.

1. 고정된 `076_manual_content_generation_brand_rules.sql` data migration을 적용하거나 기존 evidence를 검증한다.
2. 고정된 `078_faq_utterance_matching.sql`과 SHA-256 `a2c481f4ea5aba0430668d8e87d236f0a301a695cbecb4874400de0896aecde5`을 검증한다.
3. provider 세션이 대상 기존 relation 8개의 실제 owner인지 확인한 후 하나의 transaction으로 DDL과 migration marker를 기록한다.
4. 신규 column, table, index, trigger, reason constraint와 owner catalog가 정확할 때만 commit하고 `post-075-schema-migration-evidence.v1`을 mode `0600`으로 저장한다.
5. 이 gate가 끝난 뒤에만 canary container를 변경한다.

파일 내용, checksum, provider identity, 대상 catalog 중 하나라도 다르면 canary 변경 전에 중단한다. `078`은 기존 API가 계속 읽을 수 있는 expand-only schema이며 rollback 시 column/table을 삭제하지 않는다.

## FAQ worker 준비

`/opt/brand-pilot/shared/env/faq-worker-1.env`를 `bpdeploy:bpdeploy`, mode `0600`으로 만들고 `deploy/env/faq-worker.env.example` 계약을 채운다. `WORKER_API_TOKEN`은 API env와 같은 기존 worker token을 사용하며 값을 출력하지 않는다.

FAQ worker는 새 image key를 만들지 않고 현재 release의 immutable `DM_WORKER_IMAGE`를 재사용한다. 최초 시작은 release 배포와 분리해 운영자가 명시적으로 실행한다.

이번 기능의 worker rollout에서 공용 소스 때문에 `WIKI_WORKER_CHANGED=true`가 생성돼도 Wiki runtime은 교체하지 않는다. 공용 rollout 스크립트의 기본 동작은 유지하고, 이 FAQ release를 실행할 때 아래 제외값을 반드시 명시하며 결과에서 `wiki-worker-1`이 재생성되지 않았는지 확인한다.

```bash
export WORKER_ROLLOUT_EXCLUDED_SERVICES=wiki-worker-1
```

```bash
docker compose -p brand-pilot \
  -f /opt/brand-pilot/current/compose.production.yml \
  --env-file /opt/brand-pilot/current/release.env \
  --profile faq-worker-1 config --quiet

docker compose -p brand-pilot \
  -f /opt/brand-pilot/current/compose.production.yml \
  --env-file /opt/brand-pilot/current/release.env \
  --profile faq-worker-1 up -d --no-deps --pull never faq-worker-1
```

시작 후 worker resource/heartbeat에서 worker ID `faq-worker-1`, workload `faq`를 확인하고 full FAQ run 한 건과 기존 FAQ alias-only run 한 건을 각각 완료시킨다.

## 단계별 활성화

한 번에 한 단계만 바꾸고 대상 브랜드 ID만 allowlist에 넣는다.

1. `FAQ_UTTERANCE_SUGGESTIONS_ENABLED=true`: FAQ 제안 및 기존 FAQ 표현 제안만 확인한다.
2. `FAQ_EXPANDED_EXACT_ENABLED=true`: 정규화 후 유일하게 일치하는 표현만 기존 direct FAQ 경로로 보내는지 확인한다.
3. `FAQ_MATCH_SHADOW_ENABLED=true`: 최소 24시간 kind/FAQ ID/score만 수집하고 고객 응답이 바뀌지 않았는지 확인한다.
4. gate 통과 후에만 `FAQ_CLARIFICATION_ENABLED=true`: fuzzy 후보가 고정 확인 질문을 거쳐 답변하는지 확인한다.

conflict, 낮은 점수, URL, 이모지만 있는 발화는 확인 질문을 보내지 않고 기존 Wiki/fallback 경로로 간다.

## rollback과 실제 runtime 보존

worker 교체 전 release manifest만 믿지 말고 현재 실행 container의 immutable image와 ID를 기록한다.

```bash
docker ps --filter label=com.docker.compose.project=brand-pilot \
  --format '{{.Names}} {{.ID}} {{.Image}}'

docker inspect --format '{{.Name}} {{.Config.Image}} {{.Image}} {{.Config.Labels.org.opencontainers.image.revision}}' \
  brand-pilot-dm-worker-1-1 brand-pilot-dm-worker-2-1 2>/dev/null
```

- matcher 오판: migration/data를 되돌리지 않고 `FAQ_EXPANDED_EXACT_ENABLED`, `FAQ_MATCH_SHADOW_ENABLED`, `FAQ_CLARIFICATION_ENABLED`를 false로 바꾼다.
- FAQ worker 오류: `faq-worker-1` profile만 중지·삭제하고 FAQ 제안 플래그를 false로 바꾼다.
- DM worker 오류: 교체 직전 기록한 각 DM container의 immutable digest로 DM worker만 복구한다.
- Wiki worker와 무관 worker는 이 rollout에서 교체하지 않는다.
- migration 078의 column/table을 삭제하지 않는다. 신규 쓰기만 중단한다.

운영 배포가 실제로 승인되기 전에는 위 명령으로 production container를 변경하지 않는다.
