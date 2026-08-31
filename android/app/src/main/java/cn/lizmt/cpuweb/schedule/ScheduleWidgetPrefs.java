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
        SharedPreferences preferences = prefs(context);
        String stored = preferences.getString(KEY_ENDPOINT, "");
        String normalized = ScheduleWidgetEndpoint.normalize(stored);
        if (!normalized.equals(stored)) {
            preferences.edit().putString(KEY_ENDPOINT, normalized).apply();
        }
        return normalized;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
