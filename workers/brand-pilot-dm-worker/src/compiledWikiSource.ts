import { buildCompiledSourceUnits, type CompiledWikiSourceUnit } from "./compiledWikiTypes.js";
import { curateKnowledge, type CuratedKnowledgeUnit } from "./knowledgeCurator.js";
import { normalizeKnowledgeSource } from "./knowledgeNormalizer.js";
import type { ClaimedWikiBuildItem, WikiBuildSource } from "./wikiRefresh.js";

export interface CompiledWikiSourceDb {
  claimWikiBuildItem(workerId: string, versions: {
    curatorPromptVersion: string;
    embeddingModel: string;
    embeddingVersion: string;
  }): Promise<ClaimedWikiBuildItem | null>;
  getWikiBuildSource(item: ClaimedWikiBuildItem): Promise<WikiBuildSource>;
  completeWikiSourceItem(
    item: ClaimedWikiBuildItem,
    units: CompiledWikiSourceUnit[],
  ): Promise<{ collectionComplete: boolean }>;
  failWikiBuildItem(item: ClaimedWikiBuildItem, error: string): Promise<void>;
}

function directUnit(source: WikiBuildSource): CuratedKnowledgeUnit {
  return {
    unitType: source.source_kind as "faq" | "product" | "policy",
    title: source.title,
    content: source.content,
    keywords: source.keywords,
    aliases: source.aliases,
    sourceQuote: source.content,
    validFrom: null,
    validUntil: null,
    structuredData: source.structured_data,
  };
}

function sourceOnlyGuideUnit(title: string, content: string): CuratedKnowledgeUnit {
  return {
    unitType: "guide_section",
    title,
    content,
    keywords: [],
    aliases: [],
    sourceQuote: content.slice(0, 300),
    validFrom: null,
    validUntil: null,
    structuredData: {},
  };
}

function canUseSourceOnlyFallback(error: unknown) {
  return error instanceof Error
    && (error.message === "codex_timeout" || error.message === "curator_source_quote_missing");
}

export async function runCompiledWikiSourceItemOnce(input: {
  workerId: string;
  db: CompiledWikiSourceDb;
  curatorPromptVersion: string;
  embeddingModel: string;
  embeddingVersion: string;
  runtimeDirectory: string;
  curatorTimeoutMs?: number;
  runCodex: (input: { prompt: string; runtimeDirectory: string; timeoutMs: number }) => Promise<unknown>;
}) {
  const item = await input.db.claimWikiBuildItem(input.workerId, {
    curatorPromptVersion: input.curatorPromptVersion,
    embeddingModel: input.embeddingModel,
    embeddingVersion: input.embeddingVersion,
  });
  if (!item) return { status: "idle" as const };

  try {
    const source = await input.db.getWikiBuildSource(item);
    let units: CuratedKnowledgeUnit[];
    if (source.source_kind === "owned_snapshot") {
      const normalized = normalizeKnowledgeSource(source.content);
      if (!normalized) {
        const completion = await input.db.completeWikiSourceItem(item, []);
        return {
          status: "completed" as const,
          itemId: item.id,
          unitCount: 0,
          collectionComplete: completion.collectionComplete,
        };
      }
      try {
        units = await curateKnowledge({
          normalizedSource: normalized,
          sourceTitle: source.title,
          sourceStructuredData: source.structured_data,
          runtimeDirectory: input.runtimeDirectory,
          timeoutMs: input.curatorTimeoutMs ?? 30_000,
          runCodex: input.runCodex,
        });
      } catch (error) {
        if (!canUseSourceOnlyFallback(error)) throw error;
        units = [sourceOnlyGuideUnit(source.title, normalized)];
      }
    } else {
      units = [directUnit(source)];
    }

    const compiledUnits = buildCompiledSourceUnits({
      sourceKind: source.source_kind,
      sourceId: source.source_id,
      sourceUrl: source.source_url,
      units,
    });
    const completion = await input.db.completeWikiSourceItem(item, compiledUnits);
    return {
      status: "completed" as const,
      itemId: item.id,
      unitCount: compiledUnits.length,
      collectionComplete: completion.collectionComplete,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "wiki_source_item_failed";
    await input.db.failWikiBuildItem(item, message);
    return { status: "failed" as const, itemId: item.id };
  }
}
