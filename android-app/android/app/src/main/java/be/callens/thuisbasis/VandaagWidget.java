package be.callens.thuisbasis;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/** Widget "Vandaag" op het beginscherm: machine die aftelt, afspraken en herinneringen van vandaag, ophaling morgen. */
public class VandaagWidget extends AppWidgetProvider {
    private static final int[] ROWS = { R.id.w_r1, R.id.w_r2, R.id.w_r3, R.id.w_r4, R.id.w_r5, R.id.w_r6 };

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        update(c);
    }

    /** alle widgets bijwerken (na een nieuwe lijst, een machine, middernacht…) */
    static void update(Context c) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            int[] ids = m.getAppWidgetIds(new ComponentName(c, VandaagWidget.class));
            if (ids == null || ids.length == 0) return;
            m.updateAppWidget(ids, build(c));
        } catch (Exception ignored) {}
    }

    private static String fmt(String p, long t) {
        return new SimpleDateFormat(p, new Locale("nl", "BE")).format(new Date(t));
    }

    static RemoteViews build(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_vandaag);
        long now = System.currentTimeMillis();
        String today = fmt("yyyy-MM-dd", now);
        v.setTextViewText(R.id.w_title, "Vandaag · " + fmt("EEE d MMM", now));
        v.setOnClickPendingIntent(R.id.w_root, Notif.openApp(c, "day:" + today));

        // 1. draaiende machine (telt zelf af)
        JSONArray timers = Store.timers(c);
        JSONObject run = null;
        for (int i = 0; i < timers.length(); i++) {
            JSONObject t = timers.optJSONObject(i);
            if (t != null && t.optLong("end") > now && (run == null || t.optLong("end") < run.optLong("end"))) run = t;
        }
        if (run != null) {
            long end = run.optLong("end");
            v.setViewVisibility(R.id.w_machine, View.VISIBLE);
            v.setChronometer(R.id.w_chrono, SystemClock.elapsedRealtime() + (end - now), null, true);
            v.setChronometerCountDown(R.id.w_chrono, true);
            v.setTextViewText(R.id.w_mlabel, run.optString("label", "Machine") + " · klaar om " + fmt("HH:mm", end));
            v.setOnClickPendingIntent(R.id.w_machine, Notif.openApp(c, "k:machines"));
        } else {
            v.setViewVisibility(R.id.w_machine, View.GONE);
        }

        // 2. afspraken (van de server) en herinneringen/alarmen (op dit toestel) van vandaag
        List<Object[]> items = new ArrayList<>(); // {sorteersleutel, tijd, titel, kleur}
        JSONObject day = null;
        try { day = new JSONObject(Store.str(c, "day")); } catch (Exception ignored) {}
        boolean fresh = day != null && today.equals(day.optString("d"));
        if (fresh) {
            JSONArray ev = day.optJSONArray("ev");
            for (int i = 0; ev != null && i < ev.length(); i++) {
                JSONObject e = ev.optJSONObject(i);
                if (e == null) continue;
                int col;
                try { col = Color.parseColor(e.optString("c", "#8A8578")); } catch (Exception x) { col = Color.GRAY; }
                String t = e.optString("t");
                items.add(new Object[] { t.isEmpty() ? "00:00" : t, t, e.optString("n"), col });
            }
        }
        JSONArray alarms = Store.alarms(c);
        for (int i = 0; i < alarms.length(); i++) {
            JSONObject a = alarms.optJSONObject(i);
            if (a == null) continue;
            String id = a.optString("id");
            if (id.startsWith("proef") || id.startsWith("machine:")) continue;
            long at = a.optLong("at");
            if (!today.equals(fmt("yyyy-MM-dd", at))) continue;
            String t = fmt("HH:mm", at);
            items.add(new Object[] { t, t, ("alarm".equals(a.optString("kind")) ? "⏰ " : "🔔 ") + a.optString("title"), 0xFF8A8578 });
        }
        items.sort((x, y) -> ((String) x[0]).compareTo((String) y[0]));

        for (int i = 0; i < ROWS.length; i++) {
            if (i < items.size()) {
                Object[] it = items.get(i);
                SpannableStringBuilder sb = new SpannableStringBuilder();
                sb.append("● ", new ForegroundColorSpan((Integer) it[3]), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                String t = (String) it[1];
                if (!t.isEmpty()) sb.append(t + "  ", new StyleSpan(Typeface.BOLD), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                sb.append((String) it[2]);
                v.setTextViewText(ROWS[i], sb);
                v.setViewVisibility(ROWS[i], View.VISIBLE);
            } else {
                v.setViewVisibility(ROWS[i], View.GONE);
            }
        }
        if (items.isEmpty()) {
            v.setTextViewText(ROWS[0], fresh || run != null ? "Niets gepland vandaag" : "Open Planner om bij te werken");
            v.setViewVisibility(ROWS[0], View.VISIBLE);
        }
        if (items.size() > ROWS.length) {
            v.setTextViewText(R.id.w_more, "+" + (items.size() - ROWS.length) + " meer");
            v.setViewVisibility(R.id.w_more, View.VISIBLE);
        } else {
            v.setViewVisibility(R.id.w_more, View.GONE);
        }

        // 3. ophaling morgen
        String w = fresh ? day.optString("w") : "";
        if (!w.isEmpty()) {
            v.setTextViewText(R.id.w_waste, "Morgen ophaling: " + w);
            v.setViewVisibility(R.id.w_waste, View.VISIBLE);
        } else {
            v.setViewVisibility(R.id.w_waste, View.GONE);
        }
        return v;
    }
}
