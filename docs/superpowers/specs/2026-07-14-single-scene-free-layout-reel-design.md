# Single-scene Free-layout Reel Design

## Goal

Instagram 릴스용 정보 이미지를 정확히 한 장만 생성하고, 시각적 레이아웃은 워커가 주제와 원문에 맞게 자율적으로 결정한다.

## Contract

- 프롬프트 버전은 `worker-reel.v3`이다.
- `selectedAssetCount`와 `scenes` 길이는 정확히 1이어야 한다.
- 이미지는 최종 9:16 세로형 PNG여야 하며 후속 크롭에 의존하지 않는다.
- URL 근거, 구체적인 정보, 저장·공유 가치, 한글 가독성 및 브랜드 색상 참고 규칙은 유지한다.
- 표, 번호, 아이콘, 구분선, 강조 상자, 제목 위치, 정보 블록 수, 삽화 사용 여부를 중앙에서 지시하지 않는다.
- 워커가 한 장의 완성도 높은 정보 이미지 레이아웃을 자율적으로 구성한다.
- 기존 BGM 합성과 Instagram 게시 흐름은 유지한다.

## Validation

- 워커 manifest parser는 릴스 이미지가 한 장이 아니면 `reel_asset_count_invalid`를 반환한다.
- 중앙 API result parser도 같은 조건으로 거부한다.
- Reel renderer는 한 장이 아닌 입력을 `invalid_reel_scene_count`로 거부한다.
- 카드뉴스와 스토리 계약은 변경하지 않는다.

