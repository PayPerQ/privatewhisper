-- Drop stt_provider_used. The STT vendor is inferable from stt_model_used
-- ("nova-3" => Deepgram, "parakeet:*" => Parakeet), so the explicit vendor
-- column is redundant. llm_provider_used is intentionally KEPT: the LLM vendor
-- (groq/cerebras/tinfoil/xai) cannot be inferred from llm_model_used, since the
-- same model runs across multiple inference providers.
--
-- The voice-logs edge function was redeployed to stop writing this column
-- before this drop. Irreversible.

alter table public.voice_pipeline_logs
  drop column if exists stt_provider_used;
