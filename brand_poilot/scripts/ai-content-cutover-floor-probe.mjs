import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

import { decodeCaCertificate, resolveVerifiedTlsConfig } from "./databaseTls.mjs";

const fail = (code) => { throw new Error(code); };

function validateDatabaseUrl(value) {
  let parsed;
  try { parsed = new URL(value); }
  catch { fail("ai_content_floor_probe_input_invalid"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !parsed.hostname || !parsed.username || !parsed.password || !parsed.pathname
    || parsed.pathname === "/" || parsed.hash || /\s/u.test(value)) {
    fail("ai_content_floor_probe_input_invalid");
  }
  return value;
}

export function parseFloorProbeInput(input, kind, operatorCaBase64) {
  if (kind === "operator") {
    const connectionString = String(input ?? "").trim();
    if (!connectionString || connectionString.includes("\n") || connectionString.includes("\r")) {
      fail("ai_content_floor_probe_input_invalid");
    }
    if (typeof operatorCaBase64 !== "string"
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(operatorCaBase64)) {
      fail("ai_content_floor_probe_input_invalid");
    }
    return { connectionString: validateDatabaseUrl(connectionString), caBase64: operatorCaBase64 };
  }
  if (kind !== "env") fail("ai_content_floor_probe_kind_invalid");
  const exact = (key) => {
    const values = String(input ?? "").split(/\r?\n/u)
      .filter((line) => line.startsWith(`${key}=`));
    if (values.length !== 1) fail("ai_content_floor_probe_input_invalid");
    return values[0].slice(key.length + 1);
  };
  const connectionString = validateDatabaseUrl(exact("SUPABASE_DATABASE_URL"));
  const caBase64 = exact("DB_SSL_CA_BASE64");
  if (caBase64 && !/^[A-Za-z0-9+/]+={0,2}$/.test(caBase64)) {
    fail("ai_content_floor_probe_input_invalid");
  }
  return { connectionString, caBase64: caBase64 || undefined };
}

export async function probeCutoverMarker(client, kind) {
  if (kind === "operator") {
    const state = await client.query(
      "select marker_present from public.read_ai_content_cutover_control_state('00000000-0000-0000-0000-000000000000'::uuid)",
    );
    if (state.rows?.length !== 1 || typeof state.rows[0]?.marker_present !== "boolean") {
      fail("ai_content_floor_probe_result_invalid");
    }
    return state.rows[0].marker_present;
  }
  const relation = await client.query("select to_regclass('public.schema_migrations')::text as relation");
  if (relation.rows?.length !== 1) fail("ai_content_floor_probe_result_invalid");
  if (relation.rows[0]?.relation == null) return false;
  const marker = await client.query(
    "select exists(select 1 from public.schema_migrations where id='075_ai_content_three_format_cutover.sql') as present",
  );
  if (marker.rows?.length !== 1 || typeof marker.rows[0]?.present !== "boolean") {
    fail("ai_content_floor_probe_result_invalid");
  }
  return marker.rows[0].present;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith("--") || argv[index + 1] === undefined || args[key.slice(2)] !== undefined) {
      fail("ai_content_floor_probe_arguments_invalid");
    }
    args[key.slice(2)] = argv[index + 1];
  }
  if (JSON.stringify(Object.keys(args).sort()) !== JSON.stringify(["input-file", "input-kind"])) {
    fail("ai_content_floor_probe_arguments_invalid");
  }
  return args;
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);
  const config = parseFloorProbeInput(
    await readFile(args["input-file"], "utf8"),
    args["input-kind"],
    process.env.DB_SSL_CA_BASE64,
  );
  const client = new Client(resolveVerifiedTlsConfig(config.connectionString, {
    caCertificate: decodeCaCertificate(config.caBase64),
  }));
  try {
    await client.connect();
    process.stdout.write(`${await probeCutoverMarker(client, args["input-kind"])}\n`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "ai_content_floor_probe_failed"}\n`);
    process.exitCode = 1;
  });
}
