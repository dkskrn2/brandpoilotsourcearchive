import path from "node:path";

const CONTRACT_VERSION = "ai-content-visual-session-image-audit.v1";

function imageTool(toolName) {
  if (typeof toolName !== "string") return false;
  const normalized = toolName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "imagegenimagegen"
    || normalized === "imagegeneration"
    || normalized === "imagegen";
}

function exactObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function sceneIndex(toolInput) {
  const source = exactObject(toolInput);
  const prompt = source && typeof source.prompt === "string" ? source.prompt : "";
  const match = /^BRAND_PILOT_SCENE_INDEX=(\d+)\r?\n/.exec(prompt);
  return match ? Number(match[1]) : null;
}

function assertState(audit) {
  if (!exactObject(audit) || audit.contractVersion !== CONTRACT_VERSION
    || !Array.isArray(audit.expectedSceneIndices) || !Array.isArray(audit.calls)) {
    throw new Error("visual_session_image_audit_invalid");
  }
}

function assertReferencePaths(toolInput, workspaceDir) {
  const references = toolInput.referenced_image_paths;
  if (references === undefined || references === null) return;
  if (!Array.isArray(references) || references.some((value) => typeof value !== "string" || !value)) {
    throw new Error("visual_session_image_reference_path_invalid");
  }
  if (typeof workspaceDir !== "string" || !path.isAbsolute(workspaceDir)) {
    throw new Error("visual_session_image_reference_path_invalid");
  }
  const inputRoot = path.resolve(workspaceDir, "inputs");
  for (const reference of references) {
    if (!path.isAbsolute(reference)) throw new Error("visual_session_image_reference_path_invalid");
    const resolved = path.resolve(workspaceDir, reference);
    const relative = path.relative(inputRoot, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("visual_session_image_previous_output_reference_forbidden");
    }
  }
}

function assertRequiredProductReferences(toolInput, requiredPaths, workspaceDir) {
  if (requiredPaths === undefined || requiredPaths === null || requiredPaths.length === 0) return;
  if (!Array.isArray(requiredPaths) || requiredPaths.some((value) => typeof value !== "string" || !value || !path.isAbsolute(value))
    || typeof workspaceDir !== "string" || !path.isAbsolute(workspaceDir)) {
    throw new Error("visual_session_image_required_product_reference_invalid");
  }
  const supplied = Array.isArray(toolInput.referenced_image_paths)
    ? new Set(toolInput.referenced_image_paths.map((value) => path.resolve(workspaceDir, value)))
    : new Set();
  if (requiredPaths.some((value) => !supplied.has(path.resolve(workspaceDir, value)))) {
    throw new Error("visual_session_image_required_product_reference_missing");
  }
}

export function createVisualSessionImageAudit(expectedSceneIndices) {
  if (!Array.isArray(expectedSceneIndices) || expectedSceneIndices.length < 1 || expectedSceneIndices.length > 5
    || expectedSceneIndices.some((value, offset) => value !== offset + 1)) {
    throw new Error("visual_session_image_audit_invalid");
  }
  return { contractVersion: CONTRACT_VERSION, expectedSceneIndices: [...expectedSceneIndices], calls: [] };
}

export function applyVisualSessionImageHookEvent(audit, event) {
  assertState(audit);
  if (!imageTool(event?.toolName)) return audit;
  if (!Number.isSafeInteger(event?.nowMs) || event.nowMs < 0
    || typeof event?.toolUseId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(event.toolUseId)) {
    throw new Error("visual_session_image_hook_event_invalid");
  }
  const calls = audit.calls.map((call) => ({ ...call }));
  if (event.hookEventName === "PreToolUse") {
    if (calls.some(({ status }) => status === "started")) throw new Error("visual_session_image_call_overlap_forbidden");
    if (calls.some(({ toolUseId }) => toolUseId === event.toolUseId)) throw new Error("visual_session_image_call_retry_forbidden");
    if (calls.length >= audit.expectedSceneIndices.length) throw new Error("visual_session_image_call_count_invalid");
    const input = exactObject(event.toolInput);
    if (!input) throw new Error("visual_session_image_hook_event_invalid");
    if (input.num_last_images_to_include !== undefined && input.num_last_images_to_include !== null) {
      throw new Error("visual_session_image_previous_output_reference_forbidden");
    }
    assertReferencePaths(input, event.workspaceDir);
    assertRequiredProductReferences(input, event.requiredProductReferencePaths, event.workspaceDir);
    const boundSceneIndex = sceneIndex(input);
    if (boundSceneIndex === null) throw new Error("visual_session_image_scene_binding_invalid");
    if (boundSceneIndex !== audit.expectedSceneIndices[calls.length]) throw new Error("visual_session_image_scene_order_invalid");
    calls.push({
      toolUseId: event.toolUseId,
      sceneIndex: boundSceneIndex,
      arguments: structuredClone(input),
      status: "started",
      startedAtMs: event.nowMs,
      completedAtMs: null,
    });
    return { ...audit, calls };
  }
  if (event.hookEventName === "PostToolUse") {
    const current = calls.at(-1);
    if (!current || current.toolUseId !== event.toolUseId || current.status !== "started") {
      throw new Error("visual_session_image_lifecycle_invalid");
    }
    if (sceneIndex(event.toolInput) !== current.sceneIndex
      || JSON.stringify(event.toolInput) !== JSON.stringify(current.arguments)) {
      throw new Error("visual_session_image_arguments_changed");
    }
    calls[calls.length - 1] = { ...current, status: "completed", completedAtMs: event.nowMs };
    return { ...audit, calls };
  }
  throw new Error("visual_session_image_hook_event_invalid");
}

export function assertCompleteVisualSessionImageAudit(audit) {
  assertState(audit);
  if (audit.calls.length !== audit.expectedSceneIndices.length
    || audit.calls.some((call, offset) => call.status !== "completed"
      || call.sceneIndex !== audit.expectedSceneIndices[offset]
      || !Number.isSafeInteger(call.startedAtMs) || !Number.isSafeInteger(call.completedAtMs)
      || call.completedAtMs < call.startedAtMs)) {
    throw new Error("visual_session_image_audit_incomplete");
  }
  return audit.calls.map((call) => ({
    sceneIndex: call.sceneIndex,
    toolUseId: call.toolUseId,
    arguments: structuredClone(call.arguments),
    startedAtMs: call.startedAtMs,
    completedAtMs: call.completedAtMs,
    durationMs: call.completedAtMs - call.startedAtMs,
  }));
}
