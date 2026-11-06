package be.callens.thuisbasis;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Kleine opslag op het toestel: geplande alarmen, machines, wat al afging en acties die nog naar de server moeten. */
final class Store {
    private Store() {}

    static SharedPreferences p(Context c) {
        return c.getSharedPreferences("thuis", Context.MODE_PRIVATE);
    }

    static JSONArray arr(Context c, String k) {
        try {
            return new JSONArray(p(c).getString(k, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    static void put(Context c, String k, JSONArray a) {
        p(c).edit().putString(k, a.toString()).apply();
    }

    static String str(Context c, String k) {
        return p(c).getString(k, "");
    }

    static void str(Context c, String k, String v) {
        p(c).edit().putString(k, v == null ? "" : v).apply();
    }

    /* alarmen: [{id, key, at, title, body, kind: "alarm"|"note"}] */
    static JSONArray alarms(Context c) { return arr(c, "alarms"); }
    static void alarms(Context c, JSONArray a) { put(c, "alarms", a); }

    /* machines: [{id, label, start, end}] */
    static JSONArray timers(Context c) { return arr(c, "timers"); }
    static void timers(Context c, JSONArray a) { put(c, "timers", a); }

    static JSONObject find(JSONArray a, String id) {
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && id.equals(o.optString("id"))) return o;
        }
        return null;
    }

    /* wat al afging (alarm-id|tijd, machine-id|start), om dubbels te vermijden */
    static synchronized boolean fired(Context c, String k) {
        JSONArray a = arr(c, "fired");
        for (int i = 0; i < a.length(); i++) if (k.equals(a.optString(i))) return true;
        return false;
    }

    static synchronized void markFired(Context c, String k) {
        if (fired(c, k)) return;
        JSONArray a = arr(c, "fired");
        a.put(k);
        JSONArray out = new JSONArray();
        for (int i = Math.max(0, a.length() - 300); i < a.length(); i++) out.put(a.optString(i));
        put(c, "fired", out);
    }

    /* acties (Gedaan / 10 min later / Stop) die nog naar Supabase moeten: [{col, id, patch}] */
    static synchronized void addPending(Context c, JSONObject o) {
        JSONArray a = arr(c, "pending");
        a.put(o);
        put(c, "pending", a);
    }

    static synchronized JSONArray pending(Context c) { return arr(c, "pending"); }

    static synchronized void removePending(Context c, JSONObject done) {
        JSONArray a = arr(c, "pending"), out = new JSONArray();
        String d = done.toString();
        boolean skipped = false;
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (!skipped && o != null && d.equals(o.toString())) { skipped = true; continue; }
            out.put(o);
        }
        put(c, "pending", out);
    }
}
