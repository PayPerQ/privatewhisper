-- Drop the legacy single-field provenance columns now fully superseded by the
-- split stt_*/llm_* columns. The 20260512000000 migration backfilled every
-- legacy value into the new columns; verified 0 rows carry legacy-only data
-- before this drop. This is irreversible (the legacy values are deleted).

alter table public.voice_pipeline_logs
  drop column if exists model_used,
  drop column if exists provider_used;
