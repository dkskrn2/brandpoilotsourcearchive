type JsonRecord = Record<string, unknown>;

function asObject(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function parseObject(value: unknown): JsonRecord | null {
  if (typeof value !== "string") return null;
  try {
    return asObject(JSON.parse(value));
  } catch {
    return null;
  }
}

function safeToken(value: unknown): string | null {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_.-]{0,47}$/i.test(value)) return null;
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function classifyKnownFailure(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (normalized.includes("invalid_json_schema")) return "codex_invalid_json_schema";
  if (/usage limit|usage_limit|quota exceeded/.test(normalized)) return "codex_usage_limit";
  if (/rate limit|rate_limit|too many requests/.test(normalized)) return "codex_rate_limit";
  if (/not logged in|unauthorized|authentication failed/.test(normalized)) return "codex_authentication_failed";
  if (/internal server error|internal_error|server_error/.test(normalized)) return "codex_image_generation_internal_error";
  if (/timed out|timeout/.test(normalized)) return "codex_image_generation_timeout";
  return null;
}

function structuredDiagnostic(value: unknown): string | null {
  const payload = parseObject(value);
  if (!payload) return classifyKnownFailure(value);
  const error = asObject(payload.error);
  const type = safeToken(error?.type);
  const code = safeToken(error?.code);
  const status = Number.isInteger(payload.status) && Number(payload.status) >= 100 && Number(payload.status) <= 599
    ? `http_${String(payload.status)}`
    : null;
  const parts = [type, code, status].filter((part): part is string => Boolean(part));
  return parts.length > 0
    ? `codex_failure_${parts.join("_")}`.slice(0, 114)
    : classifyKnownFailure(value);
}

function diagnosticFromEvent(event: JsonRecord): string | null {
  if (event.type !== "error" && event.type !== "turn.failed") return null;
  const error = asObject(event.error);
  for (const candidate of [event.message, error?.message]) {
    const diagnostic = structuredDiagnostic(candidate);
    if (diagnostic) return diagnostic;
  }
  const type = safeToken(error?.type);
  const code = safeToken(error?.code);
  const parts = [type, code].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? `codex_failure_${parts.join("_")}`.slice(0, 114) : null;
}

export function codexFailureDiagnostic(stderr: string, stdout: string): string {
  for (const stream of [stdout, stderr]) {
    for (const line of stream.trim().split(/\r?\n/).reverse()) {
      const event = parseObject(line);
      const diagnostic = event ? diagnosticFromEvent(event) : null;
      if (diagnostic) return diagnostic;
    }
  }
  return classifyKnownFailure(stderr) ?? "codex_cli_error";
}
