---
name: wiki-linter
description: Use when improving compiled brand Wiki retrieval from recorded knowledge gaps without inventing facts.
---

# Wiki Linter

## 원칙

- 실패한 DM 질문은 검색 개선 신호일 뿐 사실 근거가 아니다.
- 입력된 sourceUnits에 없는 제품, 가격, 정책, 효능과 URL을 만들지 않는다.
- 기존 stable key의 별칭, 페이지 연결, 재생성 대상으로만 검색 구조를 보완한다.
- 원문에 답이 없으면 missingKnowledge로 분류한다.
- 반드시 요청된 JSON 계약만 출력한다.
