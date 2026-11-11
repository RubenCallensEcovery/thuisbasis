package be.callens.thuisbasis;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
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
 * Widget "Vandaag" (Bauhaus-stijl van de app): grote datum + weer, machine met voortgangsring,
 * "straks" (eerstvolgende), de rest van de dag met gekleurde balkjes per persoon, ophaling morgen,
 * knoppen voor Jonah en een nieuwe afspraak. Past zich aan de grootte aan.
 */
public class VandaagWidget extends AppWidgetProvider {
    private static final int[] ROW = { R.id.w_row1, R.id.w_row2, R.id.w_row3, R.id.w_row4, R.id.w_row5 };
    private static final int[] BAR = { R.id.w_bar1, R.id.w_bar2, R.id.w_bar3, R.id.w_bar4, R.id.w_bar5 };
    private static final int[] TIME = { R.id.w_time1, R.id.w_time2, R.id.w_time3, R.id.w_time4, R.id.w_time5 };
    private static final int[] TITLE = { R.id.w_title1, R.id.w_title2, R.id.w_title3, R.id.w_title4, R.id.w_title5 };
    private static final int[] CHIP = { R.id.w_chip1, R.id.w_chip2, R.id.w_chip3 };
    /* kleuren van het logo (de vijf vormen) */
    private static final String[] SHAPES = { "●", "■", "▲", "◗", "◆" };
    private static final int[] SHAPE_COL = { 0xFFD7301F, 0xFF1E3A8A, 0xFF2E9D4F, 0xFF1E8FB8, 0xFFE07A1F };

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) { update(c); }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle o) { update(c); }

    /** alle widgets bijwerken (na een nieuwe lijst, een machine, middernacht…) */
    static void update(Context c) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            int[] ids = m.getAppWidgetIds(new ComponentName(c, VandaagWidget.class));
            if (ids == null || ids.length == 0) return;
            Data d = load(c);
            for (int id : ids) {
                if (Build.VERSION.SDK_INT >= 31) {
                    Map<SizeF, RemoteViews> map = new HashMap<>();
                    map.put(new SizeF(150, 110), build(c, d, 0));
                    map.put(new SizeF(250, 140), build(c, d, 1));
                    map.put(new SizeF(250, 250), build(c, d, 2));
                    m.updateAppWidget(id, new RemoteViews(map));
                } else {
                    Bundle o = m.getAppWidgetOptions(id);
                    int h = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 180), w = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250);
                    m.updateAppWidget(id, build(c, d, w < 230 ? 0 : h >= 240 ? 2 : 1));
                }
            }
            scheduleNext(c, d);
        } catch (Exception ignored) {}
    }

    /* ---------- gegevens ---------- */
    static final class Item { String key, time, title, who; int color; boolean allDay; long at; }
    static final class Data {
        long now; String today; JSONObject wx; String waste = ""; boolean fresh;
        List<Item> items = new ArrayList<>(); JSONObject machine;
    }

    private static String fmt(String p, long t) { return new SimpleDateFormat(p, new Locale("nl", "BE")).format(new Date(t)); }

    private static long todayAt(String today, String hhmm) {
        try { return new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).parse(today + " " + hhmm).getTime(); } catch (Exception e) { return 0; }
    }

    static Data load(Context c) {
        Data d = new Data();
        d.now = System.currentTimeMillis();
        d.today = fmt("yyyy-MM-dd", d.now);
        JSONObject day = null;
        try { day = new JSONObject(Store.str(c, "day")); } catch (Exception ignored) {}
        d.fresh = day != null && d.today.equals(day.optString("d"));
        if (d.fresh) {
            d.wx = day.optJSONObject("wx");
            d.waste = day.optString("w");
            JSONArray ev = day.optJSONArray("ev");
            for (int i = 0; ev != null && i < ev.length(); i++) {
                JSONObject e = ev.optJSONObject(i);
                if (e == null) continue;
                Item it = new Item();
                it.time = e.optString("t");
                it.allDay = it.time.isEmpty();
                it.key = it.allDay ? "00:00" : it.time;
                it.at = it.allDay ? 0 : todayAt(d.today, it.time);
                it.title = e.optString("n");
                try { it.color = Color.parseColor(e.optString("c", "#8A8578")); } catch (Exception x) { it.color = 0xFF8A8578; }
                d.items.add(it);
            }
        }
        JSONArray alarms = Store.alarms(c);
        for (int i = 0; i < alarms.length(); i++) {
            JSONObject a = alarms.optJSONObject(i);
            if (a == null) continue;
            String id = a.optString("id");
            if (id.startsWith("proef") || id.startsWith("machine:")) continue;
            long at = a.optLong("at");
            if (!d.today.equals(fmt("yyyy-MM-dd", at))) continue;
            Item it = new Item();
            it.time = fmt("HH:mm", at); it.key = it.time; it.at = at;
            it.title = ("alarm".equals(a.optString("kind")) ? "⏰ " : "🔔 ") + a.optString("title");
            it.color = 0xFFD7301F;
            d.items.add(it);
        }
        d.items.sort((x, y) -> x.key.compareTo(y.key));
        JSONArray timers = Store.timers(c);
        for (int i = 0; i < timers.length(); i++) {
            JSONObject t = timers.optJSONObject(i);
            if (t != null && t.optLong("end") > d.now && (d.machine == null || t.optLong("end") < d.machine.optLong("end"))) d.machine = t;
        }
        return d;
    }

    /** volgende moment waarop de widget iets anders moet tonen ("straks" schuift door) */
    private static void scheduleNext(Context c, Data d) {
        long next = Long.MAX_VALUE;
        for (Item it : d.items) if (!it.allDay && it.at > d.now) next = Math.min(next, it.at + 60_000L);
        if (next == Long.MAX_VALUE) return;
        AlarmManager am = c.getSystemService(AlarmManager.class);
        am.setAndAllowWhileIdle(AlarmManager.RTC, next, Scheduler.firePi(c, "tick", "widget", null, PendingIntent.FLAG_UPDATE_CURRENT));
    }

    /* ---------- tekenen ---------- */
    private static boolean dark(Context c) {
        return (c.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    /** voortgangsring met het wasmachine-icoon in het midden */
    private static Bitmap ring(Context c, float frac) {
        float dp = c.getResources().getDisplayMetrics().density;
        int s = (int) (42 * dp);
        Bitmap b = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        int ink = ContextCompat.getColor(c, R.color.w_ink), accent = ContextCompat.getColor(c, R.color.w_accent);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(4 * dp);
        p.setStrokeCap(Paint.Cap.ROUND);
        RectF r = new RectF(3 * dp, 3 * dp, s - 3 * dp, s - 3 * dp);
        p.setColor((ink & 0x00FFFFFF) | 0x26000000);
        cv.drawArc(r, 0, 360, false, p);
        p.setColor(accent);
        cv.drawArc(r, -90, Math.max(4f, 360f * Math.max(0f, Math.min(1f, frac))), false, p);
        Drawable w = ContextCompat.getDrawable(c, R.drawable.ic_stat_wash);
        if (w != null) {
            w = w.mutate();
            w.setTint(ink);
            int pad = (int) (12 * dp);
            w.setBounds(pad, pad, s - pad, s - pad);
            w.draw(cv);
        }
        return b;
    }

    private static String wxIcon(int code, boolean night) {
        if (code == 0) return night ? "🌙" : "☀️";
        if (code <= 2) return night ? "☁️" : "⛅";
        if (code == 3) return "☁️";
        if (code == 45 || code == 48) return "🌫️";
        if (code >= 51 && code <= 57) return "🌦️";
        if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "🌧️";
        if ((code >= 71 && code <= 77) || code == 85 || code == 86) return "❄️";
        if (code >= 95) return "⛈️";
        return "⛅";
    }

    private static int chipFor(String w) {
        String x = w.toLowerCase(Locale.ROOT);
        if (x.contains("pmd")) return R.drawable.chip_pmd;
        if (x.contains("gft")) return R.drawable.chip_gft;
        if (x.contains("rest")) return R.drawable.chip_rest;
        if (x.contains("papier")) return R.drawable.chip_pk;
        if (x.contains("glas")) return R.drawable.chip_glas;
        return R.drawable.chip_other;
    }

    private static PendingIntent action(Context c, String act, int code) {
        Intent i = new Intent(c, MainActivity.class).setAction(act).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** size: 0 = klein, 1 = middel, 2 = groot */
    static RemoteViews build(Context c, Data d, int size) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_vandaag);
        v.setOnClickPendingIntent(R.id.w_root, Notif.openApp(c, "day:" + d.today));
        v.setOnClickPendingIntent(R.id.w_jonah, action(c, "be.callens.thuisbasis.PRAAT", 41));
        v.setOnClickPendingIntent(R.id.w_add, Notif.openApp(c, "new:" + d.today));

        // kop
        v.setTextViewText(R.id.w_daynum, fmt("d", d.now));
        v.setTextViewText(R.id.w_weekday, fmt("EEEE", d.now).toUpperCase(new Locale("nl", "BE")));
        v.setTextViewText(R.id.w_month, fmt("MMMM", d.now));
        SpannableStringBuilder sh = new SpannableStringBuilder();
        for (int i = 0; i < SHAPES.length; i++) sh.append(SHAPES[i] + " ", new ForegroundColorSpan(SHAPE_COL[i]), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        v.setTextViewText(R.id.w_shapes, sh);
        v.setViewVisibility(R.id.w_shapes, size == 0 ? View.GONE : View.VISIBLE);
        if (d.wx != null) {
            v.setViewVisibility(R.id.w_wxbox, View.VISIBLE);
            v.setTextViewText(R.id.w_wx, wxIcon(d.wx.optInt("c"), d.wx.optInt("n") == 1) + " " + d.wx.optInt("t") + "°");
            String sub = d.wx.optInt("hi") + "° / " + d.wx.optInt("lo") + "°" + (d.wx.optInt("p") >= 20 ? "  💧" + d.wx.optInt("p") + "%" : "");
            v.setTextViewText(R.id.w_wx2, sub);
            v.setViewVisibility(R.id.w_wx2, size == 0 ? View.GONE : View.VISIBLE);
        } else {
            v.setViewVisibility(R.id.w_wxbox, View.GONE);
        }

        // machine
        if (d.machine != null) {
            long start = d.machine.optLong("start"), end = d.machine.optLong("end");
            v.setViewVisibility(R.id.w_machine, View.VISIBLE);
            v.setImageViewBitmap(R.id.w_ring, ring(c, end > start ? (float) (d.now - start) / (end - start) : 0f));
            v.setChronometer(R.id.w_chrono, SystemClock.elapsedRealtime() + (end - d.now), null, true);
            v.setChronometerCountDown(R.id.w_chrono, true);
            v.setTextViewText(R.id.w_mlabel, d.machine.optString("label", "Machine") + " · klaar om " + fmt("HH:mm", end));
            v.setOnClickPendingIntent(R.id.w_machine, Notif.openApp(c, "k:machines"));
        } else {
            v.setViewVisibility(R.id.w_machine, View.GONE);
        }

        // straks: eerstvolgende met een uur (anders de eerste van de dag)
        Item next = null;
        for (Item it : d.items) if (!it.allDay && it.at >= d.now - 10 * 60_000L) { next = it; break; }
        if (next == null && !d.items.isEmpty()) next = d.items.get(0);
        List<Item> rest = new ArrayList<>();
        for (Item it : d.items) if (it != next && (it.allDay || it.at >= d.now - 30 * 60_000L)) rest.add(it);
        boolean showNext = next != null && (size > 0 || d.machine == null);
        if (showNext) {
            v.setViewVisibility(R.id.w_next, View.VISIBLE);
            v.setInt(R.id.w_nextbar, "setColorFilter", next.color);
            String lbl = next.allDay ? "VANDAAG" : next.at <= d.now ? "NU" : "STRAKS";
            v.setTextViewText(R.id.w_nextlbl, lbl);
            v.setTextViewText(R.id.w_nexttxt, (next.allDay ? "" : next.time + "  ") + next.title);
        } else if (d.items.isEmpty() && size > 0) {
            v.setViewVisibility(R.id.w_next, View.VISIBLE);
            v.setInt(R.id.w_nextbar, "setColorFilter", 0xFF2E9D4F);
            v.setTextViewText(R.id.w_nextlbl, d.fresh ? "VANDAAG" : "PLANNER");
            v.setTextViewText(R.id.w_nexttxt, d.fresh ? "Niets gepland. Geniet ervan!" : "Open Planner om bij te werken");
        } else {
            v.setViewVisibility(R.id.w_next, View.GONE);
        }

        // de rest van de dag
        int max = size == 2 ? ROW.length : size == 1 ? (d.machine != null ? 1 : 2) : 0;
        v.setViewVisibility(R.id.w_rows, max > 0 ? View.VISIBLE : View.GONE);
        for (int i = 0; i < ROW.length; i++) {
            if (i < max && i < rest.size()) {
                Item it = rest.get(i);
                v.setViewVisibility(ROW[i], View.VISIBLE);
                v.setInt(BAR[i], "setColorFilter", it.color);
                v.setTextViewText(TIME[i], it.allDay ? "hele dag" : it.time);
                v.setTextViewText(TITLE[i], it.title);
            } else {
                v.setViewVisibility(ROW[i], View.GONE);
            }
        }
        int more = rest.size() - Math.min(max, rest.size());
        if (max > 0 && more > 0) {
            v.setViewVisibility(R.id.w_more, View.VISIBLE);
            v.setTextViewText(R.id.w_more, "+ " + more + " meer vandaag");
        } else {
            v.setViewVisibility(R.id.w_more, View.GONE);
        }

        // ophaling morgen
        String[] parts = d.waste.isEmpty() ? new String[0] : d.waste.split(" \\+ ");
        v.setViewVisibility(R.id.w_wastelbl, parts.length > 0 && size > 0 ? View.VISIBLE : View.GONE);
        for (int i = 0; i < CHIP.length; i++) {
            if (i < parts.length && size > 0) {
                v.setViewVisibility(CHIP[i], View.VISIBLE);
                v.setTextViewText(CHIP[i], parts[i].replace("Papier-karton", "Papier"));
                v.setInt(CHIP[i], "setBackgroundResource", chipFor(parts[i]));
            } else {
                v.setViewVisibility(CHIP[i], View.GONE);
            }
        }
        v.setViewVisibility(R.id.w_add, size == 0 ? View.GONE : View.VISIBLE);
        return v;
    }
}
