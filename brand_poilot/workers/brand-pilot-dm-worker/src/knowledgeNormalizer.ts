const minimumContentLength = 120;

const boilerplatePattern = /(?:쿠키\s*(?:설정|정책|동의)|개인정보\s*처리방침|privacy\s*policy|all\s+rights\s+reserved|copyright|^©\s*\d{4})/i;

function normalizeLine(line: string) {
  return line.trim().replace(/[\t ]+/g, " ");
}

function isNavigationBlock(block: string) {
  const lines = block.split("\n");
  return lines.every((line) => {
    if (/^\|.*\|$/.test(line)) return false;
    const separators = line.match(/\||›|>|·/g)?.length ?? 0;
    return line.length <= 100 && separators >= 2;
  });
}

function isBoilerplateBlock(block: string) {
  return boilerplatePattern.test(block) || isNavigationBlock(block);
}

export function normalizeWhitespace(value: string) {
  return value.normalize("NFKC").replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
}

export function normalizeKnowledgeSource(source: string): string | null {
  const normalizedLines = source
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(normalizeLine);
  const blocks = normalizedLines.join("\n").split(/\n{2,}/);
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const rawBlock of blocks) {
    const block = rawBlock.split("\n").filter(Boolean).join("\n").trim();
    if (!block || isBoilerplateBlock(block)) continue;
    const duplicateKey = normalizeWhitespace(block).toLocaleLowerCase("ko-KR");
    if (seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);
    kept.push(block);
  }

  const result = kept.join("\n\n").trim();
  return result.length >= minimumContentLength ? result : null;
}
