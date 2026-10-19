package cn.lizmt.cpuweb.schedule;

import android.content.Context;
import org.json.JSONObject;

/** Each desktop instance owns its configuration, like iOS's Edit Widget. */
public final class ScheduleWidgetOptions {
    public boolean todayOnly;
    public boolean tomorrow;
    public int courseCount = 2;
    public boolean timeline;
    public boolean showCourseName = true;
    public boolean showRoom = true;
    public boolean showTeacher = true;
    public boolean showTime = true;
    public boolean showLunarDate = true;
    public boolean showHoliday = true;

    public static ScheduleWidgetOptions defaults(ScheduleWidgetProvider.WidgetMode mode) {
        ScheduleWidgetOptions value = new ScheduleWidgetOptions();
        value.timeline = mode == ScheduleWidgetProvider.WidgetMode.TODAY_LARGE;
        return value;
    }

    static ScheduleWidgetOptions decode(String json, ScheduleWidgetProvider.WidgetMode mode) {
        ScheduleWidgetOptions value = defaults(mode);
        try {
            JSONObject data = new JSONObject(json);
            value.todayOnly = data.optBoolean("todayOnly", false);
            value.tomorrow = data.optBoolean("tomorrow", false);
            value.courseCount = data.optInt("courseCount", 2) == 1 ? 1 : 2;
            value.timeline = data.optBoolean("timeline", value.timeline);
            value.showCourseName = data.optBoolean("showCourseName", true);
            value.showRoom = data.optBoolean("showRoom", true);
            value.showTeacher = data.optBoolean("showTeacher", true);
            value.showTime = data.optBoolean("showTime", true);
            value.showLunarDate = data.optBoolean("showLunarDate", true);
            value.showHoliday = data.optBoolean("showHoliday", true);
        } catch (Exception ignored) { /* Missing/older settings retain defaults. */ }
        return value;
    }

    public static ScheduleWidgetOptions load(Context context, int id, ScheduleWidgetProvider.WidgetMode mode) {
        return decode(context.getSharedPreferences("schedule_widget", Context.MODE_PRIVATE)
                .getString("instance_" + id, "{}"), mode);
    }

    public void save(Context context, int id) {
        try {
            JSONObject data = new JSONObject().put("todayOnly", todayOnly).put("tomorrow", tomorrow)
                    .put("courseCount", courseCount).put("timeline", timeline)
                    .put("showCourseName", showCourseName).put("showRoom", showRoom)
                    .put("showTeacher", showTeacher).put("showTime", showTime)
                    .put("showLunarDate", showLunarDate).put("showHoliday", showHoliday);
            context.getSharedPreferences("schedule_widget", Context.MODE_PRIVATE).edit()
                    .putString("instance_" + id, data.toString()).apply();
        } catch (Exception error) { throw new IllegalStateException(error); }
    }

    static void remove(Context context, int id) {
        context.getSharedPreferences("schedule_widget", Context.MODE_PRIVATE).edit().remove("instance_" + id).apply();
    }
}
