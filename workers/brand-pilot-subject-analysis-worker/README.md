# 모종 Subject Analysis Worker

제품·서비스 분석 작업을 하나씩 가져와 Codex CLI로 사실·시장 분석과 타깃별 소구점을 만든다. 별도 appeal 워커는 없으며, 이 프로세스 하나가 `analysis`와 `appeal` 두 phase를 모두 처리한다.

```powershell
npm run env:check -- --process=subject-analysis-worker
npm run dev:subject-analysis-worker
```

단일 작업은 `npm run subject-analysis-worker:once`로 실행한다. 한 프로세스는 동시에 하나의 작업만 처리한다. 기본 lease는 900초, heartbeat는 30초, API 요청 제한은 300초, Codex 실행 제한은 900초다. 작업이 중단되면 lease 만료 후 다시 claim하며 프로세스·네트워크·5xx/408/429 오류는 최대 3회 시도한다. JSON 계약 검증 오류와 명시적인 비재시도 API 오류는 즉시 최종 실패로 기록한다.

API claim 응답은 `analysisId`, `workerId`, `leaseToken`, 계약 버전과 phase를 포함한다. 신규 생성은 `subject-analysis.v2`를 사용하며 다음 네 한국어 프롬프트를 입력 유형과 phase에 따라 선택한다.

- `product-analysis.v2-ko`: 제품 사실·사용 맥락·대안·VOC 분석
- `service-analysis.v2-ko`: SaaS·컨설팅·교육·대행·구독·전문 서비스의 제공 방식과 도입 맥락 분석
- `product-appeal.v2-ko`: 제품 분석 결과를 근거로 타깃과 소구점 생성
- `service-appeal.v2-ko`: 서비스 분석 결과를 근거로 타깃과 소구점 생성

기존 저장 데이터는 `subject-analysis.v1`과 `subject-analysis-result.v1`을 계속 읽고 처리한다. v2 분석 결과는 `subject-analysis-result.v2`, 소구점 결과는 `subject-appeal-result.v2` JSON 계약으로 검증한다.

제품·서비스 사실은 API가 URL, 직접 설명, 첨부 문서와 이미지에서 준비한 근거만 사용한다. 공개 웹 검색은 VOC·대안·시장 맥락으로 제한한다. 계약 파싱 실패는 재시도하지 않고 기록하며, 프로세스·네트워크 오류만 API의 최대 3회 재시도 정책에 맡긴다.

분석 입력은 URL, 직접 설명과 다음 첨부를 조합할 수 있다.

| 구분 | 형식 | 파일당 최대 크기 |
|---|---|---:|
| 제품·인물·크기 비교·시각 참고 이미지 | PNG, JPEG | 5 MB |
| 문서 | TXT, Markdown, CSV | 5 MB |
| 문서 | PDF, XLSX | 10 MB |

서버는 확장자만 신뢰하지 않고 MIME, 크기, Blob 메타데이터와 파일 시그니처를 검증한다. 분석용 첨부 ID는 해당 생성 건에 속한 파일만 허용한다.

v2 분석은 `generationId`에 종속된다. 다른 생성 건에서 같은 URL을 입력해도 공용 URL 캐시를 재사용하지 않는다. 같은 생성 건의 동일 입력은 기존 활성 분석을 반환하고, 같은 idempotency key의 중복 요청도 같은 결과를 반환한다. v2 전체 재분석/`force`는 지원하지 않으며, 소구점만 `appeals/regenerate`로 다시 만들 수 있다. 기존 v1 URL 캐시와 상세 조회는 읽기 호환을 위해 유지한다.

## 환경 변수

로컬 PC와 실제 서버는 아래 변수를 **동일한 이름과 의미**로 설정한다. 주소와 비밀값만 환경에 맞게 바꾸며, 서버 이전 시 임의의 다른 변수명이나 숨은 기본값을 만들지 않는다.

- 필수: `BRAND_PILOT_API_URL`, `WORKER_API_TOKEN`
- 실행 식별·폴링: `SUBJECT_ANALYSIS_WORKER_ID`, `SUBJECT_ANALYSIS_POLL_MS`
- lease/API/Codex 제한: `SUBJECT_ANALYSIS_LEASE_SECONDS`, `SUBJECT_ANALYSIS_HEARTBEAT_MS`, `SUBJECT_ANALYSIS_API_TIMEOUT_MS`, `SUBJECT_ANALYSIS_CODEX_TIMEOUT_MS`
- Codex: `SUBJECT_ANALYSIS_CODEX_COMMAND`, `SUBJECT_ANALYSIS_CODEX_MODEL`, `SUBJECT_ANALYSIS_CODEX_REASONING_EFFORT`, `SUBJECT_ANALYSIS_CODEX_FAST_MODE`

기준값은 [`.env.example`](.env.example)에 있다. `WORKER_API_TOKEN`은 중앙 API와 정확히 같아야 하고 실제 `.env`와 비밀값은 커밋하지 않는다. 서버에서도 `npm run env:check -- --process=subject-analysis-worker`를 통과한 뒤 워커를 시작한다.

Codex는 `.runtime-subject-analysis` 아래 임시 작업 디렉터리에서 `--sandbox read-only`, `--ignore-user-config`, `--ephemeral`로 실행한다. 패키지의 `subject-analysis` skill만 런타임의 `.agents/skills`로 복사하고, Codex 자식 프로세스에는 실행·인증·네트워크에 필요한 환경변수 허용목록만 전달한다. 작업 종료 시 임시 파일을 삭제한다.

`read-only` sandbox는 저장소 쓰기를 막지만 호스트 파일 읽기 자체를 격리하지 않는다. 운영 환경에서는 전용 OS 계정 또는 별도 컨테이너로 워커를 실행하고, 해당 계정이 불필요한 호스트 경로와 비밀정보를 읽지 못하도록 권한을 제한한다.
