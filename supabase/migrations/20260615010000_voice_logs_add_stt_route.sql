-- Add stt_route to voice_pipeline_logs.
--
-- We now record BOTH the real STT vendor and the routing choice:
--   stt_provider_used : real backend vendor ("deepgram", "parakeet")  [existing column, repurposed]
--   stt_route         : user routing setting ("cloud", "local")        [this column]
--   stt_model_used    : concrete model id ("nova-3", "parakeet:...")    [existing column]
--
-- Additive + nullable. Historical rows (where stt_provider_used held the old
-- "ppq"/"local" routing value) are left untouched.

alter table public.voice_pipeline_logs
  add column if not exists stt_route text;
