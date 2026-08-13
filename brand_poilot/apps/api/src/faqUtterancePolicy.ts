export const FAQ_UTTERANCE_MAX_ITEMS = 8;
export const FAQ_UTTERANCE_MAX_LENGTH = 80;

function displayFaqUtterance(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function lengthOf(value: string): number {
  return Array.from(value).length;
}

export function normalizeFaqUtterance(value: string): string {
  return displayFaqUtterance(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function parseFaqUtterances(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("faq_utterance_validation_failed:root");
  }
  if (value.length > FAQ_UTTERANCE_MAX_ITEMS) {
    throw new Error("faq_utterance_validation_failed:limit");
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error("faq_utterance_validation_failed:item");
    }
    const display = displayFaqUtterance(item);
    const normalized = normalizeFaqUtterance(display);
    if (
      !display
      || !normalized
      || lengthOf(display) > FAQ_UTTERANCE_MAX_LENGTH
    ) {
      throw new Error("faq_utterance_validation_failed:item");
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(display);
  }
  return result;
}

export function effectiveFaqAliases(
  sourceAliases: string[],
  manualAliases: string[],
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of [...sourceAliases, ...manualAliases]) {
    if (typeof item !== "string") continue;
    const display = displayFaqUtterance(item);
    const normalized = normalizeFaqUtterance(display);
    if (!display || !normalized || lengthOf(display) > FAQ_UTTERANCE_MAX_LENGTH || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(display);
    if (result.length >= FAQ_UTTERANCE_MAX_ITEMS) break;
  }
  return result;
}
