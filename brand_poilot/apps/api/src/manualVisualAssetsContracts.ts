const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(field: string): never {
  throw new Error(`manual_visual_assets_validation_failed:${field}`);
}
function row(value: unknown, prefix: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${prefix}:root`);
  return value as Record<string, unknown>;
}
function closed(value: Record<string, unknown>, keys: readonly string[], prefix: string): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) throw new Error(`${prefix}:unknown_key:${unknown}`);
}
function text(value: unknown, field: string, maximum: number, required = true): string {
  if (typeof value !== "string") fail(field);
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maximum) fail(field);
  return normalized;
}
function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) fail(field);
  return value.toLowerCase();
}
function stringList(value: unknown, field: string, maximumItems: number, maximumLength: number): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) fail(field);
  const items = value.map((item) => text(item, field, maximumLength));
  if (new Set(items).size !== items.length) fail(field);
  return items;
}

export interface BrandStylePresetInputV1 {
  contractVersion: "brand-style-preset.v1";
  name: string;
  description: string;
  visualTokens: { colors: string[]; fonts: string[]; notes: string[] };
  referenceItemIds: string[];
  isDefault: boolean;
}
export function parseBrandStylePresetInput(value: unknown): BrandStylePresetInputV1 {
  const source = row(value, "brand_style_preset_validation_failed");
  closed(source, ["contractVersion", "name", "description", "visualTokens", "referenceItemIds", "isDefault"], "brand_style_preset_validation_failed");
  if (source.contractVersion !== "brand-style-preset.v1") throw new Error("brand_style_preset_validation_failed:contractVersion");
  const tokens = row(source.visualTokens, "brand_style_preset_validation_failed:visualTokens");
  closed(tokens, ["colors", "fonts", "notes"], "brand_style_preset_validation_failed:visualTokens");
  if (!Array.isArray(source.referenceItemIds) || source.referenceItemIds.length < 1 || source.referenceItemIds.length > 5) {
    throw new Error("brand_style_preset_validation_failed:referenceItemIds");
  }
  const referenceItemIds = source.referenceItemIds.map((id) => {
    if (typeof id !== "string" || !UUID.test(id)) throw new Error("brand_style_preset_validation_failed:referenceItemIds");
    return id.toLowerCase();
  });
  if (new Set(referenceItemIds).size !== referenceItemIds.length) throw new Error("brand_style_preset_validation_failed:referenceItemIds");
  if (typeof source.isDefault !== "boolean") throw new Error("brand_style_preset_validation_failed:isDefault");
  return {
    contractVersion: "brand-style-preset.v1",
    name: text(source.name, "name", 120),
    description: source.description === undefined ? "" : text(source.description, "description", 1_000, false),
    visualTokens: {
      colors: stringList(tokens.colors, "visualTokens.colors", 12, 80),
      fonts: stringList(tokens.fonts, "visualTokens.fonts", 12, 120),
      notes: stringList(tokens.notes, "visualTokens.notes", 20, 500),
    },
    referenceItemIds,
    isDefault: source.isDefault,
  };
}

export interface ManualProductImageInputV1 {
  sessionId: string;
  role: "hero" | "detail";
  position: number;
}
export interface ManualProductImagesInputV1 {
  contractVersion: "manual-product-images.v1";
  images: ManualProductImageInputV1[];
}
export function parseManualProductImagesInput(value: unknown): ManualProductImagesInputV1 {
  const source = row(value, "manual_product_images_validation_failed");
  closed(source, ["contractVersion", "images"], "manual_product_images_validation_failed");
  if (source.contractVersion !== "manual-product-images.v1" || !Array.isArray(source.images) || source.images.length > 5) {
    throw new Error("manual_product_images_validation_failed:root");
  }
  const images = source.images.map((value, index) => {
    const image = row(value, "manual_product_images_validation_failed:image");
    closed(image, ["sessionId", "role", "position"], "manual_product_images_validation_failed:image");
    if (image.role !== "hero" && image.role !== "detail") throw new Error("manual_product_images_validation_failed:role");
    if (!Number.isSafeInteger(image.position) || Number(image.position) < 1 || Number(image.position) > 5) {
      throw new Error("manual_product_images_validation_failed:position");
    }
    const role: ManualProductImageInputV1["role"] = image.role;
    return { sessionId: uuid(image.sessionId, `images.${index}.sessionId`), role, position: Number(image.position) };
  });
  if (new Set(images.map(({ sessionId }) => sessionId)).size !== images.length
    || new Set(images.map(({ position }) => position)).size !== images.length
    || images.some(({ position }, index) => position !== index + 1)
    || (images.length > 0 && images.filter(({ role }) => role === "hero").length !== 1)) {
    throw new Error("manual_product_images_validation_failed:images");
  }
  return { contractVersion: "manual-product-images.v1", images };
}
