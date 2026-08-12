import { createHash } from "node:crypto";
import { parseCardDeckEditorialPlanV1, type CardDeckEditorialPlanV1 } from "./cardDeckEditorialPlan.js";

function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, normalize(child)]));
  };
  return JSON.stringify(normalize(value));
}

export function cardDeckEditorialPlanSha256(plan: CardDeckEditorialPlanV1): string {
  return createHash("sha256").update(canonicalJson(parseCardDeckEditorialPlanV1(plan)), "utf8").digest("hex");
}
