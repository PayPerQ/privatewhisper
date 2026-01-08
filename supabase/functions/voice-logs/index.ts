import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const LOG_API_KEY = Deno.env.get("LOG_API_KEY") ?? "";
const LOG_TABLE = Deno.env.get("LOG_TABLE") ?? "voice_pipeline_logs";
const GEO_ENDPOINT = Deno.env.get("GEO_ENDPOINT") ?? "https://ipapi.co";

const GEO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const geoCache = new Map<string, { data: unknown; expiresAt: number }>();

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const getClientIp = (req: Request) => {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
};

const fetchGeo = async (ip: string) => {
  const cached = geoCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const res = await fetch(`${GEO_ENDPOINT}/${ip}/json/`, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) return null;
  const data = await res.json();
  geoCache.set(ip, { data, expiresAt: Date.now() + GEO_CACHE_TTL_MS });
  return data;
};

const normalizeInt = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const apiKey = req.headers.get("apikey") ?? "";
  const expectedKey = LOG_API_KEY || ANON_KEY;
  if (!apiKey || !expectedKey || apiKey !== expectedKey) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON" });
  }

  if (!payload.request_started_at || !payload.response_received_at) {
    return jsonResponse(400, { error: "Missing required timestamps" });
  }

  const ip = getClientIp(req);
  const user_geo = ip ? await fetchGeo(ip) : null;

  const row = {
    request_started_at: payload.request_started_at,
    response_received_at: payload.response_received_at,
    user_geo,
    stt_processing_ms: normalizeInt(payload.stt_processing_ms),
    audio_duration_ms: normalizeInt(payload.audio_duration_ms),
    llm_processing_ms: normalizeInt(payload.llm_processing_ms),
    output_tokens: normalizeInt(payload.output_tokens),
    roundtrip_ms: normalizeInt(payload.roundtrip_ms),
    misc_processing_ms: normalizeInt(payload.misc_processing_ms),
    model_used:
      typeof payload.model_used === "string" ? payload.model_used : null,
    provider_used:
      typeof payload.provider_used === "string" ? payload.provider_used : null,
  };

  if (!ANON_KEY) {
    return jsonResponse(500, { error: "Missing Supabase key" });
  }

  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.from(LOG_TABLE).insert(row);

  if (error) {
    return jsonResponse(500, { error: error.message });
  }

  return jsonResponse(200, { ok: true });
});
