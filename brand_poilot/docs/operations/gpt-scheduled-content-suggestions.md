# GPT 예약 기반 콘텐츠 제안 운영 절차

## 배포 범위

이 문서는 코드 검증부터 운영 등록까지의 절차를 정의한다. 다음 작업은 앞 단계의 검증이 성공한 뒤 순서대로 실행한다.

- 운영 API/UI 배포와 봉인된 DB migration 실행
- ChatGPT에 운영 MCP 앱 등록 및 플러그인 연결
- Scheduled task 생성 또는 활성화

## OpenAI 제품 경계

OpenAI의 [Scheduled Tasks 안내](https://help.openai.com/en/articles/10291617-tasks-in-chatgpt)에 따르면 Scheduled task는 연결된 앱을 사용할 수 있지만 GPTs는 지원하지 않는다. 따라서 이 기능의 실행 주체는 “커스텀 GPT”가 아니라 “ChatGPT Scheduled task + 연결된 Brand Pilot MCP 앱”이다. Scheduled는 Codex 기능이 아니므로 Ubuntu CLI나 Codex 자동화로 생성·관리하지 않는다.

플러그인은 워크플로 지침과 연결 앱을 묶는 배포 단위다. Brand Pilot의 DB 저장 기능은 플러그인 자체가 아니라 공개 HTTPS MCP 서버의 두 도구가 수행한다. 관련 기준은 [플러그인 MCP 서버 문서](https://developers.openai.com/plugins/build/mcp-server)와 [플러그인 연결·테스트 문서](https://developers.openai.com/plugins/deploy/connect-chatgpt)를 따른다.

Pro 계정의 활성 Scheduled task 한도는 15개다. 이 기능은 분야별 task 15개를 모두 사용하므로 다른 활성 task가 있으면 일부를 일시중지해야 한다. 각 task는 하루 한 번만 실행되며, 분야별 시작 시각을 5분씩 분산한다.

## 노출 도구와 권한

운영 MCP URL은 다음 하나다.

```text
https://api.danbammsg.co.kr/plugins/content-suggestions/mcp
```

도구는 다음 두 개만 노출한다.

1. `get_content_suggestion_scope`: 분야, KST 날짜, 활성 세부분야와 한도 조회
2. `publish_content_suggestion_batch`: 검증된 한 분야 배치를 원자적으로 저장

SQL, 일반 CRUD, 브랜드 목록, 사용자 정보, 브랜드 코어 조회 도구는 노출하지 않는다. 고객 조회 API는 별도의 기존 로그인 세션과 브랜드 접근 권한을 사용한다.

고정 bearer secret이나 ChatGPT에 직접 입력하는 API key는 사용하지 않는다. API는 외부 OAuth 2.1 authorization server가 발급한 JWT의 서명, issuer, audience, 만료를 JWKS로 검증하는 resource server다. 다음 운영 설정은 모두 필수다.

- `CONTENT_SUGGESTION_OAUTH_ISSUER`: 외부 authorization server issuer
- `CONTENT_SUGGESTION_OAUTH_JWKS_URI`: 서명 검증 JWKS URL
- `CONTENT_SUGGESTION_OAUTH_AUDIENCE`: Supabase OAuth access token의 기본 audience인 `authenticated`
- `CONTENT_SUGGESTION_OAUTH_RESOURCE`: `https://api.danbammsg.co.kr/plugins/content-suggestions/mcp`
- `CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS`: 예약 전용 Supabase Auth 사용자 UUID 목록

API는 `/.well-known/oauth-protected-resource`에서 authorization server와 Supabase가 지원하는 `email` 표준 scope를 공개한다. 두 도구 모두 이 scope와 운영 허용 목록의 예약 전용 사용자 `sub`를 요구한다. Supabase OAuth access token의 기본 `aud`는 `authenticated`이고 동적 등록된 클라이언트 ID는 `client_id` claim으로 검증한다. MCP URL은 protected resource 식별자로 유지한다. 각 도구는 `tools/list`의 최상위 `securitySchemes`에 요구 scope를 공개하고, scope가 부족하면 결과의 `_meta["mcp/www_authenticate"]`에 OAuth challenge를 반환한다. 토큰, 프롬프트 전문, 출처 본문은 로그에 넣지 않는다. OpenAI의 [플러그인 인증 문서](https://developers.openai.com/plugins/build/auth)에 따라 ChatGPT 연결 과정에서 OAuth 로그인을 완료하고 access token의 issuer, audience, client ID, `sub`, `email` scope를 모두 확인한다.

## 배포 후 등록 순서

1. 운영 백업과 롤백 지점을 확인한다.
2. 075 checksum과 운영 이력을 검증하고, 봉인된 post-075 data gate로 migration 076을 실행하거나 기존 증거를 검증한다.
3. migration 076이 적용된 상태에서 봉인된 post-075 schema gate로 migration 077만 실행하고 owner, application DML 권한, public 권한 부재, DDL guard 재활성화를 검증한다. 두 gate 모두 owner-only provider DB URL 파일을 사용하며 일반 migration 경로나 inline DB URL을 사용하지 않는다.
4. API와 UI를 배포하되 Scheduled task는 아직 만들지 않는다.
5. `/ready`와 기존 고객 핵심 흐름을 확인한다.
6. MCP Inspector로 운영 URL을 초기화하고 도구 목록이 정확히 두 개인지 확인한다.
7. credential이 없거나 틀리면 OAuth `WWW-Authenticate` challenge와 401이 반환되고, 정상 OAuth access token이면 initialize가 성공하는지 확인한다.
8. ChatGPT 웹에서 `Settings > Security and login > Developer mode`를 켠다.
9. Plugins 화면의 추가 버튼에서 운영 MCP URL을 등록하고 연결·인증을 완료한다.
10. 발견된 도구 이름, 입력/출력 스키마, read/write annotation을 검토한다.
11. 등록 후 브라우저 URL의 `plugin_asdk_app...` 기술 ID를 복사한다.
12. `$plugin-creator`에 해당 기술 ID와 `brand-pilot-content-suggestions` 이름을 전달해 플러그인 패키지와 테스트용 개인 marketplace 항목을 만든다.
13. 새 ChatGPT 대화에 플러그인을 연결하고 아래 수동 검증을 통과시킨다.
14. `docs/operations/gpt-scheduled-content-suggestion-tasks.json`을 기준으로 15개 task를 Scheduled 화면에서 만든다.
15. 첫 3일은 매일 저장 수, 오류 코드, 대시보드/생성 화면 노출을 확인한다.

운영 앱 기술 ID는 환경마다 달라 등록 전에는 만들 수 없다. 소스에 가짜 `plugin_asdk_app...` ID를 넣지 않는다.

## 수동 검증

첫 검증 분야는 `travel_tourism`으로 고정한다.

1. 일반 ChatGPT 대화에 Brand Pilot 플러그인을 연결한다.
2. `get_content_suggestion_scope({"categoryCode":"travel_tourism"})`를 호출한다.
3. 응답 날짜가 KST 오늘이고 활성 세부분야가 DB와 일치하는지 확인한다.
4. 정보성 1개와 트렌드성 1개만 포함한 작은 테스트 배치를 만든다.
5. 잘못된 세부분야, `advertising` intent, 3번 position, `file://` 출처를 각각 보내 전체 거부되는지 확인한다.
6. 정상 배치를 게시하고 `status: published`, `batchId`, `savedCount`를 확인한다.
7. 같은 payload를 다시 보내 동일 batch ID가 반환되는지 확인한다.
8. 고객 API에서 날짜와 출처가 반환되지 않는지 확인한다.
9. 대시보드 카드와 `/ai-content/new?view=today`를 확인한다. 과거 `view=suggestions` 링크도 같은 화면으로 열리는지 확인한다.
10. 대시보드 버튼으로 `/ai-content/new?suggestionId=<저장된 ID>`에 진입해 V3 입력이 채워지는지 확인한다.

## 15개 task 생성

정의 파일의 배열 순서대로 만든다. 이름, `categoryCode`, KST 시각과 프롬프트를 임의로 바꾸지 않는다. 각 task는 scope 조회 후 웹 검색을 수행하고, 저장 성공까지 완료 범위에 포함한다.

한 task의 정상 완료 조건은 다음 세 가지가 모두 참인 경우다.

- `publish_content_suggestion_batch`가 실제로 호출됨
- 응답 `status`가 `published`
- 응답에 `batchId`가 있음

분야 전체에서 유효한 항목이 0개거나 저장 호출이 실패하면 해당 실행은 실패다. 채팅 본문에 결과를 남기는 것으로 대체하지 않는다.

## 관측과 롤백

API 로그에서는 category code, generation date, batch ID, saved count, 처리 시간과 안정적인 오류 코드만 확인한다. 토큰, 프롬프트 전문, 출처 본문과 사용자 브랜드 코어를 로그로 남기지 않는다.

문제가 발생하면 다음 순서로 중단한다.

1. Scheduled 화면에서 15개 task를 모두 일시중지한다.
2. 플러그인의 Brand Pilot 앱 연결 또는 write action을 비활성화한다.
3. API 배포를 이전 버전으로 롤백한다.
4. migration 076 데이터와 migration 077 스키마는 구버전 API에서 사용하지 않으므로 즉시 삭제하거나 역변환하지 않는다.
5. 원인을 확인한 뒤 데이터 삭제가 정말 필요한 경우 별도 승인과 백업 후 수행한다.
