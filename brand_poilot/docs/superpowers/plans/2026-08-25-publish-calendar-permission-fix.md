# 게시 캘린더 예약 권한 오류 구현 계획

1. 합성 저장소가 게시 캘린더에 `aiContentPool`을 전달하는지 검증하는 실패 테스트를 추가한다.
2. UI가 `tenant_scope_rejected`와 `internal_error`를 서로 다른 문구로 표시하는 실패 테스트를 추가한다.
3. 게시 캘린더 저장소 배선을 `pool`에서 `aiContentPool`로 최소 변경한다.
4. UI 오류 매핑의 기본값을 재시도 가능한 일반 오류로 변경한다.
5. 관련 단위 테스트, PostgreSQL application-role 통합 테스트, 타입 검사와 빌드를 실행한다.
6. 변경 범위와 운영 영향도를 검토하되 배포하지 않는다.
