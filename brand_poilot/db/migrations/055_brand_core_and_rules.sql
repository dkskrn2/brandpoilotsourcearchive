begin;

create or replace function brand_review_state_is_valid(value jsonb)
returns boolean
language sql
immutable
as $$
  select
    jsonb_typeof(value) = 'object'
    and not exists (
      select 1
      from jsonb_each(value) as field(path, review)
      where length(trim(field.path)) = 0
         or jsonb_typeof(field.review) <> 'object'
         or field.review->>'decision' not in ('ai_suggested', 'user_edited', 'approved')
         or (
           field.review ? 'reviewerUserId'
           and jsonb_typeof(field.review->'reviewerUserId') not in ('string', 'null')
         )
         or (
           field.review ? 'reviewedAt'
           and jsonb_typeof(field.review->'reviewedAt') not in ('string', 'null')
         )
         or exists (
           select 1
           from jsonb_object_keys(field.review) as review_key(key)
           where review_key.key not in ('decision', 'reviewerUserId', 'reviewedAt')
         )
    );
$$;

create table if not exists brand_core_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  source_analysis_id uuid null,
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'approved', 'superseded')),
  core_json jsonb not null check (jsonb_typeof(core_json) = 'object'),
  evidence_json jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence_json) = 'array'),
  review_state_json jsonb not null default '{}'::jsonb
    check (brand_review_state_is_valid(review_state_json)),
  created_by text not null check (created_by in ('analysis_confirm', 'user', 'migration')),
  created_by_user_id uuid null references app_users(id) on delete set null,
  approved_by_user_id uuid null references app_users(id) on delete set null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_core_versions_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint brand_core_versions_source_analysis_ownership_fk
    foreign key (source_analysis_id, workspace_id, brand_id)
    references brand_analysis_runs(id, workspace_id, brand_id) on delete restrict,
  constraint brand_core_versions_tenant_identity_unique
    unique (id, workspace_id, brand_id),
  constraint brand_core_versions_brand_version_unique
    unique (workspace_id, brand_id, version),
  constraint brand_core_versions_approval_actor_check check (
    (status = 'approved' and approved_at is not null)
    or status <> 'approved'
  )
);

create unique index if not exists brand_core_one_approved
  on brand_core_versions (workspace_id, brand_id)
  where status = 'approved';

create index if not exists brand_core_versions_brand_created_idx
  on brand_core_versions (workspace_id, brand_id, created_at desc);

create table if not exists brand_rule_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'approved', 'superseded')),
  rules_json jsonb not null check (jsonb_typeof(rules_json) = 'object'),
  created_by text not null check (created_by in ('analysis_confirm', 'user', 'migration')),
  created_by_user_id uuid null references app_users(id) on delete set null,
  approved_by_user_id uuid null references app_users(id) on delete set null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_rule_sets_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint brand_rule_sets_tenant_identity_unique
    unique (id, workspace_id, brand_id),
  constraint brand_rule_sets_brand_version_unique
    unique (workspace_id, brand_id, version),
  constraint brand_rule_sets_approval_actor_check check (
    (status = 'approved' and approved_at is not null)
    or status <> 'approved'
  )
);

create unique index if not exists brand_rule_sets_one_approved
  on brand_rule_sets (workspace_id, brand_id)
  where status = 'approved';

create index if not exists brand_rule_sets_brand_created_idx
  on brand_rule_sets (workspace_id, brand_id, created_at desc);

alter table brand_profiles
  add column if not exists active_brand_core_id uuid null,
  add column if not exists active_brand_rule_set_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'brand_profiles_active_brand_core_fk'
  ) then
    alter table brand_profiles
      add constraint brand_profiles_active_brand_core_fk
      foreign key (active_brand_core_id, workspace_id, brand_id)
      references brand_core_versions(id, workspace_id, brand_id)
      deferrable initially deferred;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'brand_profiles_active_brand_rule_set_fk'
  ) then
    alter table brand_profiles
      add constraint brand_profiles_active_brand_rule_set_fk
      foreign key (active_brand_rule_set_id, workspace_id, brand_id)
      references brand_rule_sets(id, workspace_id, brand_id)
      deferrable initially deferred;
  end if;
end;
$$;

insert into brand_core_versions (
  workspace_id,
  brand_id,
  source_analysis_id,
  version,
  status,
  core_json,
  evidence_json,
  review_state_json,
  created_by,
  approved_at,
  created_at,
  updated_at
)
select
  run.workspace_id,
  run.brand_id,
  run.id,
  1,
  'approved',
  jsonb_build_object(
    'contractVersion', 'brand-core.v1',
    'summary', jsonb_build_object(
      'oneLine', coalesce(effective.result->>'coreAppeal', effective.result->>'businessDescription', ''),
      'description', coalesce(
        effective.result->>'businessDescription',
        effective.result->>'companyOverview',
        ''
      )
    ),
    'audiences', case
      when nullif(trim(effective.result->>'primaryTarget'), '') is null then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object(
        'name', effective.result->>'primaryTarget',
        'problem', '',
        'desiredOutcome', ''
      ))
    end,
    'valueProposition', jsonb_build_object(
      'primary', coalesce(effective.result->>'coreAppeal', ''),
      'differentiators', case
        when nullif(trim(effective.result->>'differentiators'), '') is null then '[]'::jsonb
        else jsonb_build_array(effective.result->>'differentiators')
      end,
      'proofPoints', '[]'::jsonb
    ),
    'messaging', jsonb_build_object(
      'appeals', case
        when nullif(trim(effective.result->>'coreAppeal'), '') is null then '[]'::jsonb
        else jsonb_build_array(effective.result->>'coreAppeal')
      end,
      'tone', '[]'::jsonb,
      'preferredPhrases', '[]'::jsonb,
      'brandDirection', coalesce(effective.result->>'differentiators', ''),
      'priorityMessages', '[]'::jsonb
    )
  ),
  coalesce(mapped_evidence.items, '[]'::jsonb),
  '{}'::jsonb,
  'migration',
  coalesce(run.confirmed_at, run.updated_at, now()),
  coalesce(run.confirmed_at, run.created_at, now()),
  coalesce(run.confirmed_at, run.updated_at, now())
from brand_analysis_runs run
join brand_profiles profile
  on profile.workspace_id = run.workspace_id
 and profile.brand_id = run.brand_id
cross join lateral (
  select coalesce(run.edited_result_json, run.result_json) as result
) effective
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'fieldPath', case evidence->>'field'
      when 'companyOverview' then 'summary.description'
      when 'businessDescription' then 'summary.description'
      when 'primaryTarget' then 'audiences'
      when 'differentiators' then 'valueProposition.differentiators'
      when 'coreAppeal' then 'valueProposition.primary'
    end,
    'sourceType', case
      when evidence->>'sourceId' = 'owned-url' then 'owned_url'
      when nullif(evidence->>'sourceUrl', '') is not null then 'public_web'
      else 'analysis'
    end,
    'sourceId', evidence->>'sourceId',
    'sourceUrl', evidence->'sourceUrl',
    'excerpt', evidence->>'claim',
    'confidence', null
  )) as items
  from jsonb_array_elements(coalesce(effective.result->'evidence', '[]'::jsonb)) evidence
  where evidence->>'field' in (
    'companyOverview',
    'businessDescription',
    'primaryTarget',
    'differentiators',
    'coreAppeal'
  )
) mapped_evidence on true
where run.status = 'confirmed'
  and run.is_active
  and coalesce(run.edited_result_json, run.result_json) is not null
  and profile.active_brand_core_id is null
  and not exists (
    select 1
    from brand_core_versions existing
    where existing.workspace_id = run.workspace_id
      and existing.brand_id = run.brand_id
  )
on conflict (workspace_id, brand_id, version) do nothing;

insert into brand_rule_sets (
  workspace_id,
  brand_id,
  version,
  status,
  rules_json,
  created_by,
  approved_at,
  created_at,
  updated_at
)
select
  profile.workspace_id,
  profile.brand_id,
  1,
  'approved',
  jsonb_build_object(
    'contractVersion', 'brand-rules.v1',
    'requiredPhrases', '[]'::jsonb,
    'forbiddenPhrases', profile.forbidden_terms,
    'exaggerationRules', '[]'::jsonb,
    'ctaRules', jsonb_build_object('defaultCta', profile.default_cta, 'allowed', '[]'::jsonb),
    'channelRules', '{}'::jsonb,
    'designRules', jsonb_build_object(
      'colors', '[]'::jsonb,
      'fonts', '[]'::jsonb,
      'notes', '[]'::jsonb
    ),
    'autoApprovalRules', jsonb_build_object(
      'enabled', profile.auto_approval_enabled,
      'conditions', '[]'::jsonb
    )
  ),
  'migration',
  now(),
  profile.created_at,
  now()
from brand_profiles profile
where profile.active_brand_rule_set_id is null
  and not exists (
    select 1
    from brand_rule_sets existing
    where existing.workspace_id = profile.workspace_id
      and existing.brand_id = profile.brand_id
  )
on conflict (workspace_id, brand_id, version) do nothing;

update brand_profiles profile
set active_brand_core_id = core.id
from brand_core_versions core
where profile.workspace_id = core.workspace_id
  and profile.brand_id = core.brand_id
  and core.status = 'approved'
  and profile.active_brand_core_id is null;

update brand_profiles profile
set active_brand_rule_set_id = rules.id
from brand_rule_sets rules
where profile.workspace_id = rules.workspace_id
  and profile.brand_id = rules.brand_id
  and rules.status = 'approved'
  and profile.active_brand_rule_set_id is null;

update knowledge_entries
set enabled = false,
    direct_reply_enabled = false,
    structured_data = structured_data || jsonb_build_object(
      'legacyProjection', true,
      'source', 'brand_core_backfill'
    ),
    updated_at = now()
where normalized_question = '__confirmed_brand_intelligence__';

drop trigger if exists brand_core_versions_set_updated_at on brand_core_versions;
create trigger brand_core_versions_set_updated_at
before update on brand_core_versions
for each row execute function set_updated_at();

drop trigger if exists brand_rule_sets_set_updated_at on brand_rule_sets;
create trigger brand_rule_sets_set_updated_at
before update on brand_rule_sets
for each row execute function set_updated_at();

commit;
