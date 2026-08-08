import type { Pool, PoolClient } from "pg";

export const AI_CONTENT_MAINTENANCE_ERROR = "ai_content_maintenance";

export async function assertAiContentWritable(
  queryable: Pick<Pool | PoolClient, "query">,
): Promise<void> {
  try {
    await queryable.query("select assert_ai_content_writable()");
  } catch (error) {
    if ((error as { code?: string })?.code !== "42883") throw error;
    const marker = await queryable.query(
      `select exists (
         select 1 from schema_migrations
          where id='074_ai_content_maintenance_write_fence.sql'
       ) as installed`,
    );
    if (marker.rows[0]?.installed) throw new Error("ai_content_maintenance_guard_missing");
  }
}

export function withAiContentTransactionFence(pool: Pool): Pool {
  return new Proxy(pool, {
    get(target, property, _receiver) {
      if (property !== "connect") {
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async () => {
        const client = await target.connect();
        return new Proxy(client, {
          get(clientTarget, clientProperty, _clientReceiver) {
            if (clientProperty !== "query") {
              const value = Reflect.get(clientTarget, clientProperty, clientTarget);
              return typeof value === "function" ? value.bind(clientTarget) : value;
            }
            return async (query: unknown, ...parameters: unknown[]) => {
              const result = await Reflect.apply(clientTarget.query, clientTarget, [query, ...parameters]);
              const text = typeof query === "string"
                ? query
                : String((query as { text?: unknown })?.text ?? "");
              if (/^\s*begin\s*;?\s*$/i.test(text)) await assertAiContentWritable(clientTarget);
              return result;
            };
          },
        });
      };
    },
  });
}
