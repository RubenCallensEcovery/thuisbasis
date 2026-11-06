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
                "Zet 'Alarmen en herinneringen' aan voor Thuisbasis, zodat je alarmen exact op tijd afgaan.",
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
