begin;

create table if not exists ai_content_subject_appeal_regeneration_keys (
  analysis_id uuid not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint ai_content_subject_appeal_regeneration_keys_pkey
    primary key (analysis_id, idempotency_key),
  constraint ai_content_subject_appeal_regeneration_keys_analysis_fk
    foreign key (analysis_id)
    references ai_content_subject_analyses(id)
    on delete cascade,
  constraint ai_content_subject_appeal_regeneration_keys_key_check
    check (char_length(idempotency_key) between 1 and 200)
);

insert into ai_content_subject_appeal_regeneration_keys
  (analysis_id, idempotency_key)
select analyses.id, legacy_key.idempotency_key
from ai_content_subject_analyses analyses
cross join lateral jsonb_array_elements_text(
  case
    when jsonb_typeof(analyses.input_json -> 'regenerationIdempotencyKeys') = 'array'
      then analyses.input_json -> 'regenerationIdempotencyKeys'
    else '[]'::jsonb
  end
) as legacy_key(idempotency_key)
where analyses.contract_version = 'subject-analysis.v2'
  and char_length(legacy_key.idempotency_key) between 1 and 200
on conflict (analysis_id, idempotency_key) do nothing;

update ai_content_subject_analyses
set input_json = input_json - 'regenerationIdempotencyKeys',
    updated_at = now()
where contract_version = 'subject-analysis.v2'
  and input_json ? 'regenerationIdempotencyKeys';

commit;
