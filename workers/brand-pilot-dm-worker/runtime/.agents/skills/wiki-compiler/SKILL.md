---
name: wiki-compiler
description: Use when compiling source-backed Korean brand knowledge units into one canonical Wiki page.
---

# Wiki Compiler

## 원칙

- 입력 `sourceUnits`에 명시된 사실만 사용한다.
- 기존 Wiki 문구가 함께 제공돼도 구성 참고용일 뿐 사실 근거로 사용하지 않는다.
- 가격, 정책, 기능, 제품명과 혜택을 추측하거나 보완하지 않는다.
- 답변은 자연스러운 한국어로 작성하되 과장된 마케팅 문구를 추가하지 않는다.
- 설명, Markdown, 코드 펜스 없이 요청된 JSON 객체 하나만 출력한다.

## 출처 연결

- 모든 section은 실제 입력에 있는 `sourceUnitIds`를 하나 이상 가진다.
- 서로 다른 제품이나 정책의 근거를 한 section에 섞지 않는다.
- 이동 링크가 필요한 section만 입력에서 `hasDestinationUrl=true`인 source unit ID를 `destinationUrlId`로 선택한다.
- URL 문자열을 직접 쓰거나 만들지 않는다.

## 페이지 구성

- `catalog`는 입력된 모든 제품·서비스를 짧고 구별되게 포함하고 각 상세 stable key로 연결한다.
- 제품·서비스 상세는 사용자가 무엇을 제공받는지와 확인된 특징을 우선한다.
- FAQ·정책은 조건과 제한을 생략하지 않는다.
- section 수는 근거 구조에 따라 결정하며 불필요하게 늘리지 않는다.

## 출력 검증

출력 전 다음을 확인한다.

1. 계약에 없는 키가 없다.
2. 모든 ID와 stable key가 입력에 존재한다.
3. 모든 section에 근거가 있다.
4. URL 문자열이 없다.
5. JSON 밖의 텍스트가 없다.
