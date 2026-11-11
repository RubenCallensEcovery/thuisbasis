package be.callens.thuisbasis;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Pushberichten van de server (functie notify), ook als de app dicht is:
 *  - "plan": de actuele alarmen, herinneringen en machines voor dit gezinslid → meteen exact ingepland
 *  - "msg":  een gewone melding (wat iemand deed, afspraak, afval, voorraad, ochtend)
 */
public class PushService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage m) {
        Map<String, String> d = m.getData();
        String type = d.get("type");
        if ("plan".equals(type)) {
            try {
                JSONArray a = new JSONArray(d.containsKey("alarms") ? d.get("alarms") : "[]"), alarms = new JSONArray();
                for (int i = 0; i < a.length(); i++) {
                    JSONObject x = a.getJSONObject(i);
                    alarms.put(new JSONObject().put("id", x.optString("i")).put("key", x.optString("k")).put("at", x.optLong("a"))
                        .put("kind", "n".equals(x.optString("n")) ? "note" : "alarm").put("title", x.optString("t")).put("body", x.optString("b")));
                }
                JSONArray t = new JSONArray(d.containsKey("timers") ? d.get("timers") : "[]"), timers = new JSONArray();
                for (int i = 0; i < t.length(); i++) {
                    JSONObject x = t.getJSONObject(i);
                    timers.put(new JSONObject().put("id", x.optString("i")).put("label", x.optString("l")).put("start", x.optLong("s")).put("end", x.optLong("e")));
                }
                Notif.channels(this);
                Scheduler.plan(this, alarms, timers);
            } catch (Exception ignored) {}
        } else if ("msg".equals(type)) {
            Notif.channels(this);
            Notif.message(this, d.get("tag"), d.get("title"), d.get("body"), d.get("go"));
        }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        // de app schrijft de nieuwe code bij de volgende start weg (daar is de login nodig)
        Store.str(this, "fcm", token);
    }
}
