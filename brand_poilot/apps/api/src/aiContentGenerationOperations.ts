import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;

export async function completeGenerationOperationIfTerminal(client: Queryable, generationId: string) {
  const generationResult = await client.query(
    "select status,operation_id from ai_content_generations where id=$1 for update",
    [generationId],
  );
  const generation = generationResult.rows[0] as Record<string, unknown> | undefined;
  if (!generation || generation.status !== "completed" || !generation.operation_id) return;
  const operationResult = await client.query(
    "select id,status from ai_content_generation_operations where id=$1 and generation_id=$2 for update",
    [generation.operation_id, generationId],
  );
  const operation = operationResult.rows[0] as Record<string, unknown> | undefined;
  if (!operation) throw new Error("ai_content_generation_operation_completion_conflict");
  if (operation.status === "completed") return;
  if (operation.status !== "started") throw new Error("ai_content_generation_operation_completion_conflict");
  await client.query(
    "select transition_ai_content_generation_operation($1,'started','completed')",
    [operation.id],
  );
}

export async function reverseGenerationReservationIfTerminalFailure(client: Queryable, generationId: string) {
  const generationResult = await client.query(
    "select status,operation_id from ai_content_generations where id=$1 for update",
    [generationId],
  );
  const generation = generationResult.rows[0] as Record<string, unknown> | undefined;
  if (!generation || generation.status !== "failed" || !generation.operation_id) return;
  const graph = await client.query(
    `select operation.id operation_id,operation.status operation_status,reservation.id reservation_id,
            reservation.workspace_id,reservation.brand_id,reservation.quantity,reservation.usage_date
       from ai_content_generation_operations operation
       join ai_content_usage_ledger reservation
         on reservation.operation_id=operation.id and reservation.generation_id=operation.generation_id
        and reservation.usage_type='generation' and reservation.reservation_id=reservation.id
      where operation.id=$1 and operation.generation_id=$2
      for update of operation,reservation`,
    [generation.operation_id, generationId],
  );
  const row = graph.rows[0] as Record<string, unknown> | undefined;
  if (!row || !row.reservation_id || Number(row.quantity) <= 0) {
    throw new Error("ai_content_generation_reservation_missing");
  }
  const reversalResult = await client.query(
    `select operation.status operation_status,reversal.id reversal_id,reversal.quantity reversal_quantity
       from ai_content_generation_operations operation
       left join ai_content_usage_ledger reversal
         on reversal.operation_id=operation.id and reversal.reversal_of_ledger_id=$2
        and reversal.usage_type='reversal'
      where operation.id=$1`,
    [row.operation_id, row.reservation_id],
  );
  const current = reversalResult.rows[0] as Record<string, unknown> | undefined;
  if (!current) throw new Error("ai_content_generation_reversal_conflict");
  if (current.reversal_id) {
    if (Number(current.reversal_quantity) !== -Number(row.quantity) || current.operation_status !== "reversed") {
      throw new Error("ai_content_generation_reversal_conflict");
    }
    return;
  }
  if (current.operation_status !== "started" && current.operation_status !== "failed") {
    throw new Error("ai_content_generation_reversal_conflict");
  }
  await client.query(
    `insert into ai_content_usage_ledger(
       id,workspace_id,brand_id,generation_id,output_id,usage_type,quantity,usage_date,
       idempotency_key,operation_id,reservation_id,reversal_of_ledger_id
     ) values($1,$2,$3,$4,null,'reversal',$5,$6,$7,$8,$9,$9)`,
    [randomUUID(), row.workspace_id, row.brand_id, generationId, -Number(row.quantity), row.usage_date,
      `generation-reversal:${row.operation_id}`, row.operation_id, row.reservation_id],
  );
  await client.query(
    "select transition_ai_content_generation_operation($1,$2,'reversed')",
    [row.operation_id, current.operation_status],
  );
}
