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
    private static java.lang.ref.WeakReference<ThuisPlugin> current = new java.lang.ref.WeakReference<>(null);
    private static volatile String pendingGo = null;
    private volatile boolean loaded = false;

    /** tik op een melding: naar de juiste plek in de app (zelfde 'go' als bij de webapp) */
    static void go(String g) {
        if (g == null || g.isEmpty()) return;
        pendingGo = g;
        ThuisPlugin p = current.get();
        if (p != null && p.loaded) p.getActivity().runOnUiThread(p::runGo);
    }

    private void runGo() {
        String g = pendingGo;
        if (g == null || bridge == null || bridge.getWebView() == null) return;
        pendingGo = null;
        String q = org.json.JSONObject.quote(g);
        bridge.getWebView().evaluateJavascript(
            "(function(g){var n=0;(function t(){if(typeof goWhenReady==='function'){goWhenReady(g);}" +
            "else if(n++<40){setTimeout(t,250);}else{location.replace(location.pathname+'#go='+encodeURIComponent(g));location.reload();}})();})(" + q + ")", null);
    }

    @Override
    public void load() {
        Notif.channels(getContext());
        current = new java.lang.ref.WeakReference<>(this);
        // eigen kanaal pagina → Android (werkt ook als de Capacitor-brug niet in de pagina zit)
        bridge.getWebView().addJavascriptInterface(new NativeApi(getContext()), "ThuisNative");
        fetchPushToken(getContext());
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                inject(webView);
                loaded = true;
                runGo();
            }
        });
    }

    /** Firebase-pushcode ophalen en bewaren (de pagina schrijft ze weg in push_subs) */
    static void fetchPushToken(android.content.Context ctx) {
        final android.content.Context c = ctx.getApplicationContext();
        try {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken().addOnCompleteListener(t -> {
                if (t.isSuccessful() && t.getResult() != null) { Store.str(c, "fcm", t.getResult()); Store.str(c, "diag_fcmerr", ""); }
                else Store.str(c, "diag_fcmerr", String.valueOf(t.getException()));
            });
        } catch (Throwable e) {
            Store.str(c, "diag_fcmerr", "Firebase niet beschikbaar: " + e.getClass().getSimpleName());
        }
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        // bij terugkeren: koppelscript opnieuw aanbieden (doet niets als het al draait)
        if (loaded && bridge != null && bridge.getWebView() != null) inject(bridge.getWebView());
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
        Scheduler.plan(getContext(), alarms, timers);
        Store.str(getContext(), "url", conn.getString("url", ""));
        Store.str(getContext(), "apikey", conn.getString("key", ""));
        Store.str(getContext(), "token", conn.getString("token", ""));
        Store.str(getContext(), "pfx", conn.getString("pfx", ""));
        Remote.flush(getContext());
        call.resolve(status());
    }

    /** Firebase-pushcode van dit toestel (leeg als push niet ingebouwd is) */
    @PluginMethod
    public void pushToken(PluginCall call) {
        try {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken().addOnCompleteListener(t -> {
                JSObject r = new JSObject();
                r.put("token", t.isSuccessful() && t.getResult() != null ? t.getResult() : "");
                call.resolve(r);
            });
        } catch (Exception e) {
            JSObject r = new JSObject();
            r.put("token", "");
            call.resolve(r);
        }
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
