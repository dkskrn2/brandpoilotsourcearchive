# Instagram DM 운영 런북

## 목적

Instagram DM 자동답변에서 사람이 확인해야 하는 상태를 안전하게 처리하고, 이미 발송됐을 수 있는 답변을 중복 발송하지 않기 위한 절차다.

## 일상 점검

1. DM 자동답변 화면에서 `확인 필요` 건수와 일시정지 대화를 확인한다.
2. 지식 데이터에서 활성 Wiki 버전, 마지막 활성화 시각, 최근 실패 빌드를 확인한다.
3. worker heartbeat가 끊겼거나 대기 작업이 계속 증가하면 worker 프로세스와 중앙 API 연결을 확인한다.
4. 로그에는 access token, app secret, 전체 credential payload를 기록하지 않는다.

## 일시정지 대화

- 불만, 발송 결과 불명확, 처리 오류 상태에서는 자동응답이 일시정지될 수 있다.
- 제한 요청과 지식 충돌은 확인 필요로 표시하지만 자동응답은 유지한다.
- 일시정지 중 수신 메시지는 저장하되 새 자동응답을 만들지 않는다.
- 원문, 판정 사유, 발송 시도 상태를 확인한 뒤 `확인 완료`를 실행한다.
- 같은 대화의 열린 확인 필요 항목이 모두 해결된 경우에만 자동응답이 다시 활성화된다.

## 확인 필요 유형

- `restricted_request`: 쿠폰 발행, 데이터 수정·삭제, 권한 변경 등 자동 수행 금지 요청이다.
- `complaint`: 불만 또는 항의가 포함된 대화다.
- `knowledge_gap`: 답변 근거가 없거나 FAQ가 충돌한다.
- `delivery_unknown`: Instagram 응답을 받지 못해 실제 발송 여부를 확정할 수 없다.
- `processing_error`: worker, Wiki, Graph API 처리 오류다.

## Wiki 상태

- 새 Wiki는 모든 문서 정제와 임베딩이 성공한 후에만 활성화된다.
- 빌드가 실패하면 최근 실패 원인을 확인하되 기존 활성 Wiki는 유지한다.
- FAQ 또는 제품 데이터를 수정한 뒤 Wiki 갱신 작업이 완료됐는지 확인한다.
- 직접 FAQ 충돌은 질문, 키워드, 별칭 중복을 제거한 후 새 Wiki를 만든다.

## 발송 결과 불명확

1. `delivery_unknown`인 발송은 자동 재시도하지 않는다.
2. Instagram 대화에서 실제 발송 여부를 먼저 확인한다.
3. 이미 발송됐다면 확인 필요 항목만 해결한다.
4. 발송되지 않았더라도 동일 자동응답을 즉시 재큐잉하지 않고 운영자가 상황을 판단한다.

## Worker 오프라인

1. 중앙 API health와 worker heartbeat를 확인한다.
2. `BRAND_PILOT_API_URL`, `WORKER_API_TOKEN`, `DM_WORKER_DATABASE_URL` 연결을 확인한다.
3. worker를 한 번만 실행해 가장 오래된 DM 작업이 처리되는지 확인한다.
4. 정상 처리 후 지속 실행을 재개한다. Meta credential은 worker 환경에 추가하지 않는다.

## Instagram 앱 수동 대응

- 권한 만료 또는 insufficient permission이면 채널 연결 상태를 확인하고 OAuth 재연결을 진행한다.
- Webhook 구독, callback URL, verify token은 Meta Developer 설정과 중앙 API 환경값이 일치해야 한다.
- app secret이나 access token을 화면 캡처, 이슈, 채팅, 저장소에 남기지 않는다.

## 운영 환경값

```text
KNOWLEDGE_CURATOR_TIMEOUT_MS=30000
DM_PROFILE_REFRESH_AFTER_HOURS=24
```

실제 비밀값은 배포 플랫폼의 비밀 저장소에만 둔다.
