package be.callens.thuisbasis;

import android.Manifest;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static final String GO = "be.callens.thuisbasis.GO";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ThuisPlugin.class);
        super.onCreate(savedInstanceState);
        Notif.channels(this);
        handle(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handle(intent);
    }

    /** snelkoppeling "Proefalarm" (lang drukken op het app-icoon) */
    private void handle(Intent in) {
        if (in != null && GO.equals(in.getAction())) {
            String go = in.getStringExtra("go");
            in.setAction(Intent.ACTION_MAIN);
            ThuisPlugin.go(go);
            return;
        }
        if (in != null && "be.callens.thuisbasis.STATUS".equals(in.getAction())) {
            in.setAction(Intent.ACTION_MAIN);
            showStatus();
            return;
        }
        if (in != null && "be.callens.thuisbasis.PROEF".equals(in.getAction())) {
            in.setAction(Intent.ACTION_MAIN);
            Scheduler.proef(this, 10);
            android.widget.Toast.makeText(this, "Proefalarm over 10 seconden. Vergrendel gerust je gsm.", android.widget.Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        Scheduler.apply(this);
        askNext();
    }

    /** toestemmingen één voor één vragen, elk maar één keer */
    private void askNext() {
        android.content.SharedPreferences p = Store.p(this);
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            if (!p.getBoolean("asked_notif", false)) {
                p.edit().putBoolean("asked_notif", true).apply();
                ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7);
            }
            return;
        }
        if (!Scheduler.exactAllowed(this) && !p.getBoolean("asked_exact", false) && Build.VERSION.SDK_INT >= 31) {
            p.edit().putBoolean("asked_exact", true).apply();
            explain("Alarmen op het juiste moment",
                "Zet 'Alarmen en herinneringen' aan voor Planner, zodat je alarmen exact op tijd afgaan.",
                new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName())));
            return;
        }
        if (Build.VERSION.SDK_INT >= 34 && !getSystemService(NotificationManager.class).canUseFullScreenIntent() && !p.getBoolean("asked_fsi", false)) {
            p.edit().putBoolean("asked_fsi", true).apply();
            explain("Alarm op volledig scherm",
                "Sta 'Meldingen op volledig scherm' toe, zodat een alarm ook op het vergrendelscherm groot verschijnt.",
                new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getPackageName())));
        }
    }

    /** Status: wat werkt er (voor nakijken zonder computer) */
    private void showStatus() {
        ThuisPlugin.fetchPushToken(this);
        String sync = Store.str(this, "diag_sync");
        String when = sync.isEmpty() ? "nog nooit" : new java.text.SimpleDateFormat("dd/MM HH:mm:ss", java.util.Locale.getDefault()).format(new java.util.Date(Long.parseLong(sync)));
        boolean notif = androidx.core.app.NotificationManagerCompat.from(this).areNotificationsEnabled();
        boolean fsi = Build.VERSION.SDK_INT < 34 || getSystemService(NotificationManager.class).canUseFullScreenIntent();
        String ver = "";
        try { ver = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception ignored) {}
        String fcm = Store.str(this, "fcm");
        StringBuilder t = new StringBuilder();
        t.append("Versie: ").append(ver).append("\n\n");
        t.append("Koppeling met de app: ").append(Store.str(this, "diag_script").isEmpty() ? "niet gestart" : Store.str(this, "diag_script")).append("\n");
        t.append("Laden: ").append(Store.str(this, "diag_mode")).append("\n");
        t.append("Pagina: ").append(Store.str(this, "diag_page").isEmpty() ? "?" : Store.str(this, "diag_page")).append("\n");
        t.append("Laatst bijgewerkt: ").append(when).append("\n");
        t.append("Gezinslid: ").append(Store.str(this, "diag_me").isEmpty() ? "?" : Store.str(this, "diag_me")).append("\n");
        t.append("Ingepland: ").append(Store.str(this, "diag_counts").isEmpty() ? "-" : Store.str(this, "diag_counts")).append("\n\n");
        t.append("Pushcode: ").append(fcm.isEmpty() ? "geen" + (Store.str(this, "diag_fcmerr").isEmpty() ? "" : " (" + Store.str(this, "diag_fcmerr") + ")") : "ok").append("\n");
        t.append("Push ingeschreven: ").append(Store.str(this, "diag_push").isEmpty() ? "nog niet" : Store.str(this, "diag_push")).append("\n");
        t.append("Laatste push ontvangen: ").append(Store.str(this, "diag_pushin").isEmpty() ? "nog geen" : Store.str(this, "diag_pushin")).append("\n\n");
        t.append("Meldingen: ").append(notif ? "aan" : "UIT").append("\n");
        t.append("Exacte alarmen: ").append(Scheduler.exactAllowed(this) ? "aan" : "UIT").append("\n");
        t.append("Volledig scherm: ").append(fsi ? "aan" : "UIT").append("\n");
        String err = Store.str(this, "diag_error");
        if (!err.isEmpty()) t.append("\nLaatste fout: ").append(err);
        new AlertDialog.Builder(this)
            .setTitle("Planner — status")
            .setMessage(t.toString())
            .setPositiveButton("Sluiten", null)
            .setNeutralButton("Meldingen-instellingen", (d, w) -> {
                try { startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())); } catch (Exception ignored) {}
            })
            .show();
    }

    private void explain(String title, String msg, Intent go) {
        new AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(msg)
            .setPositiveButton("Instellen", (d, w) -> {
                try { startActivity(go); } catch (Exception ignored) {}
            })
            .setNegativeButton("Later", null)
            .show();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 7) askNext();
    }
}
