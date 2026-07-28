import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LEDGER_PATH = 'docs/prd/brand-pilot-feature-preservation-ledger.md';
const MATRIX_PATH = 'docs/quality/d-hybrid-regression-matrix.md';
const ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+-\d{3}$/;
const TEST_EVIDENCE_PATTERN =
  /`([^`]+\.(?:test|spec)\.(?:ts|tsx|mjs))`\s*::\s*`([^`]+)`/g;

function parseIdTableRows(markdown, documentName) {
  const rows = [];
  const errors = [];
  let inIdTable = false;

  markdown.split(/\r?\n/).forEach((line, index) => {
    if (!line.startsWith('|')) {
      inIdTable = false;
      return;
    }
    const cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
    if (cells[0] === 'ID') {
      inIdTable = true;
      return;
    }
    if (!inIdTable || cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return;
    if (!ID_PATTERN.test(cells[0] ?? '')) {
      errors.push(`${documentName} data row ${index + 1} has no stable ID`);
      return;
    }
    rows.push(cells);
  });

  return { rows, errors };
}

function countById(rows) {
  const counts = new Map();
  for (const row of rows) {
    counts.set(row[0], (counts.get(row[0]) ?? 0) + 1);
  }
  return counts;
}

function parseEvidence(value) {
  return [...value.matchAll(TEST_EVIDENCE_PATTERN)].map((match) => ({
    file: match[1].replaceAll('\\', '/'),
    testName: match[2],
  }));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function verifyRegressionMatrix(root = process.cwd()) {
  const [ledger, matrix] = await Promise.all([
    readFile(path.join(root, LEDGER_PATH), 'utf8'),
    readFile(path.join(root, MATRIX_PATH), 'utf8'),
  ]);
  const ledgerTable = parseIdTableRows(ledger, 'ledger');
  const matrixTable = parseIdTableRows(matrix, 'matrix');
  const ledgerRows = ledgerTable.rows;
  const matrixRows = matrixTable.rows;
  const ledgerCounts = countById(ledgerRows);
  const matrixCounts = countById(matrixRows);
  const errors = [...ledgerTable.errors, ...matrixTable.errors];

  for (const [id, count] of ledgerCounts) {
    if (count > 1) errors.push(`duplicate ledger ID ${id}`);
    if (!matrixCounts.has(id)) errors.push(`ledger ID ${id} is missing from the matrix`);
  }
  for (const [id, count] of matrixCounts) {
    if (count > 1) errors.push(`duplicate matrix ID ${id}`);
    if (!ledgerCounts.has(id)) errors.push(`matrix ID ${id} is missing from the ledger`);
  }

  for (const row of matrixRows) {
    const [
      id,
      requirement,
      testEvidence,
      e2eEvidence,
      operationalState,
      exclusion,
      lifecycle,
      supersededBy,
      evidenceCommand,
    ] = row;

    if (!requirement || requirement === '-') errors.push(`${id}: product requirement is missing`);
    if (!operationalState || operationalState === '-') {
      errors.push(`${id}: operational activation state is missing`);
    }
    if (!exclusion || exclusion === '-') errors.push(`${id}: explicit exclusion is missing`);
    if (!evidenceCommand || evidenceCommand === '-') {
      errors.push(`${id}: evidence command is missing`);
    }

    if (
      exclusion === '사용자 화면 제외' &&
      !/\bNEGATIVE\b/.test(`${testEvidence} ${e2eEvidence}`)
    ) {
      errors.push(`${id}: excluded feature requires negative UI/API evidence`);
    }

    if (lifecycle === 'planned') {
      if (!testEvidence.startsWith('GAP:')) {
        errors.push(`${id}: planned rows must state an honest GAP`);
      }
      continue;
    }

    if (lifecycle === 'superseded' && (!supersededBy || supersededBy === '-')) {
      errors.push(`${id}: superseded link is missing`);
    }

    const evidence = parseEvidence(`${testEvidence} ${e2eEvidence}`);
    if (lifecycle === 'active' && evidence.length === 0) {
      errors.push(`${id}: active row has no test evidence`);
    }

    for (const item of evidence) {
      const absolutePath = path.join(root, item.file);
      if (!(await fileExists(absolutePath))) {
        errors.push(`${id}: test file does not exist: ${item.file}`);
        continue;
      }
      const source = await readFile(absolutePath, 'utf8');
      if (!source.includes(item.testName)) {
        errors.push(`${id}: test name was not found in ${item.file}: ${item.testName}`);
      }
    }
  }

  return errors;
}

async function main() {
  const root = process.cwd();
  const errors = await verifyRegressionMatrix(root);
  if (errors.length > 0) {
    console.error(`Regression matrix verification failed (${errors.length}):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  const matrix = await readFile(path.join(root, MATRIX_PATH), 'utf8');
  const rows = parseIdTableRows(matrix, 'matrix').rows;
  const counts = rows.reduce(
    (result, row) => {
      result.total += 1;
      result[row[6]] = (result[row[6]] ?? 0) + 1;
      return result;
    },
    { total: 0 },
  );
  console.log(
    `Regression matrix verified: ${counts.total} IDs ` +
      `(active ${counts.active ?? 0}, planned gaps ${counts.planned ?? 0}, ` +
      `excluded ${counts.excluded ?? 0}, superseded ${counts.superseded ?? 0})`,
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
