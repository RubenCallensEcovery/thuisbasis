// Thuisbasis — meldingen: wordt elke minuut opgeroepen (Supabase Cron) en stuurt pushmeldingen
// naar de toestellen van het gezin: herinneringen, afspraken die eraan komen, wat anderen deden,
// afval buitenzetten, machines die klaar zijn en voorraad die bijna op is.
// Twee soorten toestellen in push_subs:
//  - webapp (webpush, zoals altijd)
//  - Android-app Planner (sub.fcm): via Firebase. Krijgt dezelfde meldingen, behalve alarmen/herinneringen/machines:
//    die plant de app zelf exact in uit een "plan" (lijst per gezinslid) dat meteen na elke wijziging verstuurd wordt.
//    Planner test (sub.env = "test") krijgt hetzelfde, maar dan uit de testgegevens (test~).
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
  const isApp = (s: any) => !!(s.sub && s.sub.fcm);
  const web = subs.filter((s: any) => !isApp(s));
  const appLive = subs.filter((s: any) => isApp(s) && s.sub.env !== "test");
  const appTest = subs.filter((s: any) => isApp(s) && s.sub.env === "test");
  const cols = ["reminders", "events", "waste", "timers", "stock", "notifs", "settings"];
  const load = async (pfx: string) => {
    const { data: rows } = await sb.from("docs").select("col,id,data").in("col", cols.map((c) => pfx + c));
    const C: Record<string, any[]> = {}; cols.forEach((c) => (C[c] = []));
    (rows || []).forEach((r: any) => C[r.col.slice(pfx.length)].push({ id: r.id, ...r.data }));
    return C;
  };

  const now = local(); const t = now.date, hm = now.time, H = Number(hm.slice(0, 2));
  type Out = { key: string; to: string[]; title: string; body: string; tag?: string; icon?: string; alarm?: boolean; id?: string; silent?: boolean; sticky?: boolean; go?: string };
  let wx: any = undefined;
  const build = async (C: Record<string, any[]>, devs: any[]) => {
  const out: Out[] = [];
  const ico = (n: string) => `icons/n/${n}.png`; // icoon links in de melding, volgens het onderwerp
  const names = (w: string[]) => (w || []).map((x) => NAMES[x] || x).join(", ");

  // 1. herinneringen
  for (const r of C.reminders) {
    if (r.done || !r.date || r.date < addDays(t, -1)) continue;
    if (r.alarm) {
      // alarm: op het uur of x min vooraf (of na 'snooze'); 3 keer, om de 5 minuten, tot iemand het stopt
      let ad = r.date, am = toMin(r.time || "08:00") - (Number(r.alarmBefore) || 0);
      while (am < 0) { am += 1440; ad = addDays(ad, -1); }
      if (typeof r.snooze === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.snooze)) { ad = r.snooze.slice(0, 10); am = toMin(r.snooze.slice(11)); }
      const at = `${ad} ${String(Math.floor(am / 60)).padStart(2, "0")}:${String(am % 60).padStart(2, "0")}`;
      if (r.ack === at) continue;
      const el = diffDays(t, ad) * 1440 + toMin(hm) - am;
      if (el < 0 || el >= 15) continue;
      out.push({ key: `ra:${r.id}:${at}:${Math.floor(el / 5)}`, to: r.who || [], title: `⏰ ${r.title}`, body: r.time ? `Om ${r.time}` + (Number(r.alarmBefore) && !r.snooze ? ` (over ${r.alarmBefore} min)` : "") : "Alarm", tag: "r" + r.id, icon: ico("bell"), alarm: true, id: r.id, go: `rem:${r.id}` });
      continue;
    }
    if (r.date > t || (r.date === t && hm < (r.time || "08:00"))) continue;
    out.push({ key: `r:${r.id}:${r.date}${r.time || ""}`, to: r.who || [], title: "🔔 Herinnering", body: r.title, tag: "r" + r.id, icon: ico("bell"), go: `rem:${r.id}` });
  }
  // 2. wat anderen deden (activiteiten van de laatste 15 minuten)
  for (const n of C.notifs) {
    if (!n.at || Date.now() - n.at > 15 * 6e4) continue;
    const to = [...PARENTS, ...KIDS].filter((m) => m !== n.by && (PARENTS.includes(m) || (n.to || []).includes(m) || (n.to || []).includes("all")));
    out.push({ key: `n:${n.id}`, to, title: NAMES[n.by] || "Thuisbasis", body: n.text, icon: ico(n.kind === "agenda" ? "agenda" : n.kind === "voorraad" || n.kind === "eten" ? "cart" : "chat"),
      go: n.go || ({ agenda: "k:agenda", voorraad: "k:voorraad", eten: "k:boodschappen", machine: "k:machines", taak: "k:klusjes", ritme: "k:ritme", regelen: "k:regelen", school: "k:rugzak" } as Record<string, string>)[n.kind] || "k:home" });
  }
  // 3. afspraken die binnen 30 minuten beginnen (met kledijtip bij buitenactiviteiten)
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
    out.push({ key: `e:${ev.id}:${t}`, to: [...PARENTS, ...kids], title: `Om ${ev.start}`, body: `${ev.title}${ev.who && ev.who.length ? " — " + names(ev.who) : ""}${tip ? "\n" + tip : ""}`, tag: "e" + ev.id, icon: ico(ev.type === "Match" || ev.type === "Training" ? "sport" : "agenda"), go: `ev:${ev.id}:${t}` });
  }
  // 4. afval: de avond ervoor vanaf 19u
  const w = C.waste.find((x) => (x.date || x.id) === addDays(t, 1));
  const ws = C.settings.find((x) => x.id === "waste") || {};
  if (w && H >= 19 && ws.remind !== false) out.push({ key: `w:${addDays(t, 1)}`, to: PARENTS, title: "🗑️ Morgen ophaling", body: `${(w.types || []).map((x: string) => WASTE[x] || x).join(" + ")}: zet ze vanavond buiten.`, icon: ico((["gft", "pmd", "rest"].find((x) => (w.types || []).includes(x))) || "rest"), go: `day:${addDays(t, 1)}` });
  // 5. machines die klaar zijn
  for (const m of C.timers) {
    const end = (m.startedAt || 0) + (m.minutes || 0) * 6e4;
    if (m.startedAt && end > Date.now()) {
      // draait nog: blijvende, stille melding met de resterende tijd, om de 5 minuten bijgewerkt
      const el = Math.floor((Date.now() - m.startedAt) / 6e4), left = Math.max(1, Math.ceil((end - Date.now()) / 6e4)), n = Math.round(Math.min(1, el / Math.max(1, m.minutes)) * 10);
      const hh = new Intl.DateTimeFormat("nl-BE", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit" }).format(new Date(end));
      const fm = left >= 60 ? `${Math.floor(left / 60)}u${String(left % 60).padStart(2, "0")}` : `${left} min`;
      out.push({ key: `tr:${m.id}:${m.startedAt}:${Math.floor(el / 5)}`, to: PARENTS, title: `🫧 ${m.label || "Machine"} draait`, body: `${"▰".repeat(n)}${"▱".repeat(10 - n)}  nog ${fm} · klaar om ${hh}`, tag: "m" + m.id, icon: ico("machine"), silent: true, sticky: true, go: "k:machines" });
      continue;
    }
    if (end > Date.now() || Date.now() - end > 60 * 6e4) continue;
    out.push({ key: `t:${m.id}:${m.startedAt}`, to: PARENTS, title: "🫧 Klaar", body: `${m.label || "De machine"} is klaar. Tijd om uit te halen.`, tag: "m" + m.id, icon: ico("machine"), go: "k:machines" });
  }
  // 6. voorraad: één keer per dag vanaf 17u
  if (H >= 17) {
    const low = C.stock.filter((s) => { const c = stockLeft(s, t); return c !== null && c <= (Number(s.warnDays) || 2); }).map((s) => s.name);
    if (low.length) out.push({ key: `s:${t}`, to: PARENTS, title: "🛒 Bijna op", body: low.join(", "), icon: ico("cart"), go: "k:voorraad" });
  }

  // 7. ochtendmelding: per gezinslid op het gekozen uur (aan/uit in Instellingen → Meldingen)
  const mc = (C.settings.find((x) => x.id === "morning") || {}).members || {};
  for (const id of [...PARENTS, ...KIDS]) {
    const cfg = mc[id] || {}; const on = cfg.on !== undefined ? !!cfg.on : PARENTS.includes(id);
    if (!on || !devs.some((x: any) => x.member === id)) continue;
    const at = toMin(cfg.time || "07:00"), nowM = toMin(hm);
    if (nowM < at || nowM > at + 180) continue;
    if (wx === undefined) wx = await weather();
    out.push({ key: `m:${id}:${t}`, to: [id], title: `Goeiemorgen ${NAMES[id]}`, body: morningText(id, C, t, wx), icon: ico("morning"), go: `day:${t}` });
  }

  return out;
  };

  // alarmen, herinneringen en machines plant de app zelf in (via het plan); die gaan niet als gewone melding naar de app
  const appMsg = (m: Out) => !/^(ra|r|tr|t):/.test(m.key);
  const toApp = async (s: any, m: Out) => (await fcmSend(sb, s, { type: "msg", title: m.title, body: m.body, tag: m.tag || "", go: m.go || "" })) ? 1 : 0;

  let sent = 0;
  const C = await load("");
  const out = await build(C, [...web, ...appLive]);
  for (const m of out) {
    const { error } = await sb.from("push_sent").insert({ key: m.key });
    if (error) continue; // al verstuurd
    for (const s of web.filter((x: any) => m.to.includes(x.member))) {
      try { await webpush.sendNotification(s.sub, JSON.stringify({ title: m.title, body: m.body, tag: m.tag, icon: m.icon, alarm: m.alarm || undefined, id: m.id || undefined, silent: m.silent || undefined, sticky: m.sticky || undefined, go: m.go || undefined })); sent++; }
      catch (e: any) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await sb.from("push_subs").delete().eq("endpoint", s.endpoint); }
    }
    if (appMsg(m)) for (const s of appLive.filter((x: any) => m.to.includes(x.member))) sent += await toApp(s, m);
  }

  // Planner test: zelfde meldingen, uit de testgegevens, enkel naar testtoestellen
  let CT: Record<string, any[]> | null = null;
  if (appTest.length) {
    CT = await load("test~");
    for (const m of await build(CT, appTest)) {
      if (!appMsg(m)) continue;
      const { error } = await sb.from("push_sent").insert({ key: "test|" + m.key });
      if (error) continue;
      for (const s of appTest.filter((x: any) => m.to.includes(x.member))) sent += await toApp(s, m);
    }
  }

  // plan per app-toestel: enkel versturen als het veranderde (of om de 6 uur, voor de zekerheid)
  let plans = 0;
  const wxNow = (appLive.length || appTest.length) ? await weatherToday() : null;
  for (const s of [...appLive, ...appTest]) {
    const src = s.sub.env === "test" ? CT : C;
    if (!src) continue;
    const p = planFor(src, s.member, wxNow), h = await hash(JSON.stringify(p));
    if (s.sub.plan === h && Date.now() - (Number(s.sub.planAt) || 0) < 6 * 3600e3) continue;
    if (await fcmSend(sb, s, { type: "plan", alarms: JSON.stringify(p.alarms), timers: JSON.stringify(p.timers), day: JSON.stringify(p.day) }, "86400s")) {
      plans++;
      await sb.from("push_subs").update({ sub: { ...s.sub, plan: h, planAt: Date.now() } }).eq("endpoint", s.endpoint);
    }
  }
  await sb.from("push_sent").delete().lt("at", new Date(Date.now() - 14 * 864e5).toISOString());
  return new Response(JSON.stringify({ candidates: out.length, sent, plans }), { headers: { "content-type": "application/json" } });
});

/* ---------- Planner (Android): plan per gezinslid, zelfde regels als in de app ---------- */
function planFor(C: Record<string, any[]>, me: string, wx: any = null) {
  const now = Date.now(), horizon = now + 14 * 864e5, pad = (n: number) => String(n).padStart(2, "0");
  const cut = (x: string) => String(x || "").slice(0, 80);
  const alarms: any[] = [];
  for (const r of C.reminders) {
    if (r.done || !r.date || !(r.who || []).includes(me)) continue;
    if (r.alarm) {
      let key: string;
      if (r.snooze) key = String(r.snooze);
      else { let ad = r.date, am = toMin(r.time || "08:00") - (Number(r.alarmBefore) || 0); while (am < 0) { am += 1440; ad = addDays(ad, -1); } key = `${ad} ${pad(Math.floor(am / 60))}:${pad(am % 60)}`; }
      if (r.ack === key || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(key)) continue;
      const at = bxMs(key); if (at < now - 15 * 6e4 || at > horizon) continue;
      alarms.push({ i: r.id, k: key, a: at, n: "a", t: cut(r.title || "Alarm"), b: r.time ? `Om ${r.time}` + (Number(r.alarmBefore) && !r.snooze ? ` (over ${r.alarmBefore} min)` : "") : "Alarm" });
    } else {
      const key = `${r.date} ${r.time || "08:00"}`, at = bxMs(key);
      if (at < now - 15 * 6e4 || at > horizon) continue;
      alarms.push({ i: r.id, k: key, a: at, n: "n", t: cut(r.title || "Herinnering"), b: r.time ? `Om ${r.time}` : "" });
    }
  }
  alarms.sort((a, b) => a.a - b.a);
  const timers: any[] = [];
  if (PARENTS.includes(me)) for (const m of C.timers) {
    if (!m.startedAt || !m.minutes) continue;
    const end = m.startedAt + m.minutes * 6e4;
    if (now - end > 60 * 6e4) continue;
    // r: alarm als ze klaar is (wie gekozen werd bij het starten, anders wie ze startte)
    const ring = Array.isArray(m.alarmFor) ? m.alarmFor.includes(me) : m.by === me;
    timers.push({ i: m.id, l: cut(m.label || "Machine"), s: m.startedAt, e: end, r: ring ? 1 : 0 });
  }
  return { alarms: alarms.slice(0, 20), timers, day: { ...dayFor(C, me), wx } };
}
/* widget "Vandaag": afspraken van vandaag (zoals in de ochtendmelding) en de ophaling van morgen */
const COLORS: Record<string, string> = { charlotte: "#DB3F76", ruben: "#4A5370", nant: "#1F9858", abel: "#1E8FB8", max: "#E07A1F" };
function dayFor(C: Record<string, any[]>, me: string) {
  const t = local().date, parent = PARENTS.includes(me);
  const fam = ((C.settings.find((x) => x.id === "family") || {}).members || {}) as Record<string, any>;
  const colorOf = (who: string[]) => (who || []).length > 1 ? "#F2B705" : ((fam[(who || [])[0]] || {}).color || COLORS[(who || [])[0]] || "#8A8578");
  const on = (ev: any, d: string) => occursOn(ev, d) || (!!ev.endDate && (ev.repeat || "none") === "none" && d >= ev.date && d <= ev.endDate);
  const ev = C.events.filter((e) => e.date && !e.info && !(e.squad && e.sel === "nee") && on(e, t) && !(e.conge || []).includes(t))
    .filter((e) => !(e.repeat && e.repeat !== "none" && (e.type === "Werk" || e.type === "Crèche")))
    .filter((e) => parent ? true : (e.who || []).includes(me))
    .sort((a, b) => (a.allDay || !a.start ? "00" : a.start).localeCompare(b.allDay || !b.start ? "00" : b.start))
    .slice(0, 8)
    .map((e) => ({ t: e.allDay || !e.start ? "" : e.start, n: String(e.title || "").slice(0, 42), c: colorOf(e.who) }));
  const w = parent ? C.waste.find((x) => (x.date || x.id) === addDays(t, 1)) : null;
  return { d: t, ev, w: w ? (w.types || []).map((x: string) => WASTE[x] || x).join(" + ") : "" };
}
/* weer van vandaag voor de widget (Open-Meteo, Tielt), 20 minuten bewaard */
let wxCache: { at: number; v: any } | null = null;
async function weatherToday() {
  if (wxCache && Date.now() - wxCache.at < 20 * 6e4) return wxCache.v;
  try {
    const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=51.0&longitude=3.33&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Europe%2FBrussels&forecast_days=1");
    if (!r.ok) return wxCache ? wxCache.v : null;
    const j = await r.json();
    const v = { t: Math.round(j.current.temperature_2m), c: j.current.weather_code, n: j.current.is_day ? 0 : 1,
      hi: Math.round(j.daily.temperature_2m_max[0]), lo: Math.round(j.daily.temperature_2m_min[0]), p: j.daily.precipitation_probability_max[0] ?? 0 };
    wxCache = { at: Date.now(), v };
    return v;
  } catch (_) { return wxCache ? wxCache.v : null; }
}
/* "JJJJ-MM-DD UU:MM" in Belgische tijd → tijdstip in ms */
function bxMs(key: string) {
  const want = Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10), +key.slice(11, 13), +key.slice(14, 16));
  let t = want;
  for (let k = 0; k < 2; k++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    t += want - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  }
  return t;
}
async function hash(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d.slice(0, 12)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

/* ---------- Firebase Cloud Messaging (geheim FCM_SERVICE_ACCOUNT = JSON-sleutel van het serviceaccount) ---------- */
let fcmAuth: { token: string; exp: number; project: string } | null = null;
const b64url = (u: Uint8Array) => { let b = ""; u.forEach((x) => (b += String.fromCharCode(x))); return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
async function fcmLogin() {
  if (fcmAuth && fcmAuth.exp > Date.now() + 60e3) return fcmAuth;
  let sa: any;
  try { sa = JSON.parse(String(Deno.env.get("FCM_SERVICE_ACCOUNT") || "").trim()); } catch (_) { return null; }
  if (!sa || !sa.private_key || !sa.client_email || !sa.project_id) return null;
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = enc({ alg: "RS256", typ: "JWT" }) + "." + enc({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 });
  const der = Uint8Array.from(atob(String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + unsigned + "." + b64url(sig) });
  if (!r.ok) { console.warn("fcm login", r.status, (await r.text()).slice(0, 200)); return null; }
  const j = await r.json();
  fcmAuth = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000, project: sa.project_id };
  return fcmAuth;
}
async function fcmSend(sb: any, s: any, data: Record<string, string>, ttl = "3600s") {
  try {
    const a = await fcmLogin(); if (!a) return false;
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project}/messages:send`, {
      method: "POST", headers: { authorization: `Bearer ${a.token}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { token: s.sub.fcm, data, android: { priority: "HIGH", ttl } } })
    });
    if (r.ok) return true;
    const txt = await r.text();
    if (r.status === 404 || /UNREGISTERED/.test(txt)) await sb.from("push_subs").delete().eq("endpoint", s.endpoint);
    else console.warn("fcm", r.status, txt.slice(0, 200));
  } catch (e) { console.warn("fcm", e); }
  return false;
}

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
