import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PUBLISHABLE_KEY = Deno.env.get("PUBLISHABLE_KEY") ?? "";

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const normalizeInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;

const normalizeString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const normalizeUuid = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return UUID_RE.test(v) ? v : null;
};

// Canonicalize provider names: lowercase + map internal aliases to real
// vendors. Mirrors normalizeProviderName in the renderer (src/App.jsx) so
// rows from older clients also land canonical (e.g. "Groq" -> "groq",
// "ppq-private" -> "tinfoil").
const PROVIDER_ALIASES: Record<string, string> = {
  "ppq-private": "tinfoil",
  "x-ai": "xai",
  grok: "xai",
};
const normalizeProvider = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim().toLowerCase();
  return PROVIDER_ALIASES[v] ?? v;
};

const normalizeCountryCode = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
};

const getClientIp = (req: Request): string | null => {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || null;
  }
  return (
    req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || null
  );
};

// Cache IP -> country code for 6 hours (persists within isolate lifetime)
const IP_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ipCache = new Map<string, { code: string | null; expiresAt: number }>();

const lookupCountryCode = async (ip: string): Promise<string | null> => {
  const cached = ipCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.code;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const code = normalizeCountryCode(data?.countryCode);
    ipCache.set(ip, { code, expiresAt: Date.now() + IP_CACHE_TTL_MS });
    return code;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const apiKeyHeader = req.headers.get("apikey") ?? "";
  const providedKey = authHeader.replace(/^Bearer\s+/i, "") || apiKeyHeader;
  if (!providedKey || providedKey !== PUBLISHABLE_KEY) {
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

  const clientIp = getClientIp(req);
  const countryCode = clientIp ? await lookupCountryCode(clientIp) : null;

  const row = {
    request_started_at: payload.request_started_at,
    response_received_at: payload.response_received_at,
    app_version: normalizeString(payload.app_version),
    country_code: countryCode,
    user_uuid: normalizeUuid(payload.user_uuid),
    user_label: normalizeString(payload.user_label),
    stt_processing_ms: normalizeInt(payload.stt_processing_ms),
    audio_duration_ms: normalizeInt(payload.audio_duration_ms),
    llm_processing_ms: normalizeInt(payload.llm_processing_ms),
    output_tokens: normalizeInt(payload.output_tokens),
    roundtrip_ms: normalizeInt(payload.roundtrip_ms),
    misc_processing_ms: normalizeInt(payload.misc_processing_ms),
    stt_model_used: normalizeString(payload.stt_model_used),
    stt_route: normalizeString(payload.stt_route),
    llm_model_used: normalizeString(payload.llm_model_used),
    llm_provider_used: normalizeProvider(payload.llm_provider_used),
    error_message: normalizeString(payload.error_message),
  };

  if (!SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: "Missing Supabase key" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.from("voice_pipeline_logs").insert(row);

  if (error) {
    return jsonResponse(500, { error: error.message });
  }

  return jsonResponse(200, { ok: true });
});
