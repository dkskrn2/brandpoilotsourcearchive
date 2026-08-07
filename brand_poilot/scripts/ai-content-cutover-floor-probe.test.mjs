import assert from "node:assert/strict";
import test from "node:test";

import { parseFloorProbeInput } from "./ai-content-cutover-floor-probe.mjs";

test("floor probe accepts one operator URL or one exact API env contract", () => {
  assert.deepEqual(
    parseFloorProbeInput("postgresql://operator:secret@db.example.test/postgres\n", "operator"),
    { connectionString: "postgresql://operator:secret@db.example.test/postgres", caBase64: undefined },
  );
  assert.deepEqual(
    parseFloorProbeInput([
      "SUPABASE_DATABASE_URL=postgresql://app:secret@db.example.test/postgres",
      "DB_SSL_CA_BASE64=YWJj",
      "CONTENT_PROPOSALS_ENABLED=false",
      "",
    ].join("\n"), "env"),
    {
      connectionString: "postgresql://app:secret@db.example.test/postgres",
      caBase64: "YWJj",
    },
  );
});

test("floor probe rejects duplicate, missing, and unknown input kinds", () => {
  assert.throws(
    () => parseFloorProbeInput("SUPABASE_DATABASE_URL=a\nSUPABASE_DATABASE_URL=b\nDB_SSL_CA_BASE64=c\n", "env"),
    /ai_content_floor_probe_input_invalid/,
  );
  assert.throws(
    () => parseFloorProbeInput("SUPABASE_DATABASE_URL=a\n", "env"),
    /ai_content_floor_probe_input_invalid/,
  );
  assert.throws(
    () => parseFloorProbeInput("postgresql://operator:secret@db.example.test/postgres", "other"),
    /ai_content_floor_probe_kind_invalid/,
  );
});
