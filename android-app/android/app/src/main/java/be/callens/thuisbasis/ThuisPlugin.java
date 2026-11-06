package be.callens.thuisbasis;

import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.WebView;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;

/**
 * Brug tussen de pagina en Android. De pagina zelf (de webapp) blijft ongewijzigd:
 * het koppelscript (assets/thuis-app.js) wordt enkel in deze app in de pagina geladen.
 */
@CapacitorPlugin(name = "Thuis")
public class ThuisPlugin extends Plugin {
    private String script;

    @Override
    public void load() {
        Notif.channels(getContext());
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                inject(webView);
            }
        });
    }

    private void inject(WebView w) {
        try {
            if (script == null) {
                try (InputStream in = getContext().getAssets().open("thuis-app.js")) {
                    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                    script = out.toString("UTF-8");
                }
            }
            w.evaluateJavascript(script, null);
        } catch (Exception ignored) {}
    }

    /** de app geeft de actuele alarmen, herinneringen en machines voor dit gezinslid door */
    @PluginMethod
    public void sync(PluginCall call) {
        JSArray alarms = call.getArray("alarms", new JSArray());
        JSArray timers = call.getArray("timers", new JSArray());
        JSObject conn = call.getObject("conn", new JSObject());
        // proefalarmen bestaan enkel op dit toestel: bewaren
        org.json.JSONArray old = Store.alarms(getContext());
        for (int i = 0; i < old.length(); i++) {
            org.json.JSONObject o = old.optJSONObject(i);
            if (o != null && o.optString("id").startsWith("proef") && o.optLong("at") > System.currentTimeMillis() - 10 * 60_000L) alarms.put(o);
        }
        Store.alarms(getContext(), alarms);
        Store.timers(getContext(), timers);
        Store.str(getContext(), "url", conn.getString("url", ""));
        Store.str(getContext(), "apikey", conn.getString("key", ""));
        Store.str(getContext(), "token", conn.getString("token", ""));
        Store.str(getContext(), "pfx", conn.getString("pfx", ""));
        Scheduler.apply(getContext());
        AlarmService.stopIfGone(getContext());
        Remote.flush(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void info(PluginCall call) {
        call.resolve(status());
    }

    private JSObject status() {
        JSObject r = new JSObject();
        r.put("notifications", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        r.put("exact", Scheduler.exactAllowed(getContext()));
        boolean fsi = true;
        if (Build.VERSION.SDK_INT >= 34) fsi = getContext().getSystemService(NotificationManager.class).canUseFullScreenIntent();
        r.put("fullScreen", fsi);
        r.put("pending", Store.pending(getContext()).length());
        try {
            r.put("version", getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName);
        } catch (Exception ignored) {}
        return r;
    }

    /** systeeminstellingen openen: "notifications", "exact", "fullScreen", "channel:<id>" */
    @PluginMethod
    public void openSettings(PluginCall call) {
        String what = call.getString("what", "notifications");
        String pkg = getContext().getPackageName();
        Intent i;
        if ("exact".equals(what) && Build.VERSION.SDK_INT >= 31) {
            i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + pkg));
        } else if ("fullScreen".equals(what) && Build.VERSION.SDK_INT >= 34) {
            i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + pkg));
        } else if (what.startsWith("channel:") && Build.VERSION.SDK_INT >= 26) {
            i = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, pkg).putExtra(Settings.EXTRA_CHANNEL_ID, what.substring(8));
        } else {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
        }
        try {
            getActivity().startActivity(i);
        } catch (Exception e) {
            getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg)));
        }
        call.resolve();
    }

    /** proefalarm binnen x seconden (standaard 5) */
    @PluginMethod
    public void testAlarm(PluginCall call) {
        int sec = call.getInt("seconds", 5);
        Scheduler.proef(getContext(), sec);
        call.resolve(status());
    }
}
