import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { expect, it } from "vitest";

const applicationRole = "ai_content_prompt_version_application";
const applicationPassword = "ai-content-prompt-version-application-test";
const oldSourceHash = "02760a1e006eb5920980a4b9c5b268cf53b3595543c5f909f2d66be53393c660";
const oldCatalogHash = "41ac04e76adf0fd9746ea7535b36f6c1ea314ec4890253a2cd56a9f215f7cdbe";
const newSourceHash = "ecada3861313486b50e0a1475d89284f13fe4a74018207d11f205613deefb550";
const newCatalogHash = "415ca40b3dc3616affab6642b437ecd6b148bf70f017638640e2a4f858aaf808";
const proposalSchemaHash = "54bf063cf32926874af6b098272df08d41a9e7d7f578ee6560debe44428cf5f3";

function connectionStringForRole(connectionString: string, role: string, password: string) {
  const value = new URL(connectionString);
  value.username = role;
  value.password = password;
  return value.toString();
}

function insertProposalContract(
  pool: Pool,
  promptVersion: string,
  sourceHash: string,
  catalogHash: string,
) {
  return pool.query(
    `insert into ai_content_proposal_job_contracts(
       request_contract_version,base_input_contract_version,research_contract_version,
       proposal_contract_version,proposal_prompt_version,proposal_output_schema_sha256,
       contract_source_sha256,catalog_sha256
     ) values('content-proposal-request.v2','proposal-base-input.v2','research-evidence.v1',
       'content-proposal.v2',$1,$2,$3,$4)`,
    [promptVersion, proposalSchemaHash, sourceHash, catalogHash],
  );
}

function insertPromptBinding(pool: Pool, promptVersion: string, sourceHash: string) {
  return pool.query(
    `insert into ai_content_generation_prompt_bindings(
       proposal_prompt_version,contract_source_hash
     ) values($1,$2)`,
    [promptVersion, sourceHash],
  );
}

it("allows exact historical v2 and current v3 prompt lineage without widening application privileges", async () => {
  let container: StartedPostgreSqlContainer | null = null;
  let administrator: Pool | null = null;
  let application: Pool | null = null;
  try {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    administrator = new Pool({ connectionString: container.getConnectionUri() });
    await administrator.query(
      `create role ${applicationRole} login noinherit nosuperuser nobypassrls
         nocreatedb nocreaterole noreplication password '${applicationPassword}'`,
    );
    await administrator.query(`
      create table ai_content_proposal_job_contracts(
        request_contract_version text not null,
        base_input_contract_version text not null,
        research_contract_version text not null,
        proposal_contract_version text not null,
        proposal_prompt_version text not null,
        proposal_output_schema_sha256 text not null,
        contract_source_sha256 text not null,
        catalog_sha256 text not null,
        constraint ai_content_proposal_job_contracts_versions_check check(
          request_contract_version='content-proposal-request.v2'
          and base_input_contract_version='proposal-base-input.v2'
          and research_contract_version='research-evidence.v1'
          and proposal_contract_version='content-proposal.v2'
          and proposal_prompt_version='proposal.writer.v2'
          and proposal_output_schema_sha256='${proposalSchemaHash}'
          and contract_source_sha256='${oldSourceHash}'
          and catalog_sha256='${oldCatalogHash}'
        )
      );
      create table ai_content_generation_prompt_bindings(
        proposal_prompt_version text not null,
        contract_source_hash text not null,
        constraint ai_content_generation_prompt_bind_proposal_prompt_version_check
          check(proposal_prompt_version='proposal.writer.v2'),
        constraint ai_content_generation_prompt_binding_contract_source_hash_check
          check(contract_source_hash='${oldSourceHash}')
      );
      grant select,insert on ai_content_proposal_job_contracts,
        ai_content_generation_prompt_bindings to ${applicationRole};
    `);
    await insertProposalContract(administrator, "proposal.writer.v2", oldSourceHash, oldCatalogHash);
    await insertPromptBinding(administrator, "proposal.writer.v2", oldSourceHash);

    await administrator.query(await readFile(
      resolve(process.cwd(), "../../db/migrations/087_ai_content_prompt_lineage_v3.sql"),
      "utf8",
    ));

    application = new Pool({
      connectionString: connectionStringForRole(
        container.getConnectionUri(), applicationRole, applicationPassword,
      ),
    });
    await insertProposalContract(application, "proposal.writer.v3", newSourceHash, newCatalogHash);
    await insertPromptBinding(application, "proposal.writer.v3", newSourceHash);

    const stored = await application.query<{
      proposal_prompt_version: string;
      contract_source_sha256: string;
      catalog_sha256: string;
    }>(
      `select proposal_prompt_version,contract_source_sha256,catalog_sha256
         from ai_content_proposal_job_contracts order by proposal_prompt_version`,
    );
    expect(stored.rows).toEqual([
      {
        proposal_prompt_version: "proposal.writer.v2",
        contract_source_sha256: oldSourceHash,
        catalog_sha256: oldCatalogHash,
      },
      {
        proposal_prompt_version: "proposal.writer.v3",
        contract_source_sha256: newSourceHash,
        catalog_sha256: newCatalogHash,
      },
    ]);
    await expect(insertProposalContract(
      application, "proposal.writer.v3", oldSourceHash, newCatalogHash,
    )).rejects.toThrow(/ai_content_proposal_job_contracts_versions_check/);
    await expect(insertPromptBinding(
      application, "proposal.writer.v2", newSourceHash,
    )).rejects.toThrow(/ai_content_generation_prompt_bindings_proposal_lineage_check/);
    await expect(insertPromptBinding(
      application, "proposal.writer.v4", newSourceHash,
    )).rejects.toThrow(/ai_content_generation_prompt_bindings_proposal_lineage_check/);

    const privileges = await application.query<{
      proposal_update: boolean;
      binding_update: boolean;
    }>(`select
      has_table_privilege(current_user,'ai_content_proposal_job_contracts','UPDATE') proposal_update,
      has_table_privilege(current_user,'ai_content_generation_prompt_bindings','UPDATE') binding_update`);
    expect(privileges.rows[0]).toEqual({ proposal_update: false, binding_update: false });
  } finally {
    await application?.end().catch(() => undefined);
    await administrator?.end().catch(() => undefined);
    await container?.stop().catch(() => undefined);
  }
}, 180_000);
