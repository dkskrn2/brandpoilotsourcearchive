alter table brand_channels drop constraint if exists brand_channels_channel_check;
alter table brand_channels
  add constraint brand_channels_channel_check
  check (channel in ('instagram', 'threads', 'tiktok', 'youtube', 'x'));

alter table channel_outputs drop constraint if exists channel_outputs_channel_check;
alter table channel_outputs
  add constraint channel_outputs_channel_check
  check (channel in ('instagram', 'threads', 'tiktok', 'youtube', 'x'));

alter table publish_slots drop constraint if exists publish_slots_channel_check;
alter table publish_slots
  add constraint publish_slots_channel_check
  check (channel in ('instagram', 'threads', 'tiktok', 'youtube', 'x'));

alter table publish_queue drop constraint if exists publish_queue_channel_check;
alter table publish_queue
  add constraint publish_queue_channel_check
  check (channel in ('instagram', 'threads', 'tiktok', 'youtube', 'x'));

insert into brand_channels (workspace_id, brand_id, channel, status, account_label, enabled)
select b.workspace_id, b.id, new_channels.channel, 'not_connected', '연결 전', true
from brands b
cross join (values ('tiktok'), ('youtube'), ('x')) as new_channels(channel)
where b.deleted_at is null
on conflict (brand_id, channel) where deleted_at is null do nothing;
