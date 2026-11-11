package be.callens.thuisbasis;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONObject;

/** Rinkelt een alarm: eigen beltoon op het alarmvolume (werkt ook als de gsm op stil staat), trilt, tot je stopt. */
public class AlarmService extends Service {
    static final String RING = "be.callens.thuisbasis.RING";
    static final long MAX_RING_MS = 3 * 60_000L;

    static volatile String ringingId = null;
    private static volatile String ringingKey = null, ringingTitle = null;

    private MediaPlayer player;
    private Vibrator vib;
    private PowerManager.WakeLock wake;
    private final Handler h = new Handler(Looper.getMainLooper());
    private final Runnable timeout = () -> {
        // niemand reageerde: stil maken en een "gemist"-melding laten staan
        if (ringingId != null) Notif.missed(this, ringingId, ringingKey, ringingTitle);
        stopSelf();
    };

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent in, int flags, int startId) {
        if (in == null || !RING.equals(in.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String id = in.getStringExtra("id"), key = in.getStringExtra("key");
        String title = in.getStringExtra("title"), body = in.getStringExtra("body");
        if (ringingId != null && !ringingId.equals(id)) Notif.missed(this, ringingId, ringingKey, ringingTitle);
        ringingId = id; ringingKey = key; ringingTitle = title;

        android.app.Notification n = Notif.alarm(this, id, key, title, body);
        if (Build.VERSION.SDK_INT >= 29) startForeground(Notif.ID_ALARM, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(Notif.ID_ALARM, n);

        PowerManager pm = getSystemService(PowerManager.class);
        if (wake == null) {
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "thuisbasis:alarm");
            wake.acquire(MAX_RING_MS + 10_000L);
        }
        // scherm tonen als de gsm in gebruik is (op het vergrendelscherm doet de melding dat zelf)
        if (pm.isInteractive()) {
            try { startActivity(Notif.screen(this, id, key, title, body)); } catch (Exception ignored) {}
        }
        ring();
        h.removeCallbacks(timeout);
        h.postDelayed(timeout, MAX_RING_MS);
        return START_NOT_STICKY;
    }

    private void ring() {
        quiet();
        AudioAttributes aa = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(aa);
            player.setDataSource(this, Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.thuis_alarm));
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            player = null;
        }
        vib = getSystemService(Vibrator.class);
        if (vib != null && vib.hasVibrator()) {
            long[] p = {0, 500, 300, 500, 300, 800, 1200};
            vib.vibrate(VibrationEffect.createWaveform(p, 0), aa);
        }
    }

    private void quiet() {
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) {}
            player.release();
            player = null;
        }
        if (vib != null) vib.cancel();
    }

    @Override
    public void onDestroy() {
        h.removeCallbacks(timeout);
        quiet();
        if (wake != null && wake.isHeld()) wake.release();
        ringingId = null;
        AlarmActivity.closeAll();
        super.onDestroy();
    }

    static String keyOf(long t) {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(new Date(t));
    }

    /** knop Gedaan / 10 min later / Stop (uit de melding of het alarmscherm) */
    static void act(Context c, String act, String id, String key, String title) {
        if (id == null) return;
        if (id.equals(ringingId) || ringingId == null) c.stopService(new Intent(c, AlarmService.class));
        Notif.cancel(c, ("g" + id).hashCode());
        if (key != null) Store.markFired(c, "alarm|" + id + "|" + key);
        long now = System.currentTimeMillis();
        if (id.startsWith("machine:")) {
            // machine klaar: enkel op dit toestel; "10 min later" = over 10 minuten nog eens
            if ("snooze".equals(act)) {
                long at = (now + 10 * 60_000L) / 60_000L * 60_000L;
                Scheduler.snooze(c, id, title == null ? "Machine is klaar" : title, keyOf(at), at);
            }
            return;
        }
        if (id.startsWith("proef")) {
            if ("snooze".equals(act)) Scheduler.snooze(c, id, "Proefalarm", keyOf(now + 60_000L), now + 60_000L);
            return;
        }
        try {
            JSONObject patch = new JSONObject();
            if ("done".equals(act)) {
                patch.put("done", true).put("doneAt", now).put("ack", key);
            } else if ("snooze".equals(act)) {
                long at = (now + 10 * 60_000L) / 60_000L * 60_000L;
                String nk = keyOf(at);
                patch.put("snooze", nk).put("ack", key);
                Scheduler.snooze(c, id, title == null ? "Alarm" : title, nk, at);
            } else {
                patch.put("ack", key);
            }
            Store.addPending(c, new JSONObject().put("col", "reminders").put("id", id).put("patch", patch));
        } catch (Exception ignored) {}
        Remote.flush(c);
    }

    /** de app meldt dat een alarm intussen elders gestopt/gedaan is */
    static void stopIfGone(Context c) {
        String id = ringingId;
        if (id == null) return;
        JSONObject cur = Store.find(Store.alarms(c), id);
        if (cur == null || !cur.optString("key").equals(ringingKey)) c.stopService(new Intent(c, AlarmService.class));
    }
}
