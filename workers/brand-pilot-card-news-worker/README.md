# 모종 Card News Worker

카드뉴스 분석 및 1~5장 PNG 생성을 담당하는 독립 Codex CLI 워커다. 중앙 API의 `card-news` 작업만 가져오고, `codex-cli/content` 자원 lease를 얻은 동안 한 작업만 처리한다.

`npm run run-once --workspace @brand-pilot/card-news-worker` 또는 `npm run dev --workspace @brand-pilot/card-news-worker`로 실행한다.
