-- Split the legacy `model_used` / `provider_used` columns on voice_pipeline_logs
-- into separate STT and LLM provenance columns. Additive only — old columns are
-- left in place for historical rows and dashboards.
--
-- Routing logic for the backfill mirrors the renderer code prior to this change
-- (src/App.jsx): when reasoning ran, model_used/provider_used held the LLM
-- model and its provider; otherwise provider_used was hardcoded to "ppq" and
-- model_used held the transcription model.

alter table public.voice_pipeline_logs
  add column if not exists stt_model_used    text,
  add column if not exists stt_provider_used text,
  add column if not exists llm_model_used    text,
  add column if not exists llm_provider_used text;

-- Backfill LLM columns for rows where reasoning ran (provider_used != 'ppq').
update public.voice_pipeline_logs
   set llm_model_used    = model_used,
       llm_provider_used = provider_used
 where provider_used is not null
   and provider_used <> 'ppq'
   and llm_model_used is null;

-- Backfill STT columns for rows where reasoning did NOT run. Prefer the
-- existing stt_model_used value if the renderer already populated it; fall
-- back to the legacy model_used otherwise.
update public.voice_pipeline_logs
   set stt_model_used    = coalesce(stt_model_used, model_used),
       stt_provider_used = coalesce(stt_provider_used, 'ppq')
 where provider_used = 'ppq'
   and (stt_model_used is null or stt_provider_used is null);
