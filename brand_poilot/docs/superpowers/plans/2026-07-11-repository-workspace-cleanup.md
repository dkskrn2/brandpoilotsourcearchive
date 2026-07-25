# 저장소 워크스페이스 정리 구현 계획

> **에이전트 작업 필수 하위 스킬:** 이 계획을 항목별로 구현할 때 `superpowers:executing-plans`를 사용한다. 이 저장소는 현재 Git 저장소로 인식되지 않으므로 커밋 단계는 생략하고 각 작업 뒤 검증 결과를 기록한다.

**목표:** 루트 npm 워크스페이스와 한글 실행 문서를 추가하고, API 빌드 계약·마이그레이션 순서·생성 파일 관리를 정리한다.

**구조:** 기존 API, 고객 UI, 이미지 워커의 경계는 유지한다. 루트 npm 워크스페이스가 설치와 통합 명령을 제공하고, API는 `tsup`으로 실제 실행 가능한 ESM 결과물을 생성한다. Supabase PostgreSQL을 기본 데이터베이스로 문서화하며 로컬 Docker PostgreSQL은 선택적인 테스트 환경으로 남긴다.

**기술 스택:** npm workspaces, Node.js 20, TypeScript, tsup, Vitest, Playwright, Fastify, React/Vite, PostgreSQL/Supabase

---

### 작업 1: 저장소 구조 계약 테스트 추가

**파일:**
- 생성: `scripts/repository-contract.test.mjs`

- [ ] **1단계: 실패하는 계약 테스트 작성**

`scripts/repository-contract.test.mjs`에 Node 내장 테스트를 작성한다. 테스트는 다음을 검사한다.

```js
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("루트 패키지가 세 프로젝트를 npm 워크스페이스로 관리한다", async () => {
  const pkg = await readJson("package.json");
  assert.equal(pkg.private, true);
  assert.deepEqual(pkg.workspaces, ["apps/*", "workers/*"]);
  assert.equal(pkg.scripts.build, "npm run build --workspaces --if-present");
  assert.equal(pkg.scripts.test, "npm run test --workspaces --if-present");
});

test("API 빌드는 실제 dist 진입점을 만든다", async () => {
  const pkg = await readJson("apps/api/package.json");
  assert.equal(pkg.scripts.typecheck, "tsc --noEmit");
  assert.match(pkg.scripts.build, /tsup/);
  assert.equal(pkg.scripts.start, "node dist/index.js");
});

test("마이그레이션 번호가 001부터 011까지 고유하다", async () => {
  const files = (await readdir("db/migrations")).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(files.map((name) => name.slice(0, 3)),
    ["001", "002", "003", "004", "005", "006", "007", "008", "009", "010", "011"]);
});

test("하위 프로젝트에 별도 잠금 파일이 없다", async () => {
  const roots = ["apps/api", "apps/customer-ui", "workers/brand-pilot-image-worker"];
  for (const root of roots) {
    assert.rejects(readFile(`${root}/package-lock.json`));
  }
});
```

- [ ] **2단계: 테스트가 예상대로 실패하는지 확인**

실행: `node --test scripts/repository-contract.test.mjs`

예상: 루트 `package.json` 부재, API `typecheck` 부재, 마이그레이션 번호 중복, 하위 잠금 파일 존재로 실패한다.

### 작업 2: 루트 npm 워크스페이스와 API 빌드 구성

**파일:**
- 생성: `package.json`
- 생성: `package-lock.json` (`npm install` 생성)
- 수정: `apps/api/package.json`
- 삭제: `apps/api/package-lock.json`
- 삭제: `apps/customer-ui/package-lock.json`
- 삭제: `workers/brand-pilot-image-worker/package-lock.json`

- [ ] **1단계: 루트 패키지 파일 작성**

```json
{
  "name": "brand-pilot",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["apps/*", "workers/*"],
  "engines": { "node": ">=20" },
  "scripts": {
    "dev:api": "npm run dev --workspace @brand-pilot/api",
    "dev:ui": "npm run dev --workspace @brand-pilot/customer-ui",
    "dev:worker": "npm run dev --workspace @brand-pilot/image-worker",
    "worker:once": "npm run run-once --workspace @brand-pilot/image-worker",
    "worker:control": "npm run control --workspace @brand-pilot/image-worker",
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "test:contract": "node --test scripts/repository-contract.test.mjs",
    "test:e2e": "npm run e2e --workspace @brand-pilot/customer-ui",
    "db:up": "docker compose up -d postgres",
    "db:down": "docker compose down"
  }
}
```

- [ ] **2단계: API 빌드 스크립트 수정**

`apps/api/package.json`에 `typecheck`, 실제 번들 빌드, `tsup` 개발 의존성을 추가한다.

```json
"scripts": {
  "dev": "tsx watch src/index.ts",
  "typecheck": "tsc --noEmit",
  "build": "npm run typecheck && tsup src/index.ts --format esm --platform node --target node20 --out-dir dist --clean --sourcemap",
  "vercel-build": "npm run typecheck",
  "start": "node dist/index.js",
  "test": "vitest run",
  "seed": "tsx src/seed.ts"
}
```

`devDependencies`에는 `"tsup": "^8.5.0"`을 추가한다.

- [ ] **3단계: 하위 잠금 파일 제거 후 루트 잠금 파일 생성**

세 하위 `package-lock.json`을 제거한 뒤 루트에서 `npm install`을 실행한다.

예상: 루트에 단일 `package-lock.json`이 생성되고 세 워크스페이스 의존성이 설치된다.

- [ ] **4단계: 계약 테스트의 워크스페이스/API 항목 통과 확인**

실행: `node --test scripts/repository-contract.test.mjs`

예상: 마이그레이션 항목을 제외한 워크스페이스, API 빌드, 잠금 파일 검사가 통과한다.

- [ ] **5단계: API 빌드 결과 확인**

실행: `npm run build --workspace @brand-pilot/api`

예상: 타입 검사와 번들이 성공하고 `apps/api/dist/index.js` 및 소스맵이 생성된다.

### 작업 3: 마이그레이션 파일 순서 정리

**파일:**
- 이름 변경: `db/migrations/002_topic_rows_duplicate_policy.sql` → `db/migrations/003_topic_rows_duplicate_policy.sql`
- 이름 변경: 기존 `003`~`009` 파일 → 설계서의 `004`~`011` 이름
- 수정: `db/README.md`
- 수정: `docs/SERVER_MIGRATION_AND_LAUNCH_CHECKLIST.md`

- [ ] **1단계: 기존 SQL 내용 해시 기록**

실행: `Get-FileHash db/migrations/*.sql | Sort-Object Path`

예상: 이름 변경 전 각 파일의 SHA-256 값을 확인할 수 있다.

- [ ] **2단계: 충돌을 피하도록 역순으로 파일 이름 변경**

`009`부터 `003`까지 역순으로 설계서에 명시한 고유 번호로 변경하고, 중복된 두 보조 마이그레이션도 각각 `003`, `008`로 변경한다. SQL 본문은 수정하지 않는다.

- [ ] **3단계: DB 문서의 실행 목록을 001~011 전체 순서로 수정**

`db/README.md`의 로컬 신규 DB 적용 명령이 모든 마이그레이션을 한 번씩 파일 이름순으로 실행하도록 바꾼다. Supabase 운영 DB에는 이미 적용된 마이그레이션을 재실행하지 말라는 경고를 추가한다.

`docs/SERVER_MIGRATION_AND_LAUNCH_CHECKLIST.md`에서 기존 `006_kakao_auth.sql` 참조를 새 이름 `007_kakao_auth.sql`로 바꾼다.

- [ ] **4단계: SQL 내용이 유지됐는지 해시로 확인**

실행: `Get-FileHash db/migrations/*.sql | Sort-Object Path`

예상: 파일별 이름만 달라지고 대응하는 SQL 파일의 SHA-256 값은 1단계와 동일하다.

- [ ] **5단계: 계약 테스트 통과 확인**

실행: `node --test scripts/repository-contract.test.mjs`

예상: 네 계약 테스트가 모두 통과한다.

### 작업 4: 생성 파일 제거와 재발 방지

**파일:**
- 수정: `.gitignore`
- 삭제: `artifacts/`
- 삭제: `output/`
- 삭제: `.runtime-logs/`
- 삭제: `apps/api/storage/rendered-content/`
- 삭제: `workers/brand-pilot-image-worker/output/`
- 삭제: 모든 애플리케이션의 `*.log`
- 삭제: 애플리케이션 내부 `.vercel/`

- [ ] **1단계: 무시 규칙 계약을 테스트에 추가**

`scripts/repository-contract.test.mjs`에 다음 테스트를 추가한다.

```js
test("생성 파일 경로를 저장소에서 제외한다", async () => {
  const ignore = await readFile(".gitignore", "utf8");
  for (const pattern of ["artifacts/", "output/", "*.log", "*.dump", ".vercel/", "storage/rendered-content/"]) {
    assert.match(ignore, new RegExp(`^${pattern.replaceAll(".", "\\.").replaceAll("*", ".*")}$`, "m"));
  }
});
```

- [ ] **2단계: 무시 규칙 테스트 실패 확인**

실행: `node --test scripts/repository-contract.test.mjs`

예상: 현재 `.gitignore`에 생성 파일 규칙이 없어 새 테스트만 실패한다.

- [ ] **3단계: `.gitignore` 확장**

```gitignore
node_modules/
dist/
coverage/
.cache/
.vite/
.env
.env.*
!.env.example
*.tsbuildinfo
*.log
*.dump
.vercel/
.gstack/
.playwright-cli/
.playwright-mcp/
.runtime-logs/
artifacts/
output/
test-results/
playwright-report/
storage/rendered-content/
```

- [ ] **4단계: 정리 대상 절대 경로 확인 후 삭제**

삭제 전에 각 대상이 `C:\Users\dkskr\OneDrive\111\brand_poilot` 아래인지 확인한다. 확인한 경로만 PowerShell `Remove-Item -LiteralPath ... -Recurse -Force`로 삭제한다. `.env`, `.env.example`, 소스 테스트와 프로토타입 자산은 삭제하지 않는다.

- [ ] **5단계: 무시 규칙 테스트 통과 확인**

실행: `node --test scripts/repository-contract.test.mjs`

예상: 생성 파일 무시 규칙을 포함한 모든 계약 테스트가 통과한다.

### 작업 5: 한글 루트 README 작성

**파일:**
- 생성: `README.md`
- 수정: `db/README.md`

- [ ] **1단계: 루트 README 작성**

다음 순서로 실제 명령을 포함한다.

1. Brand Pilot 한 줄 설명과 현재 내부 파일럿 상태
2. API, 고객 UI, 이미지 워커, DB, 문서 디렉터리 설명
3. Node.js 20+, npm, 선택적 Docker 요구사항
4. `npm install` 최초 설치
5. `.env.example` 기반 환경 설정과 비밀값 비커밋 원칙
6. `SUPABASE_DATABASE_URL` 우선 사용 및 `DATABASE_URL`/로컬 fallback 순서
7. `npm run dev:api`, `npm run dev:ui`, 워커 실행법
8. `npm test`, `npm run build`, `npm run test:e2e`
9. `npm run db:up`을 사용하는 선택적 로컬 PostgreSQL
10. 마이그레이션을 기존 Supabase에 재실행하지 말라는 경고
11. 이미지 워커가 DB 비밀값을 보유하지 않는 책임 경계
12. `docs/PRE_LAUNCH_REQUIRED.md` 링크

- [ ] **2단계: 문서 명령과 package 스크립트 대조**

실행: `rg -n "npm (install|run|test)" README.md db/README.md`

예상: 문서에 나온 각 루트 npm 명령이 `package.json`에 존재한다.

### 작업 6: 전체 회귀 검증

**파일:**
- 검증만 수행

- [ ] **1단계: 저장소 계약 테스트 실행**

실행: `npm run test:contract`

예상: 모든 계약 테스트 통과.

- [ ] **2단계: 전체 단위 테스트 실행**

실행: `npm test`

예상: API, 고객 UI, 이미지 워커의 전체 Vitest 테스트 통과.

- [ ] **3단계: 전체 빌드 실행**

실행: `npm run build`

예상: 세 워크스페이스 빌드 통과, API `dist/index.js`와 고객 UI `dist/` 생성.

- [ ] **4단계: API 결과물 모듈 로딩 확인**

실행: `node --check apps/api/dist/index.js`

예상: 구문 또는 ESM 모듈 해석 오류 없이 종료 코드 0.

- [ ] **5단계: 파일 정리 상태 확인**

실행: `Get-ChildItem artifacts,output,.runtime-logs,apps/api/storage/rendered-content,workers/brand-pilot-image-worker/output -Force -ErrorAction SilentlyContinue`

예상: 아무 파일도 출력되지 않는다.

- [ ] **6단계: 비밀 파일 보존과 잠금 파일 구조 확인**

실행: `rg --files -g '.env*' -g 'package-lock.json'`

예상: 실제 `.env`와 `.env.example` 파일은 그대로 있으며, 잠금 파일은 루트 `package-lock.json` 하나만 출력된다.

