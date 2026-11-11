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

    /** popup "wie krijgt een alarm als de machine klaar is?" ({id, label, start, me}) */
    @JavascriptInterface
    public void askMachine(String json) {
        try { ThuisPlugin.askMachine(new JSONObject(json)); } catch (Exception ignored) {}
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
