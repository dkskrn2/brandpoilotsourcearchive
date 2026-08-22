# 목록·캘린더 공통 게시 항목 설계

작성일: 2026-08-20

기준 소스: 운영 release `f9cf909a84a3ad43420450e35b8f3ded9bfb3fb9`, 운영 API source `de95a8d2094afb4c5730ff2bff0deadfe01323f9`

운영 API source와 release 사이의 이 설계 관련 API·migration 파일에는 차이가 없음을 확인했다.

상태: 사용자 설계 승인, Release A/B 구현 계획 작성 완료

## 1. 배경과 확인된 원인

게시 관리의 목록 보기와 캘린더 보기는 같은 게시 운영 화면이지만 현재 운영 소스에서는 서로 다른 항목 집합을 사용한다.

- `apps/customer-ui/src/pages/PublishQueuePage.tsx`의 목록은 게시 큐, 콘텐츠 생성 결과, 게시 결과를 브라우저에서 조합한다.
- 같은 파일의 캘린더는 `calendarSlots.map(entryFromSlot)`만 사용한다.
- API의 캘린더 슬롯 조회는 `publish_calendar_slots`를 기준으로 하므로 슬롯과 연결되지 않은 기존 목록 항목은 캘린더에 나타나지 않는다.
- 목록 카드에는 캘린더에서 사용하는 게시 예약 설정 동작이 연결되어 있지 않다.

따라서 문제는 화면 표시 누락이 아니라 목록과 캘린더가 서로 다른 읽기 모델과 조작 경로를 사용하는 구조에 있다.

## 2. 목표

1. 목록과 캘린더가 `PublishItem[]` 한 벌을 공유한다.
2. 같은 게시 항목은 두 보기에서 같은 식별자, 상태, 채널, 콘텐츠 형식, 예약 시각과 게시 시각을 사용한다.
3. 예약·게시 이력이 있는 항목은 캘린더 날짜 칸에 표시한다.
4. 예약 시각이 없는 게시 가능 항목은 캘린더의 `미예약 콘텐츠` 보관함에 표시한다.
5. 목록과 미예약 보관함은 같은 게시 설정 패널과 같은 예약 API를 사용한다.
6. 생성 전, 생성 중, 생성 완료·미게시 항목을 예약할 수 있다.
7. 모든 수동·목록·일괄·자동 배정에서 최소 게시 간격 제한을 제거하고 동일 시각 다중 예약도 허용한다.
8. 기존 게시 큐 실행, 게시 실패·재시도, 늦은 자동 게시, 구독 주간 한도 정책은 유지한다.
9. 기존 일일 정보성·트렌드성 추천 2건의 자동 선택과 생성 전 슬롯 연결을 유지한다.
10. 자동 콘텐츠 형식 설정이 없을 때 카드뉴스·릴스 혼합 기본 배치를 유지하고, 명시한 형식 설정은 그대로 적용한다.
11. 사이드바의 `생성 N건 남음`은 생성 횟수 한도를 표시하며, 게시 예약만으로 생성 잔여량을 차감하지 않는다.
12. 게시 한도는 플랜 시작일 기준 주간 주기, 생성 한도는 구독 플랜의 별도 생성 횟수 계약을 따르며 월 구독 변경 경계에서도 서로 섞이지 않는다.

## 3. 비목표

- Instagram 외 게시 provider 추가
- 게시 큐 runner, provider adapter 또는 재시도 분류 변경
- 기존 게시 데이터의 일괄 변환 또는 보정
- 예약된 항목을 고객 UI에서 즉시 강제 게시하는 기능 추가
- 취소 후 재생성으로 우회하는 reschedule 기능 추가
- DM, FAQ, crawl, wiki, 무관 worker 변경 또는 회귀 테스트
- 게시 목록 pagination 재설계

## 4. 공통 게시 항목 한 벌

### 4.1 단일 조회 경로

게시 관리 페이지는 브랜드 범위의 공통 게시 항목 API를 한 번 호출한다.

```text
GET /brands/:brandId/publish-items
  -> PublishItem[]
       -> 목록 보기
       -> 캘린더 보기
```

목록용 응답과 캘린더용 응답을 별도로 만든 뒤 브라우저에서 합치지 않는다. 서버 repository가 기존 콘텐츠 생성, 캘린더 슬롯, topic publish group, publish queue와 publish result 관계를 workspace·brand 범위에서 결합해 한 항목 배열을 반환한다.

현재 목록처럼 페이지가 항목 전체를 한 번 읽고 두 보기는 동일한 배열에 정렬·필터·날짜 그룹화만 적용한다. 목록 pagination은 이번 범위에서 추가하지 않는다.

### 4.2 DTO

`PublishItem`은 다음 정보를 가진다.

- `itemKey`: 현재 응답 안에서 유일한 namespaced 식별자
- `workspaceId`, `brandId`
- `title`
- `createdAt`: 목록 정렬용 source 생성 시각. 캘린더 날짜에는 사용하지 않음
- `contentFormat`
- `channels`
- `source`: 기존 결과 상세에서 사용하는 source type, label, detail과 URL 배열
- `targets`: 채널별 queue ID, 상태, 실제 예약 시각, 게시·실패 시각, 오류, preview/output JSON, artifact URL, 외부 게시 ID/URL과 source summary
- `reviewTargets`: 기존 생성 검토를 유지하기 위한 channel output ID, 채널, delivery format, 검토 상태, preview/output JSON, source summary, block reason과 생성 시각. 최초 별도 목록 조회 없이 같은 항목에서 승인·거절·재생성 및 콘텐츠 상세를 수행한다.
- `contentStatus`: pre_generation, generating, completed 또는 failed
- `publishStatus`: unreserved, reserved, publish_queued, scheduled, deferred, publishing, partially_published, published, failed, result_unknown 또는 cancelled
- `status`: 두 상태에서 결정한 canonical 표시 상태
- `groupStatus`: 저장된 topic publish group 상태 또는 null
- `publicationProgress`: none, partial 또는 complete
- `scheduledFor`: 사용자가 정한 슬롯의 원래 예약 시각
- `effectiveScheduledFor`: 게시 큐가 실제로 실행할 시각
- `publishedAt`: 실제 게시 완료 시각
- `calendarDate`: 서버가 아래 날짜 규칙으로 결정한 캘린더 표시 시각 또는 null
- `calendarPlacement`: dated, unreserved 또는 hidden
- `assignmentMode`: automatic, manual, direct 또는 null
- `sourceRefs`: content topic, proposal, generation, generation output, calendar slot, topic publish group, queue ID
- `schedulable`: 현재 상태에서 새 예약 설정이 가능한지 여부
- `scheduleBlockedReason`: 예약 불가 이유
- `lastError`: 게시 실패 또는 지연 사유

publication unit의 가장 이른 추적 가능한 source를 기준으로 중복을 제거한다. 기존 `content_topics.status='selected'` 항목도 `contentTopicId`를 포함해 반환하며, 이 경로에서 생성된 topic publish group은 같은 content topic을 통해 하나의 논리 항목으로 결합한다. AI 생성 경로는 completed output이 있으면 output을 publication unit으로 사용하고, 아직 output이 없을 때만 generation을 사용한다. 하나의 generation에서 여러 output이 생성되면 각 output은 서로 다른 publication unit이다. 아직 group이 없는 항목은 content topic, generation output, generation, legacy queue 순서의 namespaced key를 사용한다. 모든 원본 ID를 `sourceRefs`에 유지해 mutation 후 서버 응답에서 원본을 다시 찾을 수 있게 한다. 한 응답 안에서는 같은 source/publication unit을 중복 반환하지 않는다.

UI는 별도 목록·슬롯 조회를 fallback으로 사용하지 않는다. 기존 `/publish-queue`와 `/publish-calendar/slots` 조회 route는 저장소 밖 운영 소비자를 확인할 수 없는 API 계약이므로 즉시 삭제하지 않지만, 게시 관리 페이지는 공통 게시 항목 API만 사용한다. no-key open-slot `POST /publish-calendar/slots`는 Release A에서 호출량과 actor를 관찰한다. 외부 호출이 없으면 Release B에서 제거하고, 호출이 있으면 caller를 keyed canonical provisioning으로 전환하기 전에는 Release B를 진행하지 않는다. 호출자가 없어진 customer UI client wrapper와 조합 함수는 repository call-site 확인 후 제거한다.

### 4.3 상태 결정

상태는 target별 사실을 먼저 보존하고, aggregate 상태는 현재 운영의 오류·재시도 우선순위를 유지한다.

1. 하나라도 `publish_delivery_unknown`이면 `result_unknown`
2. 하나라도 failed target이 있으면 `failed`
3. 모든 target이 cancelled이고 활성 slot/group/queue가 없으면 `cancelled`
4. cancelled target과 published 또는 활성 target이 섞이면 `failed`
5. 하나라도 publishing이면 `publishing`
6. 하나라도 deferred이면 `deferred`
7. 하나라도 scheduled이면 `scheduled`
8. queued target 또는 waiting/ready group이 있으면 `publish_queued`
9. required target 일부만 published이고 위의 더 높은 우선 상태가 없으면 `partially_published`
10. required target 전부가 published일 때만 `published`
11. 활성 calendar slot은 있지만 queue가 아직 없으면 `reserved`
12. 게시 예약 전에는 `completed_unpublished`, `generating`, `pre_generation` 순으로 content 상태를 사용

일부 target만 published이고 다른 target이 실패한 경우 aggregate는 `failed`, `publicationProgress`는 `partial`, 저장된 `groupStatus`는 `partially_published`가 될 수 있다. 생성 중인 콘텐츠가 이미 슬롯에 연결됐으면 `publishStatus=reserved`, `contentStatus=generating`을 함께 반환하고 UI는 `예약 · 생성 중`처럼 두 사실을 표시한다. UI는 target별 오류와 허용된 retry를 숨기지 않는다. `publishedAt`은 모든 required target이 published된 시점인 `max(target.publishedAt)`으로 정의하고, 부분 게시에서는 null로 둔다.

혼합 상태의 고정 결과는 다음과 같다.

| target 조합 | canonical 상태 | 진행도 |
| --- | --- | --- |
| scheduled + deferred | deferred | none 또는 partial |
| 모든 target cancelled, 활성 실행 없음 | cancelled | none |
| published + cancelled | failed | partial |
| published + failed | failed | partial |
| published + scheduled | scheduled | partial |
| 모든 required target published | published | complete |

### 4.4 캘린더 날짜 결정

- published: `publishedAt`
- scheduled, deferred, publishing: 가장 이른 활성 target의 `effectiveScheduledFor`
- 부분 게시이며 활성 예약 target이 있음: 가장 이른 활성 target의 `effectiveScheduledFor`
- 부분 게시이며 published+failed만 남음: 가장 늦은 published target의 `publishedAt`
- 예약 슬롯은 있지만 큐가 아직 준비되지 않음: `scheduledFor`
- 날짜가 없고 `schedulable=true`: `calendarPlacement=unreserved`로 미예약 콘텐츠 보관함에 표시
- 날짜가 없고 `schedulable=false`: `calendarPlacement=hidden`으로 캘린더에서는 숨기되 목록에는 유지
- 생성일과 수정일은 게시 캘린더 날짜로 사용하지 않음

과거 게시 이력과 미래 예약은 같은 캘린더에서 날짜별로 조회한다. 늦게 자동 게시되는 항목은 원래 예약 시각과 실제 실행 예정 시각을 상세에서 분리해 보여 준다.

## 5. UI 설계

### 5.1 목록 보기

목록은 공통 `PublishItem[]`을 기존 카드 구조로 렌더링한다.

- 생성 결과에 검토 대상이 있으면 기존 콘텐츠 상세, 승인·수동 승인·거절·재생성 동작과 부분 성공/새로고침 실패 처리를 유지한다.
- 생성 전·생성 중·생성 완료·미게시이며 예약이 없는 항목: `게시 설정`
- 예약됨·deferred·게시 중: `예약 상세`
- 게시 완료: `결과 보기`
- 실패·취소: 기존 오류와 허용된 재시도 동작

카드에 원래 예약 시각, 실제 실행 예정 시각 또는 게시 완료 시각을 상태에 맞게 표시한다.

### 5.2 캘린더 보기

캘린더는 같은 `PublishItem[]`을 날짜 기준으로 그룹화한다.

- 날짜 칸: 예약, 게시 중, 게시 완료 항목
- 미예약 콘텐츠 보관함: `calendarPlacement=unreserved`인 항목
- 보관함은 상태 필터와 제목 검색을 제공하고 한 번에 제한된 수를 보여 준 뒤 `더 보기`로 확장한다.
- `새 콘텐츠 생성`과 `여러 주제 일괄 설정`은 미예약 콘텐츠 영역에서 유지한다.

캘린더 진입 시 현재 월이면 서울 기준 오늘을 기본 선택한다. 다른 월로 이동하면 해당 월의 첫 날짜를 선택한다.

### 5.3 공용 게시 설정 패널

목록의 `게시 설정`과 캘린더 미예약 보관함의 `게시 설정`은 같은 컴포넌트를 사용한다.

- 선택 콘텐츠와 현재 생성 상태
- 콘텐츠 형식
- Instagram 연결 상태
- 게시 날짜와 시각
- 주간 게시 한도
- 예약 등록

선택한 기존 항목의 source는 고정하며 사용자가 다른 콘텐츠로 바꾸지 않는다. 다른 콘텐츠를 예약하려면 해당 항목에서 별도로 게시 설정을 연다.

예약된 항목은 새 예약 버튼을 제공하지 않는다. 상세에서 기존 슬롯과 큐 상태를 보여 주며 기존 취소 정책만 사용한다.

## 6. 예약 저장 흐름

### 6.1 기존 항목

목록과 캘린더는 동일한 manual slot provisioning 경로를 호출한다.

- 생성 중: `generationId`
- 생성 완료·미게시: `generationOutputId`
- AI 생성 전 draft: 기존 콘텐츠 생성 1단계를 시작하고 generation draft가 만들어지는 즉시 `generationId`로 슬롯 연결
- 현재 목록의 selected content topic: 기존 `(content_topic_id)` unique를 사용해 waiting topic publish group을 생성하거나 재사용하고 `generation_pending` 슬롯을 연결. topic 상태는 변경하지 않으며 기존 콘텐츠 생성 배치가 나중에 같은 group을 완성함

서버는 브랜드 advisory transaction 안에서 다음을 검증하고 슬롯 생성·source 연결을 원자 처리한다.

- workspace·brand 소유권
- 활성 구독과 현재 플랜
- 주간 게시 한도
- Instagram 연결과 활성 상태
- source의 콘텐츠 형식 일치
- 같은 source의 활성 슬롯 또는 활성 게시 큐 중복
- 과거 시각 여부
- idempotency key

성공 후 UI는 공통 게시 항목 한 벌과 게시 사용량을 다시 조회한다. 목록에서 예약한 항목은 같은 응답에서 미예약 보관함에서 사라지고 날짜 칸과 목록 카드에 예약 상태로 나타난다.

### 6.2 새 콘텐츠와 일괄 등록

새 콘텐츠는 기존 콘텐츠 생성 1단계를 그대로 사용한다. 목적, 형식과 DB catalog 기반 선택값을 수집한 뒤 generation draft가 생성되면 슬롯을 연결한다.

일괄 등록은 각 행이 기존 생성 1단계를 통과해 generation ID를 얻은 후 batch provisioning을 실행한다. 행별 상태와 전체 성공·실패를 구분하며 전체 transaction 실패 시 일부 슬롯만 남기지 않는다.

## 7. 최소 간격 제한 완전 제거

수동 예약, 목록 예약, 일괄 등록, 자동 새벽 배정 모두에서 최소 간격 검증을 제거한다. 동일 브랜드의 여러 publication unit이 정확히 같은 `scheduled_for`를 가져도 허용한다.

### 7.1 DB migration

현재 운영 최신 migration은 `084_ai_content_usage_reversal_identity_invoker.sql`이다. 구 API가 `publish_calendar_slots_active_brand_time_unique`를 `ON CONFLICT` arbiter로 직접 사용하므로, 이를 한 번에 제거하면 migration 적용과 canary 사이에 운영 write가 깨진다. 따라서 반드시 expand/contract 두 release로 나눈다.

**Release A — expand/compatibility (`085`)**

- `publish_calendar_slots.idempotency_key` nullable text 컬럼 추가. 기존 행은 null로 유지
- idempotency key가 있는 새 행을 `(brand_id, idempotency_key)`로 식별하는 partial unique index 추가
- `(brand_id, generation_output_id)` active partial unique index 추가
- 기존 brand/time unique와 generation unique index는 유지
- API A는 새 idempotency key를 쓰고 brand/time·generation unique index를 repository의 replay 판정에 사용하지 않음
- API A의 customer manual/batch/settings 입력 검증은 30분 간격과 동일 시각 제한을 계속 유지해 Release A의 사용자 동작을 바꾸지 않음
- API A의 internal automatic keyed create path는 spacing을 적용하지 않아 Release B에서 저장된 duplicate/near settings로 rollback해도 allocator가 계속 동작함. Release A에서는 settings 입력 검증 때문에 이 permissive path가 사용자-visible 동일 시각 슬롯을 새로 만들지 않음
- API A를 모든 replica에 승격한 뒤 구 API process가 남지 않았음을 digest로 확인

**Release B — contract/feature (`086`)**

- `publish_calendar_slots_active_brand_time_unique` 제거
- 기존 generation unique를 `generation_id is not null and generation_output_id is null and status<>'cancelled'`인 generation-level slot에만 적용하도록 교체
- output-level은 Release A에서 만든 `(brand_id,generation_output_id)` active unique를 사용
- 기존 non-unique `(brand_id,scheduled_for,id)` index 유지
- API/UI B에서 모든 간격 제한 제거와 공통 게시 항목 UI를 활성화
- 기존 슬롯 데이터 변환 없음

Release B 이후 application rollback 대상은 API/UI A다. API A는 time unique가 없어도 동작하고 기존 동일 시각 슬롯과 duplicate/near automatic settings를 읽고 새 horizon까지 계속 배정·실행할 수 있어야 한다. forward-only `086`을 즉시 되돌려 unique index를 재생성하지 않는다. 동일 시각 데이터가 만들어진 뒤 schema 복구가 필요하면 write를 중지하고 중복 데이터 처리에 대한 사용자 승인을 받은 별도 복구만 수행한다.

### 7.2 repository 변경

- `validateSlotTimes`의 중복·30분 검증과 `assertSlotSpacing` 제거
- 고객 UI 자동 설정의 `slotTimesAreSpaced`, 일괄 등록의 30분 검증·문구·`+30분` 기본 증가 규칙 제거
- 설정 시간 배열의 최소 간격 검사 제거
- batch 내부 행 간 최소 간격 검사 제거
- allocator의 timestamp `Set` 중복 건너뛰기를 occurrence key 기반 replay 판정으로 교체
- `ON CONFLICT (brand_id, scheduled_for) WHERE status <> 'cancelled'` 의존 제거
- 같은 시각의 기존 슬롯을 먼저 찾아 conflict 처리하는 분기를 제거하고, idempotency key와 동일 source 검증으로 대체한다.
- manual provisioning은 요청의 기존 idempotency key를 slot에 저장하고 동일 key replay에서 동일 payload면 기존 slot을 반환한다.
- batch provisioning은 기존 `batchKey`와 `clientRowId`를 canonical encoding 후 hash한 key를 각 slot에 저장한다.
- automatic allocation은 서울 날짜, 설정 시각과 동일 시각 발생 순번으로 deterministic key를 만들어 재실행한다.
- automatic `createSlot` 입력과 내부 저장 경로에 deterministic idempotency key를 필수로 전달한다.
- 같은 idempotency key에 다른 source, 시각, 채널 또는 형식이 들어오면 conflict로 거부한다.
- `repository.ts`의 late calendar path는 `earliestSafePublicationTime`과 30분 blocked-time 조회를 사용하지 않고 overdue이면 현재 tick 시각으로 예약한다. 여러 overdue group은 같은 시각을 가질 수 있다.
- slot 없는 ready group path는 occupied policy slot 조회와 `nextAvailablePolicySlot`/queue ID jitter를 사용하지 않고 같은 다음 policy 시각을 사용할 수 있다. 호출자가 없어진 충돌 회피 helper는 제거한다.
- due queue claim, 실행 batch, provider 호출, retry 간격과 `publishing_started_at` stale recovery 30분은 게시 예약 간격이 아니므로 변경하지 않는다.
- source별 활성 unique는 source 종류에 맞게 유지한다. generation-level slot은 output이 없을 때만 generation unique, output-level slot은 output ID unique, publish group은 group unique다.
- output source 중복 검사는 같은 output ID 또는 같은 parent generation의 아직 output이 연결되지 않은 generation-level slot만 차단한다. 같은 generation의 서로 다른 completed output은 각각 예약할 수 있다.

자동 설정의 동일한 시간 문자열 중복도 허용한다. allocator는 정렬된 설정 시각별 발생 순번을 deterministic key에 포함하므로 같은 시각의 자동 슬롯 여러 개를 재실행해도 중복 생성하지 않는다. 서로 다른 게시 항목과 서로 다른 설정 슬롯이 같은 실행 시각을 갖는 것은 정상 상태다.

### 7.3 idempotency 계약

- brand lock 안에서 tenant와 key 형식을 확인한 직후 durable replay를 먼저 조회한다. 과거 시각, 현재 quota, 채널 상태처럼 성공 후 바뀔 수 있는 검증보다 replay 판정을 먼저 한다.
- 기존 key이면 저장된 assignment mode, recommendation kind, 정규화된 channels, content format, 정확한 timestamp, source kind와 source ID가 모두 같을 때만 기존 slot을 반환한다.
- 하나라도 다르면 `publish_calendar_idempotency_conflict`로 거부하고 기존 slot을 바꾸지 않는다.
- manual, batch, automatic, legacy-open namespace를 분리한다.
- batch key는 문자열 연결이 아니라 canonical JSON 배열 `[batchKey, clientRowId]`의 SHA-256으로 만든다.
- automatic key는 KST 날짜, 설정 시각, 정렬 후 동일 시각 occurrence index의 canonical JSON SHA-256으로 만든다.
- Release A의 기존 body에 key가 없는 legacy open-slot route는 `idempotency_key=null`을 유지하고 brand lock 아래 기존 active exact-time replay/conflict 의미를 보존한다. 따라서 active slot 취소 후 같은 payload를 다시 만들 수 있다. 새 customer UI와 allocator는 이 no-key route에 의존하지 않는다.
- API A의 legacy exact 조회는 같은 시각의 active row 전체를 읽어 source kind가 legacy-open이고 assignment mode, recommendation kind, 정규화 channels, format과 timestamp가 모두 같은 row를 찾는다. 여러 row 중 일치 항목이 있으면 ID 순 첫 항목을 반환하고, 같은 시각 row는 있지만 일치 항목이 없을 때만 기존 time conflict를 반환한다.
- Release B 전에 호출이 없음을 확인해 legacy write route를 제거하거나, 실제 caller가 있으면 keyed canonical provisioning으로 전환한다. no-key route를 남긴 채 동일 시각 기능을 활성화하지 않는다.
- automatic allocator는 deterministic key가 이미 존재하면 그 미래 slot을 immutable로 보존하고 현재 settings payload로 replay하지 않는다. slotTimes, channels 또는 format 변경은 아직 존재하지 않는 key의 새 slot에만 적용한다. server-generated automatic namespace가 아닌 기존 key 충돌은 오류로 거부한다.
- concurrent replay는 새 unique index와 brand lock으로 한 slot만 생성한다.

### 7.4 quota 계산 단위

게시 한도 1건은 timestamp나 채널 queue가 아니라 publication unit 1개다.

quota SQL도 공통 조회와 동일한 canonical publication unit key를 사용한다. AI generation output, 연결된 `contentTopicId`, generation, topic publish group, channel output, 마지막으로 queue ID 순으로 가장 이른 논리 source의 target을 묶는다. 따라서 group 생성 전후에도 AI output은 output 단위, 기존 topic 경로는 content topic 단위로 유지된다. `topic_publish_group_id is null` 전체를 하나로 group하지 않는다.

- 같은 시각의 서로 다른 publication unit 2개는 예약 2건
- 같은 group의 여러 channel target은 1건
- idempotency replay는 추가 0건
- calendar-linked group은 direct 집계에서 다시 세지 않음
- group 없는 서로 다른 legacy 콘텐츠 2개는 2건, 같은 legacy 콘텐츠의 multi-target은 1건
- cancelled unit은 예약 사용량에서 해제
- published 전이는 reserved에서 succeeded로 정확히 한 번 이동

## 8. 오류 처리

- 구독 없음: 일반 로딩 실패가 아니라 플랜 필요 안내
- 주간 한도 초과: 남은 게시 한도와 다음 구독 기간 시작일 안내
- 이미 예약된 항목: 새 슬롯을 만들지 않고 기존 예약 상세로 이동
- 과거 시각: 저장 전에 인라인 안내하고 서버도 재검증
- 채널 미연결 또는 비활성: Instagram 연결 안내
- 콘텐츠 형식 불일치: 저장 전 차단하고 항목 상태를 변경하지 않음
- tenant 범위 불일치: 존재 여부를 노출하지 않고 거부
- 공통 게시 항목 조회 실패: 목록과 캘린더 모두 stale data를 성공처럼 표시하지 않고 명시적 재시도 제공
- mutation 성공 후 재조회만 실패: 저장 성공과 새로고침 실패를 구분해 안내하고 중복 제출하지 않음

## 9. 테스트와 검증

### 9.1 API·repository

- publication unit 중복 제거와 상태 우선순위
- selected content topic이 생성 전 목록에 남고 topic publish group 생성 뒤 같은 논리 항목으로 결합됨
- 한 generation의 output 전환과 여러 output publication unit 분리
- scheduled+deferred, cancelled-only, published+cancelled, published+failed, published+scheduled, all-published target 조합의 aggregate 상태·진행도·날짜
- scheduled, deferred, published 날짜 결정
- 예약 없는 eligible 항목은 unreserved, 날짜 없는 failed/cancelled 항목은 hidden으로 반환
- 같은 source의 active slot/queue 중복 차단
- 같은 generation의 서로 다른 completed output 2건은 예약되고 같은 output replay는 차단됨
- workspace·brand 격리와 cross-tenant 거부
- subscription, weekly quota, channel, format 검증
- 플랜 시작일 기준 주간 게시 주기와 월 구독 변경 경계
- 게시 예약과 별도인 생성 횟수 잔여량 및 사이드바 `생성 N건 남음`
- 일일 정보성·트렌드성 추천 2건의 생성 전 자동 선택·슬롯 연결
- 자동 형식 미설정 시 카드뉴스·릴스 혼합, 명시 설정 시 해당 형식 적용
- 동일 시각의 서로 다른 슬롯 2건 생성 성공
- 동일 시각 duplicate automatic settings, batch, overdue calendar group과 slot 없는 direct ready group 성공
- idempotency replay가 시각 경과·quota 감소·채널 비활성 이후에도 기존 slot을 반환하고 새 슬롯을 만들지 않음
- assignment mode, recommendation kind, channels, format, timestamp와 source 중 하나라도 다른 동일 key는 conflict
- batch delimiter collision이 없고 concurrent replay가 한 slot만 생성
- legacy no-key open slot은 active replay를 유지하고 cancel 후 같은 payload로 새 slot 생성
- automatic settings의 slotTimes/channels/format 변경 후 기존 미래 slot 보존, 새 key slot만 새 settings 적용, allocator 무실패
- API B에서 duplicate/near automatic settings 저장 후 horizon 밖 날짜를 API A allocator가 배정해도 spacing conflict 없이 성공
- API B가 만든 same-time row 여러 개 중 뒤쪽 legacy-open payload가 일치할 때 API A replay가 정확한 row 반환
- 같은 시각 distinct publication unit 2개는 quota 2건, multi-target group은 1건, replay는 0건 추가
- group 없는 서로 다른 legacy publication unit 2개와 같은 legacy 콘텐츠 multi-target의 quota 구분
- calendar/direct 이중 집계 없음, cancel 해제, publish 전이의 reserved/succeeded 이동

DB를 읽거나 쓰는 변경 SQL은 운영과 동등한 최소 권한 application role의 실제 PostgreSQL에서 전체 transaction으로 검증한다. owner/provider role 통과만으로 완료 처리하지 않는다. migration 적용 전후의 index catalog와 application role의 INSERT, UPDATE, SELECT 권한 조합을 검증한다.

### 9.2 고객 UI

- 같은 `PublishItem`이 목록과 캘린더에서 같은 상태·시각으로 표시
- 목록 예약 후 같은 항목이 미예약 보관함에서 사라지고 날짜 칸에 표시
- 게시 완료가 `publishedAt` 날짜에 표시되고 재예약 버튼이 없음
- 부분 게시와 실패 target이 완료로 덮이지 않고 retry/error가 유지됨
- 날짜 없는 failed/cancelled 항목은 목록에 남고 캘린더 visible subset에서는 숨겨짐
- 생성 전·생성 중·완료 미게시만 게시 설정 가능
- 공용 게시 설정 패널을 두 보기에서 동일하게 사용
- 현재 월 진입 시 서울 기준 오늘 선택
- 구독 비활성 오류를 플랜 안내로 표시
- 모바일에서 캘린더와 상세 패널이 body 가로 overflow를 만들지 않음

### 9.3 영향 범위 회귀

- publish queue 목록, 결과 상세, 예약, 취소, 재시도
- calendar settings, manual provisioning, batch provisioning, allocator
- AI content generation draft와 generation completion의 slot linkage
- API typecheck/build와 customer UI build

DM, FAQ, crawl, wiki와 무관 worker는 변경하지 않고 테스트하지 않는다.

## 10. 배포 경계

게시 provider worker와 DM worker는 두 release 모두 변경하지 않는다.

### 10.1 Release A — schema expand와 호환 API

Release A와 Release B는 별도 PR·별도 운영 승격이다. `086`은 Release A의 모든 replica 확인과 rollback 기준 보존이 끝나기 전에 main의 pending migration으로 포함하지 않는다.

1. 원격 main, 실제 운영 release/API source SHA, API digest, dirty worktree와 진행 중 hotfix 확인
2. migration `085`를 최소 권한 application role의 실제 PostgreSQL transaction과 catalog 계약으로 검증
3. backup/PITR 확인 후 additive `085` 적용. 기존 API health와 calendar write canary 확인
4. brand/time unique에 의존하지 않고 B-created duplicate settings/data에도 호환되지만 Release A customer 입력 정책은 유지하는 API A를 server-only canary로 배포
5. 기존 목록, 캘린더, manual/batch/automatic write와 queue 실행 영향 테스트
6. no-key open-slot route의 caller/actor 관찰 결과 기록
7. 모든 API replica가 API A digest인지 확인하고 Release A를 rollback 기준으로 보존

Release A rollback은 API만 이전 digest로 복구할 수 있다. `085`는 additive이며 구 API와 호환되므로 schema는 forward 상태로 둔다.

### 10.2 Release B — contract와 기능 활성화

1. 운영의 모든 API replica가 API A인지 재확인하고 다른 배포/hotfix가 없는지 확인
2. no-key open-slot caller가 없으면 route 제거를 확정하고, caller가 있으면 keyed canonical provisioning 전환을 완료. 미완료면 Release B 중단
3. backup/PITR 후 contract migration `086` 적용
4. API A로 기존 calendar write, automatic allocation과 queue 실행이 계속 정상인지 확인
5. 공통 게시 항목 API와 간격 제거를 활성화한 API B를 canary 후 승격
6. 고객 UI B를 승격하고 운영 브라우저에서 목록·캘린더 동일 항목, 미예약 보관함, 공용 게시 설정, 동일 시각 2 publication unit을 확인
7. health, ready, API digest, restart count와 게시 관련 최근 오류 로그 확인

Release B rollback은 고객 UI A와 API A만 복구하며 `086`은 forward 상태로 둔다. API A는 time/generation unique 변경 후 schema, 이미 만들어진 동일 시각·동일 generation의 서로 다른 output 슬롯, duplicate/near automatic settings를 읽고 다음 horizon까지 실행할 수 있어야 한다. 중복 데이터가 생긴 뒤 index를 되살리는 schema rollback은 자동 절차에 포함하지 않는다.

## 11. 완료 조건

1. 목록과 캘린더가 네트워크에서 같은 `PublishItem[]` 응답을 사용한다.
2. 목록의 예약 가능한 모든 항목에 게시 설정 동작이 있다.
3. 캘린더 날짜 칸과 미예약 보관함은 `calendarPlacement`가 dated 또는 unreserved인 목록 subset과 정확히 일치하고, hidden 항목은 목록에 유지된다.
4. 예약·게시 완료 날짜 규칙이 자동 테스트와 운영 브라우저에서 동일하다.
5. 같은 시각의 서로 다른 슬롯을 수동·batch·automatic 경로에서 생성할 수 있다.
6. 주간 게시 한도, 구독, tenant, channel, format과 동일 source 중복 차단은 유지된다.
7. 기존 publish queue 실행·재시도·결과 조회가 영향 테스트를 통과한다.
8. 일일 추천 자동 선택, 생성 전 자동 슬롯 연결과 카드뉴스·릴스 기본 혼합이 유지된다.
9. 예약만으로 생성 잔여량이 줄지 않고, 사이드바는 `생성 N건 남음`을 정확히 표시한다.
10. 플랜 시작일 기준 주간 게시 한도와 월 구독 변경 경계가 기존 구독 계약대로 계산된다.
11. migration `085`/`086`과 변경 SQL이 최소 권한 application role의 실제 PostgreSQL에서 통과한다.
12. Release A 상태에서 `086` 적용 전·후 모두 calendar write와 queue 실행이 정상이고, API A rollback 호환성이 증명된다.
13. 무관 기능과 worker는 변경·배포·테스트 대상에 포함되지 않는다.
