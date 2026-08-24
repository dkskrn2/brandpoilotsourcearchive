import type { PoolClient } from "pg";

export async function lockProductServiceAssetVersion(
  client: Pick<PoolClient, "query">,
  versionId: string,
): Promise<void> {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended($1::text,0))",
    [versionId],
  );
}
