# 수동 콘텐츠 비주얼 품질 확인

이 절차는 제품·스타일·아바타 선택이 카드뉴스·릴스·블로그 기획과 이미지 입력에 실제로 반영되는지 사람이 비교하기 위한 로컬 전용 확인 절차입니다. 자동 점수, 자동 재시도, 자동 재생성, 운영 배포는 수행하지 않습니다.

## 고정 조건

- 원문 URL: `https://www.theverge.com/streaming/977474/youtube-partner-program-new-requirements`
- 구성안 생성: 수동 origin의 composition만 Codex Fast, 모델과 추론 강도는 운영값 유지
- 최종 기획: 형식별 기존 호출 1회
- 패키징: 기존 `package_finalize` 1회
- 판단: 여섯 결과의 화면과 기록을 사용자가 직접 비교

다음 명령으로 여섯 케이스를 확인합니다.

```powershell
node scripts/ai-content-quality-cases.mjs --manifest
```

| 케이스 | 제품 | 제품 이미지 | 스타일 | 아바타 |
| --- | --- | --- | --- | --- |
| `none` | 없음 | 없음 | 없음 | 없음 |
| `product-text` | 설명 포함 | 없음 | 없음 | 없음 |
| `product-image` | 설명 포함 | 포함 | 없음 | 없음 |
| `style` | 없음 | 없음 | 포함 | 없음 |
| `style-avatar` | 없음 | 없음 | 포함 | 기본 아바타 |
| `all` | 설명 포함 | 포함 | 포함 | 기본 아바타 |

제품은 이미지가 없어도 이름·설명·특징·혜택이 기획 입력에 포함되어야 합니다. 스타일은 선택한 preset의 고정 revision만 사용하며 과거 `brandRules.designRules.referenceImages`를 대신 사용하지 않습니다. 아바타는 선택한 revision 또는 명시적인 `없음`이어야 합니다.

## 로컬 준비

1. 운영 데이터와 섞이지 않는 로컬 DB에 migration 079를 적용합니다.
2. 같은 브랜드에 다음 자산을 준비합니다.
   - 설명이 있는 제품/서비스 1개
   - 해당 제품의 선택적 hero 또는 detail 이미지 1개 이상
   - 안전하게 확인된 reference item 1개 이상
   - reference item을 연결한 기본 브랜드 스타일 preset 1개
   - 대표 이미지가 있는 기본 아바타 1개
3. 로컬 API와 고객 UI, content-proposal/Card/Reel/Blog/Image worker를 같은 commit으로 실행합니다.
4. 각 케이스는 새 수동 생성으로만 실행합니다. 자동 생성과 과거 queued 작업을 재사용하지 않습니다.

## 케이스별 확인 및 캡처

각 케이스에서 다음 화면을 캡처합니다.

1. 구성안 선택 후 표시되는 제품·스타일·아바타 선택 상태
2. 선택한 구성안과 전체 구성안 목록
3. 생성 진행 상태와 생성 ID
4. 완성된 전체 deck 또는 결과
5. 개별 장면 이미지

각 생성 ID에 대해 다음 값도 기록합니다.

- 선택한 product service ID와 실제 product image asset IDs
- style preset ID/revision과 실제 staged reference item IDs
- avatar ID/revision과 실제 staged avatar image asset IDs
- 첨부 ID
- proposal/planning/render/total 소요 시간
- proposal/planning 및 장면별 render attempt 수
- 장면별 완료 상태와 이미지 URL

raw prompt, 원문 본문, Blob URL/pathname, checksum, 인증 정보는 보고서에 넣지 않습니다. 프롬프트 전달 손실은 기존 형식별 진단의 계약 버전·해시·ID·attempt·terminal code로만 확인합니다.

## 비교 보고서 만들기

여섯 생성 기록을 JSON 배열로 저장한 뒤 다음을 실행합니다.

```powershell
node scripts/ai-content-quality-cases.mjs --input .\tmp\manual-visual-runs.json --out .\tmp\manual-visual-quality
```

생성물:

- `report.json`: 선택, 생성 ID, 시간, 시도 횟수, staged ID, 장면 상태
- `index.html`: 사람이 결과 링크와 정보를 나란히 비교하는 화면

보고서는 빠진 케이스를 `아직 실행하지 않음`으로 표시할 뿐 실행하거나 보정하지 않습니다.

## 사용자 판단 항목

- 제품 설명만 있을 때도 콘텐츠 소재가 자연스럽게 반영되는가
- 제품 이미지가 있을 때 필요한 장면에서만 사용되는가
- 스타일 preset의 색·폰트·메모와 reference가 결과 전반에 일관되게 반영되는가
- 아바타가 필요한 장면에서만 사용되고, `없음` 선택 시 임의 인물이 강제되지 않는가
- 아무것도 선택하지 않은 결과보다 정보나 레이아웃 품질이 떨어지지 않는가
- 선택을 늘렸을 때 모든 요소를 억지로 한 장에 넣지 않는가

품질 판단이 끝나기 전에는 보고서 결과만으로 프롬프트를 자동 변경하거나 재생성을 요청하지 않습니다.
