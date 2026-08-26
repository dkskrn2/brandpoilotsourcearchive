begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.ai_content_proposal_job_contracts
  add constraint ai_content_proposal_job_contracts_versions_v4_check
  check (
    request_contract_version = 'content-proposal-request.v2'
    and base_input_contract_version = 'proposal-base-input.v2'
    and research_contract_version = 'research-evidence.v1'
    and proposal_contract_version = 'content-proposal.v2'
    and proposal_output_schema_sha256 = '54bf063cf32926874af6b098272df08d41a9e7d7f578ee6560debe44428cf5f3'
    and (
      (
        proposal_prompt_version = 'proposal.writer.v2'
        and contract_source_sha256 = '02760a1e006eb5920980a4b9c5b268cf53b3595543c5f909f2d66be53393c660'
        and catalog_sha256 = '41ac04e76adf0fd9746ea7535b36f6c1ea314ec4890253a2cd56a9f215f7cdbe'
      )
      or (
        proposal_prompt_version = 'proposal.writer.v3'
        and contract_source_sha256 = 'ecada3861313486b50e0a1475d89284f13fe4a74018207d11f205613deefb550'
        and catalog_sha256 = '415ca40b3dc3616affab6642b437ecd6b148bf70f017638640e2a4f858aaf808'
      )
      or (
        proposal_prompt_version = 'proposal.writer.v4'
        and contract_source_sha256 = 'e607bbb891af3723dc4620a0319382e83ee29006ed547aae620086b9809f248d'
        and catalog_sha256 = '6d983b25c51debb7588650165494f6cceffd1b2a921301e8cb79afb38543c9a9'
      )
    )
  ) not valid;

alter table public.ai_content_proposal_job_contracts
  validate constraint ai_content_proposal_job_contracts_versions_v4_check;

alter table public.ai_content_proposal_job_contracts
  drop constraint ai_content_proposal_job_contracts_versions_check;

alter table public.ai_content_proposal_job_contracts
  rename constraint ai_content_proposal_job_contracts_versions_v4_check
  to ai_content_proposal_job_contracts_versions_check;

alter table public.ai_content_generation_prompt_bindings
  add constraint ai_content_generation_prompt_bindings_proposal_lineage_v4_check
  check (
    (
      proposal_prompt_version = 'proposal.writer.v2'
      and contract_source_hash = '02760a1e006eb5920980a4b9c5b268cf53b3595543c5f909f2d66be53393c660'
    )
    or (
      proposal_prompt_version = 'proposal.writer.v3'
      and contract_source_hash = 'ecada3861313486b50e0a1475d89284f13fe4a74018207d11f205613deefb550'
    )
    or (
      proposal_prompt_version = 'proposal.writer.v4'
      and contract_source_hash = 'e607bbb891af3723dc4620a0319382e83ee29006ed547aae620086b9809f248d'
    )
  ) not valid;

alter table public.ai_content_generation_prompt_bindings
  validate constraint ai_content_generation_prompt_bindings_proposal_lineage_v4_check;

alter table public.ai_content_generation_prompt_bindings
  drop constraint ai_content_generation_prompt_bindings_proposal_lineage_check;

alter table public.ai_content_generation_prompt_bindings
  rename constraint ai_content_generation_prompt_bindings_proposal_lineage_v4_check
  to ai_content_generation_prompt_bindings_proposal_lineage_check;

commit;
