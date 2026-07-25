import type { SourceReadResult } from "./sourceReader.js";

export interface ThreadsTextResult {
  deliveryFormat: "threads_text";
  promptVersion: "worker-threads.v1";
  title: string;
  text: string;
  sourceMode: SourceReadResult["sourceMode"];
  fetchStatus: SourceReadResult["fetchStatus"];
  model: string;
}

const resultKeys = new Set([
  "deliveryFormat",
  "promptVersion",
  "title",
  "text",
  "sourceMode",
  "fetchStatus",
  "model"
]);

export function parseThreadsTextResult(
  message: string,
  expected: Pick<ThreadsTextResult, "sourceMode" | "fetchStatus" | "model">
): ThreadsTextResult {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    throw new Error("codex_text_output_json_invalid");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("codex_text_output_invalid");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== resultKeys.size || keys.some((key) => !resultKeys.has(key))) {
    throw new Error("codex_text_output_contract_invalid");
  }
  if (
    record.deliveryFormat !== "threads_text"
    || record.promptVersion !== "worker-threads.v1"
    || record.sourceMode !== expected.sourceMode
    || record.fetchStatus !== expected.fetchStatus
    || record.model !== expected.model
  ) {
    throw new Error("codex_text_output_contract_invalid");
  }
  if (
    typeof record.title !== "string"
    || record.title.trim().length === 0
    || typeof record.text !== "string"
    || record.text.trim().length === 0
  ) {
    throw new Error("codex_text_output_invalid");
  }
  return {
    deliveryFormat: "threads_text",
    promptVersion: "worker-threads.v1",
    title: record.title.trim(),
    text: record.text.trim(),
    sourceMode: expected.sourceMode,
    fetchStatus: expected.fetchStatus,
    model: expected.model
  };
}
