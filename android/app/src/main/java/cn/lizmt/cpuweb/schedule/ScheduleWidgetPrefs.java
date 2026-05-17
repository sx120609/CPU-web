package cn.lizmt.cpuweb.schedule;

import android.content.Context;
import android.content.SharedPreferences;

final class ScheduleWidgetPrefs {
    private static final String PREFS = "schedule_widget";
    private static final String KEY_ENDPOINT = "endpoint";

    private ScheduleWidgetPrefs() {
    }

    static void saveEndpoint(Context context, String endpoint) {
        prefs(context).edit().putString(KEY_ENDPOINT, endpoint).apply();
    }

    static String endpoint(Context context) {
        return prefs(context).getString(KEY_ENDPOINT, "");
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
