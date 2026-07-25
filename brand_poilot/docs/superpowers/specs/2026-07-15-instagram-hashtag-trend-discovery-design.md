# Instagram Hashtag Trend Discovery Design

작성일: 2026-07-15  
상태: Approved design  
대상: Brand Pilot 고객용 React 앱, 중앙 API, Supabase PostgreSQL

## 1. 목적

고객이 Instagram 해시태그를 검색해 Meta가 선정한 인기 공개 콘텐츠를 확인하고, 유용한 콘텐츠를 브랜드의 외부 참고 소스로 저장할 수 있게 한다.

이 기능은 콘텐츠를 자동 복제하거나 주제 큐에 바로 넣는 기능이 아니다. 고객이 시장의 시각적 흐름과 반응이 좋은 콘텐츠를 발견하고, 이후 콘텐츠 생성에 사용할 참고 자료를 선택하는 탐색 도구다.

## 2. 확정 범위

### 포함

- Meta 공식 Instagram API with Facebook Login 사용
- Instagram 연결이 완료된 브랜드만 사용
- 해시태그 검색
- `top_media` 인기 공개 미디어 최대 150개 수집
- 릴스, 일반 동영상, 이미지, 캐러셀 표시
- Meta 인기순, 좋아요순, 댓글순 정렬
- 미디어 형식 필터
- 콘텐츠 상세 모달
- Instagram 원본 이동
- 브랜드 외부 참고 소스로 저장
- 브랜드별 검색 기록과 즐겨찾기 해시태그
- 24시간 공용 캐시
- 기존 업종을 대표 분야와 세부 분야로 교체

### 제외

- 캡션 자유 검색
- `recent_media`
- 타 계정 미디어 조회수와 재생수 분석
- 급상승, 순위 변동, 자체 인기 점수
- 지표 스냅샷 이력
- 자동 주기 갱신과 Cron
- 트렌드 수집 전용 워커
- 트렌드 콘텐츠의 주제 큐 자동 추가
- Instagram 미연결 고객을 위한 운영자 공용 계정
- 공개 미디어 파일의 영구 복제 저장

## 3. Meta API 기준

검색 순서는 Meta `top_media` 응답 순서를 그대로 사용한다. Meta는 Instagram 해시태그 검색의 인기 게시물 선정 방식과 같은 기준을 사용한다고 설명하지만 계산식은 공개하지 않는다. 따라서 Brand Pilot은 Meta 순서를 자체 점수로 대체하지 않는다.

호출 흐름:

```text
GET /ig_hashtag_search
  -> IG hashtag ID
  -> GET /{ig-hashtag-id}/top_media
  -> 커서 페이지네이션으로 최대 150개 정규화
  -> DB upsert
```

요청 필드:

- `id`
- `caption`
- `comments_count`
- `like_count`
- `media_type`
- `media_url`
- `permalink`
- `timestamp`
- `username`
- `children`

제약:

- 페이지당 최대 50개를 요청하고 커서를 따라 전체 최대 150개까지 수집한다.
- 연결된 Professional Instagram 계정을 대신해 요청한다.
- 계정당 연속 7일 동안 최대 30개의 고유 해시태그 제한을 고려한다.
- 좋아요 숨김 콘텐츠에는 `like_count`가 없을 수 있다.
- 해시태그 이모지와 공백 입력은 허용하지 않는다.
- Meta 미디어 URL은 만료될 수 있으므로 `permalink`를 최종 원본으로 취급한다.

출시 전 Meta 앱에서 `Instagram Public Content Access` 기능과 Hashtag Search에 필요한 권한의 Advanced Access 승인을 확인해야 한다. 기존 게시·DM 권한만으로는 공개 해시태그 검색이 보장되지 않는다.

공식 문서:

- [Instagram Hashtag Search](https://developers.facebook.com/docs/instagram-api/guides/hashtag-search)
- [IG Hashtag Top Media](https://developers.facebook.com/docs/instagram-api/reference/ig-hashtag/top-media)
- [Instagram API with Facebook Login](https://www.postman.com/meta/instagram/folder/23987686-3a75357f-e106-47ef-a8d9-af1aadf85365)

## 4. 사용자 흐름

### 4.1 진입

사이드바에 `트렌드 탐색` 메뉴를 추가한다.

Instagram 연결이 없거나 정상 상태가 아니면 검색 UI 대신 연결 상태와 `채널 연결로 이동` 버튼을 표시한다.

### 4.2 검색

1. 사용자가 `#` 포함 여부와 관계없이 해시태그를 입력한다.
2. 클라이언트는 저장된 DB 결과를 먼저 요청한다.
3. 24시간 이내 갱신된 결과가 있으면 캐시 결과만 표시한다.
4. 캐시가 없거나 24시간을 초과했으면 기존 결과를 유지한 채 `갱신 중`을 표시한다.
5. 중앙 API가 고객의 암호화된 Meta 토큰을 복호화해 Meta를 직접 호출한다.
6. 반환 결과를 공용 데이터에 upsert하고 브랜드 검색 기록을 갱신한다.
7. 클라이언트는 최신 결과를 다시 받아 화면을 교체한다.

해시태그 정규화:

- 앞의 `#` 제거
- 양쪽 공백 제거
- Unicode NFKC 정규화
- 비교 키는 소문자 변환
- 표시값은 최초 정상 입력 형태 보존
- 내부 공백, 이모지, 빈 문자열 거부

### 4.3 탐색

기본 정렬은 Meta 인기순이다. 사용자는 좋아요순과 댓글순으로 바꿀 수 있다.

형식 필터:

- 전체
- 릴스
- 동영상
- 이미지
- 캐러셀

Hashtag Top Media 응답에는 `media_product_type`이 없다. `media_type=VIDEO`이면서 permalink의 canonical path가 `/reel/`인 경우에만 `릴스`로 표시하고, 나머지는 `동영상`으로 표시한다. 이 값은 화면 분류용 파생값이며 Meta 원본 필드로 저장하지 않는다.

### 4.4 상세와 저장

카드를 클릭하면 상세 모달을 연다.

표시 항목:

- 미디어 미리보기
- 형식
- 작성 계정
- 캡션
- 게시일
- 좋아요 수
- 댓글 수
- 검색 해시태그
- 마지막 갱신 시각
- Instagram 원본 이동
- 참고 소스로 저장

`참고 소스로 저장`은 기존 `source_urls`에 `source_type=reference`로 등록한다. Instagram 페이지는 일반 웹 크롤링이 실패할 수 있으므로 저장 시점의 캡션, 작성 계정, 지표, 게시일, 해시태그를 `source_snapshots`의 성공 스냅샷으로 함께 저장한다. 이 항목은 웹 크롤러를 다시 실행하지 않아도 콘텐츠 생성 근거로 사용할 수 있다. 같은 브랜드가 같은 permalink를 다시 저장하면 기존 소스를 반환한다. 주제 큐에는 넣지 않는다.

## 5. 화면 구조

### 5.1 트렌드 탐색

- 페이지 제목과 설명
- 마지막 갱신 시각
- 해시태그 검색 입력과 검색 버튼
- 최근 검색과 즐겨찾기 해시태그
- 미디어 형식 필터
- 정렬 메뉴
- 데스크톱 4열 썸네일 그리드
- 반응형 2열 또는 1열 그리드
- 20개 단위 화면 페이지
- 상세 모달

검색 시 Meta 결과를 최대 150개까지 수집하며 화면에서는 20개씩 표시한다. `더 보기`는 DB에 저장된 다음 항목을 표시한다.

이미지는 `media_url`, 캐러셀은 첫 번째 child 미디어, 동영상은 `<video preload="metadata">`로 미리보기한다. 접근할 수 없는 URL은 플레이스홀더로 대체하고 원본 Instagram 링크는 유지한다.

### 5.2 브랜드 설정

기존 `업종` UI를 제거한다.

- 대표 분야: 시스템 고정 목록에서 정확히 1개 선택
- 세부 분야: 시스템 목록과 직접 입력을 합해 최대 5개
- 사용자 정의 세부 분야: 앞뒤 공백 제거 후 30자 이하
- 대표 분야를 변경하면 기존 시스템 세부 분야 중 새 대표 분야에 속하지 않는 항목을 제거하기 전에 확인한다.
- 사용자 정의 세부 분야는 대표 분야 변경 시 유지할 수 있다.

## 6. 대표 분야와 세부 분야 초기값

대표 분야는 코드와 표시명을 분리해 저장한다.

| 코드 | 표시명 | 시스템 세부 분야 초기값 |
|---|---|---|
| `travel_tourism` | 여행·관광 | 국내여행, 해외여행, 자유여행, 패키지여행, 항공권, 여행 경비, 지역 가이드 |
| `hospitality_leisure` | 숙박·레저 | 호텔, 펜션, 리조트, 캠핑, 액티비티, 테마파크, 예약 서비스 |
| `food_dining` | 식음료·외식 | 음식점, 카페, 베이커리, 주류, 식품, 배달, 외식 브랜드 |
| `shopping_commerce` | 쇼핑·커머스 | 온라인 쇼핑몰, 리테일, 생활용품, 구독 커머스, 해외구매, 선물, 상품 큐레이션 |
| `beauty_fashion` | 뷰티·패션 | 스킨케어, 메이크업, 헤어, 네일, 의류, 잡화, 주얼리 |
| `health_fitness` | 건강·운동 | 헬스, 요가, 필라테스, 러닝, 영양, 웰니스, 의료 정보 |
| `education_learning` | 교육·학습 | 입시, 외국어, 직무 교육, 자격증, 온라인 강의, 유아 교육, 학습 코칭 |
| `parenting_family` | 육아·가족 | 임신·출산, 영유아, 초등 육아, 가족 활동, 육아용품, 부모 교육, 가족 상담 |
| `pets` | 반려동물 | 반려견, 반려묘, 반려용품, 사료·간식, 훈련, 미용, 동물 건강 |
| `real_estate_home` | 부동산·주거 | 아파트, 상가, 임대, 분양, 인테리어, 리모델링, 주거 정보 |
| `finance_insurance` | 금융·보험 | 재테크, 대출, 카드, 보험, 세금, 회계, 자산 관리 |
| `it_software` | IT·소프트웨어 | SaaS, AI, 개발, 데이터, 보안, 업무 자동화, IT 기기 |
| `business_professional` | 비즈니스·전문 서비스 | 마케팅 컨설팅, 브랜드 전략, 콘텐츠 운영, 법률, 노무, 세무, 경영 자문 |
| `culture_content` | 문화·콘텐츠 | 도서, 영화, 음악, 공연, 전시, 크리에이터, 미디어 제작 |
| `local_lifestyle` | 지역·생활 서비스 | 지역 상점, 청소, 이사, 수리, 세탁, 웨딩, 생활 편의 |

시스템 세부 분야는 운영 데이터이며 삭제하지 않고 `active=false`로 비활성화한다.

대표 분야별 기본 추천 해시태그는 다음과 같이 시작한다. 추천값을 클릭해도 즉시 수집하지 않고 검색 입력에만 채우며, 사용자가 검색 버튼을 눌러야 Meta를 호출한다.

| 대표 분야 | 기본 추천 해시태그 |
|---|---|
| 여행·관광 | `#여행`, `#국내여행`, `#해외여행` |
| 숙박·레저 | `#호텔`, `#호캉스`, `#여행숙소` |
| 식음료·외식 | `#맛집`, `#카페`, `#먹스타그램` |
| 쇼핑·커머스 | `#쇼핑`, `#온라인쇼핑`, `#신상품` |
| 뷰티·패션 | `#뷰티`, `#패션`, `#데일리룩` |
| 건강·운동 | `#운동`, `#헬스`, `#건강` |
| 교육·학습 | `#교육`, `#공부`, `#자기계발` |
| 육아·가족 | `#육아`, `#육아정보`, `#가족` |
| 반려동물 | `#반려동물`, `#강아지`, `#고양이` |
| 부동산·주거 | `#부동산`, `#인테리어`, `#아파트` |
| 금융·보험 | `#재테크`, `#금융`, `#보험` |
| IT·소프트웨어 | `#IT`, `#AI`, `#SaaS` |
| 비즈니스·전문 서비스 | `#마케팅`, `#브랜딩`, `#사업` |
| 문화·콘텐츠 | `#문화생활`, `#콘텐츠`, `#전시` |
| 지역·생활 서비스 | `#지역맛집`, `#동네생활`, `#생활서비스` |

## 7. 데이터 모델

### 7.1 분야 데이터

`content_categories`

- `id uuid primary key`
- `code text unique not null`
- `name text not null`
- `sort_order integer not null`
- `active boolean not null default true`

`content_subcategories`

- `id uuid primary key`
- `category_id uuid not null references content_categories(id)`
- `code text not null`
- `name text not null`
- `sort_order integer not null`
- `active boolean not null default true`
- `unique(category_id, code)`

`content_category_hashtags`

- `id uuid primary key`
- `category_id uuid not null references content_categories(id)`
- `subcategory_id uuid null references content_subcategories(id)`
- `normalized_tag text not null`
- `display_tag text not null`
- `sort_order integer not null`
- `active boolean not null default true`
- 대표 분야 기본 태그와 세부 분야 전용 태그의 중복 방지 unique index

`brand_profiles`

- `primary_category_id uuid null references content_categories(id)` 추가
- 기존 `industry`는 전환 기간 동안 deprecated 상태로 유지

`brand_profile_subcategories`

- `id uuid primary key`
- `workspace_id uuid not null`
- `brand_id uuid not null`
- `brand_profile_id uuid not null`
- `subcategory_id uuid null references content_subcategories(id)`
- `custom_name text null`
- `custom_key text null`
- 시스템 선택 또는 `custom_name + custom_key` 중 정확히 한 방식만 존재하는 check constraint
- 사용자 입력은 1~30자 check constraint
- 시스템 선택 중복 방지 unique index
- `custom_key`로 브랜드 내 사용자 입력 중복 방지

최대 5개 제한은 API transaction 안에서 잠금 후 검증한다.

### 7.2 트렌드 데이터

`instagram_trend_hashtags`

- `id uuid primary key`
- `normalized_tag text unique not null`
- `display_tag text not null`
- `meta_hashtag_id text null`
- `last_refreshed_at timestamptz null`
- `last_error_code text null`
- `created_at`, `updated_at`

`instagram_trend_media`

- `id uuid primary key`
- `instagram_media_id text unique not null`
- `username text null`
- `caption text null`
- `media_type text not null`
- `media_url text null`
- `permalink text not null`
- `posted_at timestamptz null`
- `like_count bigint null`
- `comments_count bigint null`
- `last_fetched_at timestamptz not null`
- `raw_metadata jsonb not null default '{}'`
- `created_at`, `updated_at`

`instagram_trend_hashtag_media`

- `hashtag_id uuid not null`
- `media_id uuid not null`
- `meta_rank integer not null check (meta_rank between 1 and 50)`
- `first_seen_at timestamptz not null`
- `last_seen_at timestamptz not null`
- `primary key(hashtag_id, media_id)`
- `unique(hashtag_id, meta_rank)`

이 테이블은 현재 Meta 순위만 저장한다. 순위 이력이나 변동값은 저장하지 않는다.

`brand_trend_searches`

- `id uuid primary key`
- `workspace_id uuid not null`
- `brand_id uuid not null`
- `hashtag_id uuid not null`
- `is_favorite boolean not null default false`
- `last_searched_at timestamptz not null`
- `search_count integer not null default 1`
- `unique(brand_id, hashtag_id)`

`instagram_trend_account_hashtags`

- `id uuid primary key`
- `workspace_id uuid not null`
- `brand_id uuid not null`
- `brand_channel_id uuid not null references brand_channels(id)`
- `hashtag_id uuid not null`
- `quota_window_started_at timestamptz not null`
- `last_meta_queried_at timestamptz not null`
- `unique(brand_channel_id, hashtag_id)`

Meta를 실제 호출한 경우에만 기록한다. 같은 계정과 해시태그를 7일 안에 다시 호출해도 `quota_window_started_at`은 갱신하지 않는다. 7일을 넘긴 뒤 다시 호출하면 새 시각으로 갱신한다. 계정 연결이 바뀌면 새 `brand_channel_id` 범위로 계산한다.

`brand_trend_saved_media`

- `id uuid primary key`
- `workspace_id uuid not null`
- `brand_id uuid not null`
- `trend_media_id uuid not null`
- `source_url_id uuid not null references source_urls(id)`
- `created_at timestamptz not null`
- `unique(brand_id, trend_media_id)`
- `unique(source_url_id)`

### 7.3 테넌트 경계

트렌드 해시태그, 미디어, 해시태그-미디어 관계는 공개 콘텐츠 공용 데이터다. 브랜드 검색 기록, 즐겨찾기, 참고 소스 연결은 workspace와 brand 소유권을 가진다.

## 8. API 계약

### 분야

`GET /content-categories`

- 활성 대표 분야와 활성 시스템 세부 분야 반환

기존 브랜드 프로필 API:

- `GET /brands/:brandId/profile`
- `PUT /brands/:brandId/profile`

추가 필드:

```json
{
  "primaryCategoryCode": "business_professional",
  "subcategories": [
    { "type": "system", "code": "marketing_consulting", "name": "마케팅 컨설팅" },
    { "type": "custom", "name": "세일즈 메시지 설계" }
  ]
}
```

### 트렌드

`GET /brands/:brandId/instagram-trends?hashtag={tag}&type={type}&sort={sort}&page={page}`

- DB 결과만 즉시 반환
- Meta API를 호출하지 않음

`POST /brands/:brandId/instagram-trends/search`

요청:

```json
{ "hashtag": "콘텐츠마케팅" }
```

응답:

```json
{
  "hashtag": "콘텐츠마케팅",
  "source": "cache",
  "refreshed": false,
  "refreshedAt": "2026-07-15T05:20:00.000Z",
  "total": 42,
  "items": []
}
```

- 24시간 이내 캐시는 Meta 호출 없이 반환
- stale 또는 미수집 상태는 중앙 API가 Meta를 호출한 뒤 반환
- 처리 중 기존 GET 결과는 계속 표시 가능

`GET /brands/:brandId/instagram-trend-searches`

- 최근 검색과 즐겨찾기 반환

`PUT /brands/:brandId/instagram-trend-searches/:hashtagId/favorite`

- `{ "isFavorite": true }`

`POST /brands/:brandId/instagram-trends/:mediaId/save-source`

- permalink를 기존 reference source로 원자적 저장
- 수집된 캡션과 메타데이터로 성공 `source_snapshot` 생성
- 저장 관계를 idempotent하게 생성
- 기존 저장이 있으면 기존 `sourceUrl` 반환

## 9. 캐시와 동시성

- 공용 해시태그의 `last_refreshed_at`이 24시간 이내면 모든 브랜드가 캐시를 공유한다.
- Meta 호출 전에 현재 `brand_channel_id`의 활성 quota window에 속한 고유 해시태그 수를 확인한다. 30개에 도달하면 Meta를 호출하지 않고 제한 오류를 반환한다.
- 동일 해시태그에 stale 검색이 동시에 들어오면 PostgreSQL advisory lock 또는 원자적 refresh lease로 Meta 호출을 하나만 허용한다.
- 잠금을 얻지 못한 요청은 짧게 대기한 뒤 갱신된 DB 결과를 반환한다.
- Meta 호출 성공 후 한 transaction에서 미디어 upsert, 해당 해시태그의 기존 현재 관계 삭제, 새 관계와 rank 삽입, refreshed timestamp 갱신을 처리한다. 공용 미디어 자체는 삭제하지 않는다.
- Meta 실패 시 기존 결과와 `last_error_code`를 유지하고 성공 timestamp는 변경하지 않는다.

## 10. 인증과 보안

- 고객 브라우저에 Meta access token을 반환하지 않는다.
- 기존 `channel_credentials` 암호화 payload를 중앙 API에서만 복호화한다.
- Instagram channel 상태가 `connected`이고 credential 상태가 `active`여야 검색 가능하다.
- 모든 브랜드 전용 route에서 현재 사용자의 workspace와 brand 소유권을 검증한다.
- 공개 콘텐츠만 저장하며 비공개 계정 우회 수집을 하지 않는다.
- 미디어 파일은 Brand Pilot Storage에 복제하지 않는다.

## 11. 오류 처리

| 상황 | API 동작 | UI 동작 |
|---|---|---|
| Instagram 미연결 | `409 instagram_connection_required` | 채널 연결 안내와 이동 버튼 |
| 토큰 만료 | `409 instagram_reconnect_required` | 채널 상태 오류와 재연결 안내 |
| 권한 부족 | `409 instagram_permission_required` | 필요한 권한 안내 |
| 잘못된 해시태그 | `400 invalid_hashtag` | 입력 필드 오류 |
| 고유 해시태그 제한 | `429 hashtag_search_limit_reached` | 7일 제한 설명 |
| Meta 일시 오류 | `502 instagram_trend_fetch_failed` | 기존 결과 유지와 갱신 실패 표시 |
| 결과 없음 | `200`, 빈 items | 정상 빈 화면 |
| 좋아요 비공개 | `likeCount=null` | 좋아요 수 숨김 표시 |
| 미디어 URL 만료 | 정상 데이터 | 미리보기 대체 UI와 원본 이동 |
| 참고 소스 중복 | 기존 source 반환 | 저장됨 상태 유지 |

## 12. 업종 마이그레이션

제품 UI와 API contract는 `industry` 대신 대표·세부 분야를 사용한다.

전환 순서:

1. 분야 lookup과 관계 테이블 추가
2. `brand_profiles.primary_category_id` 추가
3. 명확히 매핑 가능한 기존 업종 값 변환
4. API와 React 타입을 새 필드로 전환
5. 콘텐츠 생성·이미지·텍스트 워커 프롬프트를 대표·세부 분야로 전환
6. 프로필 완료 조건을 대표 분야 기준으로 변경
7. 매핑되지 않은 기존 브랜드에 설정 재선택 요구
8. `industry` 읽기와 쓰기 금지
9. 안정화 후 별도 cleanup migration에서 `industry` 삭제

초기 Growthline의 `서비스`와 같이 범위가 불명확한 값은 자동 추측하지 않는다. 대표 분야가 없는 상태로 남기고 사용자에게 선택을 요구한다.

## 13. 테스트

### 단위 테스트

- 해시태그 정규화와 검증
- 24시간 캐시 경계
- Meta 응답 매핑
- Instagram media ID 중복 제거
- Meta rank 1~50 저장
- nullable like count
- 미디어 형식 매핑
- 대표 분야와 세부 분야 검증
- 시스템·사용자 세부 분야 합산 최대 5개

### 저장소와 API 테스트

- 공용 미디어 upsert
- 동일 해시태그 동시 refresh 단일 호출
- 브랜드 검색 기록 격리
- 참고 소스 idempotency
- Instagram 연결 상태별 오류
- Meta 실패 시 기존 결과 보존
- 업종 마이그레이션과 미매핑 브랜드 처리

### React 테스트

- 미연결 화면
- 첫 검색 loading
- 캐시 결과 즉시 표시
- 갱신 중 기존 결과 유지
- 형식 필터와 정렬
- 상세 모달
- 참고 소스 저장 상태
- 결과 없음과 오류 상태
- 대표·세부 분야 선택과 최대 5개 제한

### 실제 Smoke Test

테스트 Professional Instagram 계정으로 고유 해시태그 1개를 검색한다.

검증:

- 최대 150개 수집
- 24시간 내 재검색에서 Meta 미호출
- 콘텐츠 상세와 원본 링크
- 참고 소스 저장
- access token이 네트워크 응답과 브라우저 로그에 노출되지 않음

## 14. 성공 기준

- Instagram 연결 브랜드가 해시태그를 검색해 인기 콘텐츠를 확인할 수 있다.
- 24시간 내 같은 해시태그 검색은 Meta를 다시 호출하지 않는다.
- 같은 Instagram media ID가 중복 저장되지 않는다.
- 미디어 형식과 좋아요·댓글 정렬이 정상 작동한다.
- 선택한 콘텐츠를 외부 참고 소스로 중복 없이 저장할 수 있다.
- 기존 콘텐츠 생성 흐름이 대표·세부 분야를 사용하고 `industry`에 의존하지 않는다.
- 트렌드 기능이 새 워커나 Cron 없이 중앙 API에서 동작한다.
