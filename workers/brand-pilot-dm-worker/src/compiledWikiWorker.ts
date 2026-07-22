import { compileWikiGroup, type CompiledWikiPage, type WikiCompilationGroup } from "./wikiCompiler.js";

export interface ClaimedWikiCompilationItem {
  id: string;
  workspaceId: string;
  brandId: string;
  wikiVersionId: string;
  itemType: "brand_core_pages" | "detail_page" | "policy_page" | "faq_guide_page";
  stableKey: string;
  leaseToken: string;
}

export interface CompiledWikiWorkerDb {
  claimWikiCompilationItem(workerId: string): Promise<ClaimedWikiCompilationItem | null>;
  getWikiCompilationGroup(item: ClaimedWikiCompilationItem): Promise<WikiCompilationGroup>;
  completeWikiCompilationItem(item: ClaimedWikiCompilationItem, page: CompiledWikiPage): Promise<void>;
  failWikiCompilationItem(item: ClaimedWikiCompilationItem, error: string): Promise<void>;
}

export async function runWikiCompilationItemOnce(input: {
  workerId: string;
  db: CompiledWikiWorkerDb;
  runtimeDirectory: string;
  timeoutMs: number;
  runCodex: (input: { prompt: string; runtimeDirectory: string; timeoutMs: number }) => Promise<unknown>;
}) {
  const item = await input.db.claimWikiCompilationItem(input.workerId);
  if (!item) return { status: "idle" as const };

  try {
    const group = await input.db.getWikiCompilationGroup(item);
    const page = await compileWikiGroup({
      group,
      runtimeDirectory: input.runtimeDirectory,
      timeoutMs: input.timeoutMs,
      runCodex: input.runCodex,
    });
    await input.db.completeWikiCompilationItem(item, page);
    return {
      status: "completed" as const,
      itemId: item.id,
      pageType: page.pageType,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "wiki_compilation_item_failed";
    await input.db.failWikiCompilationItem(item, message);
    return { status: "failed" as const, itemId: item.id };
  }
}
