package be.callens.thuisbasis;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Alle meldingen van de app. */
final class Notif {
    private Notif() {}

    static final String CH_ALARM = "alarm";
    static final String CH_NOTE = "herinnering";
    static final String CH_MACHINE = "machine_loopt"; // vroeger "machine" (stil, niet op vergrendelscherm)
    static final String CH_KLAAR = "klaar";
    static final String CH_GEMIST = "gemist";
    static final String CH_MSG = "meldingen";
    static final int ID_ALARM = 1001;

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        // alarm: het geluid komt van de alarmdienst zelf (alarmvolume, ook als de gsm op stil staat)
        NotificationChannel a = new NotificationChannel(CH_ALARM, "Alarmen", NotificationManager.IMPORTANCE_HIGH);
        a.setDescription("Herinneringen met alarm: rinkelt tot je stopt");
        a.setSound(null, null);
        a.enableVibration(false);
        a.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        a.setBypassDnd(true);
        nm.createNotificationChannel(a);

        NotificationChannel n = new NotificationChannel(CH_NOTE, "Herinneringen", NotificationManager.IMPORTANCE_HIGH);
        n.setDescription("Gewone herinneringen zonder alarm");
        nm.createNotificationChannel(n);

        // zichtbaar in de statusbalk en op het vergrendelscherm, maar zonder geluid of trillen
        nm.deleteNotificationChannel("machine");
        NotificationChannel m = new NotificationChannel(CH_MACHINE, "Machine draait", NotificationManager.IMPORTANCE_DEFAULT);
        m.setDescription("Blijvende melding die aftelt tot de was- of droogmachine klaar is");
        m.setSound(null, null);
        m.enableVibration(false);
        m.setShowBadge(false);
        m.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(m);

        NotificationChannel k = new NotificationChannel(CH_KLAAR, "Machine klaar", NotificationManager.IMPORTANCE_HIGH);
        k.setDescription("Als de machine klaar is");
        k.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
            new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
        nm.createNotificationChannel(k);

        NotificationChannel b = new NotificationChannel(CH_MSG, "Meldingen", NotificationManager.IMPORTANCE_HIGH);
        b.setDescription("Wat anderen deden, afspraken, afval, voorraad en de ochtendmelding");
        nm.createNotificationChannel(b);

        NotificationChannel g = new NotificationChannel(CH_GEMIST, "Gemiste alarmen", NotificationManager.IMPORTANCE_DEFAULT);
        nm.createNotificationChannel(g);
    }

    static int flags() {
        return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    }

    static PendingIntent openApp(Context c) {
        return openApp(c, null);
    }

    /** app openen, en met 'go' meteen naar de juiste plek (rem:<id> | ev:<id>:<datum> | day:<datum> | k:<scherm>) */
    static PendingIntent openApp(Context c, String go) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (go != null && !go.isEmpty()) {
            i.setAction(MainActivity.GO).setData(Uri.parse("thuis://go/" + Uri.encode(go))).putExtra("go", go);
            return PendingIntent.getActivity(c, ("go" + go).hashCode(), i, flags());
        }
        return PendingIntent.getActivity(c, 0, i, flags());
    }

    static PendingIntent action(Context c, String act, String id, String key, String title) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(AlarmReceiver.ACT)
            .setData(Uri.parse("thuis://actie/" + act + "/" + Uri.encode(id)))
            .putExtra("act", act).putExtra("id", id).putExtra("key", key).putExtra("title", title);
        return PendingIntent.getBroadcast(c, (act + id).hashCode(), i, flags());
    }

    static Intent screen(Context c, String id, String key, String title, String body) {
        return new Intent(c, AlarmActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION)
            .putExtra("id", id).putExtra("key", key).putExtra("title", title).putExtra("body", body);
    }

    /** melding van een rinkelend alarm (hoort bij de alarmdienst) */
    static Notification alarm(Context c, String id, String key, String title, String body) {
        PendingIntent full = PendingIntent.getActivity(c, 1, screen(c, id, key, title, body), flags());
        return new NotificationCompat.Builder(c, CH_ALARM)
            .setSmallIcon(R.drawable.ic_stat_bell)
            .setContentTitle("⏰ " + title)
            .setContentText(body)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setFullScreenIntent(full, true)
            .setContentIntent(full)
            .addAction(0, "Gedaan", action(c, "done", id, key, title))
            .addAction(0, "10 min later", action(c, "snooze", id, key, title))
            .addAction(0, "Stop", action(c, "stop", id, key, title))
            .build();
    }

    static void missed(Context c, String id, String key, String title) {
        Notification n = new NotificationCompat.Builder(c, CH_GEMIST)
            .setSmallIcon(R.drawable.ic_stat_bell)
            .setContentTitle("Gemist alarm")
            .setContentText(title)
            .setAutoCancel(true)
            .setContentIntent(openApp(c, "rem:" + id))
            .addAction(0, "Gedaan", action(c, "done", id, key, title))
            .addAction(0, "10 min later", action(c, "snooze", id, key, title))
            .build();
        show(c, ("g" + id).hashCode(), n);
    }

    static void note(Context c, String id, String title, String body) {
        Notification n = new NotificationCompat.Builder(c, CH_NOTE)
            .setSmallIcon(R.drawable.ic_stat_bell)
            .setContentTitle("Herinnering")
            .setContentText(title)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(title + (body == null || body.isEmpty() ? "" : "\n" + body)))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(openApp(c, "rem:" + id))
            .build();
        show(c, ("r" + id).hashCode(), n);
    }

    /** gewone melding van de server; zelfde 'tag' vervangt de vorige */
    static void message(Context c, String tag, String title, String body, String go) {
        if (title == null) title = "Planner";
        if (body == null) body = "";
        Notification n = new NotificationCompat.Builder(c, CH_MSG)
            .setSmallIcon(R.drawable.ic_stat_thuis)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(openApp(c, go))
            .build();
        int id = tag != null && !tag.isEmpty() ? ("s" + tag).hashCode() : (int) (System.currentTimeMillis() % 1_000_000_000L);
        show(c, id, n);
    }

    /** vector-icoon als bitmap (groot icoon in de melding) */
    static android.graphics.Bitmap bitmap(Context c, int res) {
        try {
            android.graphics.drawable.Drawable d = androidx.core.content.ContextCompat.getDrawable(c, res);
            int px = (int) (64 * c.getResources().getDisplayMetrics().density);
            android.graphics.Bitmap b = android.graphics.Bitmap.createBitmap(px, px, android.graphics.Bitmap.Config.ARGB_8888);
            android.graphics.Canvas cv = new android.graphics.Canvas(b);
            d.setBounds(0, 0, px, px);
            d.draw(cv);
            return b;
        } catch (Exception e) {
            return null;
        }
    }

    static String hhmm(long t) {
        return new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date(t));
    }

    /** draaiende machine: blijvende melding die zelf aftelt */
    static void running(Context c, String id, String label, long start, long end) {
        int max = (int) Math.max(1, (end - start) / 60000), done = (int) Math.max(0, Math.min(max, (System.currentTimeMillis() - start) / 60000));
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_MACHINE)
            .setSmallIcon(R.drawable.ic_stat_wash)
            .setLargeIcon(bitmap(c, R.drawable.ic_large_wash))
            .setContentTitle(label + " draait")
            .setContentText("Klaar om " + hhmm(end))
            .setWhen(end)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setProgress(max, done, false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setContentIntent(openApp(c, "k:machines"));
        // Android 16+: als "live update" (aftellend chipje in de statusbalk en groot op het vergrendelscherm)
        b.getExtras().putBoolean("android.requestPromotedOngoing", true);
        b.getExtras().putCharSequence("android.shortCriticalText", hhmm(end));
        Notification n = b.build();
        show(c, ("m" + id).hashCode(), n);
    }

    static void machineDone(Context c, String id, String label) {
        Notification n = new NotificationCompat.Builder(c, CH_KLAAR)
            .setSmallIcon(R.drawable.ic_stat_wash)
            .setLargeIcon(bitmap(c, R.drawable.ic_large_wash))
            .setContentTitle(label + " is klaar")
            .setContentText("Tijd om uit te halen.")
            .setAutoCancel(true)
            .setContentIntent(openApp(c, "k:machines"))
            .build();
        show(c, ("m" + id).hashCode(), n);
    }

    static void cancel(Context c, int id) {
        NotificationManagerCompat.from(c).cancel(id);
    }

    static void show(Context c, int id, Notification n) {
        try {
            NotificationManagerCompat.from(c).notify(id, n);
        } catch (SecurityException e) {
            // geen toestemming voor meldingen
        }
    }
}
