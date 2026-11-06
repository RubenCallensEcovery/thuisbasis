package be.callens.thuisbasis;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Na herstarten, een update of een klokwijziging: alle alarmen opnieuw inplannen. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent in) {
        Notif.channels(c);
        Scheduler.apply(c);
    }
}
