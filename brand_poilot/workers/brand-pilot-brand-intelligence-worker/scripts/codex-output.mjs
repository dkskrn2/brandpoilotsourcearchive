function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function parseObject(value) {
  if (typeof value !== "string") return null;
  const unfenced = value.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try { return asObject(JSON.parse(unfenced)); } catch { return null; }
}

export function extractJson(value) {
  const direct = parseObject(value);
  if (direct) return direct;
  for (const line of value.trim().split(/\r?\n/).reverse()) {
    const event = parseObject(line);
    if (!event) continue;
    for (const candidate of [event.text, event.output, event.item?.text]) {
      const parsed = parseObject(candidate);
      if (parsed) return parsed;
    }
  }
  throw new Error("brand_intelligence_codex_json_invalid");
}

function safeToken(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_.-]{0,79}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function classifyKnownFailure(value) {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (normalized.includes("invalid_json_schema")) return "invalid_json_schema";
  if (normalized.includes("usage limit")) return "usage_limit";
  if (normalized.includes("rate limit")) return "rate_limit";
  if (/not logged in|unauthorized|authentication failed/.test(normalized)) {
    return "authentication_failed";
  }
  if (/unexpected argument|unknown option|unrecognized option/.test(normalized)) {
    return "cli_argument_invalid";
  }
  return null;
}

function structuredDiagnostic(value) {
  const payload = parseObject(value);
  if (!payload) return classifyKnownFailure(value);
  const error = asObject(payload.error);
  const type = safeToken(error?.type);
  const code = safeToken(error?.code);
  const status = Number.isInteger(payload.status) && payload.status >= 100 && payload.status <= 599
    ? `http_${payload.status}`
    : null;
  const parts = [type, code, status].filter(Boolean);
  return parts.length ? parts.join(":") : classifyKnownFailure(value);
}

function diagnosticFromEvent(event) {
  if (event.type !== "error" && event.type !== "turn.failed") return null;
  const error = asObject(event.error);
  for (const candidate of [event.message, error?.message]) {
    const diagnostic = structuredDiagnostic(candidate);
    if (diagnostic) return diagnostic;
  }
  const type = safeToken(error?.type);
  const code = safeToken(error?.code);
  const parts = [type, code].filter(Boolean);
  return parts.length ? parts.join(":") : null;
}

export function codexFailureDiagnostic(stderr, stdout) {
  for (const stream of [stdout, stderr]) {
    for (const line of stream.trim().split(/\r?\n/).reverse()) {
      const event = parseObject(line);
      const diagnostic = event ? diagnosticFromEvent(event) : null;
      if (diagnostic) return diagnostic;
    }
  }
  return classifyKnownFailure(`${stderr}\n${stdout}`) ?? "codex_cli_error";
}
