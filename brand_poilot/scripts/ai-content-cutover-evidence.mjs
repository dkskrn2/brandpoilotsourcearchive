import { createHash } from "node:crypto";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export const REQUIRED_INCIDENT_GENERATION_IDS = Object.freeze([
  "26998aec-b8c4-4abb-a1d8-a7204c1b6226",
  "71565421-d205-4627-8ea5-84633ac879cb",
]);

export const INCIDENT_EVIDENCE_SECTIONS = Object.freeze([
  "request",
  "orchestration",
  "proposal_batch",
  "proposal",
  "approval",
  "v3_input",
  "generation",
  "jobs",
  "outputs",
  "render",
  "errors",
  "idempotency",
  "manifest",
  "attachment_paths",
  "log_correlation",
  "release_sha",
  "release_images",
  "migration_version",
]);

export const INCIDENT_QUERY_SECTIONS = Object.freeze([
  "request",
  "orchestration",
  "proposal_batch",
  "proposal",
  "approval",
  "v3_input",
  "generation",
  "jobs",
  "outputs",
  "render",
  "errors",
  "idempotency",
  "manifest",
  "attachment_paths",
]);

const RECORD_SET_SECTIONS = new Set([
  "jobs",
  "outputs",
  "render",
  "errors",
  "idempotency",
  "manifest",
  "attachment_paths",
  "log_correlation",
  "release_images",
]);

const METADATA_KEYS = new Set(["release_sha", "release_images", "incident_log_correlation"]);
const SECTION_SET = new Set(INCIDENT_EVIDENCE_SECTIONS);

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical_json_number_invalid");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("canonical_json_value_invalid");
  }
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) throw new Error(`canonical_json_undefined:${key}`);
      return [key, canonicalValue(value[key])];
    }),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256CanonicalJson(value) {
  return createHash("sha256").update(`${canonicalJson(value)}\n`, "utf8").digest("hex");
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deterministicRecordSet(value) {
  if (!Array.isArray(value)) return value;
  return [...value].sort((left, right) => lexicalCompare(canonicalJson(left), canonicalJson(right)));
}

function evidenceSection(section, value) {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
    return { status: "not_found" };
  }
  return {
    status: "found",
    data: RECORD_SET_SECTIONS.has(section) ? deterministicRecordSet(value) : value,
  };
}

function validateIncidentRecords(incidentRecords) {
  if (incidentRecords === null || typeof incidentRecords !== "object" || Array.isArray(incidentRecords)) {
    throw new Error("incident_records_invalid");
  }
  for (const [generationId, record] of Object.entries(incidentRecords)) {
    if (!REQUIRED_INCIDENT_GENERATION_IDS.includes(generationId)) {
      throw new Error(`incident_generation_id_invalid:${generationId}`);
    }
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`incident_record_invalid:${generationId}`);
    }
    for (const key of Object.keys(record)) {
      if (!SECTION_SET.has(key)) throw new Error(`incident_section_invalid:${key}`);
    }
  }
}

export function buildIncidentEvidenceBundle({ incidentRecords = {} } = {}) {
  validateIncidentRecords(incidentRecords);
  return {
    schema_version: "ai-content-cutover-evidence.v2",
    database_row_encoding: "postgres-jsonb-text.v1",
    required_generation_ids: [...REQUIRED_INCIDENT_GENERATION_IDS],
    incidents: REQUIRED_INCIDENT_GENERATION_IDS.map((generationId) => {
      const record = incidentRecords[generationId] ?? {};
      return {
        generation_id: generationId,
        ...Object.fromEntries(
          INCIDENT_EVIDENCE_SECTIONS.map((section) => [section, evidenceSection(section, record[section])]),
        ),
      };
    }),
  };
}

const INCIDENT_SECTION_SQL = Object.freeze({
  request: `
    select evidence.row_json
    from (
      select 1 as source_order,jsonb_build_object(
        'kind','proposal_v2_request',
        'record',jsonb_build_object(
          'batch_id',batch.id,
          'request_json',batch.request_json,
          'source_snapshot_json',batch.source_snapshot_json)
      ) as row_json
      from ai_content_proposals proposal
      join ai_content_proposal_batches batch
        on batch.id=proposal.batch_id
       and batch.workspace_id=proposal.workspace_id
       and batch.brand_id=proposal.brand_id
      where proposal.generation_id=$1::uuid
      union all
      select 2,jsonb_build_object(
        'kind','generation_request',
        'record',jsonb_build_object(
          'generation_id',generation.id,
          'type',generation.type,
          'title',generation.title,
          'draft_json',generation.draft_json,
          'analysis_json',generation.analysis_json,
          'analysis_idempotency_key',generation.analysis_idempotency_key,
          'generation_idempotency_key',generation.generation_idempotency_key)
      )
      from ai_content_generations generation
      where generation.id=$1::uuid
    ) evidence
    order by evidence.source_order,evidence.row_json::text`,
  orchestration: `
    select evidence.row_json from (
      select jsonb_build_object('kind','generation_orchestration_snapshot','record',generation.orchestration_snapshot) row_json
      from ai_content_generations generation where generation.id=$1::uuid and generation.orchestration_snapshot is not null
      union all
      select jsonb_build_object('kind','generation_brief','record',to_jsonb(brief))
      from ai_content_generation_briefs brief where brief.generation_id=$1::uuid
      union all
      select jsonb_build_object('kind','analyzed_subject_snapshot','record',to_jsonb(snapshot))
      from ai_content_analyzed_subject_snapshots snapshot
      join ai_content_generations generation on generation.id=$1::uuid
      where snapshot.id=(generation.orchestration_snapshot->'subject'->>'snapshotId')::uuid
      union all
      select jsonb_build_object('kind','subject_analysis','record',to_jsonb(analysis))
      from ai_content_subject_analyses analysis
      where analysis.generation_id=$1::uuid or analysis.id in (
        select snapshot.analysis_id from ai_content_analyzed_subject_snapshots snapshot
        join ai_content_generations generation on generation.id=$1::uuid
        where snapshot.id=(generation.orchestration_snapshot->'subject'->>'snapshotId')::uuid)
      union all
      select jsonb_build_object('kind','subject_image','record',to_jsonb(image))
      from ai_content_subject_images image where image.analysis_id in (
        select analysis.id from ai_content_subject_analyses analysis
        where analysis.generation_id=$1::uuid or analysis.id in (
          select snapshot.analysis_id from ai_content_analyzed_subject_snapshots snapshot
          join ai_content_generations generation on generation.id=$1::uuid
          where snapshot.id=(generation.orchestration_snapshot->'subject'->>'snapshotId')::uuid))
      union all
      select jsonb_build_object('kind','subject_appeal_regeneration_key','record',to_jsonb(regeneration_key))
      from ai_content_subject_appeal_regeneration_keys regeneration_key
      join ai_content_subject_analyses analysis on analysis.id=regeneration_key.analysis_id
      where analysis.generation_id=$1::uuid or analysis.id in (
        select snapshot.analysis_id from ai_content_analyzed_subject_snapshots snapshot
        join ai_content_generations generation on generation.id=$1::uuid
        where snapshot.id=(generation.orchestration_snapshot->'subject'->>'snapshotId')::uuid)
      union all
      select jsonb_build_object('kind','generation_reference','record',to_jsonb(reference))
      from ai_content_generation_references reference where reference.generation_id=$1::uuid
      union all
      select jsonb_build_object('kind','generation_reference_migration_audit','record',to_jsonb(audit))
      from ai_content_generation_reference_migration_audits audit where audit.generation_id=$1::uuid
      union all
      select jsonb_build_object('kind','wiki_version_snapshot','record',to_jsonb(snapshot))
      from ai_content_generations generation
      cross join lateral jsonb_array_elements(coalesce(generation.orchestration_snapshot->'wikiSnapshots','[]'::jsonb)) wiki(item)
      join ai_content_wiki_version_snapshots snapshot on snapshot.id=(wiki.item->>'id')::uuid
      where generation.id=$1::uuid
    ) evidence order by evidence.row_json::text`,
  proposal_batch: `
    select evidence.row_json from (
      select jsonb_build_object('kind','proposal_batch','record',to_jsonb(batch)) row_json
      from ai_content_proposals proposal join ai_content_proposal_batches batch
        on batch.id=proposal.batch_id and batch.workspace_id=proposal.workspace_id and batch.brand_id=proposal.brand_id
      where proposal.generation_id=$1::uuid
      union all
      select jsonb_build_object('kind','proposal_research_snapshot','record',to_jsonb(snapshot))
      from ai_content_proposal_research_snapshots snapshot join ai_content_proposals proposal on proposal.batch_id=snapshot.batch_id
      where proposal.generation_id=$1::uuid
    ) evidence order by evidence.row_json::text`,
  proposal: `
    select jsonb_build_object('kind','proposal','record',to_jsonb(proposal)) as row_json
    from ai_content_proposals proposal
    where proposal.generation_id=$1::uuid
    order by proposal.id`,
  approval: `
    select jsonb_build_object('kind','approved_proposal_version','record',to_jsonb(approval)) as row_json
    from ai_content_proposals proposal
    join ai_content_approved_proposal_versions approval
      on approval.proposal_id=proposal.id
     and approval.workspace_id=proposal.workspace_id
     and approval.brand_id=proposal.brand_id
    where proposal.generation_id=$1::uuid
    order by approval.revision,approval.id`,
  v3_input: `
    select jsonb_build_object('kind','generation_input_snapshot','record',to_jsonb(input_snapshot)) as row_json
    from ai_content_generation_input_snapshots input_snapshot
    where input_snapshot.generation_id=$1::uuid
    order by input_snapshot.id`,
  generation: `
    select jsonb_build_object('kind','generation','record',to_jsonb(generation)) as row_json
    from ai_content_generations generation
    where generation.id=$1::uuid`,
  jobs: `
    select evidence.row_json
    from (
      select jsonb_build_object('kind','generation_job','record',to_jsonb(job)) as row_json
      from ai_content_generation_jobs job
      where job.generation_id=$1::uuid
      union all
      select jsonb_build_object('kind','proposal_job','record',to_jsonb(job)) as row_json
      from ai_content_proposal_jobs job
      join ai_content_proposals proposal
        on proposal.batch_id=job.batch_id
       and proposal.workspace_id=job.workspace_id
       and proposal.brand_id=job.brand_id
      where proposal.generation_id=$1::uuid
      union all
      select jsonb_build_object('kind','legacy_channel_job','record',to_jsonb(job))
      from jobs job join channel_outputs channel_output on channel_output.id=job.channel_output_id
      join ai_content_generation_outputs output on output.id=channel_output.ai_content_generation_output_id
      where output.generation_id=$1::uuid
    ) evidence
    order by evidence.row_json::text`,
  outputs: `
    select evidence.row_json from (
      select jsonb_build_object('kind','generation_output','record',to_jsonb(output)) row_json
      from ai_content_generation_outputs output where output.generation_id=$1::uuid
      union all
      select jsonb_build_object('kind','output_research_snapshot','record',to_jsonb(snapshot))
      from ai_content_output_research_snapshots snapshot where snapshot.generation_id=$1::uuid
    ) evidence order by evidence.row_json::text`,
  render: `
    select jsonb_build_object('kind','render_job','record',to_jsonb(render_job)) as row_json
    from ai_content_generation_render_jobs render_job
    where render_job.generation_id=$1::uuid
    order by render_job.output_id,render_job.job_kind,render_job.asset_index nulls last,render_job.id`,
  errors: `
    select evidence.row_json
    from (
      select jsonb_build_object('kind','generation','record',to_jsonb(generation)) as row_json
      from ai_content_generations generation
      where generation.id=$1::uuid and generation.error_code is not null
      union all
      select jsonb_build_object('kind','generation_job','record',to_jsonb(job))
      from ai_content_generation_jobs job
      where job.generation_id=$1::uuid and job.error_code is not null
      union all
      select jsonb_build_object('kind','output','record',to_jsonb(output))
      from ai_content_generation_outputs output
      where output.generation_id=$1::uuid and output.failure_code is not null
      union all
      select jsonb_build_object('kind','render_job','record',to_jsonb(render_job))
      from ai_content_generation_render_jobs render_job
      where render_job.generation_id=$1::uuid and render_job.error_code is not null
      union all
      select jsonb_build_object('kind','proposal_batch','record',to_jsonb(batch))
      from ai_content_proposal_batches batch
      join ai_content_proposals proposal
        on proposal.batch_id=batch.id
       and proposal.workspace_id=batch.workspace_id
       and proposal.brand_id=batch.brand_id
      where proposal.generation_id=$1::uuid and batch.error_code is not null
      union all
      select jsonb_build_object('kind','proposal_job','record',to_jsonb(job))
      from ai_content_proposal_jobs job
      join ai_content_proposals proposal
        on proposal.batch_id=job.batch_id
       and proposal.workspace_id=job.workspace_id
       and proposal.brand_id=job.brand_id
      where proposal.generation_id=$1::uuid and job.error_code is not null
      union all
      select jsonb_build_object('kind','legacy_channel_job','record',to_jsonb(job))
      from jobs job join channel_outputs channel_output on channel_output.id=job.channel_output_id
      join ai_content_generation_outputs output on output.id=channel_output.ai_content_generation_output_id
      where output.generation_id=$1::uuid and (job.last_error is not null or job.status in ('failed','dead'))
      union all
      select jsonb_build_object('kind','attachment_upload_session','record',to_jsonb(upload))
      from ai_content_attachment_upload_sessions upload
      where upload.generation_id=$1::uuid and (upload.last_error_code is not null or upload.status='failed')
      union all
      select jsonb_build_object('kind','attachment_deletion_job','record',to_jsonb(deletion))
      from ai_content_attachment_deletion_jobs deletion
      where deletion.generation_id=$1::uuid and (deletion.last_error_category is not null or deletion.status in ('failed','dead_letter'))
      union all
      select jsonb_build_object('kind','subject_analysis','record',to_jsonb(analysis))
      from ai_content_subject_analyses analysis
      where analysis.generation_id=$1::uuid
        and (analysis.error_code is not null or analysis.error_message is not null or analysis.status='failed')
    ) evidence
    order by evidence.row_json::text`,
  idempotency: `
    select evidence.row_json
    from (
      select jsonb_build_object('kind','create_idempotency','record',to_jsonb(record)) as row_json
      from ai_content_create_idempotency_records record
      where record.resource_id=$1::uuid
         or record.resource_id in (
           select proposal.id from ai_content_proposals proposal where proposal.generation_id=$1::uuid
           union all
           select proposal.batch_id from ai_content_proposals proposal where proposal.generation_id=$1::uuid
           union all
           select brief.id from ai_content_generation_briefs brief where brief.generation_id=$1::uuid
         )
      union all
      select jsonb_build_object('kind','usage_ledger','record',to_jsonb(usage))
      from ai_content_usage_ledger usage
      where usage.generation_id=$1::uuid
      union all
      select jsonb_build_object('kind','subject_appeal_regeneration_key','record',to_jsonb(regeneration_key))
      from ai_content_subject_appeal_regeneration_keys regeneration_key
      join ai_content_subject_analyses analysis on analysis.id=regeneration_key.analysis_id
      where analysis.generation_id=$1::uuid or analysis.id in (
        select snapshot.analysis_id from ai_content_analyzed_subject_snapshots snapshot
        join ai_content_generations generation on generation.id=$1::uuid
        where snapshot.id=(generation.orchestration_snapshot->'subject'->>'snapshotId')::uuid)
    ) evidence
    order by evidence.row_json::text`,
  manifest: `
    select jsonb_build_object(
      'kind','output_manifest',
      'record',jsonb_build_object(
        'output_id', output.id,
        'output_index', output.output_index,
        'artifact_manifest_json', output.artifact_manifest_json,
        'manifest_url', output.manifest_url)
    ) as row_json
    from ai_content_generation_outputs output
    where output.generation_id=$1::uuid
    order by output.output_index,output.id`,
  attachment_paths: `
    select evidence.row_json from (
      select jsonb_build_object('kind','attachment','record',to_jsonb(attachment)) row_json
      from ai_content_generation_attachments attachment where attachment.generation_id=$1::uuid
      union all
      select jsonb_build_object('kind','upload_session','record',to_jsonb(upload))
      from ai_content_attachment_upload_sessions upload where upload.generation_id=$1::uuid
      union all
      select jsonb_build_object('kind','deletion_job','record',to_jsonb(deletion))
      from ai_content_attachment_deletion_jobs deletion where deletion.generation_id=$1::uuid
      union all
      select jsonb_build_object('kind','storage_path_guard','record',to_jsonb(path_guard))
      from ai_content_attachment_storage_path_guards path_guard where path_guard.storage_path in (
        select attachment.storage_path from ai_content_generation_attachments attachment where attachment.generation_id=$1::uuid
        union select upload.storage_path from ai_content_attachment_upload_sessions upload where upload.generation_id=$1::uuid
        union select deletion.storage_path from ai_content_attachment_deletion_jobs deletion where deletion.generation_id=$1::uuid)
      union all
      select jsonb_build_object('kind','one_time_avatar_receipt','record',to_jsonb(receipt))
      from ai_content_one_time_avatar_receipts receipt where receipt.generation_id=$1::uuid
      union all
      select jsonb_build_object('kind','one_time_avatar_revocation','record',to_jsonb(revocation))
      from ai_content_one_time_avatar_revocations revocation where revocation.generation_id=$1::uuid
    ) evidence order by evidence.row_json::text`,
});

const MIGRATION_VERSION_SQL = `
  select jsonb_build_object('kind','schema_migration','record',to_jsonb(migration)) as row_json
  from schema_migrations migration
  order by migration.applied_at desc,migration.id desc
  limit 1`;

function queryName(section) {
  return `ai-content-evidence-${section.replaceAll("_", "-")}`;
}

function queryRows(result) {
  return result.rows.map((row) => {
    if (typeof row.row_json_text !== "string") throw new Error("incident_row_json_text_invalid");
    return Object.freeze({ encoding: "postgres-jsonb-text.v1", json_text: row.row_json_text });
  });
}

function plainDataEntries(value, errorCode) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(errorCode);
  const entries = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new Error(errorCode);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error(errorCode);
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function denseDataArrayValues(value, errorCode) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error(errorCode);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.at(-1) !== "length") throw new Error(errorCode);
  const values = [];
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    if (keys[index] !== key) throw new Error(errorCode);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error(errorCode);
    values.push(descriptor.value);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || lengthDescriptor.enumerable
    || lengthDescriptor.value !== value.length) throw new Error(errorCode);
  return values;
}

function validateMetadata(metadata) {
  const metadataEntries = plainDataEntries(metadata, "incident_metadata_invalid");
  const metadataValues = Object.fromEntries(metadataEntries);
  for (const [key] of metadataEntries) {
    if (!METADATA_KEYS.has(key)) throw new Error(`incident_metadata_key_invalid:${key}`);
  }
  if (metadataValues.release_sha !== undefined && !/^[0-9a-f]{40}$/.test(metadataValues.release_sha)) {
    throw new Error("incident_release_sha_invalid");
  }
  let normalizedImages;
  if (metadataValues.release_images !== undefined) {
    normalizedImages = denseDataArrayValues(metadataValues.release_images, "incident_release_image_invalid").map((record) => {
      const entries = plainDataEntries(record, "incident_release_image_invalid");
      const fields = Object.fromEntries(entries);
      if (entries.map(([key]) => key).sort().join(",") !== "component,digest"
        || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(fields.component)
        || !/^sha256:[0-9a-f]{64}$/.test(fields.digest)) {
        throw new Error("incident_release_image_invalid");
      }
      return Object.freeze({ component: fields.component, digest: fields.digest });
    });
  }
  const correlation = metadataValues.incident_log_correlation;
  const normalizedCorrelation = {};
  if (correlation !== undefined) {
    for (const [generationId, rawItems] of plainDataEntries(correlation, "incident_log_correlation_invalid")) {
      if (!REQUIRED_INCIDENT_GENERATION_IDS.includes(generationId)) {
        throw new Error(`incident_log_generation_id_invalid:${generationId}`);
      }
      const normalizedItems = [];
      const allowed = new Set(["request_id", "trace_id", "correlation_id", "log_group", "log_stream", "log_url", "started_at", "ended_at"]);
      for (const item of denseDataArrayValues(rawItems, "incident_log_correlation_invalid")) {
        const entries = plainDataEntries(item, "incident_log_correlation_invalid");
        if (entries.length === 0) throw new Error("incident_log_correlation_invalid");
        for (const [key, value] of entries) {
          if (!allowed.has(key)) throw new Error(`incident_log_correlation_key_invalid:${key}`);
          if (typeof value !== "string" || value.length === 0) throw new Error(`incident_log_correlation_value_invalid:${key}`);
        }
        normalizedItems.push(Object.freeze(Object.fromEntries(entries)));
      }
      normalizedCorrelation[generationId] = Object.freeze(normalizedItems);
    }
  }
  return Object.freeze({
    ...(metadataValues.release_sha === undefined ? {} : { release_sha: metadataValues.release_sha }),
    ...(normalizedImages === undefined ? {} : {
      release_images: Object.freeze(normalizedImages),
    }),
    ...(correlation === undefined ? {} : {
      incident_log_correlation: Object.freeze(Object.fromEntries(
        REQUIRED_INCIDENT_GENERATION_IDS.filter((id) => Object.hasOwn(normalizedCorrelation, id)).map((id) => [
          id,
          normalizedCorrelation[id],
        ]),
      )),
    }),
  });
}

export async function collectIncidentEvidence(queryable, { metadata = {} } = {}) {
  if (!queryable || typeof queryable.query !== "function") throw new Error("incident_queryable_invalid");
  const normalizedMetadata = validateMetadata(metadata);
  const incidentRecords = {};
  for (const generationId of REQUIRED_INCIDENT_GENERATION_IDS) {
    const record = {};
    for (const section of INCIDENT_QUERY_SECTIONS) {
      const result = await queryable.query({
        name: queryName(section),
        text: `select exact_row.row_json::text as row_json_text from (${INCIDENT_SECTION_SQL[section]}) exact_row order by exact_row.row_json::text collate "C"`,
        values: [generationId],
      });
      const rows = queryRows(result);
      if (rows.length) record[section] = rows.length === 1 && !RECORD_SET_SECTIONS.has(section) ? rows[0] : rows;
    }
    record.log_correlation = normalizedMetadata.incident_log_correlation?.[generationId];
    record.release_sha = normalizedMetadata.release_sha;
    record.release_images = normalizedMetadata.release_images;
    incidentRecords[generationId] = record;
  }

  const migration = await queryable.query({
    name: queryName("migration_version"),
    text: `select exact_row.row_json::text as row_json_text from (${MIGRATION_VERSION_SQL}) exact_row order by exact_row.row_json::text collate "C"`,
    values: [],
  });
  const migrationRows = queryRows(migration);
  for (const generationId of REQUIRED_INCIDENT_GENERATION_IDS) {
    if (migrationRows.length) incidentRecords[generationId].migration_version = migrationRows[0];
  }
  return buildIncidentEvidenceBundle({ incidentRecords });
}

function isInside(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

async function resolvedDirectory(path, missingError) {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(missingError);
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("output_directory_invalid");
  return { directory: await realpath(path), stat };
}

async function assertOutputDirectory({ outputDirectory, executionGraphRoots, verifyModeRestricted }) {
  if (typeof outputDirectory !== "string" || !isAbsolute(outputDirectory)) {
    throw new Error("output_directory_must_be_absolute");
  }
  const resolvedOutput = await resolvedDirectory(outputDirectory, "output_directory_not_found");
  for (const root of executionGraphRoots) {
    if (typeof root !== "string" || !isAbsolute(root)) throw new Error("execution_graph_root_must_be_absolute");
    let resolvedRoot;
    try {
      resolvedRoot = await realpath(root);
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error("execution_graph_root_not_found");
      throw error;
    }
    if (isInside(resolvedRoot, resolvedOutput.directory)) {
      throw new Error("output_directory_inside_execution_graph");
    }
  }
  if (process.platform === "win32" && !verifyModeRestricted) {
    throw new Error("output_directory_acl_verifier_required");
  }
  const restricted = verifyModeRestricted
    ? await verifyModeRestricted(resolvedOutput)
    : process.platform !== "win32" && (resolvedOutput.stat.mode & 0o077) === 0;
  if (!restricted) throw new Error("output_directory_not_mode_restricted");
  return resolvedOutput.directory;
}

export async function writeChecksummedJson({
  outputDirectory,
  fileName,
  value,
  executionGraphRoots = [],
  verifyModeRestricted,
}) {
  if (
    typeof fileName !== "string"
    || basename(fileName) !== fileName
    || fileName.includes("\\")
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(fileName)
  ) {
    throw new Error("output_file_name_invalid");
  }
  if (!Array.isArray(executionGraphRoots)) throw new Error("execution_graph_roots_invalid");
  if (executionGraphRoots.length === 0) throw new Error("execution_graph_roots_required");
  const directory = await assertOutputDirectory({ outputDirectory, executionGraphRoots, verifyModeRestricted });
  const jsonPath = resolve(join(directory, fileName));
  const checksumPath = resolve(join(directory, `${fileName}.sha256`));
  if (!isInside(directory, jsonPath) || !isInside(directory, checksumPath)) throw new Error("output_path_invalid");
  const contents = `${canonicalJson(value)}\n`;
  const sha256 = sha256CanonicalJson(value);
  const created = [];
  let jsonHandle;
  let checksumHandle;
  try {
    jsonHandle = await open(jsonPath, "wx", 0o600);
    created.push(jsonPath);
    checksumHandle = await open(checksumPath, "wx", 0o600);
    created.push(checksumPath);
    await jsonHandle.writeFile(contents, "utf8");
    await checksumHandle.writeFile(`${sha256}  ${fileName}\n`, "utf8");
    await jsonHandle.sync();
    await checksumHandle.sync();
  } catch (error) {
    await jsonHandle?.close();
    await checksumHandle?.close();
    jsonHandle = undefined;
    checksumHandle = undefined;
    await Promise.all(created.map((path) => unlink(path).catch(() => undefined)));
    if (error?.code === "EEXIST") throw new Error("output_file_exists");
    throw error;
  } finally {
    await jsonHandle?.close();
    await checksumHandle?.close();
  }
  return { jsonPath, checksumPath, sha256, bytes: Buffer.byteLength(contents, "utf8") };
}
