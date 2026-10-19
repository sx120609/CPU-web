package cn.lizmt.cpuweb.schedule;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * 网页端拿到的课表按日期展开后写在 App 私有目录里，小组件只读这一份（docs/schedule-widget-rules.md 第 7 节）。
 * 格式和 iOS NativeWidgetLocalSchedule 的 Record 一致：{ semester, days, holidays }。
 * 整学期的快照整份覆盖；只按周取的快照只替换那一周的日子。退出登录时删除。
 */
final class ScheduleWidgetLocalDays {
    static final String FILE_NAME = "schedule-widget-local-days.json";
    private static final Object LOCK = new Object();

    private ScheduleWidgetLocalDays() {
    }

    /** 网页端传来的 { semester, complete, days, holidays }。内容有变化才写文件并刷新小组件。 */
    static boolean save(Context context, String json) {
        JSONObject incoming;
        try {
            incoming = new JSONObject(json == null ? "" : json);
        } catch (Exception ignored) {
            return false;
        }
        boolean changed;
        synchronized (LOCK) {
            File file = file(context);
            JSONObject existing = parse(readFile(file));
            JSONObject record = merge(incoming, existing);
            if (record == null) return false;
            String body = record.toString();
            if (existing != null && body.equals(existing.toString())) return true;
            changed = writeFile(file, body);
        }
        if (changed) ScheduleWidgetProvider.updateAll(context);
        return changed;
    }

    /** 退出登录、换账号：别让下一个人的小组件看到上一个人的课。 */
    static void clear(Context context) {
        boolean deleted;
        synchronized (LOCK) {
            File file = file(context);
            deleted = file.exists() && file.delete();
        }
        if (deleted) ScheduleWidgetProvider.updateAll(context);
    }

    static JSONObject read(Context context) {
        synchronized (LOCK) {
            return parse(readFile(file(context)));
        }
    }

    /** 读出的本地记录必须有学期和日子，否则当作没有。 */
    static JSONObject parse(String body) {
        if (body == null || body.isEmpty()) return null;
        try {
            JSONObject record = new JSONObject(body);
            JSONArray days = record.optJSONArray("days");
            if (ScheduleWidgetJson.text(record, "semester", "").isEmpty() || days == null || days.length() == 0) return null;
            return record;
        } catch (Exception ignored) {
            return null;
        }
    }

    /**
     * 拼出要写的那一份。`existing` 是上一次写的：只按周取的快照缺别的周的课，同一学期时保留那些日子；
     * 这次没带放假安排时也沿用上次的。
     */
    static JSONObject merge(JSONObject incoming, JSONObject existing) {
        if (incoming == null) return null;
        String semester = ScheduleWidgetJson.text(incoming, "semester", "").trim();
        JSONArray days = incoming.optJSONArray("days");
        if (semester.isEmpty() || days == null || days.length() == 0) return null;
        Map<String, JSONObject> byDate = new TreeMap<>();
        for (int index = 0; index < days.length(); index++) {
            JSONObject day = days.optJSONObject(index);
            String date = day == null ? "" : ScheduleWidgetJson.text(day, "date", "");
            if (!date.isEmpty() && !byDate.containsKey(date)) byDate.put(date, day);
        }
        if (byDate.isEmpty()) return null;
        JSONArray holidays = incoming.optJSONArray("holidays");
        if (holidays == null) holidays = new JSONArray();
        boolean complete = incoming.optBoolean("complete", false);
        if (!complete && existing != null && semester.equals(ScheduleWidgetJson.text(existing, "semester", ""))) {
            JSONArray previous = existing.optJSONArray("days");
            if (previous != null) {
                for (int index = 0; index < previous.length(); index++) {
                    JSONObject day = previous.optJSONObject(index);
                    String date = day == null ? "" : ScheduleWidgetJson.text(day, "date", "");
                    if (!date.isEmpty() && !byDate.containsKey(date)) byDate.put(date, day);
                }
            }
            JSONArray previousHolidays = existing.optJSONArray("holidays");
            if (holidays.length() == 0 && previousHolidays != null) holidays = previousHolidays;
        }
        try {
            JSONArray sorted = new JSONArray();
            for (JSONObject day : byDate.values()) sorted.put(day);
            return new JSONObject()
                    .put("semester", semester)
                    .put("days", sorted)
                    .put("holidays", holidays);
        } catch (Exception ignored) {
            return null;
        }
    }

    /**
     * 拼成和服务端小组件接口一样形状的数据，渲染代码不用分两套。
     * 今天不在学期里（假期）时给一个空的今天，照样显示休息状态和节假日。
     */
    static JSONObject payload(JSONObject record, String todayDate) {
        if (record == null) return null;
        JSONArray days = record.optJSONArray("days");
        if (days == null) return null;
        try {
            JSONObject today = null;
            for (int index = 0; index < days.length(); index++) {
                JSONObject day = days.optJSONObject(index);
                if (day != null && todayDate.equals(ScheduleWidgetJson.text(day, "date", ""))) {
                    today = day;
                    break;
                }
            }
            if (today == null) today = emptyDay(todayDate);
            Object week = today.opt("week");
            JSONArray weekDays = new JSONArray();
            if (week != null && !JSONObject.NULL.equals(week)) {
                for (int index = 0; index < days.length(); index++) {
                    JSONObject day = days.optJSONObject(index);
                    if (day != null && String.valueOf(week).equals(String.valueOf(day.opt("week")))) weekDays.put(day);
                }
            }
            return new JSONObject()
                    .put("semester", ScheduleWidgetJson.text(record, "semester", ""))
                    .put("week", week == null ? JSONObject.NULL : week)
                    .put("strictDate", true)
                    .put("today", today)
                    .put("weekDays", weekDays)
                    .put("days", days);
        } catch (Exception ignored) {
            return null;
        }
    }

    static List<ChineseCalendarInfo.PublishedHoliday> holidays(JSONObject record) {
        List<ChineseCalendarInfo.PublishedHoliday> result = new ArrayList<>();
        JSONArray holidays = record == null ? null : record.optJSONArray("holidays");
        if (holidays == null) return result;
        for (int index = 0; index < holidays.length(); index++) {
            JSONObject holiday = holidays.optJSONObject(index);
            if (holiday == null) continue;
            String date = ScheduleWidgetJson.text(holiday, "date", "");
            String name = ScheduleWidgetJson.text(holiday, "name", "");
            if (!date.isEmpty() && !name.isEmpty()) result.add(new ChineseCalendarInfo.PublishedHoliday(date, name));
        }
        return result;
    }

    private static JSONObject emptyDay(String date) throws Exception {
        String weekday = ChineseCalendarInfo.weekdayLabel(date);
        int day = 0;
        String[] labels = {"周一", "周二", "周三", "周四", "周五", "周六", "周日"};
        for (int index = 0; index < labels.length; index++) {
            if (labels[index].equals(weekday)) day = index + 1;
        }
        return new JSONObject()
                .put("day", day)
                .put("label", weekday == null ? "" : weekday)
                .put("date", date)
                .put("courses", new JSONArray());
    }

    private static File file(Context context) {
        return new File(context.getApplicationContext().getFilesDir(), FILE_NAME);
    }

    private static String readFile(File file) {
        if (!file.exists()) return null;
        try (InputStream input = new FileInputStream(file)) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException ignored) {
            return null;
        }
    }

    private static boolean writeFile(File file, String body) {
        // 先写临时文件再改名，小组件不会读到写了一半的文件。
        File temp = new File(file.getParentFile(), file.getName() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temp)) {
            output.write(body.getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        } catch (IOException ignored) {
            temp.delete();
            return false;
        }
        return temp.renameTo(file);
    }
}
