# 게시 캘린더 운영 통합·배포 설계

작성일: 2026-08-14
운영 기준 SHA: `d9827a28f1ea66a4bb9b731466645f327606ca6b`

## 목표

승인된 게시 캘린더를 현재 운영 소스에 통합하되, 운영 게시큐와 다른 기능을 바꾸지 않는다. DB·API를 먼저 배포하고 검증한 뒤 UI를 배포한다.

## 보존하는 운영 경로

- 운영 예약 게시 실행 주체는 기존 Vercel Cron 호환 인증 경로인 `GET /internal/cron/publish-due`다.
- 운영의 `LOCAL_SCHEDULER_ENABLED=false`는 유지한다. 로컬 프로세스 러너를 새 주 실행 주체로 만들지 않는다.
- 현재 카드뉴스·릴스 직접 게시, 게시 결과 확인, 재시도, 취소, 목록 필터와 deep link를 유지한다.
- 캘린더 자동 배정은 별도 `POST /internal/cron/publish-calendar-allocate`로 분리한다.

## 데이터와 호환성

- 운영 migration 077과 078을 그대로 유지한다.
- 캘린더는 새 forward-only migration `079_publish_calendar_runtime.sql`로 추가한다.
- 079는 기존 테이블·컬럼을 삭제하거나 의미를 변경하지 않는다. 구버전 API가 079 적용 뒤에도 정상 동작해야 한다.
- 자동 게시 설정은 기본적으로 꺼져 있다. migration만 적용해도 기존 브랜드에 자동 슬롯이나 게시가 생성되지 않는다.
- 캘린더를 활성화할 브랜드의 플랜·구독 원장이 준비되지 않으면 해당 설정 활성화를 거부한다. 임의 한도 seed로 가장하지 않는다.
- 구독 원장이 아직 없는 기존 브랜드의 직접 게시와 기존 예약 큐에는 캘린더 구독 gate를 적용하지 않는다. 브랜드 활성·채널 연결·게시 시각 등 기존 실행 검사는 유지한다.

## 채널 범위

이번 릴리스의 캘린더 예약·자동 게시 채널은 Instagram만 지원한다. 다른 채널의 기존 기능은 유지하지만, 게시 adapter가 구현되기 전에는 캘린더 설정과 수동 슬롯에서 선택·저장할 수 없다.

## 릴리스 순서

1. Release A: additive DB 079, API, quota와 queue 연결, 운영 문서만 PR로 병합한다.
2. 운영 DB 백업 후 079를 적용하고 기존 API 호환성을 확인한다.
3. Release A API 이미지를 immutable digest로 canary 배포하고 health/ready/API 계약을 확인한 뒤 승격한다.
4. Release B: 캘린더 UI와 사이드바 사용량 UI를 별도 PR로 병합한다.
5. Vercel 운영 화면에서 목록 회귀, 캘린더 조회, 상세, 설정 기본-off, 반응형을 확인한다.
6. 기존 게시-due cron과 새 allocation cron을 각각 확인한다.

## 실패와 rollback

- DB migration 실패 시 API를 승격하지 않는다. 백업 메타데이터와 migration 로그를 보존한다.
- API canary가 실패하면 production 컨테이너를 건드리지 않는다.
- API 승격 후 오류가 나면 변경된 API 서비스만 직전 검증 digest로 복구한다. worker와 UI는 건드리지 않는다.
- UI 오류는 UI release B만 되돌린다. Release A API와 additive schema는 유지할 수 있어야 한다.

## 완료 조건

- PR과 CI가 운영 SHA의 후손 커밋을 검증한다.
- migration, contract, API, UI 테스트와 production build가 모두 현재 커밋에서 통과한다.
- 운영 DB backup, schema 079, API digest, UI revision, health/ready, restart count, queue heartbeat와 최근 오류 로그의 실제 증거가 있다.
- 운영 `/internal/cron/publish-due`가 유지되고 자동 설정이 꺼진 상태로 배포된다.
