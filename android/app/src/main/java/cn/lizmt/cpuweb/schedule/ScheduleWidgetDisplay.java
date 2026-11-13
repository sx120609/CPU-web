package cn.lizmt.cpuweb.schedule;

import android.content.Context;

import org.json.JSONObject;

/**
 * What every schedule widget shows, set once in the app (课表 › 更多 › 桌面课表小组件): the
 * counterpart of the fields iOS added to ScheduleWidgetDisplayOptions in 350e5e1c. A setting
 * saved by an older version lacks them and reads as the defaults.
 */
public final class ScheduleWidgetDisplay {
    public static final String AUTO = "auto";
    public static final String SMALL = "small";
    public static final String STANDARD = "standard";
    public static final String LARGE = "large";
    /** 「距上课」 appears this long before a class; a refresh is set for that moment. */
    static final int COUNTDOWN_LEAD_MINUTES = 60;
    private static final String PREFS = "schedule_widget";
    private static final String KEY = "display";

    /** 文字大小: auto, small, standard or large. An instance may choose its own. */
    public String textSize = STANDARD;
    /** 日期栏右边的「第 N 周」。 */
    public boolean showWeek = true;
    /** 时间线上长课间的「休息 N 分钟」。 */
    public boolean showBreaks = true;
    /** 正在上的课带一条进度，「当前 / 下一节」旁边是「距下课」「距上课」的倒计时。 */
    public boolean showProgress = true;
    /** 今天已经上完的课不再灰着留在列表里。 */
    public boolean hideCompleted = false;
    /** 最近的法定假期常驻在中号、大号的日期栏里（「距元旦还有 49 天」）。 */
    public boolean holidayAlwaysVisible = true;

    /** A size this version does not know (written by a later one) is the standard size. */
    public static String normalizeSize(String value) {
        if (AUTO.equals(value) || SMALL.equals(value) || LARGE.equals(value)) return value;
        return STANDARD;
    }

    /**
     * The scales to try in order: the first at which the fullest arrangement fits is used, the
     * last one otherwise. 自适应 ends at the standard size, so a full day is never drawn smaller.
     */
    public static float[] scales(String size) {
        switch (normalizeSize(size)) {
            case AUTO: return new float[]{1.16f, 1.08f, 1f};
            case SMALL: return new float[]{0.9f};
            case LARGE: return new float[]{1.12f};
            default: return new float[]{1f};
        }
    }

    static ScheduleWidgetDisplay decode(String json) {
        ScheduleWidgetDisplay value = new ScheduleWidgetDisplay();
        try {
            JSONObject data = new JSONObject(json == null ? "{}" : json);
            value.textSize = normalizeSize(data.optString("textSize", STANDARD));
            value.showWeek = data.optBoolean("showWeek", true);
            value.showBreaks = data.optBoolean("showBreaks", true);
            value.showProgress = data.optBoolean("showProgress", true);
            value.hideCompleted = data.optBoolean("hideCompleted", false);
            value.holidayAlwaysVisible = data.optBoolean("holidayAlwaysVisible", true);
        } catch (Exception ignored) { /* Unreadable settings are the defaults. */ }
        return value;
    }

    String encode() {
        try {
            return new JSONObject().put("textSize", normalizeSize(textSize)).put("showWeek", showWeek)
                    .put("showBreaks", showBreaks).put("showProgress", showProgress)
                    .put("hideCompleted", hideCompleted).put("holidayAlwaysVisible", holidayAlwaysVisible).toString();
        } catch (Exception error) { throw new IllegalStateException(error); }
    }

    public static ScheduleWidgetDisplay load(Context context) {
        return decode(context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "{}"));
    }

    public void save(Context context) {
        context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, encode()).apply();
    }

    public ScheduleWidgetDisplay copy() {
        return decode(encode());
    }

    // MARK: 倒计时与进度

    /** 「距下课」 or 「距上课」 and the second of the day it counts down to. */
    static final class Target {
        final String title;
        final int second;

        Target(String title, int second) {
            this.title = title;
            this.second = second;
        }
    }

    /** A class is on from its first minute to the end of its last one, as the course lists grey it. */
    static boolean inProgress(int startMinutes, int endMinutes, int nowMinutes) {
        return startMinutes >= 0 && endMinutes > startMinutes && nowMinutes >= startMinutes && nowMinutes <= endMinutes;
    }

    /**
     * What the countdown beside 当前 / 下一节 counts to: the end of a class that is on, or the
     * start of one that begins within the hour. Null otherwise, and for a class without a time.
     */
    static Target countdownTarget(int startMinutes, int endMinutes, int nowSeconds) {
        if (startMinutes < 0 || endMinutes <= startMinutes || nowSeconds < 0) return null;
        if (inProgress(startMinutes, endMinutes, nowSeconds / 60)) {
            return endMinutes * 60 > nowSeconds ? new Target("距下课", endMinutes * 60) : null;
        }
        int lead = startMinutes * 60 - nowSeconds;
        if (lead <= 0 || lead > COUNTDOWN_LEAD_MINUTES * 60) return null;
        return new Target("距上课", startMinutes * 60);
    }

    /** How far the class that is on has got, 0–1; -1 when it is not on. */
    static float progress(int startMinutes, int endMinutes, int nowSeconds) {
        if (nowSeconds < 0 || !inProgress(startMinutes, endMinutes, nowSeconds / 60)) return -1f;
        float total = (endMinutes - startMinutes) * 60f;
        return Math.max(0f, Math.min(1f, (nowSeconds - startMinutes * 60) / total));
    }

    /** The width the running digits need: 「00:00」 under an hour, then 「0:00:00」. */
    static String clockTemplate(int seconds) {
        return seconds >= 36_000 ? "00:00:00" : seconds >= 3600 ? "0:00:00" : "00:00";
    }

    /** The digits as the system's Chronometer writes them: 「23:10」, 「1:05:00」. */
    static String clock(int seconds) {
        int safe = Math.max(0, seconds);
        int hours = safe / 3600, minutes = safe % 3600 / 60, rest = safe % 60;
        return hours > 0
                ? String.format(java.util.Locale.US, "%d:%02d:%02d", hours, minutes, rest)
                : String.format(java.util.Locale.US, "%02d:%02d", minutes, rest);
    }

    // MARK: 下一次课预告

    /** `rows` of a preview that is one line: the label, then the first class and how many there are. */
    static final int PREVIEW_SUMMARY = -1;

    /**
     * How many classes of the next day a large 今日课表 previews under today's: three, two, one,
     * else one summary line, else nothing (0). `heights[i]` is what `candidates[i]` rows need.
     */
    static int previewRows(int[] candidates, float[] heights, float room) {
        for (int index = 0; index < candidates.length; index++) {
            if (heights[index] <= room + 0.01f) return candidates[index];
        }
        return 0;
    }
}
