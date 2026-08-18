begin;

-- The application role already has the sealed EXECUTE grant on
-- assert_ai_content_writable(). Running this thin trigger as the caller keeps
-- its schema-owner privileges out of the DML path while preserving the same
-- maintenance decision.
alter function public.enforce_manual_visual_selection_write_fence() security invoker;

commit;
