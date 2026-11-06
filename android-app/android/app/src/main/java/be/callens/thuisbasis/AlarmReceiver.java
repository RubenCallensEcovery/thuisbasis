package be.callens.thuisbasis;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;
import org.json.JSONObject;

/** Ontvangt: een alarm/herinnering/machine die nu afgaat, en de knoppen in de meldingen. */
public class AlarmReceiver extends BroadcastReceiver {
    static final String FIRE = "be.callens.thuisbasis.FIRE";
    static final String ACT = "be.callens.thuisbasis.ACT";

    @Override
    public void onReceive(Context c, Intent in) {
        String action = in.getAction();
        if (ACT.equals(action)) {
            AlarmService.act(c, in.getStringExtra("act"), in.getStringExtra("id"), in.getStringExtra("key"), in.getStringExtra("title"));
            return;
        }
        if (!FIRE.equals(action)) return;
        String kind = in.getStringExtra("kind"), id = in.getStringExtra("id");
        JSONObject o;
        try {
            o = new JSONObject(in.getStringExtra("json"));
        } catch (Exception e) {
            o = new JSONObject();
        }
        if ("machine".equals(kind)) {
            // enkel als de machine nog in de lijst staat (niet intussen leeggehaald)
            JSONObject t = Store.find(Store.timers(c), id);
            if (t == null) return;
            String fk = "machine|" + id + "|" + t.optLong("start");
            if (Store.fired(c, fk)) return;
            Store.markFired(c, fk);
            Notif.machineDone(c, id, t.optString("label", "Machine"));
            return;
        }
        // alarm of herinnering: kijk of het nog actueel is (niet intussen gedaan of verschoven)
        JSONObject cur = Store.find(Store.alarms(c), id);
        if (cur == null) return;
        String key = cur.optString("key");
        String fk = kind + "|" + id + "|" + key;
        if (Store.fired(c, fk)) return;
        if (Math.abs(cur.optLong("at") - System.currentTimeMillis()) > Scheduler.LATE_MS + 60_000L) {
            Scheduler.apply(c); // tijd veranderd: opnieuw inplannen
            return;
        }
        Store.markFired(c, fk);
        String title = cur.optString("title", o.optString("title", "Herinnering"));
        String body = cur.optString("body", "");
        if ("note".equals(kind)) {
            Notif.note(c, id, title, body);
            return;
        }
        Intent s = new Intent(c, AlarmService.class).setAction(AlarmService.RING)
            .putExtra("id", id).putExtra("key", key).putExtra("title", title).putExtra("body", body);
        try {
            ContextCompat.startForegroundService(c, s);
        } catch (Exception e) {
            // starten van de dienst mislukt (zou niet mogen bij een exact alarm): toon minstens het scherm/de melding
            Notif.show(c, Notif.ID_ALARM, Notif.alarm(c, id, key, title, body));
        }
    }
}
