// Thuisbasis — Jonah: stuurt vragen van de app door naar Claude (Anthropic API).
// De API-sleutel staat veilig als geheim in Supabase (ANTHROPIC_API_KEY) en komt nooit in de app.
// Enkel ingelogde gezinsleden kunnen deze functie gebruiken: de functie controleert zelf de inlog.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: who, error: authErr } = await admin.auth.getUser(jwt);
  if (authErr || !who || !who.user) return json({ error: { message: "Niet ingelogd" } }, 401);

  const key = String(Deno.env.get("ANTHROPIC_API_KEY") || "").split("=").pop()!.replace(/["'\s]/g, "");
  if (!key) return json({ error: { message: "ANTHROPIC_API_KEY ontbreekt in de Supabase-geheimen." } }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: { message: "Ongeldige vraag" } }, 400); }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return json({ error: { message: "Geen berichten" } }, 400);

  const payload: Record<string, unknown> = {
    model: Deno.env.get("JONAH_MODEL") || "claude-sonnet-5-5",
    max_tokens: Math.min(Number(body.max_tokens) || 1500, 4000),
    messages,
  };
  if (Array.isArray(body.tools) && body.tools.length) payload.tools = body.tools.slice(0, 20);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return new Response(await r.text(), { status: r.status, headers: { ...CORS, "content-type": "application/json" } });
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });
}
