# Brand Pilot Subject Analysis Worker

제품·서비스 URL 분석 작업을 하나씩 가져와 Codex CLI로 고객·시장 분석을 만든다.

```powershell
npm run env:check -- --process=subject-analysis-worker
npm run dev:subject-analysis-worker
```

단일 작업은 `npm run subject-analysis-worker:once`로 실행한다. 한 프로세스는 동시에 하나의 작업만 처리한다. 분석 중에는 30초마다 lease heartbeat를 보내며 Codex 실행 제한은 15분이다.

API claim 응답의 `job`은 `subject-analysis.v1` 입력과 `analysisId`, `workerId`, `leaseToken`을 포함한다. Codex는 `subject-analysis-result.v1` JSON만 출력해야 한다.

제품·서비스 사실은 API가 추출한 페이지 데이터만 사용한다. 공개 웹 검색은 VOC·대안·시장 맥락으로 제한한다. 계약 파싱 실패는 재시도하지 않고 기록하며, 프로세스·네트워크 오류만 API의 최대 3회 재시도 정책에 맡긴다.

Codex는 `.runtime-subject-analysis` 아래 임시 작업 디렉터리에서 `--sandbox read-only`, `--ignore-user-config`, `--ephemeral`로 실행한다. 패키지의 `subject-analysis` skill만 런타임의 `.agents/skills`로 복사하고, Codex 자식 프로세스에는 실행·인증·네트워크에 필요한 환경변수 허용목록만 전달한다. 작업 종료 시 임시 파일을 삭제한다.

`read-only` sandbox는 저장소 쓰기를 막지만 호스트 파일 읽기 자체를 격리하지 않는다. 운영 환경에서는 전용 OS 계정 또는 별도 컨테이너로 워커를 실행하고, 해당 계정이 불필요한 호스트 경로와 비밀정보를 읽지 못하도록 권한을 제한한다.
