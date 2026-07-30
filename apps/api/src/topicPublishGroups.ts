import { chooseNextInstagramFormat, type InstagramDeliveryFormat } from "./instagramFormats.js";
import type { Channel, PipelineRunResult } from "./types.js";

export const DAILY_TOPIC_LIMIT = 4;

export interface GenerationReadiness {
  threads: boolean;
  instagramFormat: InstagramDeliveryFormat | null;
  canProduce: boolean;
}

export function dailyTopicCapacity(existingTopicCount: number) {
  return Math.max(0, DAILY_TOPIC_LIMIT - Math.max(0, existingTopicCount));
}

export function brandPolicyDateKey(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function determineGenerationReadiness(
  enabledChannels: readonly Channel[],
  enabledInstagramFormats: readonly InstagramDeliveryFormat[],
  lastSelectedInstagramFormat: InstagramDeliveryFormat | null
): GenerationReadiness {
  const enabled = new Set(enabledChannels);
  const threads = enabled.has("threads");
  const instagramFormat = enabled.has("instagram")
    ? chooseNextInstagramFormat(enabledInstagramFormats, lastSelectedInstagramFormat)
    : null;
  const hasNonInstagramChannel = enabledChannels.some((channel) => channel !== "instagram");
  return { threads, instagramFormat, canProduce: hasNonInstagramChannel || instagramFormat !== null };
}

export async function runDailyTopicGeneration(
  generate: () => Promise<PipelineRunResult>
): Promise<PipelineRunResult> {
  const aggregate: PipelineRunResult = { processed: 0, created: 0, updated: 0, failed: 0 };
  for (let attempt = 0; attempt < DAILY_TOPIC_LIMIT; attempt += 1) {
    const result = await generate();
    aggregate.processed += result.processed;
    aggregate.created += result.created;
    aggregate.updated += result.updated;
    aggregate.failed += result.failed;
    if (result.processed === 0) break;
  }
  return aggregate;
}
