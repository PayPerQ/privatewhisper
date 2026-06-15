-- Add a per-installation anonymous identity to voice_pipeline_logs so rows can
-- be grouped by user. Previously the only UUID on a row was its auto-generated
-- primary key, which is unique per transcription (not per user) and therefore
-- never lined up with distinct users.
--
-- Two additive, nullable columns (old rows stay valid):
--   user_uuid  : random UUID generated once per install (the join/grouping key).
--   user_label : memorable "adjective-color-animal" petname for dashboards.
--
-- The identity is generated and persisted client-side (see
-- src/helpers/environment.js getUserIdentity); it is NOT derived from the PPQ
-- API key or any account data.

alter table public.voice_pipeline_logs
  add column if not exists user_uuid  uuid,
  add column if not exists user_label text;

-- Speed up grouping/filtering by user in dashboards.
create index if not exists voice_pipeline_logs_user_uuid_idx
  on public.voice_pipeline_logs (user_uuid);
