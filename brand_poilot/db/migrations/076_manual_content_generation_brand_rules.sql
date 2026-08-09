begin;

-- DML-only repair. Migration 074's write-fence catalog is intentionally unchanged.
-- Serialize the same brand rows used by the runtime readiness helper.
select 1
  from brand_profiles
 where active_brand_core_id is not null
 for update;

select 1
  from brand_rule_sets
 where status = 'approved'
 for update;

-- Reattach an existing approval before deciding that a brand has no rules.
update brand_profiles profile
   set active_brand_rule_set_id = (
     select rules.id
       from brand_rule_sets rules
      where rules.workspace_id = profile.workspace_id
        and rules.brand_id = profile.brand_id
        and rules.status = 'approved'
      order by rules.version desc
      limit 1
   )
 where profile.active_brand_core_id is not null
   and not exists (
     select 1
       from brand_rule_sets active_rules
      where active_rules.id = profile.active_brand_rule_set_id
        and active_rules.workspace_id = profile.workspace_id
        and active_rules.brand_id = profile.brand_id
        and active_rules.status = 'approved'
   )
   and exists (
     select 1
       from brand_rule_sets approved_rules
      where approved_rules.workspace_id = profile.workspace_id
        and approved_rules.brand_id = profile.brand_id
        and approved_rules.status = 'approved'
   );

-- Stage a canonical successor as superseded first. This avoids colliding with the
-- one-approved partial index while retaining the original version for audit history.
with active_source as (
  select
    profile.workspace_id,
    profile.brand_id,
    profile.forbidden_terms,
    profile.default_cta,
    profile.auto_approval_enabled,
    rules.id as old_rule_set_id,
    rules.version as old_version,
    rules.rules_json
  from brand_profiles profile
  join brand_rule_sets rules
    on rules.id = profile.active_brand_rule_set_id
   and rules.workspace_id = profile.workspace_id
   and rules.brand_id = profile.brand_id
   and rules.status = 'approved'
  where profile.active_brand_core_id is not null
), normalized as (
  select
    source.*,
    jsonb_build_object(
      'contractVersion', 'brand-rules.v1',
      'requiredPhrases', coalesce((
        select jsonb_agg(to_jsonb(left(trim(entry.value #>> '{}'), 500)) order by entry.ordinal)
          from jsonb_array_elements(
            case when jsonb_typeof(source.rules_json->'requiredPhrases') = 'array'
              then source.rules_json->'requiredPhrases' else '[]'::jsonb end
          ) with ordinality entry(value, ordinal)
         where entry.ordinal <= 20
           and jsonb_typeof(entry.value) = 'string'
           and length(trim(entry.value #>> '{}')) between 1 and 500
      ), '[]'::jsonb),
      'forbiddenPhrases', coalesce((
        select jsonb_agg(to_jsonb(left(trim(entry.value #>> '{}'), 500)) order by entry.ordinal)
          from jsonb_array_elements(
            case
              when jsonb_typeof(source.rules_json->'forbiddenPhrases') = 'array'
                then source.rules_json->'forbiddenPhrases'
              when jsonb_typeof(source.forbidden_terms) = 'array'
                then source.forbidden_terms
              else '[]'::jsonb
            end
          ) with ordinality entry(value, ordinal)
         where entry.ordinal <= 20
           and jsonb_typeof(entry.value) = 'string'
           and length(trim(entry.value #>> '{}')) between 1 and 500
      ), '[]'::jsonb),
      'exaggerationRules', coalesce((
        select jsonb_agg(to_jsonb(left(trim(entry.value #>> '{}'), 500)) order by entry.ordinal)
          from jsonb_array_elements(
            case when jsonb_typeof(source.rules_json->'exaggerationRules') = 'array'
              then source.rules_json->'exaggerationRules' else '[]'::jsonb end
          ) with ordinality entry(value, ordinal)
         where entry.ordinal <= 20
           and jsonb_typeof(entry.value) = 'string'
           and length(trim(entry.value #>> '{}')) between 1 and 500
      ), '[]'::jsonb),
      'ctaRules', jsonb_build_object(
        'defaultCta', left(trim(coalesce(
          case when jsonb_typeof(source.rules_json #> '{ctaRules,defaultCta}') = 'string'
            then source.rules_json #>> '{ctaRules,defaultCta}' end,
          source.default_cta,
          ''
        )), 500),
        'allowed', coalesce((
          select jsonb_agg(to_jsonb(left(trim(entry.value #>> '{}'), 500)) order by entry.ordinal)
            from jsonb_array_elements(
              case when jsonb_typeof(source.rules_json #> '{ctaRules,allowed}') = 'array'
                then source.rules_json #> '{ctaRules,allowed}' else '[]'::jsonb end
            ) with ordinality entry(value, ordinal)
           where entry.ordinal <= 20
             and jsonb_typeof(entry.value) = 'string'
             and length(trim(entry.value #>> '{}')) between 1 and 500
        ), '[]'::jsonb)
      ),
      'channelRules', coalesce((
        select jsonb_object_agg(channel.key, channel.rules order by channel.key)
          from (
            select
              left(trim(raw_channel.key), 50) as key,
              coalesce((
                select jsonb_agg(to_jsonb(left(trim(entry.value #>> '{}'), 500)) order by entry.ordinal)
                  from jsonb_array_elements(
                    case when jsonb_typeof(raw_channel.value) = 'array'
                      then raw_channel.value else '[]'::jsonb end
                  ) with ordinality entry(value, ordinal)
                 where entry.ordinal <= 20
                   and jsonb_typeof(entry.value) = 'string'
                   and length(trim(entry.value #>> '{}')) between 1 and 500
              ), '[]'::jsonb) as rules
            from jsonb_each(
              case when jsonb_typeof(source.rules_json->'channelRules') = 'object'
                then source.rules_json->'channelRules' else '{}'::jsonb end
            ) raw_channel
            where length(trim(raw_channel.key)) between 1 and 50
            order by raw_channel.key
            limit 20
          ) channel
      ), '{}'::jsonb),
      'designRules', jsonb_build_object(
        'colors', coalesce((
          select jsonb_agg(to_jsonb(left(trim(entry.value #>> '{}'), 500)) order by entry.ordinal)
            from jsonb_array_elements(
              case when jsonb_typeof(source.rules_json #> '{designRules,colors}') = 'array'
                then source.rules_json #> '{designRules,colors}' else '[]'::jsonb end
            ) with ordinality entry(value, ordinal)
           where entry.ordinal <= 20
             and jsonb_typeof(entry.value) = 'string'
             and length(trim(entry.value #>> '{}')) between 1 and 500
        ), '[]'::jsonb),
        'fonts', coalesce((
          select jsonb_agg(to_jsonb(left(trim(entry.value #>> '{}'), 500)) order by entry.ordinal)
            from jsonb_array_elements(
              case when jsonb_typeof(source.rules_json #> '{designRules,fonts}') = 'array'
                then source.rules_json #> '{designRules,fonts}' else '[]'::jsonb end
            ) with ordinality entry(value, ordinal)
           where entry.ordinal <= 20
             and jsonb_typeof(entry.value) = 'string'
             and length(trim(entry.value #>> '{}')) between 1 and 500
        ), '[]'::jsonb),
        'notes', coalesce((
          select jsonb_agg(to_jsonb(left(trim(entry.value #>> '{}'), 500)) order by entry.ordinal)
            from jsonb_array_elements(
              case when jsonb_typeof(source.rules_json #> '{designRules,notes}') = 'array'
                then source.rules_json #> '{designRules,notes}' else '[]'::jsonb end
            ) with ordinality entry(value, ordinal)
           where entry.ordinal <= 20
             and jsonb_typeof(entry.value) = 'string'
             and length(trim(entry.value #>> '{}')) between 1 and 500
        ), '[]'::jsonb),
        'referenceImages', case
          when jsonb_typeof(source.rules_json #> '{designRules,referenceImages}') = 'array'
           and jsonb_array_length(source.rules_json #> '{designRules,referenceImages}') <= 5
           and not exists (
             select 1
               from jsonb_array_elements(source.rules_json #> '{designRules,referenceImages}') image(value)
              where jsonb_typeof(image.value) is distinct from 'object'
                 or exists (
                   select 1 from jsonb_object_keys(image.value) image_key(key)
                    where image_key.key not in ('referenceItemId', 'description', 'tags')
                 )
                 or jsonb_typeof(image.value->'referenceItemId') is distinct from 'string'
                 or coalesce(image.value->>'referenceItemId', '')
                      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                 or jsonb_typeof(image.value->'description') is distinct from 'string'
                 or length(trim(coalesce(image.value->>'description', ''))) > 240
                 or jsonb_typeof(image.value->'tags') is distinct from 'array'
                 or jsonb_array_length(image.value->'tags') > 10
                 or exists (
                   select 1 from jsonb_array_elements(image.value->'tags') tag(value)
                    where jsonb_typeof(tag.value) is distinct from 'string'
                       or length(trim(tag.value #>> '{}')) not between 1 and 40
                 )
           )
           and (
             select count(distinct lower(image.value->>'referenceItemId'))
               from jsonb_array_elements(source.rules_json #> '{designRules,referenceImages}') image(value)
           ) = jsonb_array_length(source.rules_json #> '{designRules,referenceImages}')
           and not exists (
             select 1
               from jsonb_array_elements(source.rules_json #> '{designRules,referenceImages}') image(value)
              where not exists (
                select 1
                  from reference_items item
                  join storage_artifacts artifact
                    on artifact.id=item.storage_artifact_id
                   and artifact.workspace_id=item.workspace_id
                   and artifact.brand_id=item.brand_id
                   and artifact.deleted_at is null
                   and artifact.public_url is not null
                   and artifact.path is not null
                   and artifact.checksum ~ '^[0-9a-f]{64}$'
                   and lower(artifact.mime_type) in ('image/png','image/jpeg','image/webp')
                 where item.id::text=image.value->>'referenceItemId'
                   and item.workspace_id=source.workspace_id
                   and item.brand_id=source.brand_id
                   and item.kind='upload'
                   and item.archived_at is null
              )
           )
          then source.rules_json #> '{designRules,referenceImages}'
          else '[]'::jsonb
        end
      ),
      'autoApprovalRules', jsonb_build_object(
        'enabled', coalesce(
          case when jsonb_typeof(source.rules_json #> '{autoApprovalRules,enabled}') = 'boolean'
            then (source.rules_json #>> '{autoApprovalRules,enabled}')::boolean end,
          source.auto_approval_enabled,
          false
        ),
        'conditions', coalesce((
          select jsonb_agg(to_jsonb(left(trim(entry.value #>> '{}'), 500)) order by entry.ordinal)
            from jsonb_array_elements(
              case when jsonb_typeof(source.rules_json #> '{autoApprovalRules,conditions}') = 'array'
                then source.rules_json #> '{autoApprovalRules,conditions}' else '[]'::jsonb end
            ) with ordinality entry(value, ordinal)
           where entry.ordinal <= 20
             and jsonb_typeof(entry.value) = 'string'
             and length(trim(entry.value #>> '{}')) between 1 and 500
        ), '[]'::jsonb)
      )
    ) as normalized_rules_json
  from active_source source
)
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
  normalized.workspace_id,
  normalized.brand_id,
  (
    select coalesce(max(existing.version), 0) + 1
      from brand_rule_sets existing
     where existing.workspace_id = normalized.workspace_id
       and existing.brand_id = normalized.brand_id
  ),
  'superseded',
  normalized.normalized_rules_json,
  'migration',
  transaction_timestamp(),
  transaction_timestamp(),
  transaction_timestamp()
from normalized
where normalized.rules_json is distinct from normalized.normalized_rules_json;

-- Retire only rows for which this transaction staged a canonical successor.
update brand_rule_sets old_rules
   set status = 'superseded', updated_at = transaction_timestamp()
  from brand_profiles profile
 where old_rules.id = profile.active_brand_rule_set_id
   and old_rules.workspace_id = profile.workspace_id
   and old_rules.brand_id = profile.brand_id
   and old_rules.status = 'approved'
   and exists (
     select 1
       from brand_rule_sets staged
      where staged.workspace_id = old_rules.workspace_id
        and staged.brand_id = old_rules.brand_id
        and staged.version > old_rules.version
        and staged.status = 'superseded'
        and staged.created_by = 'migration'
        and staged.created_at = transaction_timestamp()
        and staged.approved_at = transaction_timestamp()
   );

update brand_rule_sets staged
   set status = 'approved', updated_at = transaction_timestamp()
 where staged.status = 'superseded'
   and staged.created_by = 'migration'
   and staged.created_at = transaction_timestamp()
   and staged.approved_at = transaction_timestamp()
   and staged.version = (
     select max(candidate.version)
       from brand_rule_sets candidate
      where candidate.workspace_id = staged.workspace_id
        and candidate.brand_id = staged.brand_id
        and candidate.created_by = 'migration'
        and candidate.created_at = transaction_timestamp()
        and candidate.approved_at = transaction_timestamp()
   )
   and not exists (
     select 1
       from brand_rule_sets approved
      where approved.workspace_id = staged.workspace_id
        and approved.brand_id = staged.brand_id
        and approved.status = 'approved'
   );

-- Brands with an active core but no approved rule history receive canonical defaults.
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
  coalesce((
    select max(existing.version)
      from brand_rule_sets existing
     where existing.workspace_id = profile.workspace_id
       and existing.brand_id = profile.brand_id
  ), 0) + 1,
  'approved',
  jsonb_build_object(
    'contractVersion', 'brand-rules.v1',
    'requiredPhrases', '[]'::jsonb,
    'forbiddenPhrases', coalesce((
      select jsonb_agg(to_jsonb(left(trim(entry.value #>> '{}'), 500)) order by entry.ordinal)
        from jsonb_array_elements(
          case when jsonb_typeof(profile.forbidden_terms) = 'array'
            then profile.forbidden_terms else '[]'::jsonb end
        ) with ordinality entry(value, ordinal)
       where entry.ordinal <= 20
         and jsonb_typeof(entry.value) = 'string'
         and length(trim(entry.value #>> '{}')) between 1 and 500
    ), '[]'::jsonb),
    'exaggerationRules', '[]'::jsonb,
    'ctaRules', jsonb_build_object(
      'defaultCta', left(trim(coalesce(profile.default_cta, '')), 500),
      'allowed', '[]'::jsonb
    ),
    'channelRules', '{}'::jsonb,
    'designRules', jsonb_build_object(
      'colors', '[]'::jsonb,
      'fonts', '[]'::jsonb,
      'notes', '[]'::jsonb,
      'referenceImages', '[]'::jsonb
    ),
    'autoApprovalRules', jsonb_build_object(
      'enabled', coalesce(profile.auto_approval_enabled, false),
      'conditions', '[]'::jsonb
    )
  ),
  'migration',
  transaction_timestamp(),
  transaction_timestamp(),
  transaction_timestamp()
from brand_profiles profile
where profile.active_brand_core_id is not null
  and not exists (
    select 1
      from brand_rule_sets approved
     where approved.workspace_id = profile.workspace_id
       and approved.brand_id = profile.brand_id
       and approved.status = 'approved'
  );

-- Point every active-core profile at the surviving or newly-created approval.
update brand_profiles profile
   set active_brand_rule_set_id = (
     select rules.id
       from brand_rule_sets rules
      where rules.workspace_id = profile.workspace_id
        and rules.brand_id = profile.brand_id
        and rules.status = 'approved'
      order by rules.version desc
      limit 1
   )
 where profile.active_brand_core_id is not null
   and exists (
     select 1
       from brand_rule_sets approved
      where approved.workspace_id = profile.workspace_id
        and approved.brand_id = profile.brand_id
        and approved.status = 'approved'
   )
   and not exists (
     select 1
       from brand_rule_sets active_rules
      where active_rules.id = profile.active_brand_rule_set_id
        and active_rules.workspace_id = profile.workspace_id
        and active_rules.brand_id = profile.brand_id
        and active_rules.status = 'approved'
   );

commit;
