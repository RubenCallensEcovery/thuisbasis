package be.callens.thuisbasis;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import androidx.core.content.ContextCompat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Widget "Vandaag" — doorzichtige strook (4×1). Per item een rond icoontje in de kleur van het gezinslid of
 * het onderwerp: machine (ring die volloopt), afspraak, herinnering, ophaling morgen.
 * Smal = enkel icoontjes, middel = icoon + uur/resterende tijd, breed = de eerstvolgende met uur en titel.
 * Niets gepland = niets zichtbaar.
 */
public class VandaagWidget extends AppWidgetProvider {
    private static final int[] SLOT = { R.id.w_s1, R.id.w_s2, R.id.w_s3, R.id.w_s4 };
    private static final int[] ICON = { R.id.w_i1, R.id.w_i2, R.id.w_i3, R.id.w_i4 };
    private static final int[] CHRONO = { R.id.w_c1, R.id.w_c2, R.id.w_c3, R.id.w_c4 };
    private static final int[] TEXT = { R.id.w_t1, R.id.w_t2, R.id.w_t3, R.id.w_t4 };
    private static final int RED = 0xFFD7301F;

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) { update(c); }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle o) { update(c); }

    static void update(Context c) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            int[] ids = m.getAppWidgetIds(new ComponentName(c, VandaagWidget.class));
            if (ids == null || ids.length == 0) return;
            List<Item> items = load(c);
            for (int id : ids) {
                if (Build.VERSION.SDK_INT >= 31) {
                    Map<SizeF, RemoteViews> map = new HashMap<>();
                    map.put(new SizeF(100, 40), build(c, items, 0));
                    map.put(new SizeF(210, 40), build(c, items, 1));
                    map.put(new SizeF(300, 40), build(c, items, 2));
                    m.updateAppWidget(id, new RemoteViews(map));
                } else {
                    int w = m.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 300);
                    m.updateAppWidget(id, build(c, items, w < 200 ? 0 : w < 300 ? 1 : 2));
                }
            }
            scheduleNext(c, items);
        } catch (Exception ignored) {}
    }

    /* ---------- wat er te tonen is ---------- */
    static final class Item {
        String kind; // machine | event | reminder | waste
        String time = "", title = "", go = "";
        int color, icon;
        long at, start, end;
        boolean allDay;
    }

    private static String fmt(String p, long t) { return new SimpleDateFormat(p, new Locale("nl", "BE")).format(new Date(t)); }

    private static long at(String day, String hhmm) {
        try { return new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).parse(day + " " + hhmm).getTime(); } catch (Exception e) { return 0; }
    }

    private static int wasteColor(String w) {
        String x = w.toLowerCase(Locale.ROOT);
        if (x.contains("pmd")) return 0xFF1E6FD9;
        if (x.contains("gft")) return 0xFF2E9D4F;
        if (x.contains("rest")) return 0xFF5F5A52;
        if (x.contains("papier")) return 0xFFD69A12;
        if (x.contains("glas")) return 0xFF4E9C98;
        return 0xFF8A8578;
    }

    static List<Item> load(Context c) {
        long now = System.currentTimeMillis();
        String today = fmt("yyyy-MM-dd", now);
        List<Item> out = new ArrayList<>(), dayItems = new ArrayList<>();

        // 1. draaiende machine (eerstvolgende die klaar is)
        JSONArray timers = Store.timers(c);
        JSONObject run = null;
        for (int i = 0; i < timers.length(); i++) {
            JSONObject t = timers.optJSONObject(i);
            if (t != null && t.optLong("end") > now && (run == null || t.optLong("end") < run.optLong("end"))) run = t;
        }
        if (run != null) {
            Item m = new Item();
            m.kind = "machine"; m.start = run.optLong("start"); m.end = run.optLong("end");
            m.title = run.optString("label", "Machine"); m.time = fmt("HH:mm", m.end);
            m.color = RED; m.icon = R.drawable.wi_wash; m.go = "k:machines";
            out.add(m);
        }

        // 2. afspraken van vandaag (van de server) en herinneringen (op dit toestel), nog niet voorbij
        JSONObject day = null;
        try { day = new JSONObject(Store.str(c, "day")); } catch (Exception ignored) {}
        boolean fresh = day != null && today.equals(day.optString("d"));
        if (fresh) {
            JSONArray ev = day.optJSONArray("ev");
            for (int i = 0; ev != null && i < ev.length(); i++) {
                JSONObject e = ev.optJSONObject(i);
                if (e == null) continue;
                Item it = new Item();
                it.kind = "event"; it.time = e.optString("t"); it.allDay = it.time.isEmpty();
                it.at = it.allDay ? 0 : at(today, it.time);
                if (!it.allDay && it.at < now - 15 * 60_000L) continue; // al voorbij
                it.title = e.optString("n");
                try { it.color = Color.parseColor(e.optString("c", "#8A8578")); } catch (Exception x) { it.color = 0xFF8A8578; }
                String y = e.optString("y");
                it.icon = "s".equals(y) ? R.drawable.wi_ball : "f".equals(y) ? R.drawable.wi_cake : "u".equals(y) ? R.drawable.wi_pin : R.drawable.wi_cal;
                it.go = "day:" + today;
                dayItems.add(it);
            }
        }
        JSONArray alarms = Store.alarms(c);
        for (int i = 0; i < alarms.length(); i++) {
            JSONObject a = alarms.optJSONObject(i);
            if (a == null) continue;
            String id = a.optString("id");
            if (id.startsWith("proef") || id.startsWith("machine:")) continue;
            long t = a.optLong("at");
            if (!today.equals(fmt("yyyy-MM-dd", t)) || t < now - 15 * 60_000L) continue;
            Item it = new Item();
            it.kind = "reminder"; it.at = t; it.time = fmt("HH:mm", t); it.title = a.optString("title");
            it.color = 0xFFE07A1F; it.icon = R.drawable.wi_bell; it.go = "rem:" + id;
            dayItems.add(it);
        }
        // eerst wat een uur heeft (in volgorde), dan de hele-dag-dingen
        dayItems.sort((x, y) -> x.allDay != y.allDay ? (x.allDay ? 1 : -1) : Long.compare(x.at, y.at));
        out.addAll(dayItems);

        // 3. ophaling morgen (vanaf de middag)
        if (fresh && !day.optString("w").isEmpty() && Integer.parseInt(fmt("H", now)) >= 12) {
            Item w = new Item();
            w.kind = "waste"; w.title = day.optString("w").replace("Papier-karton", "Papier");
            w.time = w.title; w.color = wasteColor(w.title); w.icon = R.drawable.wi_trash;
            w.go = "day:" + fmt("yyyy-MM-dd", now + 86_400_000L);
            out.add(w);
        }
        return out;
    }

    /** "straks" schuift door: opnieuw tekenen als een item voorbij is */
    private static void scheduleNext(Context c, List<Item> items) {
        long now = System.currentTimeMillis(), next = Long.MAX_VALUE;
        for (Item it : items) if (it.at > 0 && it.at + 15 * 60_000L > now) next = Math.min(next, it.at + 15 * 60_000L + 30_000L);
        if (next == Long.MAX_VALUE) return;
        c.getSystemService(AlarmManager.class).setAndAllowWhileIdle(AlarmManager.RTC, next,
            Scheduler.firePi(c, "tick", "widget", null, PendingIntent.FLAG_UPDATE_CURRENT));
    }

    /* ---------- tekenen ---------- */
    /** rond icoontje: gekleurde schijf met wit lijn-icoon; bij de machine een witte ring die volloopt */
    private static Bitmap badge(Context c, int color, int icon, float progress) {
        float dp = c.getResources().getDisplayMetrics().density;
        int s = (int) (32 * dp);
        Bitmap b = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        cv.drawCircle(s / 2f, s / 2f, s / 2f, p);
        int pad = (int) (8 * dp);
        if (progress >= 0) {
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(2.6f * dp);
            p.setStrokeCap(Paint.Cap.ROUND);
            RectF r = new RectF(2.4f * dp, 2.4f * dp, s - 2.4f * dp, s - 2.4f * dp);
            p.setColor(0x55FFFFFF);
            cv.drawArc(r, 0, 360, false, p);
            p.setColor(Color.WHITE);
            cv.drawArc(r, -90, Math.max(6f, 360f * Math.min(1f, progress)), false, p);
            pad = (int) (9 * dp);
        }
        Drawable d = ContextCompat.getDrawable(c, icon);
        if (d != null) { d.setBounds(pad, pad, s - pad, s - pad); d.draw(cv); }
        return b;
    }

    /** mode: 0 = enkel icoontjes, 1 = icoon + uur/tijd, 2 = eerstvolgende met titel */
    static RemoteViews build(Context c, List<Item> items, int mode) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_vandaag);
        long now = System.currentTimeMillis();
        int max = mode == 0 ? 4 : mode == 1 ? 3 : 3;
        boolean titled = false;
        for (int i = 0; i < SLOT.length; i++) {
            if (i >= max || i >= items.size()) { v.setViewVisibility(SLOT[i], View.GONE); continue; }
            Item it = items.get(i);
            v.setViewVisibility(SLOT[i], View.VISIBLE);
            float prog = "machine".equals(it.kind) && it.end > it.start ? (float) (now - it.start) / (it.end - it.start) : -1f;
            v.setImageViewBitmap(ICON[i], badge(c, it.color, it.icon, prog));
            v.setOnClickPendingIntent(SLOT[i], Notif.openApp(c, it.go));
            boolean text = mode > 0;
            // pilletje enkel als er tekst naast staat; enkel icoontjes zweven vrij
            v.setInt(SLOT[i], "setBackgroundResource", text ? R.drawable.widget_pill : 0);
            v.setViewPadding(SLOT[i], 0, 0, 0, 0);
            if (text) v.setViewPadding(SLOT[i], dp(c, 4), 0, dp(c, 12), 0);
            if ("machine".equals(it.kind) && text) {
                v.setViewVisibility(CHRONO[i], View.VISIBLE);
                v.setChronometer(CHRONO[i], SystemClock.elapsedRealtime() + (it.end - now), null, true);
                v.setChronometerCountDown(CHRONO[i], true);
                if (mode == 2 && !titled) { v.setViewVisibility(TEXT[i], View.VISIBLE); v.setTextViewText(TEXT[i], "· " + it.title.toLowerCase(new Locale("nl", "BE"))); titled = true; }
                else v.setViewVisibility(TEXT[i], View.GONE);
                continue;
            }
            v.setViewVisibility(CHRONO[i], View.GONE);
            if (!text) { v.setViewVisibility(TEXT[i], View.GONE); continue; }
            String label;
            if ("waste".equals(it.kind)) label = mode == 2 ? "Morgen " + it.title : it.title.split(" \\+ ")[0];
            else if (mode == 2 && !titled) { label = (it.allDay ? "" : it.time + "  ") + it.title; titled = true; }
            else label = it.allDay ? shortTitle(it.title) : it.time;
            v.setViewVisibility(TEXT[i], View.VISIBLE);
            v.setTextViewText(TEXT[i], label);
        }
        return v;
    }

    private static String shortTitle(String t) { return t.length() > 10 ? t.substring(0, 9) + "…" : t; }

    private static int dp(Context c, int v) { return (int) (v * c.getResources().getDisplayMetrics().density); }
}
