package cn.lizmt.cpuweb.schedule;

import android.content.Context;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * The clock the schedule widgets draw by. It is the system clock, except in a debug build
 * started with `--es debugWidgetNow 2026-11-11T10:20`: the widgets and their previews then
 * run from that moment, so a class that is on, or about to start, can be looked at on demand.
 */
final class ScheduleWidgetClock {
    private static final String PREFS = "schedule_widget";
    private static final String KEY = "debug_clock_offset";
    private static volatile long offset;
    private static volatile boolean loaded;

    private ScheduleWidgetClock() {
    }

    static long millis() {
        return System.currentTimeMillis() + offset;
    }

    /** A moment on the widgets' clock as the system clock has it, for setting alarms. */
    static long toSystem(long millis) {
        return millis - offset;
    }

    /** Reads the pinned moment once per process; a release build has none. */
    static void load(Context context) {
        if (loaded || !BuildConfig.DEBUG) return;
        offset = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY, 0L);
        loaded = true;
    }

    /** `value` is "yyyy-MM-ddTHH:mm" or "yyyy-MM-ddTHH:mm:ss" (a space works too); null or unreadable returns to the system clock. */
    static void pin(Context context, String value) {
        if (!BuildConfig.DEBUG) return;
        long next = 0L;
        if (value != null) {
            for (String pattern : new String[]{"yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm"}) {
                try {
                    Date date = new SimpleDateFormat(pattern, Locale.US).parse(value.trim().replace('T', ' '));
                    if (date != null) {
                        next = date.getTime() - System.currentTimeMillis();
                        break;
                    }
                } catch (Exception ignored) { /* Try the next pattern. */ }
            }
        }
        offset = next;
        loaded = true;
        context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(KEY, next).apply();
    }
}
