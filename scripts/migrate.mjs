import { config } from "dotenv";
import { runMigrations } from "./migrationRunner.mjs";

config({ path: ".env" });
config({ path: ".env.local", override: true });
config({ path: "apps/api/.env", override: true });
config({ path: "apps/api/.env.local", override: true });

const result = await runMigrations({
  connectionString: process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL,
  baselineUpTo: process.env.MIGRATION_BASELINE_UP_TO,
  dryRun: process.argv.includes("--dry-run")
});

console.log(JSON.stringify({ applied: result.pending, migrationCount: result.migrations.length, baselineRequired: result.baselineRequired }, null, 2));
