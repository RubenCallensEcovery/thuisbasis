// Thuisbasis — agenda-synchronisatie: Google Agenda → Thuisbasis (één richting).
// Wordt elke 15 minuten opgeroepen (Supabase Cron). Leest de geheime iCal-adressen van de agenda's
// (geheimen GCAL_RUBEN en GCAL_CHARLOTTE in Supabase → Edge Functions → Secrets) en zet nieuwe of
// gewijzigde afspraken in de tabel docs (col 'events', ook 'test~events' voor de testversie).
// - Wat al in Thuisbasis staat (zelfde dag en ongeveer zelfde uur of naam) wordt overgeslagen.
// - Afspraken die je in Thuisbasis verwijdert, komen niet terug.
// - Wie, soort en vervoer pas je in Thuisbasis aan; dat blijft bewaard. Titel, datum, uur en plaats volgen Google.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import ICAL from "npm:ical.js@2.2.1";

const CALS: { key: string; secret: string; who: string[] }[] = [
  { key: "ruben", secret: "GCAL_RUBEN", who: ["ruben"] },
  { key: "charlotte", secret: "GCAL_CHARLOTTE", who: ["charlotte"] },
];
const PAST_DAYS = 1, FUTURE_DAYS = 180;
// titels die nooit overgenomen worden (staan al als vaste afspraak of opvang in Thuisbasis); aanpasbaar via settings/gcal.ignore
const DEFAULT_IGNORE = ["training", "mama en papa", "frans en marlieve", "laura", "herfstvakantie", "kerstvakantie", "krokusvakantie", "paasvakantie", "zomervakantie"];
const HOLIDAYS: [string, string, string?][] = [
  ['Herfstvakantie','2026-11-02','2026-11-08'],['Wapenstilstand','2026-11-11'],['Kerstvakantie','2026-12-21','2027-01-03'],
  ['Krokusvakantie','2027-02-08','2027-02-14'],['Paasvakantie','2027-03-29','2027-04-11'],['Dag van de Arbeid','2027-05-01'],
  ['Hemelvaart','2027-05-06','2027-05-07'],['Pinkstermaandag','2027-05-17'],['Zomervakantie','2027-07-01','2027-08-31'],
  ['Herfstvakantie','2027-11-01','2027-11-07'],['Wapenstilstand','2027-11-11'],['Kerstvakantie','2027-12-27','2028-01-09'],
  ['Krokusvakantie','2028-02-28','2028-03-05'],['Paasvakantie','2028-04-03','2028-04-17'],['Dag van de Arbeid','2028-05-01'],
  ['Hemelvaart','2028-05-25','2028-05-26'],['Pinkstermaandag','2028-06-05'],['Zomervakantie','2028-07-01','2028-08-31'],
];

Deno.serve(async (req) => {
  const clean = (v?: string) => String(v || "").replace(/^\s*[A-Z_]+\s*=\s*/, "").replace(/["'\s]/g, "");
  const cronSecret = clean(Deno.env.get("CRON_SECRET"));
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) return new Response("nee", { status: 401 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const t = localDate(new Date()), from = addDays(t, -PAST_DAYS), to = addDays(t, FUTURE_DAYS);
  const report: Record<string, unknown> = {};

  // 1. Google-agenda's ophalen en uitrollen tot losse afspraken
  const occ: Occ[] = [];
  for (const c of CALS) {
    const url = clean(Deno.env.get(c.secret)).replace(/^webcal:/, "https:");
    if (!url) { report[c.key] = "geen iCal-adres ingesteld"; continue; }
    try {
      const r = await fetch(url);
      if (!r.ok) { report[c.key] = "fout " + r.status; continue; }
      const list = expand(await r.text(), from, to, c);
      occ.push(...list); report[c.key] = list.length;
    } catch (e) { report[c.key] = "fout " + String(e).slice(0, 120); }
  }
  if (!Object.values(report).some((v) => typeof v === "number")) return json({ ok: false, report });

  for (const prefix of ["", "test~"]) {
    const col = prefix + "events", scol = prefix + "settings";
    const { data: rows } = await sb.from("docs").select("id,data").eq("col", col);
    const all = (rows || []).map((r: any) => ({ id: r.id, ...r.data }));
    const own = all.filter((e: any) => !e.gcal), synced = new Map(all.filter((e: any) => e.gcal).map((e: any) => [e.id, e]));
    const { data: st } = await sb.from("docs").select("data").eq("col", scol).eq("id", "gcal").maybeSingle();
    const cfg: any = st?.data || {};
    const ignore: string[] = (cfg.ignore || DEFAULT_IGNORE).map(norm);
    const seen: Record<string, string> = cfg.seen || {};
    const want = new Set<string>(); let added = 0, changed = 0, removed = 0, skipped = 0;

    for (const o of occ) {
      const id = "g-" + o.cal + "-" + hash(o.uid + "|" + o.date);
      if (ignore.some((w) => norm(o.title) === w || norm(o.title).startsWith(w + " "))) { skipped++; continue; }
      if (o.allDay && HOLIDAYS.some(([n, a, b]) => o.date >= a && o.date <= (b || a) && norm(o.title).includes(norm(n).split(" ")[0]))) { skipped++; continue; }
      want.add(id);
      const h = hash([o.title, o.date, o.start, o.end, o.allDay, o.endDate, o.place].join("|"));
      const ex: any = synced.get(id);
      if (ex) {
        if (ex.gcal.h !== h) {
          await merge(sb, col, id, { title: o.title, date: o.date, start: o.start, end: o.end, allDay: o.allDay, endDate: o.endDate, place: o.place, gcal: { ...ex.gcal, h }, at: Date.now(), by: "sync" });
          changed++;
        }
        continue;
      }
      if (seen[id]) { skipped++; continue; }                  // ooit gesynchroniseerd en in Thuisbasis verwijderd
      if (own.some((e: any) => dup(e, o))) { skipped++; continue; } // staat er al (zelf ingegeven of vaste afspraak)
      await merge(sb, col, id, {
        title: o.title, date: o.date, start: o.start, end: o.end, allDay: o.allDay, endDate: o.endDate, place: o.place,
        who: o.who, type: guessType(o.title), repeat: "none", days: [], skipHol: "", until: "", note: "", outdoor: false, info: false,
        gcal: { cal: o.cal, uid: o.uid, h }, by: "sync", at: Date.now(),
      });
      seen[id] = o.date; added++;
    }
    // afspraken die uit Google verdwenen zijn (enkel binnen het venster en niet in het verleden)
    for (const [id, e] of synced) {
      if (want.has(id) || !e.date || e.date < t || e.date > to) continue;
      if (!report[e.gcal.cal] || typeof report[e.gcal.cal] !== "number") continue; // die agenda kon niet gelezen worden
      await sb.from("docs").delete().eq("col", col).eq("id", id); removed++;
    }
    for (const id of synced.keys()) seen[id] = seen[id] || "1";
    for (const k of Object.keys(seen)) if (/^\d{4}-/.test(seen[k]) && seen[k] < addDays(t, -60)) delete seen[k];
    await merge(sb, scol, "gcal", { ignore: cfg.ignore || DEFAULT_IGNORE, seen, lastRun: new Date().toISOString(), at: Date.now() });
    report[prefix || "live"] = { added, changed, removed, skipped };
  }
  return json({ ok: true, report });
});

type Occ = { cal: string; uid: string; title: string; date: string; start: string; end: string; allDay: boolean; endDate: string; place: string; who: string[] };

function expand(ics: string, from: string, to: string, c: { key: string; who: string[] }): Occ[] {
  const comp = new ICAL.Component(ICAL.parse(ics));
  for (const tz of comp.getAllSubcomponents("vtimezone")) { try { ICAL.TimezoneService.register(tz); } catch (_) { /* */ } }
  const vevents = comp.getAllSubcomponents("vevent");
  const out: Occ[] = [];
  const exceptions = new Map<string, any[]>();
  for (const v of vevents) if (v.hasProperty("recurrence-id")) { const u = String(v.getFirstPropertyValue("uid")); exceptions.set(u, [...(exceptions.get(u) || []), v]); }
  const fromT = ICAL.Time.fromDateString(from), toT = ICAL.Time.fromDateString(addDays(to, 1));
  for (const v of vevents) {
    if (v.hasProperty("recurrence-id")) continue;
    const ev = new ICAL.Event(v);
    for (const x of exceptions.get(ev.uid) || []) ev.relateException(x);
    if (String(v.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED") continue;
    const push = (s: any, e: any, item: any) => {
      if (String(item.component?.getFirstPropertyValue?.("status") || "").toUpperCase() === "CANCELLED") return;
      const allDay = s.isDate;
      const sd = allDay ? s.toString().slice(0, 10) : localDate(s.toJSDate());
      if (sd < from || sd > to) return;
      let endDate = "", st = "", en = "";
      if (allDay) { const ed = addDays(e ? e.toString().slice(0, 10) : sd, -1); if (ed > sd) endDate = ed; }
      else { st = localTime(s.toJSDate()); en = e ? localTime(e.toJSDate()) : ""; }
      out.push({ cal: c.key, uid: ev.uid, title: String(item.summary || "(zonder titel)").slice(0, 120), date: sd, start: st, end: en, allDay, endDate, place: String(item.location || "").slice(0, 160), who: c.who });
    };
    if (ev.isRecurring()) {
      const it = ev.iterator(); let n = 0, next;
      while ((next = it.next()) && n < 2000) {
        n++;
        if (next.compare(toT) > 0) break;
        const d = ev.getOccurrenceDetails(next);
        if (d.endDate.compare(fromT) < 0) continue;
        push(d.startDate, d.endDate, d.item);
      }
    } else push(ev.startDate, ev.endDate, ev);
  }
  return out;
}

/* ---------- dubbels herkennen ---------- */
function dup(e: any, o: Occ) {
  /* vaste afspraken tellen ook mee op dagen die ze zelf overslaan (vakanties): Google toont die vaak toch */
  if (!occursOn(e, o.date) && !((e.repeat || "none") !== "none" && startMatches(e, o.date))) return false;
  const a = norm(e.title), b = norm(o.title);
  const ta = new Set(a.split(" ").filter((w) => w.length > 2)), tb = b.split(" ").filter((w) => w.length > 2);
  const overlap = tb.filter((w) => ta.has(w)).length / Math.max(1, Math.min(ta.size, tb.length));
  const sameName = a && b && (a === b || a.includes(b) || b.includes(a) || a.split(" ")[0] === b.split(" ")[0] || overlap >= 0.6);
  if (o.allDay || !o.start) return !!sameName && (e.allDay || !e.start);
  if (!e.start) return !!sameName;
  const close = Math.abs(toMin(e.start) - toMin(o.start)) <= 20;
  return close || (sameName && Math.abs(toMin(e.start) - toMin(o.start)) <= 90);
}
const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function guessType(t: string) { const s = norm(t); if (/waterpolo|match|wedstrijd/.test(s)) return "Match"; if (/training/.test(s)) return "Training"; if (/feest|verjaardag|sint|kerst|nieuwjaar/.test(s)) return "Feest"; if (/vakantie|weekend/.test(s)) return "Uitstap"; return "Afspraak"; }

/* ---------- opslag ---------- */
async function merge(sb: any, col: string, id: string, patch: Record<string, unknown>) {
  const { error } = await sb.rpc("doc_merge", { p_col: col, p_id: id, p_patch: patch });
  if (error) { const { data } = await sb.from("docs").select("data").eq("col", col).eq("id", id).maybeSingle(); await sb.from("docs").upsert({ col, id, data: { ...(data?.data || {}), ...patch } }); }
}
function json(o: unknown) { return new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } }); }
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

/* ---------- datumhulpjes (zelfde regels als in de app) ---------- */
function parts(d: Date) { return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map((x) => [x.type, x.value])); }
function localDate(d: Date) { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; }
function localTime(d: Date) { const p = parts(d); return `${p.hour === "24" ? "00" : p.hour}:${p.minute}`; }
const parse = (d: string) => new Date(d + "T12:00:00Z");
const iso = (x: Date) => x.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const x = parse(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
const diffDays = (a: string, b: string) => Math.round((parse(a).getTime() - parse(b).getTime()) / 864e5);
const toMin = (s: string) => { const [h, m] = String(s || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
const holidayOn = (d: string) => HOLIDAYS.some(([, a, b]) => d >= a && d <= (b || a));
function easter(y: number) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`; }
function feestdag(d: string) { if (["01-01", "05-01", "07-21", "08-15", "11-01", "11-11", "12-25"].includes(d.slice(5))) return true; const e = easter(+d.slice(0, 4)); return d === addDays(e, 1) || d === addDays(e, 39) || d === addDays(e, 50); }
function startMatches(ev: any, s: string) {
  if (!ev.date) return false;
  const dd = diffDays(s, ev.date);
  if (ev.endDate && s >= ev.date && s <= ev.endDate) return true;
  if (dd < 0) return false;
  if (ev.until && s > ev.until) return false;
  if ((ev.skip || []).includes(s)) return false;
  const r = ev.repeat || "none";
  if (r === "none") return dd === 0;
  if (r === "weekly") return dd % 7 === 0;
  if (r === "days") return (ev.days || []).map(Number).includes(parse(s).getUTCDay());
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
