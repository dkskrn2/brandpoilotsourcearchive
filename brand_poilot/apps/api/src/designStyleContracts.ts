const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown, code = "design_style_input_invalid"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}
function closed(value: Record<string, unknown>, keys: readonly string[], code = "design_style_input_invalid"): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error(code);
}
function uuid(value: unknown, code = "design_style_input_invalid"): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(code);
  return value.toLowerCase();
}
function name(value: unknown, code = "design_style_input_invalid"): string {
  if (typeof value !== "string" || value !== value.trim() || value.length < 1 || value.length > 120) {
    throw new Error(code);
  }
  return value;
}

export interface DesignStyleInputV1 {
  contractVersion: "design-style-input.v1";
  name: string;
  referenceItemIds: string[];
}
export interface VisualPresetInputV1 {
  contractVersion: "visual-preset-input.v1";
  name: string;
  designStyleId: string;
  avatarId: string | null;
  isDefault: boolean;
}

export function parseDesignStyleInput(value: unknown): DesignStyleInputV1 {
  const source = object(value);
  closed(source, ["contractVersion", "name", "referenceItemIds"]);
  if (source.contractVersion !== "design-style-input.v1"
    || !Array.isArray(source.referenceItemIds)
    || source.referenceItemIds.length < 1
    || source.referenceItemIds.length > 5) throw new Error("design_style_input_invalid");
  const referenceItemIds = source.referenceItemIds.map((value) => uuid(value));
  if (new Set(referenceItemIds).size !== referenceItemIds.length) throw new Error("design_style_input_invalid");
  return { contractVersion: "design-style-input.v1", name: name(source.name), referenceItemIds };
}

export function parseVisualPresetInput(value: unknown): VisualPresetInputV1 {
  const code = "visual_preset_input_invalid";
  const source = object(value, code);
  closed(source, ["contractVersion", "name", "designStyleId", "avatarId", "isDefault"], code);
  if (source.contractVersion !== "visual-preset-input.v1" || typeof source.isDefault !== "boolean") {
    throw new Error("visual_preset_input_invalid");
  }
  return {
    contractVersion: "visual-preset-input.v1",
    name: name(source.name, code),
    designStyleId: uuid(source.designStyleId, code),
    avatarId: source.avatarId === null ? null : uuid(source.avatarId, code),
    isDefault: source.isDefault,
  };
}
