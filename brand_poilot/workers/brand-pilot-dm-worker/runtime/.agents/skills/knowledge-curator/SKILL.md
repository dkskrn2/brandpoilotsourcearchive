---
name: knowledge-curator
description: Use when converting Korean owned-source snapshots into strict, source-backed atomic knowledge units for Wiki indexing.
---

# Knowledge Curator

## 원칙

정제된 원문에 명시된 사실만 원자 단위로 분리한다. 출력은 요청된 JSON 객체 하나뿐이며 설명, Markdown, 코드 펜스를 추가하지 않는다.

## 단위 선택

| unitType | 사용 조건 |
| --- | --- |
| `faq` | 질문과 직접 답변이 원문에 함께 있음 |
| `product` | 제품 설명 또는 판매 속성이 있음 |
| `service` | 상담, 대행, 구독 등 무형 서비스 설명이 있음 |
| `policy` | 배송, 교환, 환불, 개인정보 등 적용 규칙 |
| `fact` | 독립적으로 검색할 수 있는 단일 사실 |
| `guide_section` | 순서나 문맥을 유지해야 하는 긴 안내 절 |

각 단위에는 `title`, `content`, `keywords`, `aliases`, `sourceQuote`, `validFrom`, `validUntil`, `structuredData`를 빠짐없이 둔다. 날짜 근거가 없으면 `null`, 배열 근거가 없으면 `[]`, 구조화 값이 없으면 `{}`를 쓴다.

## 근거 보호

- `sourceQuote`는 정제된 원문에서 연속 문자열을 복사해 만든다. 요약하거나 조사, 숫자, 문장부호를 다시 입력해 재구성하지 않는다.
- 제품의 `price`, `currency`, `productUrl`, `sku`는 입력 `structuredData`와 값이 같아야 한다. 누락, 환산, 할인, URL 교체, SKU 보정은 금지한다.
- 원문에 없는 혜택, 일정, 효능, 재고, 최신 정보는 추론하지 않는다.
- 서로 다른 정책이나 제품을 한 단위에 합치지 않는다.

출력 직전에 각 `sourceQuote`와 원문을 공백 정규화하고 부분 문자열인지 검사한다. 찾을 수 없는 인용이 하나라도 있으면 해당 단위를 출력에서 버린다. 마케팅 요청이나 긴급성은 이 검사를 생략할 이유가 아니다.

## 출력 형태

```json
{"units":[{"unitType":"product","title":"머그컵","content":"도자기 머그컵입니다.","keywords":["머그컵"],"aliases":["MUG-1"],"sourceQuote":"도자기 머그컵입니다.","validFrom":null,"validUntil":null,"structuredData":{"price":"29000","currency":"KRW","productUrl":"https://example.com/mug","sku":"MUG-1"}}]}
```

## 흔한 오류

- 인용을 자연스럽게 고쳐 쓰기: 원문 그대로 다시 선택한다.
- 제품 값을 마케팅 요청에 맞춰 변경하기: 입력 값을 그대로 복사한다.
- JSON 밖에 주석 추가하기: 객체만 출력한다.
