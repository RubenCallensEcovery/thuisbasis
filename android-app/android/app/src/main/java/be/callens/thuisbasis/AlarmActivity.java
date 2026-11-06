package be.callens.thuisbasis;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.lang.ref.WeakReference;

/** Volledig scherm bij een alarm, ook op het vergrendelscherm. */
public class AlarmActivity extends Activity {
    private static WeakReference<AlarmActivity> current = new WeakReference<>(null);
    private String id, key, title;

    static void closeAll() {
        AlarmActivity a = current.get();
        if (a != null) a.runOnUiThread(a::finish);
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        current = new WeakReference<>(this);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        build();
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        build();
    }

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private void build() {
        id = getIntent().getStringExtra("id");
        key = getIntent().getStringExtra("key");
        title = getIntent().getStringExtra("title");
        String body = getIntent().getStringExtra("body");
        if (id == null) { finish(); return; }

        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int bg = dark ? Color.parseColor("#121212") : Color.parseColor("#F4F0E6");
        int ink = dark ? Color.parseColor("#F4F0E6") : Color.parseColor("#141414");

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(bg);
        root.setPadding(dp(28), dp(28), dp(28), dp(28));

        TextView ic = new TextView(this);
        ic.setText("⏰");
        ic.setTextSize(72);
        ic.setGravity(Gravity.CENTER);
        root.addView(ic);

        TextView t = new TextView(this);
        t.setText(title);
        t.setTextColor(ink);
        t.setTextSize(30);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setGravity(Gravity.CENTER);
        t.setPadding(0, dp(16), 0, dp(8));
        root.addView(t);

        TextView s = new TextView(this);
        s.setText(body);
        s.setTextColor(ink);
        s.setAlpha(.7f);
        s.setTextSize(18);
        s.setGravity(Gravity.CENTER);
        s.setPadding(0, 0, 0, dp(36));
        root.addView(s);

        root.addView(button("Gedaan", "done", ink, bg, true));
        root.addView(button("10 min later", "snooze", ink, bg, false));
        root.addView(button("Stop", "stop", ink, bg, false));
        setContentView(root);
    }

    private Button button(String label, String act, int ink, int bg, boolean primary) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(20);
        b.setTextColor(primary ? bg : ink);
        b.setBackgroundColor(primary ? ink : Color.TRANSPARENT);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(64));
        lp.topMargin = dp(10);
        b.setLayoutParams(lp);
        b.setOnClickListener(v -> {
            AlarmService.act(this, act, id, key, title);
            finish();
        });
        return b;
    }

    @Override
    protected void onDestroy() {
        if (current.get() == this) current = new WeakReference<>(null);
        super.onDestroy();
    }
}
