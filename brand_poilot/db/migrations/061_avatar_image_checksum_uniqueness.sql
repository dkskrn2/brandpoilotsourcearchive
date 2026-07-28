-- Forward-only hardening for avatar image byte uniqueness.
-- Depends on: 058_avatar_and_reference_libraries.sql only.
-- Migration numbers 059 and 060 remain reserved for reference analysis and
-- content orchestration; this migration does not depend on either feature.
-- Legacy exact-byte duplicates are redundant. Keep the representative image
-- when present, otherwise the earliest positioned image, before enforcing the
-- invariant for all future writes.
create temporary table avatar_image_checksum_survivors
on commit drop
as
  select
    avatar_id,
    checksum,
    (array_agg(id order by is_representative desc, position asc, created_at asc, id asc))[1]
      as survivor_id,
    min(position) as retained_position
  from brand_avatar_images
  group by avatar_id, checksum
  having count(*) > 1;

delete from brand_avatar_images image
using avatar_image_checksum_survivors survivor
where image.avatar_id = survivor.avatar_id
  and image.checksum = survivor.checksum
  and image.id <> survivor.survivor_id;

update brand_avatar_images image
set position = survivor.retained_position
from avatar_image_checksum_survivors survivor
where image.id = survivor.survivor_id
  and image.position <> survivor.retained_position;

set constraints brand_avatar_images_commit_state immediate;

create unique index if not exists brand_avatar_images_avatar_checksum_unique
  on brand_avatar_images (avatar_id, checksum);
