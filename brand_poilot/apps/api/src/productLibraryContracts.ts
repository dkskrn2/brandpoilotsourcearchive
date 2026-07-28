export interface ProductServiceProfileV1 {
  contractVersion: "product-service.v1";
  name: string;
  kind: "product" | "service";
  description: string;
  features: string[];
  benefits: string[];
  cautions: string[];
  audiences: Array<Record<string, unknown>>;
  appealsByTarget: Record<string, Array<Record<string, unknown>>>;
  evergreenPurchaseInfo: string;
  sourceUrls: string[];
}

const keys = new Set([
  "contractVersion", "name", "kind", "description", "features", "benefits",
  "cautions", "audiences", "appealsByTarget", "evergreenPurchaseInfo", "sourceUrls",
]);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("product_service_validation_failed:root");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, required = false): string {
  if (typeof value !== "string" || (required && !value.trim())) {
    throw new Error(`product_service_validation_failed:${field}`);
  }
  return value.trim();
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`product_service_validation_failed:${field}`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

export function parseProductServiceProfile(value: unknown): ProductServiceProfileV1 {
  const row = object(value);
  const unknown = Object.keys(row).find((key) => !keys.has(key));
  if (unknown) throw new Error(`product_service_validation_failed:${unknown}`);
  if (row.contractVersion !== "product-service.v1") {
    throw new Error("product_service_validation_failed:contractVersion");
  }
  if (row.kind !== "product" && row.kind !== "service") {
    throw new Error("product_service_validation_failed:kind");
  }
  if (!Array.isArray(row.audiences) || row.audiences.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error("product_service_validation_failed:audiences");
  }
  const appeals = object(row.appealsByTarget);
  for (const [target, items] of Object.entries(appeals)) {
    if (!target.trim() || !Array.isArray(items) || items.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
      throw new Error("product_service_validation_failed:appealsByTarget");
    }
  }
  const sourceUrls = strings(row.sourceUrls, "sourceUrls");
  if (sourceUrls.some((url) => {
    try { return !["http:", "https:"].includes(new URL(url).protocol); } catch { return true; }
  })) throw new Error("product_service_validation_failed:sourceUrls");
  return {
    contractVersion: "product-service.v1",
    name: text(row.name, "name", true),
    kind: row.kind,
    description: text(row.description, "description"),
    features: strings(row.features, "features"),
    benefits: strings(row.benefits, "benefits"),
    cautions: strings(row.cautions, "cautions"),
    audiences: row.audiences as Array<Record<string, unknown>>,
    appealsByTarget: appeals as Record<string, Array<Record<string, unknown>>>,
    evergreenPurchaseInfo: text(row.evergreenPurchaseInfo, "evergreenPurchaseInfo"),
    sourceUrls,
  };
}
