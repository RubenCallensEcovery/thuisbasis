package be.callens.thuisbasis;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Zet alle alarmen en machine-eindes exact in Android (AlarmManager), ook als de app dicht is. */
final class Scheduler {
    private Scheduler() {}

    static final long LATE_MS = 15 * 60_000L; // een alarm dat max. 15 min geleden had moeten afgaan, gaat nog af

    static boolean exactAllowed(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        return Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
    }

    static PendingIntent firePi(Context c, String kind, String id, JSONObject extra, int flag) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(AlarmReceiver.FIRE)
            .setData(Uri.parse("thuis://" + kind + "/" + Uri.encode(id)))
            .putExtra("kind", kind).putExtra("id", id);
        if (extra != null) i.putExtra("json", extra.toString());
        return PendingIntent.getBroadcast(c, (kind + id).hashCode(), i, flag | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void cancel(Context c, String kind, String id) {
        PendingIntent pi = firePi(c, kind, id, null, PendingIntent.FLAG_NO_CREATE);
        if (pi != null) {
            c.getSystemService(AlarmManager.class).cancel(pi);
            pi.cancel();
        }
    }

    private static void setExact(Context c, long at, PendingIntent pi, boolean clock) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        try {
            if (exactAllowed(c)) {
                if (clock) am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, Notif.openApp(c)), pi);
                else am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                return;
            }
        } catch (SecurityException ignored) {}
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
    }

    /** alles opnieuw inplannen volgens wat in de opslag staat */
    static synchronized void apply(Context c) {
        long now = System.currentTimeMillis();

        // 1. alarmen en herinneringen
        JSONArray alarms = Store.alarms(c);
        Set<String> keep = new HashSet<>();
        for (int i = 0; i < alarms.length(); i++) {
            JSONObject a = alarms.optJSONObject(i);
            if (a == null) continue;
            String id = a.optString("id"), key = a.optString("key"), kind = "note".equals(a.optString("kind")) ? "note" : "alarm";
            long at = a.optLong("at");
            if (id.isEmpty() || Store.fired(c, kind + "|" + id + "|" + key)) continue;
            if (at < now - LATE_MS) continue;
            keep.add(kind + "|" + id);
            setExact(c, Math.max(at, now + 1000), firePi(c, kind, id, a, PendingIntent.FLAG_UPDATE_CURRENT), "alarm".equals(kind));
        }
        for (Object o : Store.p(c).getStringSet("planned", new HashSet<>())) {
            String s = (String) o;
            if (keep.contains(s)) continue;
            int bar = s.indexOf('|');
            if (bar > 0) cancel(c, s.substring(0, bar), s.substring(bar + 1));
        }
        Store.p(c).edit().putStringSet("planned", keep).apply();

        // 2. machines: blijvende aftellende melding + exact moment van "klaar"
        JSONArray timers = Store.timers(c);
        Set<String> running = new HashSet<>();
        for (int i = 0; i < timers.length(); i++) {
            JSONObject t = timers.optJSONObject(i);
            if (t == null) continue;
            String id = t.optString("id"), label = t.optString("label", "Machine");
            long start = t.optLong("start"), end = t.optLong("end");
            if (id.isEmpty() || end <= 0) continue;
            String fk = "machine|" + id + "|" + start;
            running.add(id);
            if (end > now) {
                Notif.running(c, id, label, start, end);
                setExact(c, end, firePi(c, "machine", id, t, PendingIntent.FLAG_UPDATE_CURRENT), false);
            } else if (now - end < 60 * 60_000L && !Store.fired(c, fk)) {
                Store.markFired(c, fk);
                Notif.machineDone(c, id, label);
            }
        }
        for (Object o : Store.p(c).getStringSet("machines", new HashSet<>())) {
            String id = (String) o;
            if (running.contains(id)) continue;
            cancel(c, "machine", id);
            Notif.cancel(c, ("m" + id).hashCode()); // leeggehaald of geschrapt
        }
        Store.p(c).edit().putStringSet("machines", running).apply();

        // voortgangsbalk van een draaiende machine om de 5 minuten bijwerken (de klok telt zelf af)
        long next = Long.MAX_VALUE;
        for (int i = 0; i < timers.length(); i++) {
            JSONObject t = timers.optJSONObject(i);
            if (t != null && t.optLong("end") > now) next = Math.min(next, Math.min(now + 5 * 60_000L, t.optLong("end") - 1000));
        }
        AlarmManager am = c.getSystemService(AlarmManager.class);
        PendingIntent tick = firePi(c, "tick", "machines", null, PendingIntent.FLAG_UPDATE_CURRENT);
        if (next != Long.MAX_VALUE) am.setAndAllowWhileIdle(AlarmManager.RTC, next, tick);
        else am.cancel(tick);

        // widget "Vandaag": nu bijwerken, en net na middernacht opnieuw (nieuwe dag)
        java.util.Calendar mid = java.util.Calendar.getInstance();
        mid.add(java.util.Calendar.DAY_OF_MONTH, 1);
        mid.set(java.util.Calendar.HOUR_OF_DAY, 0); mid.set(java.util.Calendar.MINUTE, 1); mid.set(java.util.Calendar.SECOND, 0);
        am.setAndAllowWhileIdle(AlarmManager.RTC, mid.getTimeInMillis(), firePi(c, "tick", "middernacht", null, PendingIntent.FLAG_UPDATE_CURRENT));
        VandaagWidget.update(c);
    }

    /** "10 min later": meteen op dit toestel opnieuw inplannen, los van de server */
    static void snooze(Context c, String id, String title, String newKey, long at) {
        try {
            JSONArray a = Store.alarms(c);
            JSONObject o = Store.find(a, id);
            if (o == null) {
                o = new JSONObject().put("id", id).put("kind", "alarm").put("title", title);
                a.put(o);
            }
            o.put("key", newKey).put("at", at).put("body", "Uitgesteld · om " + newKey.substring(newKey.length() - 5));
            Store.alarms(c, a);
        } catch (Exception ignored) {}
        apply(c);
    }

    /** proefalarm binnen x seconden, enkel op dit toestel */
    static void proef(Context c, int sec) {
        try {
            long at = System.currentTimeMillis() + sec * 1000L;
            JSONArray a = Store.alarms(c);
            a.put(new JSONObject().put("id", "proef" + at).put("key", AlarmService.keyOf(at) + ":" + at)
                .put("at", at).put("kind", "alarm").put("title", "Proefalarm").put("body", "Zo klinkt een alarm van Planner"));
            Store.alarms(c, a);
        } catch (Exception ignored) {}
        apply(c);
    }

    /** nieuwe lijst (van de app of via push) overnemen en alles opnieuw inplannen */
    static synchronized void plan(Context c, JSONArray alarms, JSONArray timers) {
        JSONArray old = Store.alarms(c);
        // acties die nog niet op de server staan (bv. "10 min later" zonder netwerk): lokale versie houden
        Set<String> waiting = new HashSet<>();
        JSONArray pend = Store.pending(c);
        for (int i = 0; i < pend.length(); i++) { JSONObject o = pend.optJSONObject(i); if (o != null) waiting.add(o.optString("id")); }
        JSONArray merged = new JSONArray();
        for (int i = 0; i < alarms.length(); i++) {
            JSONObject o = alarms.optJSONObject(i);
            if (o == null) continue;
            JSONObject local = waiting.contains(o.optString("id")) ? Store.find(old, o.optString("id")) : null;
            merged.put(local != null ? local : o);
        }
        for (int i = 0; i < old.length(); i++) {
            JSONObject o = old.optJSONObject(i);
            if (o == null) continue;
            String id = o.optString("id");
            // proefalarmen bestaan enkel op dit toestel; uitgestelde alarmen in afwachting van de server ook bewaren
            boolean local = id.startsWith("proef") || id.startsWith("machine:"); // bestaan enkel op dit toestel
            boolean keep = (local && o.optLong("at") > System.currentTimeMillis() - 10 * 60_000L) || waiting.contains(id);
            if (keep && Store.find(merged, id) == null) merged.put(o);
        }
        Store.alarms(c, merged);
        Store.timers(c, timers);
        apply(c);
        AlarmService.stopIfGone(c);
    }
}
