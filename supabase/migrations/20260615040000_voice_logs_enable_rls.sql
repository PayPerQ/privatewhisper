-- Enable Row-Level Security on voice_pipeline_logs.
--
-- The table was publicly readable/writable via PostgREST with the anon key
-- (Supabase "rls_disabled_in_public" warning). Clients never touch the table
-- directly — they POST to the `voice-logs` edge function, which writes using
-- the service-role key (service_role bypasses RLS). So we enable RLS with NO
-- policies: anon/authenticated get zero row access, the edge function keeps
-- working unchanged.

alter table public.voice_pipeline_logs enable row level security;

-- Belt-and-suspenders: also forbid the anon/authenticated API roles at the
-- privilege level, so the table is locked even if a permissive policy is ever
-- added by mistake. The edge function (service_role) is unaffected.
revoke all on table public.voice_pipeline_logs from anon, authenticated;
