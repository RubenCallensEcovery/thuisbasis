// Thuisbasis — meldingen: wordt elke 5 minuten opgeroepen (Supabase Cron) en stuurt pushmeldingen
// naar de toestellen van het gezin: herinneringen, afspraken die eraan komen, wat anderen deden,
// afval buitenzetten, machines die klaar zijn en voorraad die bijna op is.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import webpush from "npm:web-push@3.6.7";

// publieke push-sleutel (mag publiek zijn; staat ook in de app)
const VAPID_PUBLIC = "BCwJmmh6jsmr2uKlwLha5DxQGrlFxLpOPitqGWaDY7YWpyYbGIMGKs5LvoRurLom2efREUKbT5fNYEqhKOaLphs";
const PARENTS = ["charlotte", "ruben"];
const KIDS = ["nant", "abel", "max"];
const NAMES: Record<string, string> = { charlotte: "Charlotte", ruben: "Ruben", nant: "Nant", abel: "Abel", max: "Max" };
const WASTE: Record<string, string> = { rest: "Restafval", gft: "GFT", pmd: "PMD", pk: "Papier-karton", glas: "Glas", grof: "Grofvuil", snoei: "Snoeihout" };
const HOLIDAYS: [string, string, string?][] =[ /* bron: vlaanderen.be, schoolvakanties gewoon onderwijs */
  ['Herfstvakantie','2026-11-02','2026-11-08'],['Wapenstilstand','2026-11-11'],['Kerstvakantie','2026-12-21','2027-01-03'],
  ['Krokusvakantie','2027-02-08','2027-02-14'],['Paasvakantie','2027-03-29','2027-04-11'],['Dag van de Arbeid','2027-05-01'],
  ['Hemelvaart','2027-05-06','2027-05-07'],['Pinkstermaandag','2027-05-17'],['Zomervakantie','2027-07-01','2027-08-31'],
  ['Herfstvakantie','2027-11-01','2027-11-07'],['Wapenstilstand','2027-11-11'],['Kerstvakantie','2027-12-27','2028-01-09'],
  ['Krokusvakantie','2028-02-28','2028-03-05'],['Paasvakantie','2028-04-03','2028-04-17'],['Dag van de Arbeid','2028-05-01'],
  ['Hemelvaart','2028-05-25','2028-05-26'],['Pinkstermaandag','2028-06-05'],['Zomervakantie','2028-07-01','2028-08-31'],
];

Deno.serve(async (req) => {
  const cronSecret = String(Deno.env.get("CRON_SECRET") || "").split("=").pop()!.replace(/["'\s]/g, "");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) return new Response("nee", { status: 401 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // geheimen opkuisen (spaties of "NAAM =" die per ongeluk mee geplakt werden)
  const clean = (v?: string) => String(v || "").split("=").pop()!.replace(/["'\s]/g, "");
  const subj = String(Deno.env.get("VAPID_SUBJECT") || "").match(/mailto:\S+/)?.[0] || "mailto:gezin@example.com";
  webpush.setVapidDetails(subj, VAPID_PUBLIC, clean(Deno.env.get("VAPID_PRIVATE")));

  const { data: subs } = await sb.from("push_subs").select("*");
  if (!subs || !subs.length) return new Response("geen toestellen");
  const cols = ["reminders", "events", "waste", "timers", "stock", "notifs", "settings"];
  const { data: rows } = await sb.from("docs").select("col,id,data").in("col", cols);
  const C: Record<string, any[]> = {}; cols.forEach((c) => (C[c] = []));
  (rows || []).forEach((r: any) => C[r.col].push({ id: r.id, ...r.data }));

  const now = local(); const t = now.date, hm = now.time, H = Number(hm.slice(0, 2));
  const out: { key: string; to: string[]; title: string; body: string; tag?: string; icon?: string }[] = [];
  const ico = (n: string) => `icons/n/${n}.png`; // icoon links in de melding, volgens het onderwerp
  const names = (w: string[]) => (w || []).map((x) => NAMES[x] || x).join(", ");

  // 1. herinneringen
  for (const r of C.reminders) {
    if (r.done || !r.date || r.date < addDays(t, -1)) continue;
    if (r.date > t || (r.date === t && hm < (r.time || "08:00"))) continue;
    out.push({ key: `r:${r.id}:${r.date}${r.time || ""}`, to: r.who || [], title: "🔔 Herinnering", body: r.title, tag: "r" + r.id, icon: ico("bell") });
  }
  // 2. wat anderen deden (activiteiten van de laatste 15 minuten)
  for (const n of C.notifs) {
    if (!n.at || Date.now() - n.at > 15 * 6e4) continue;
    const to = [...PARENTS, ...KIDS].filter((m) => m !== n.by && (PARENTS.includes(m) || (n.to || []).includes(m) || (n.to || []).includes("all")));
    out.push({ key: `n:${n.id}`, to, title: NAMES[n.by] || "Thuisbasis", body: n.text, icon: ico(n.kind === "agenda" ? "agenda" : n.kind === "voorraad" || n.kind === "eten" ? "cart" : "chat") });
  }
  // 3. afspraken die binnen 30 minuten beginnen (met kledijtip bij buitenactiviteiten)
  let wx: any = undefined;
  for (const ev of C.events) {
    if (ev.allDay || !ev.start || ev.info || (ev.squad && ev.sel === "nee")) continue;
    if (ev.repeat && ev.repeat !== "none" && (ev.type === "Werk" || ev.type === "Crèche")) continue;
    if (!occursOn(ev, t)) continue;
    if ((ev.conge || []).includes(t)) continue; // die dag gaat het niet door (congé, thuis, komt niet)
    const diff = toMin(ev.start) - toMin(hm);
    if (diff <= 0 || diff > 30) continue;
    const kids = (ev.who || []).filter((w: string) => KIDS.includes(w));
    let tip = "";
    if (outdoor(ev)) { if (wx === undefined) wx = await weather(); tip = wxTip(wx, t, ev.start); }
    out.push({ key: `e:${ev.id}:${t}`, to: [...PARENTS, ...kids], title: `Om ${ev.start}`, body: `${ev.title}${ev.who && ev.who.length ? " — " + names(ev.who) : ""}${tip ? "\n" + tip : ""}`, tag: "e" + ev.id, icon: ico(ev.type === "Match" || ev.type === "Training" ? "sport" : "agenda") });
  }
  // 4. afval: de avond ervoor vanaf 19u
  const w = C.waste.find((x) => (x.date || x.id) === addDays(t, 1));
  const ws = C.settings.find((x) => x.id === "waste") || {};
  if (w && H >= 19 && ws.remind !== false) out.push({ key: `w:${addDays(t, 1)}`, to: PARENTS, title: "🗑️ Morgen ophaling", body: `${(w.types || []).map((x: string) => WASTE[x] || x).join(" + ")}: zet ze vanavond buiten.`, icon: ico((["gft", "pmd", "rest"].find((x) => (w.types || []).includes(x))) || "rest") });
  // 5. machines die klaar zijn
  for (const m of C.timers) {
    const end = (m.startedAt || 0) + (m.minutes || 0) * 6e4;
    if (end > Date.now() || Date.now() - end > 60 * 6e4) continue;
    out.push({ key: `t:${m.id}:${m.startedAt}`, to: PARENTS, title: "🫧 Klaar", body: `${m.label || "De machine"} is klaar. Tijd om uit te halen.`, icon: ico("machine") });
  }
  // 6. voorraad: één keer per dag vanaf 17u
  if (H >= 17) {
    const low = C.stock.filter((s) => { const c = stockLeft(s, t); return c !== null && c <= (Number(s.warnDays) || 2); }).map((s) => s.name);
    if (low.length) out.push({ key: `s:${t}`, to: PARENTS, title: "🛒 Bijna op", body: low.join(", "), icon: ico("cart") });
  }

  // 7. ochtendmelding: per gezinslid op het gekozen uur (aan/uit in Instellingen → Meldingen)
  const mc = (C.settings.find((x) => x.id === "morning") || {}).members || {};
  for (const id of [...PARENTS, ...KIDS]) {
    const cfg = mc[id] || {}; const on = cfg.on !== undefined ? !!cfg.on : PARENTS.includes(id);
    if (!on || !subs.some((x: any) => x.member === id)) continue;
    const at = toMin(cfg.time || "07:00"), nowM = toMin(hm);
    if (nowM < at || nowM > at + 180) continue;
    if (wx === undefined) wx = await weather();
    out.push({ key: `m:${id}:${t}`, to: [id], title: `🌅 Goeiemorgen ${NAMES[id]}`, body: morningText(id, C, t, wx), icon: ico("agenda") });
  }

  let sent = 0;
  for (const m of out) {
    const { error } = await sb.from("push_sent").insert({ key: m.key });
    if (error) continue; // al verstuurd
    for (const s of subs.filter((x: any) => m.to.includes(x.member))) {
      try { await webpush.sendNotification(s.sub, JSON.stringify({ title: m.title, body: m.body, tag: m.tag, icon: m.icon })); sent++; }
      catch (e: any) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await sb.from("push_subs").delete().eq("endpoint", s.endpoint); }
    }
  }
  await sb.from("push_sent").delete().lt("at", new Date(Date.now() - 14 * 864e5).toISOString());
  return new Response(JSON.stringify({ candidates: out.length, sent }), { headers: { "content-type": "application/json" } });
});

/* ---------- ochtendmelding: korte samenvatting van de dag ---------- */
function morningText(id: string, C: Record<string, any[]>, t: string, wx: any) {
  const parent = PARENTS.includes(id), lines: string[] = [];
  const evs = C.events.filter((ev) => ev.date && !ev.info && !(ev.squad && ev.sel === "nee") && occursOn(ev, t) && !(ev.conge || []).includes(t))
    .filter((ev) => !(ev.repeat && ev.repeat !== "none" && (ev.type === "Werk" || ev.type === "Crèche")))
    .filter((ev) => parent ? true : (ev.who || []).includes(id))
    .sort((a, b) => (a.allDay ? "00" : a.start || "99").localeCompare(b.allDay ? "00" : b.start || "99"));
  const short = (ev: any) => `${ev.allDay || !ev.start ? "" : ev.start + " "}${ev.title}${parent && (ev.who || []).length && (ev.who || []).length < 5 ? " (" + (ev.who || []).map((w: string) => NAMES[w] || w).join(", ") + ")" : ""}`;
  if (evs.length) lines.push(`📅 ${evs.slice(0, 4).map(short).join(" · ")}${evs.length > 4 ? ` · +${evs.length - 4}` : ""}`);
  else lines.push("📅 Niets speciaals gepland vandaag.");
  if (parent) {
    const work = C.events.filter((ev) => ev.type === "Werk" && occursOn(ev, t) && (ev.conge || []).includes(t)).map((ev) => (ev.who || []).map((w: string) => NAMES[w]).join(", "));
    if (work.length) lines.push(`🌴 Congé: ${work.join(", ")}`);
    const crecheOff = C.events.some((ev) => ev.type === "Crèche" && occursOn(ev, t) && (ev.conge || []).includes(t));
    if (crecheOff) lines.push("🏠 Max blijft thuis: middagdutje ±13u–15u");
  }
  const rem = C.reminders.filter((r) => !r.done && r.date === t && (r.who || []).includes(id));
  if (rem.length) lines.push(`🔔 ${rem.map((r) => (r.time ? r.time + " " : "") + r.title).join(" · ")}`);
  const outdoorEv = evs.find((ev) => outdoor(ev) && ev.start);
  const tip = outdoorEv ? wxTip(wx, t, outdoorEv.start) : "";
  if (tip) lines.push(tip);
  const w = C.waste.find((x) => (x.date || x.id) === addDays(t, 1));
  if (parent && w) lines.push(`🗑️ Vanavond buiten: ${(w.types || []).map((x: string) => WASTE[x] || x).join(" + ")}`);
  return lines.join("\n");
}

/* ---------- weer voor buitenactiviteiten (Open-Meteo, Tielt) ---------- */
function outdoor(ev: any) {
  if (ev.outdoor === true) return true; if (ev.outdoor === false) return false;
  const txt = `${ev.title || ""} ${ev.place || ""}`.toLowerCase();
  if (/waterpolo|zwem/.test(txt)) return false;
  return ev.type === "Uitstap" || ((ev.type === "Match" || ev.type === "Training") && !["waterpolo", "zwemmen"].includes(ev.sport || "voetbal")) || /tocht|markt|buiten|picknick|pretpark|plopsa|park|fiets|wandel/.test(txt);
}
async function weather() {
  try {
    const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=51.0&longitude=3.33&hourly=temperature_2m,precipitation_probability,wind_gusts_10m&timezone=Europe%2FBrussels&forecast_days=2&wind_speed_unit=kmh");
    return r.ok ? (await r.json()).hourly : null;
  } catch (_) { return null; }
}
function wxTip(h: any, d: string, start: string) {
  if (!h || !h.time) return "";
  const i = h.time.indexOf(`${d}T${String(start).slice(0, 2)}:00`); if (i < 0) return "";
  const rain = h.precipitation_probability?.[i] ?? 0, temp = Math.round(h.temperature_2m?.[i] ?? 10), gust = Math.round(h.wind_gusts_10m?.[i] ?? 0);
  if (rain >= 50) return `🌧️ ${rain}% kans op regen: regenjas en reservekleren mee.`;
  if (temp <= 3) return `🥶 ${temp}°: warm aankleden, muts en handschoenen.`;
  if (temp >= 28) return `☀️ ${temp}°: water en zonnecrème mee.`;
  if (gust >= 60) return `💨 Windstoten tot ${gust} km/u.`;
  return "";
}

/* ---------- datumhulpjes (zelfde regels als in de app) ---------- */
function local() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}
const parse = (d: string) => new Date(d + "T12:00:00Z");
const iso = (x: Date) => x.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const x = parse(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
const diffDays = (a: string, b: string) => Math.round((parse(a).getTime() - parse(b).getTime()) / 864e5);
const toMin = (s: string) => { const [h, m] = String(s || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
const holidayOn = (d: string) => HOLIDAYS.some(([, a, b]) => d >= a && d <= (b || a));
function easter(y: number) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`; }
function feestdag(d: string) { if (["01-01", "05-01", "07-21", "08-15", "11-01", "11-11", "12-25"].includes(d.slice(5))) return true; const e = easter(+d.slice(0, 4)); return d === addDays(e, 1) || d === addDays(e, 39) || d === addDays(e, 50); }
function startMatches(ev: any, s: string) {
  const dd = diffDays(s, ev.date); if (dd < 0) return false;
  if (ev.until && s > ev.until) return false;
  if ((ev.skip || []).includes(s)) return false;
  const r = ev.repeat || "none";
  if (r === "none") return dd === 0;
  if (r === "weekly") return dd % 7 === 0;
  if (r === "days") return (ev.days || []).map(Number).includes(parse(s).getUTCDay()) && (!(ev.every > 1) || Math.round(diffDays(mondayOf(s), mondayOf(ev.date)) / 7) % ev.every === 0);
  if (r === "2weekly") return dd % 14 === 0;
  if (r === "monthly") return parse(s).getUTCDate() === parse(ev.date).getUTCDate();
  if (r === "yearly") return s.slice(5) === ev.date.slice(5);
  return false;
}
function occursOn(ev: any, d: string) {
  if (ev.skipHol === "school" && (holidayOn(d) || feestdag(d))) return false;
  if (ev.skipHol === "feest" && feestdag(d)) return false;
  return startMatches(ev, d);
}
const mondayOf = (d: string) => addDays(d, -((parse(d).getUTCDay() + 6) % 7));
const schoolDay = (d: string) => { const wd = parse(d).getUTCDay(); return wd > 0 && wd < 6 && !holidayOn(d); };
function stockLeft(s: any, t: string): number | null {
  if (s.mode === "interval") { if (!s.lastBought) return 0; return Math.max(0, diffDays(addDays(s.lastBought, Math.max(1, Number(s.everyDays) || 7)), t)); }
  const per = Number(s.perDay) || 0, start = Number(s.lastQty) || Number(s.buyQty) || 0;
  if (!s.lastBought || !per || !start) return null;
  const use = (d: string) => (s.schoolDays ? (schoolDay(d) ? per : 0) : per);
  let rem = start, d = s.lastBought, i = 0;
  while (d < t && i < 730) { rem -= use(d); d = addDays(d, 1); i++; }
  if (rem <= 0) return 0;
  let left = 0; d = t; i = 0;
  while (rem > 0 && i < 730) { rem -= use(d); if (rem > 0) { left++; d = addDays(d, 1); } i++; }
  return left;
}
