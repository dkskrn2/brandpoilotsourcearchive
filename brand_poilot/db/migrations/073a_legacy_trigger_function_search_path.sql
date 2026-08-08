begin;

alter function public.ai_content_attachment_upload_sessions_immutable_metadata()
  set search_path = pg_catalog, public, pg_temp;
alter function public.ai_content_v2_freeze_batch_input_snapshot()
  set search_path = pg_catalog, public, pg_temp;
alter function public.ai_content_v2_freeze_output_plan()
  set search_path = pg_catalog, public, pg_temp;
alter function public.ai_content_v2_reject_snapshot_mutation()
  set search_path = pg_catalog, public, pg_temp;
alter function public.enforce_ai_content_attachment_upload_session_transition()
  set search_path = pg_catalog, public, pg_temp;
alter function public.enqueue_ai_content_attachment_deletion()
  set search_path = pg_catalog, public, pg_temp;
alter function public.enqueue_ai_content_upload_session_deletion()
  set search_path = pg_catalog, public, pg_temp;
alter function public.reject_ai_content_analyzed_subject_snapshot_mutation()
  set search_path = pg_catalog, public, pg_temp;
alter function public.reject_ai_content_approved_proposal_version_mutation()
  set search_path = pg_catalog, public, pg_temp;
alter function public.reject_ai_content_generation_brief_mutation()
  set search_path = pg_catalog, public, pg_temp;
alter function public.reject_ai_content_one_time_avatar_receipt_mutation()
  set search_path = pg_catalog, public, pg_temp;
alter function public.reject_ai_content_one_time_avatar_revocation_mutation()
  set search_path = pg_catalog, public, pg_temp;
alter function public.reject_ai_content_wiki_version_snapshot_mutation()
  set search_path = pg_catalog, public, pg_temp;
alter function public.release_ai_content_attachment_storage_path()
  set search_path = pg_catalog, public, pg_temp;
alter function public.reserve_ai_content_attachment_storage_path()
  set search_path = pg_catalog, public, pg_temp;
alter function public.revoke_ai_content_one_time_avatar_on_attachment_unavailable()
  set search_path = pg_catalog, public, pg_temp;
alter function public.seal_ai_content_one_time_avatar_receipt_from_upload()
  set search_path = pg_catalog, public, pg_temp;
alter function public.set_updated_at()
  set search_path = pg_catalog, public, pg_temp;
alter function public.revoke_ai_content_one_time_avatar_receipt(uuid, text)
  set search_path = pg_catalog, public, pg_temp;

commit;
