package be.callens.thuisbasis;

import android.content.Context;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Stuurt acties (Gedaan / 10 min later / Stop) naar Supabase, met de sessie die de app laatst doorgaf.
 * Lukt het niet (geen netwerk, sessie verlopen), dan blijft de actie bewaard en gaat ze mee bij de volgende keer.
 * Gebruikt enkel het toegangsbewijs, nooit het vernieuwingsbewijs: zo blijft de sessie van de app ongemoeid.
 */
final class Remote {
    private Remote() {}

    static void flush(Context ctx) {
        final Context c = ctx.getApplicationContext();
        new Thread(() -> {
            synchronized (Remote.class) {
                String url = Store.str(c, "url"), key = Store.str(c, "apikey"), token = Store.str(c, "token"), pfx = Store.str(c, "pfx");
                if (url.isEmpty() || key.isEmpty() || token.isEmpty()) return;
                JSONArray todo = Store.pending(c);
                for (int i = 0; i < todo.length(); i++) {
                    JSONObject o = todo.optJSONObject(i);
                    if (o == null) continue;
                    try {
                        JSONObject body = new JSONObject()
                            .put("p_col", pfx + o.optString("col"))
                            .put("p_id", o.optString("id"))
                            .put("p_patch", o.optJSONObject("patch"));
                        HttpURLConnection h = (HttpURLConnection) new URL(url + "/rest/v1/rpc/doc_merge").openConnection();
                        h.setRequestMethod("POST");
                        h.setConnectTimeout(15000);
                        h.setReadTimeout(15000);
                        h.setDoOutput(true);
                        h.setRequestProperty("apikey", key);
                        h.setRequestProperty("Authorization", "Bearer " + token);
                        h.setRequestProperty("Content-Type", "application/json");
                        try (OutputStream os = h.getOutputStream()) {
                            os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                        }
                        int code = h.getResponseCode();
                        h.disconnect();
                        if (code >= 200 && code < 300) Store.removePending(c, o);
                        else if (code == 401 || code == 403) return; // sessie verlopen: later opnieuw
                    } catch (Exception e) {
                        return; // geen netwerk: later opnieuw
                    }
                }
            }
        }).start();
    }
}
