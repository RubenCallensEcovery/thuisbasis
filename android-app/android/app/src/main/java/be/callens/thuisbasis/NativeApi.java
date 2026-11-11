package be.callens.thuisbasis;

import android.content.Context;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Rechtstreeks kanaal pagina → Android (window.ThuisNative), los van de Capacitor-brug.
 * Enkel voor het koppelscript: lijst doorgeven, pushcode opvragen, status melden.
 */
final class NativeApi {
    private final Context c;

    NativeApi(Context c) {
        this.c = c.getApplicationContext();
    }

    /** {alarms:[…], timers:[…], conn:{url,key,token,pfx}, me} → plant alles in */
    @JavascriptInterface
    public String sync(String json) {
        // op de achtergrond: de pagina (en dus swipen/scrollen) wacht hier nooit op
        new Thread(() -> doSync(json)).start();
        return "{\"ok\":true}";
    }

    private synchronized void doSync(String json) {
        try {
            JSONObject o = new JSONObject(json);
            JSONObject conn = o.optJSONObject("conn");
            if (conn != null) {
                Store.str(c, "url", conn.optString("url"));
                Store.str(c, "apikey", conn.optString("key"));
                Store.str(c, "token", conn.optString("token"));
                Store.str(c, "pfx", conn.optString("pfx"));
            }
            JSONArray alarms = o.optJSONArray("alarms"), timers = o.optJSONArray("timers");
            Scheduler.plan(c, alarms == null ? new JSONArray() : alarms, timers == null ? new JSONArray() : timers);
            Store.str(c, "diag_sync", String.valueOf(System.currentTimeMillis()));
            Store.str(c, "diag_me", o.optString("me"));
            Store.str(c, "diag_counts", (alarms == null ? 0 : alarms.length()) + " herinneringen/alarmen, " + (timers == null ? 0 : timers.length()) + " machines");
            Remote.flush(c);
        } catch (Exception e) {
            Store.str(c, "diag_error", "sync: " + e);
        }
    }

    /** keuze uit het venster "wie krijgt een alarm?" ({id, who:[...], me}) → bij de machine bewaren */
    @JavascriptInterface
    public void machineAlarm(String json) {
        try {
            JSONObject o = new JSONObject(json);
            JSONArray who = o.optJSONArray("who");
            if (who == null) who = new JSONArray();
            String id = o.optString("id"), me = o.optString("me");
            Store.addPending(c, new JSONObject().put("col", "timers").put("id", id).put("patch", new JSONObject().put("alarmFor", who)));
            boolean mine = false;
            for (int i = 0; i < who.length(); i++) if (me.equals(who.optString(i))) mine = true;
            JSONArray ts = Store.timers(c);
            JSONObject t = Store.find(ts, id);
            if (t != null) { t.put("ring", mine); Store.timers(c, ts); }
            Remote.flush(c);
        } catch (Exception e) {
            Store.str(c, "diag_error", "machine-alarm: " + e);
        }
    }

    /** Firebase-pushcode van dit toestel ("" als die er (nog) niet is) */
    @JavascriptInterface
    public String pushToken() {
        return Store.str(c, "fcm");
    }

    /** status/fout van het koppelscript, voor het Status-scherm */
    @JavascriptInterface
    public void report(String key, String value) {
        if (key == null || !key.matches("[a-z]{1,12}")) return;
        Store.str(c, "diag_" + key, value == null ? "" : value.length() > 300 ? value.substring(0, 300) : value);
    }
}
