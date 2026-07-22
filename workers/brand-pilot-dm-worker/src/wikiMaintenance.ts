export interface WikiMaintenanceContext {
  runId: string;
  workspaceId: string;
  brandId: string;
  wikiVersionId: string;
  questions: string[];
  stableKeys: string[];
  sourceUnits: Array<{ stableKey: string; title: string; content: string }>;
}

export interface WikiMaintenanceOutput {
  aliasUpdates: Array<{ stableKey: string; aliases: string[] }>;
  linkUpdates: Array<{ from: string; to: string; relation: string }>;
  regenerateStableKeys: string[];
  missingKnowledge: Array<{ question: string; reason: string }>;
}

export interface WikiMaintenanceDb {
  claimWikiMaintenance(): Promise<WikiMaintenanceContext | null>;
  completeWikiMaintenance(context: WikiMaintenanceContext, output: WikiMaintenanceOutput): Promise<void>;
  failWikiMaintenance(context: WikiMaintenanceContext, error: string): Promise<void>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function stringValue(value: unknown, code: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

export function validateWikiMaintenanceOutput(value: unknown, context: WikiMaintenanceContext): WikiMaintenanceOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value as Record<string, unknown>, ["aliasUpdates", "linkUpdates", "regenerateStableKeys", "missingKnowledge"])) {
    throw new Error("wiki_linter_result_invalid");
  }
  const candidate = value as Record<string, unknown>;
  const stableKeys = new Set(context.stableKeys);
  const list = (key: string) => {
    const raw = candidate[key];
    if (!Array.isArray(raw)) throw new Error("wiki_linter_result_invalid");
    return raw;
  };
  const requireKey = (value: unknown) => {
    const stableKey = stringValue(value, "wiki_linter_stable_key_invalid");
    if (!stableKeys.has(stableKey)) throw new Error("wiki_linter_stable_key_unknown");
    return stableKey;
  };
  const aliasUpdates = list("aliasUpdates").map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)
      || !exactKeys(raw as Record<string, unknown>, ["stableKey", "aliases"])) throw new Error("wiki_linter_alias_invalid");
    const entry = raw as Record<string, unknown>;
    if (!Array.isArray(entry.aliases) || !entry.aliases.every((alias) => typeof alias === "string" && alias.trim())) {
      throw new Error("wiki_linter_alias_invalid");
    }
    return { stableKey: requireKey(entry.stableKey), aliases: [...new Set(entry.aliases.map((alias) => String(alias).trim()))] };
  });
  const linkUpdates = list("linkUpdates").map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)
      || !exactKeys(raw as Record<string, unknown>, ["from", "to", "relation"])) throw new Error("wiki_linter_link_invalid");
    const entry = raw as Record<string, unknown>;
    return { from: requireKey(entry.from), to: requireKey(entry.to), relation: stringValue(entry.relation, "wiki_linter_link_invalid") };
  });
  const regenerateStableKeys = [...new Set(list("regenerateStableKeys").map(requireKey))];
  const missingKnowledge = list("missingKnowledge").map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)
      || !exactKeys(raw as Record<string, unknown>, ["question", "reason"])) throw new Error("wiki_linter_missing_knowledge_invalid");
    const entry = raw as Record<string, unknown>;
    return {
      question: stringValue(entry.question, "wiki_linter_missing_knowledge_invalid"),
      reason: stringValue(entry.reason, "wiki_linter_missing_knowledge_invalid"),
    };
  });
  return { aliasUpdates, linkUpdates, regenerateStableKeys, missingKnowledge };
}

function prompt(context: WikiMaintenanceContext) {
  return `당신은 브랜드 Wiki 검색 품질 검사 담당자입니다. 반드시 $wiki-linter Skill을 사용하세요. 실패 질문은 사실 근거가 아니며, sourceUnits에 없는 사실을 추가하지 마세요. 기존 stable key의 별칭과 연결 보강, 페이지 재생성 요청, 실제 누락 지식 기록만 할 수 있습니다. strict JSON만 출력하세요.\n\n입력:\n${JSON.stringify(context)}\n\n출력 계약:\n{"aliasUpdates":[{"stableKey":"string","aliases":["string"]}],"linkUpdates":[{"from":"string","to":"string","relation":"string"}],"regenerateStableKeys":["string"],"missingKnowledge":[{"question":"string","reason":"string"}]}\n\nJSON만 출력하세요.`;
}

export async function runWikiMaintenanceOnce(input: {
  db: WikiMaintenanceDb;
  runtimeDirectory: string;
  timeoutMs: number;
  runCodex: (input: { prompt: string; runtimeDirectory: string; timeoutMs: number }) => Promise<unknown>;
}) {
  const context = await input.db.claimWikiMaintenance();
  if (!context) return { status: "idle" as const };
  try {
    const raw = await input.runCodex({
      prompt: prompt(context), runtimeDirectory: input.runtimeDirectory, timeoutMs: input.timeoutMs,
    });
    const output = validateWikiMaintenanceOutput(raw, context);
    await input.db.completeWikiMaintenance(context, output);
    return { status: "completed" as const, runId: context.runId, issueCount: output.missingKnowledge.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "wiki_maintenance_failed";
    await input.db.failWikiMaintenance(context, message);
    return { status: "failed" as const, runId: context.runId };
  }
}
