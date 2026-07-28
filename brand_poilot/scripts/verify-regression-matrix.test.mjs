import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyRegressionMatrix } from './verify-regression-matrix.mjs';

const HEADER = `| ID | 제품 요구사항 | 단위/통합 테스트 | E2E/Smoke | 운영 활성화 | 명시적 제외 | 생명주기 | 대체 ID | 증빙 명령 |
|---|---|---|---|---|---|---|---|---|`;

async function fixture({ ledgerRows, matrixRows, files = {} }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'regression-matrix-'));
  await mkdir(path.join(root, 'docs/prd'), { recursive: true });
  await mkdir(path.join(root, 'docs/quality'), { recursive: true });
  await writeFile(
    path.join(root, 'docs/prd/brand-pilot-feature-preservation-ledger.md'),
    `| ID | 영역 | 기능 |\n|---|---|---|\n${ledgerRows.join('\n')}\n`,
  );
  await writeFile(
    path.join(root, 'docs/quality/d-hybrid-regression-matrix.md'),
    `${HEADER}\n${matrixRows.join('\n')}\n`,
  );
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }
  return root;
}

const activeRow = ({
  id = 'AUTH-LOGIN-001',
  testEvidence = '`apps/api/src/auth.test.ts` :: `keeps a session`',
  e2e = '`apps/customer-ui/e2e/auth.spec.ts` :: `signs in`',
  exclusion = '아니오',
  lifecycle = 'active',
  supersededBy = '-',
} = {}) =>
  `| ${id} | 로그인 세션을 보존한다 | ${testEvidence} | ${e2e} | 사용 중 | ${exclusion} | ${lifecycle} | ${supersededBy} | \`node --test apps/api/src/auth.test.ts\` |`;

test('accepts an active row only when its exact test evidence exists', async () => {
  const root = await fixture({
    ledgerRows: ['| AUTH-LOGIN-001 | 계정 | 로그인·세션 |'],
    matrixRows: [activeRow()],
    files: {
      'apps/api/src/auth.test.ts': "test('keeps a session', () => {});\n",
      'apps/customer-ui/e2e/auth.spec.ts': "test('signs in', () => {});\n",
    },
  });

  assert.deepEqual(await verifyRegressionMatrix(root), []);
});

test('rejects an active row whose test file does not exist', async () => {
  const root = await fixture({
    ledgerRows: ['| AUTH-LOGIN-001 | 계정 | 로그인·세션 |'],
    matrixRows: [activeRow()],
    files: {
      'apps/customer-ui/e2e/auth.spec.ts': "test('signs in', () => {});\n",
    },
  });

  assert.match((await verifyRegressionMatrix(root)).join('\n'), /AUTH-LOGIN-001.*test file does not exist/);
});

test('rejects an active row whose named test is not in the referenced file', async () => {
  const root = await fixture({
    ledgerRows: ['| AUTH-LOGIN-001 | 계정 | 로그인·세션 |'],
    matrixRows: [activeRow()],
    files: {
      'apps/api/src/auth.test.ts': "test('different behavior', () => {});\n",
      'apps/customer-ui/e2e/auth.spec.ts': "test('signs in', () => {});\n",
    },
  });

  assert.match((await verifyRegressionMatrix(root)).join('\n'), /AUTH-LOGIN-001.*test name was not found/);
});

test('requires excluded user-screen features to have negative UI or API evidence', async () => {
  const root = await fixture({
    ledgerRows: ['| VIDEO-CREATE-001 | 영상 | Reel 제작 |'],
    matrixRows: [
      activeRow({
        id: 'VIDEO-CREATE-001',
        exclusion: '사용자 화면 제외',
        lifecycle: 'excluded',
        testEvidence: '`apps/api/src/video.test.ts` :: `creates video`',
        e2e: '-',
      }),
    ],
    files: {
      'apps/api/src/video.test.ts': "test('creates video', () => {});\n",
    },
  });

  assert.match((await verifyRegressionMatrix(root)).join('\n'), /VIDEO-CREATE-001.*negative UI\/API evidence/);
});

test('does not let a planned gap bypass excluded user-screen negative evidence', async () => {
  const root = await fixture({
    ledgerRows: ['| OFFER-LIBRARY-001 | 제품 | 기간성 오퍼 보관 |'],
    matrixRows: [
      activeRow({
        id: 'OFFER-LIBRARY-001',
        exclusion: '사용자 화면 제외',
        lifecycle: 'planned',
        testEvidence: 'GAP: negative evidence is still missing',
        e2e: '-',
      }),
    ],
  });

  assert.match((await verifyRegressionMatrix(root)).join('\n'), /OFFER-LIBRARY-001.*negative UI\/API evidence/);
});

test('requires every ledger ID exactly once in the matrix', async () => {
  const root = await fixture({
    ledgerRows: [
      '| AUTH-LOGIN-001 | 계정 | 로그인·세션 |',
      '| AUTH-KAKAO-001 | 계정 | Kakao 로그인 |',
    ],
    matrixRows: [activeRow(), activeRow()],
    files: {
      'apps/api/src/auth.test.ts': "test('keeps a session', () => {});\n",
      'apps/customer-ui/e2e/auth.spec.ts': "test('signs in', () => {});\n",
    },
  });

  const errors = (await verifyRegressionMatrix(root)).join('\n');
  assert.match(errors, /duplicate matrix ID AUTH-LOGIN-001/);
  assert.match(errors, /ledger ID AUTH-KAKAO-001 is missing/);
});

test('rejects a ledger data row without a stable ID', async () => {
  const root = await fixture({
    ledgerRows: [
      '| AUTH-LOGIN-001 | 계정 | 로그인·세션 |',
      '| - | 계정 | Kakao 로그인 |',
    ],
    matrixRows: [activeRow()],
    files: {
      'apps/api/src/auth.test.ts': "test('keeps a session', () => {});\n",
      'apps/customer-ui/e2e/auth.spec.ts': "test('signs in', () => {});\n",
    },
  });

  assert.match((await verifyRegressionMatrix(root)).join('\n'), /ledger data row 4 has no stable ID/);
});

test('requires superseded rows to retain a replacement link', async () => {
  const root = await fixture({
    ledgerRows: ['| ROUTE-ARCHIVE-001 | 탐색 | archive 경로 |'],
    matrixRows: [
      activeRow({
        id: 'ROUTE-ARCHIVE-001',
        lifecycle: 'superseded',
        supersededBy: '-',
      }),
    ],
    files: {
      'apps/api/src/auth.test.ts': "test('keeps a session', () => {});\n",
      'apps/customer-ui/e2e/auth.spec.ts': "test('signs in', () => {});\n",
    },
  });

  assert.match((await verifyRegressionMatrix(root)).join('\n'), /ROUTE-ARCHIVE-001.*superseded link/);
});
