import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  completeGenerationOperationIfTerminal,
  reverseGenerationReservationIfTerminalFailure,
} from "./aiContentGenerationOperations.js";

describe("AI content generation operation terminal accounting", () => {
  it("transitions a completed generation operation exactly once", async () => {
    let operationStatus = "started";
    const statements: string[] = [];
    const client = { query: vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes("from ai_content_generations")) return { rows: [{ status: "completed", operation_id: "operation-1" }] };
      if (sql.includes("from ai_content_generation_operations")) return { rows: [{ id: "operation-1", status: operationStatus }] };
      if (sql.includes("transition_ai_content_generation_operation")) {
        operationStatus = "completed";
        return { rows: [{ status: operationStatus }] };
      }
      return { rows: [] };
    }) };

    await completeGenerationOperationIfTerminal(client as never, "generation-1");
    await completeGenerationOperationIfTerminal(client as never, "generation-1");

    expect(statements.filter((sql) => sql.includes("transition_ai_content_generation_operation"))).toHaveLength(1);
  });

  it("inserts one exact negative reversal and repairs duplicate permanent-failure delivery idempotently", async () => {
    let operationStatus = "started";
    let reversal: { id: string; quantity: number } | null = null;
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const client = { query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (sql.includes("from ai_content_generations")) return { rows: [{ status: "failed", operation_id: "operation-1" }] };
      if (sql.includes("for update of operation,reservation")) return { rows: [{
        operation_id: "operation-1", operation_status: operationStatus, reservation_id: "reservation-1",
        workspace_id: "workspace-1", brand_id: "brand-1", quantity: 1, usage_date: "2026-08-06",
      }] };
      if (sql.includes("left join ai_content_usage_ledger reversal")) return { rows: [{
        operation_status: operationStatus,
        reversal_id: reversal?.id ?? null,
        reversal_quantity: reversal?.quantity ?? null,
      }] };
      if (sql.startsWith("insert into ai_content_usage_ledger")) {
        reversal = { id: String(params[0]), quantity: Number(params[4]) };
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("transition_ai_content_generation_operation")) {
        operationStatus = "reversed";
        return { rows: [{ status: operationStatus }] };
      }
      return { rows: [] };
    }) };

    await reverseGenerationReservationIfTerminalFailure(client as never, "generation-1");
    await reverseGenerationReservationIfTerminalFailure(client as never, "generation-1");

    const inserts = statements.filter(({ sql }) => sql.startsWith("insert into ai_content_usage_ledger"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.params.slice(4)).toEqual([
      -1, "2026-08-06", "generation-reversal:operation-1", "operation-1", "reservation-1",
    ]);
    expect(statements.filter(({ sql }) => sql.includes("transition_ai_content_generation_operation"))).toHaveLength(1);
    const lockIndex = statements.findIndex(({ sql }) => sql.includes("for update of operation,reservation"));
    const recheckIndex = statements.findIndex(({ sql }) => sql.includes("left join ai_content_usage_ledger reversal"));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(recheckIndex).toBeGreaterThan(lockIndex);
  });

  it("does not return quota for retryable/non-terminal failure", async () => {
    const client = { query: vi.fn(async () => ({ rows: [{ status: "generating", operation_id: "operation-1" }] })) };
    await reverseGenerationReservationIfTerminalFailure(client as never, "generation-1");
    expect(client.query).toHaveBeenCalledOnce();
  });

  it("makes render completion consume the start reservation without a second generation charge", () => {
    const source = readFileSync(new URL("./aiContentRenderJobs.ts", import.meta.url), "utf8");
    const completeStart = source.indexOf("async completePackage(input)");
    const failStart = source.indexOf("async fail(input)", completeStart);
    const completeBody = source.slice(completeStart, failStart);
    expect(completeBody).not.toMatch(/insert into ai_content_usage_ledger/i);
    expect(completeBody).toMatch(/completeGenerationOperationIfTerminal/);
    const failBody = source.slice(failStart, source.indexOf("async saveOutputResearch", failStart));
    expect(failBody).toMatch(/if \(!retry\)[\s\S]*failRenderOutputAndGeneration/);
    const failureHelperStart = source.indexOf("async function failRenderOutputAndGeneration");
    const failureHelperBody = source.slice(failureHelperStart, source.indexOf("function requireLease", failureHelperStart));
    expect(failureHelperBody).toMatch(/reverseGenerationReservationIfTerminalFailure/);
  });
});
