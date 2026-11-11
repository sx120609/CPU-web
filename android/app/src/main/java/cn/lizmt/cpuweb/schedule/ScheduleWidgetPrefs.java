package cn.lizmt.cpuweb.schedule;

import android.content.Context;
import android.content.SharedPreferences;

final class ScheduleWidgetPrefs {
    private static final String PREFS = "schedule_widget";
    private static final String KEY_ENDPOINT = "endpoint";
    private static final String KEY_THEME = "theme";
    private static final String KEY_ACCOUNT = "account_fingerprint";
    /** 小组件风格: empty follows the timetable's style. */
    private static final String KEY_STYLE = "style";
    /** 文字底色: how much of the widget's own colour covers the photo, 0.2–0.9. */
    private static final String KEY_VEIL = "photo_veil";
    static final String PHOTO_FILE = "widget-background.jpg";

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

    /** 课表主题（和网页端、iOS 同名的九套之一）。返回是否有变化。 */
    static boolean saveTheme(Context context, String theme) {
        String normalized = ScheduleWidgetPalette.normalizeTheme(theme);
        if (normalized.equals(theme(context))) return false;
        prefs(context).edit().putString(KEY_THEME, normalized).apply();
        return true;
    }

    static String theme(Context context) {
        return ScheduleWidgetPalette.normalizeTheme(prefs(context).getString(KEY_THEME, ScheduleWidgetPalette.DEFAULT_THEME));
    }

    /** SHA-256 of the account the widget data belongs to; never the account itself. */
    static String accountFingerprint(Context context) {
        return prefs(context).getString(KEY_ACCOUNT, "");
    }

    static void saveAccountFingerprint(Context context, String fingerprint) {
        prefs(context).edit().putString(KEY_ACCOUNT, fingerprint == null ? "" : fingerprint).apply();
    }

    /** Sign-out or a different account: drop the subscription and its owner. */
    static void clearAccount(Context context) {
        prefs(context).edit().remove(KEY_ENDPOINT).remove(KEY_ACCOUNT).apply();
    }

    /** The style chosen for the widgets, or "" to follow the timetable. */
    static String styleChoice(Context context) {
        return prefs(context).getString(KEY_STYLE, "");
    }

    static void saveStyle(Context context, String style) {
        prefs(context).edit().putString(KEY_STYLE, style == null ? "" : style).apply();
    }

    /** The style the widgets draw in: their own choice, else the timetable's (classic, grid and minimal draw alike). */
    static String style(Context context) {
        String chosen = styleChoice(context);
        if (!chosen.isEmpty()) return chosen;
        return context.getApplicationContext().getSharedPreferences("native_schedule_style", Context.MODE_PRIVATE)
                .getString("visualStyle", "classic");
    }

    static float veil(Context context) {
        return Math.max(0.2f, Math.min(0.9f, prefs(context).getFloat(KEY_VEIL, 0.55f)));
    }

    static void saveVeil(Context context, float veil) {
        prefs(context).edit().putFloat(KEY_VEIL, veil).apply();
    }

    static java.io.File photoFile(Context context) {
        return new java.io.File(context.getApplicationContext().getFilesDir(), PHOTO_FILE);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
