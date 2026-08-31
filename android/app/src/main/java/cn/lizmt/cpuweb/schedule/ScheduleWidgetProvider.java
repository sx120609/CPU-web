package cn.lizmt.cpuweb.schedule;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.io.IOException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class ScheduleWidgetProvider extends AppWidgetProvider {
    static final String ACTION_WIDGET_PINNED = BuildConfig.APPLICATION_ID + ".ACTION_WIDGET_PINNED";
    static final String ACTION_WIDGET_REFRESH = BuildConfig.APPLICATION_ID + ".ACTION_WIDGET_REFRESH";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final int COMPACT_LINE_COUNT = 4;
    private static final int MINUTES_22_00 = 22 * 60;

    enum WidgetMode {
        COMPACT,
        WIDE,
        TODAY_WIDE,
        TODAY_LARGE,
        LARGE
    }

    protected WidgetMode widgetMode() {
        return WidgetMode.COMPACT;
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent != null && ACTION_WIDGET_PINNED.equals(intent.getAction())) {
            Toast.makeText(context, "课表小组件已添加", Toast.LENGTH_SHORT).show();
            updateAll(context);
        } else if (intent != null && ACTION_WIDGET_REFRESH.equals(intent.getAction())) {
            Toast.makeText(context, "正在刷新课表", Toast.LENGTH_SHORT).show();
            updateAll(context);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        WidgetMode mode = widgetMode();
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context.getApplicationContext(), manager, appWidgetId, mode);
        }
    }

    static void updateAll(Context context) {
        Context appContext = context.getApplicationContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(appContext);
        updateProvider(appContext, manager, ScheduleWidgetProvider.class, WidgetMode.COMPACT);
        updateProvider(appContext, manager, ScheduleWidgetProviderWide.class, WidgetMode.WIDE);
        updateProvider(appContext, manager, ScheduleWidgetProviderTodayWide.class, WidgetMode.TODAY_WIDE);
        updateProvider(appContext, manager, ScheduleWidgetProviderTodayLarge.class, WidgetMode.TODAY_LARGE);
        updateProvider(appContext, manager, ScheduleWidgetProviderLarge.class, WidgetMode.LARGE);
    }

    private static void updateProvider(
            Context context,
            AppWidgetManager manager,
            Class<?> provider,
            WidgetMode mode
    ) {
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, provider));
        for (int id : ids) {
            updateWidget(context, manager, id, mode);
        }
    }

    static void updateWidget(
            Context context,
            AppWidgetManager manager,
            int appWidgetId,
            WidgetMode mode
    ) {
        RemoteViews loading = baseViews(context, mode);
        renderMessage(loading, mode, "正在更新", "正在读取课表...", "");
        manager.updateAppWidget(appWidgetId, loading);

        String endpoint = ScheduleWidgetPrefs.endpoint(context);
        if (endpoint == null || endpoint.trim().isEmpty()) {
            RemoteViews empty = baseViews(context, mode);
            renderMessage(empty, mode, "未配置", "打开 App 里的“更多”添加课表小组件", "配置后会自动刷新");
            manager.updateAppWidget(appWidgetId, empty);
            return;
        }

        EXECUTOR.execute(() -> {
            RemoteViews views = baseViews(context, mode);
            try {
                JSONObject data = fetchSchedule(endpoint);
                renderSchedule(views, data, mode);
            } catch (Exception error) {
                renderFailure(views, mode, error);
            }
            manager.updateAppWidget(appWidgetId, views);
        });
    }

    private static RemoteViews baseViews(Context context, WidgetMode mode) {
        int layout;
        if (mode == WidgetMode.LARGE) {
            layout = R.layout.widget_schedule_two_day;
        } else if (mode == WidgetMode.TODAY_LARGE) {
            layout = R.layout.widget_schedule_today_large;
        } else if (mode == WidgetMode.TODAY_WIDE) {
            layout = R.layout.widget_schedule_today_wide;
        } else if (mode == WidgetMode.WIDE) {
            layout = R.layout.widget_schedule_upcoming_wide;
        } else {
            layout = R.layout.widget_schedule_upcoming_compact;
        }
        RemoteViews views = new RemoteViews(context.getPackageName(), layout);
        Intent intent = new Intent(context, MainActivity.class);
        intent.setData(Uri.parse(BuildConfig.APP_URL));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent, flags);
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);
        return views;
    }

    private static PendingIntent refreshPendingIntent(Context context) {
        Intent intent = new Intent(context, ScheduleWidgetProvider.class)
                .setAction(ACTION_WIDGET_REFRESH);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(context, 2001, intent, flags);
    }

    private static JSONObject fetchSchedule(String endpoint) throws Exception {
        IOException networkFailure = null;
        for (String candidate : ScheduleWidgetEndpoint.candidates(endpoint)) {
            try {
                return fetchScheduleOnce(candidate);
            } catch (IOException error) {
                networkFailure = error;
            }
        }
        if (networkFailure != null) throw networkFailure;
        throw new IOException("没有可用的课表服务地址");
    }

    private static JSONObject fetchScheduleOnce(String endpoint) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(cacheBustedEndpoint(endpoint)).openConnection();
        try {
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            connection.setRequestMethod("GET");
            connection.setUseCaches(false);
            connection.setRequestProperty("Cache-Control", "no-cache");
            connection.setRequestProperty("Pragma", "no-cache");
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300
                    ? connection.getInputStream()
                    : connection.getErrorStream();
            String body = readFully(stream);
            JSONObject wrapper = new JSONObject(body);
            if (status == 401 || status == 403 || wrapper.optInt("code", -1) == 401) {
                throw new WidgetAuthorizationException(wrapper.optString("message", "教务授权已失效"));
            }
            if (wrapper.optInt("code", -1) != 0) {
                throw new IllegalStateException(wrapper.optString("message", "课表读取失败"));
            }
            return wrapper.getJSONObject("data");
        } finally {
            connection.disconnect();
        }
    }

    private static void renderFailure(RemoteViews views, WidgetMode mode, Exception error) {
        if (error instanceof WidgetAuthorizationException) {
            renderMessage(views, mode, "授权已失效", "请打开 App 重新登录教务", safeMessage(error));
            return;
        }
        if (error instanceof IOException) {
            renderMessage(views, mode, "网络连接失败", "请检查网络后点刷新重试", "已自动尝试备用入口");
            return;
        }
        renderMessage(views, mode, "读取失败", "课表服务暂时不可用，请稍后重试", safeMessage(error));
    }

    private static final class WidgetAuthorizationException extends IllegalStateException {
        WidgetAuthorizationException(String message) {
            super(message);
        }
    }

    private static void renderSchedule(RemoteViews views, JSONObject data, WidgetMode mode) {
        if (mode == WidgetMode.LARGE) {
            renderLarge(views, data);
        } else if (mode == WidgetMode.TODAY_WIDE || mode == WidgetMode.TODAY_LARGE) {
            renderToday(views, data, mode == WidgetMode.TODAY_LARGE);
        } else {
            renderUpcoming(views, data, mode == WidgetMode.WIDE);
        }
    }

    private static void renderUpcoming(RemoteViews views, JSONObject data, boolean wide) {
        boolean preferTomorrow = shouldPreferTomorrow(data);
        JSONObject primaryDay = resolveDay(data, preferTomorrow ? 1 : 0);
        List<JSONObject> courses = preferTomorrow
                ? firstCourses(primaryDay, 2)
                : nextCourses(primaryDay, currentMinutes(), 2);
        if (courses.isEmpty() && !preferTomorrow) {
            primaryDay = resolveDay(data, 1);
            courses = firstCourses(primaryDay, 2);
        }
        showBitmap(views, ScheduleWidgetCardRenderer.renderUpcoming(primaryDay, courses, wide));
    }

    private static void renderToday(RemoteViews views, JSONObject data, boolean large) {
        JSONObject day = fullDayForDate(data, deviceDateOffset(0), 0);
        showBitmap(views, ScheduleWidgetCardRenderer.renderToday(day, large));
    }

    private static void renderLarge(RemoteViews views, JSONObject data) {
        JSONObject today = fullDayForDate(data, deviceDateOffset(0), 0);
        JSONObject tomorrow = fullDayForDate(data, deviceDateOffset(1), 1);
        showBitmap(views, ScheduleWidgetCardRenderer.renderTwoDay(today, tomorrow));
    }

    private static void showBitmap(RemoteViews views, Bitmap bitmap) {
        views.setViewVisibility(R.id.widget_message, View.GONE);
        views.setViewVisibility(R.id.widget_content_image, View.VISIBLE);
        views.setImageViewBitmap(R.id.widget_content_image, bitmap);
    }

    private static void renderMessage(
            RemoteViews views,
            WidgetMode mode,
            String subtitle,
            String message,
            String footer
    ) {
        String detail = footer == null || footer.isEmpty() ? message : message + "\n" + footer;
        views.setViewVisibility(R.id.widget_content_image, View.GONE);
        views.setViewVisibility(R.id.widget_message, View.VISIBLE);
        views.setTextViewText(R.id.widget_message, subtitle + "\n" + detail);
    }

    private static void renderHeader(RemoteViews views, JSONObject data, JSONObject day, String modeText) {
        String week = weekForDay(data, day);
        String dateText = day != null ? shortDate(day.optString("date", "")) : "";
        String subtitle = "第 " + (week.isEmpty() ? "--" : week) + " 周 · " + modeText;
        if (!dateText.isEmpty()) subtitle += " " + dateText;
        views.setTextViewText(R.id.widget_subtitle, subtitle);
    }

    private static void setSubtitle(RemoteViews views, JSONObject data, JSONObject day, String modeText) {
        String week = weekForDay(data, day);
        String label = day != null ? day.optString("label", modeText) : modeText;
        String date = day != null ? shortDate(day.optString("date", "")) : "";
        String subtitle = "第 " + (week.isEmpty() ? "--" : week) + " 周 · " + label;
        if (!date.isEmpty()) subtitle += " " + date;
        views.setTextViewText(R.id.widget_subtitle, subtitle);
    }

    private static JSONObject resolveDay(JSONObject data, int offset) {
        String targetDate = deviceDateOffset(offset);
        JSONObject today = data.optJSONObject("today");
        if (offset == 0 && dateMatches(today, targetDate)) return today;

        JSONArray days = data.optJSONArray("days");
        if (days != null) {
            for (int i = 0; i < days.length(); i++) {
                JSONObject day = days.optJSONObject(i);
                if (dateMatches(day, targetDate)) return day;
            }
        }

        int targetDay = ((deviceDayOfWeek() - 1 + offset) % 7) + 1;
        if (data.optBoolean("strictDate", false)) {
            try {
                return new JSONObject()
                        .put("day", targetDay)
                        .put("label", dayLabel(targetDay))
                        .put("date", targetDate)
                        .put("week", "")
                        .put("courses", new JSONArray());
            } catch (Exception ignored) {
                return null;
            }
        }
        if (days != null) {
            for (int i = 0; i < days.length(); i++) {
                JSONObject day = days.optJSONObject(i);
                if (day != null && day.optInt("day", -1) == targetDay) return day;
            }
        }

        if (offset == 0 && today != null) {
            return today;
        }
        return null;
    }

    private static JSONObject fullDayForDate(JSONObject data, String targetDate, int fallbackOffset) {
        for (String key : new String[]{"weekDays", "days"}) {
            JSONArray days = data.optJSONArray(key);
            if (days == null) continue;
            for (int index = 0; index < days.length(); index++) {
                JSONObject day = days.optJSONObject(index);
                if (dateMatches(day, targetDate)) return day;
            }
        }
        return resolveDay(data, fallbackOffset);
    }

    private static String weekForDay(JSONObject data, JSONObject day) {
        boolean dayHasWeek = day != null && day.has("week");
        Object dayWeek = dayHasWeek ? nullableJsonValue(day.opt("week")) : null;
        Object payloadWeek = nullableJsonValue(data.opt("week"));
        return ScheduleWidgetWeekResolver.resolve(dayHasWeek, dayWeek, payloadWeek);
    }

    private static Object nullableJsonValue(Object value) {
        return value == null || JSONObject.NULL.equals(value) ? null : value;
    }

    private static String dayLabel(int day) {
        String[] labels = {"周一", "周二", "周三", "周四", "周五", "周六", "周日"};
        return day >= 1 && day <= labels.length ? labels[day - 1] : "";
    }

    private static boolean shouldPreferTomorrow(JSONObject data) {
        int now = currentMinutes();
        if (now >= MINUTES_22_00) return true;
        JSONObject today = resolveDay(data, 0);
        JSONArray courses = coursesOf(today);
        if (courses == null || courses.length() == 0) return false;
        for (int i = 0; i < courses.length(); i++) {
            JSONObject course = courses.optJSONObject(i);
            if (courseEndMinutes(course) >= now) return false;
        }
        return true;
    }

    static List<JSONObject> nextCourses(JSONObject day, int now, int limit) {
        List<JSONObject> result = new ArrayList<>();
        JSONArray courses = coursesOf(day);
        if (courses == null) return result;
        for (int i = 0; i < courses.length() && result.size() < limit; i++) {
            JSONObject course = courses.optJSONObject(i);
            int end = courseEndMinutes(course);
            if (course != null && (end >= now || (courseStartMinutes(course) < 0 && end <= 0))) {
                result.add(course);
            }
        }
        return result;
    }

    private static List<JSONObject> firstCourses(JSONObject day, int limit) {
        List<JSONObject> result = new ArrayList<>();
        JSONArray courses = coursesOf(day);
        if (courses == null) return result;
        for (int i = 0; i < courses.length() && result.size() < limit; i++) {
            JSONObject course = courses.optJSONObject(i);
            if (course != null) result.add(course);
        }
        return result;
    }

    private static JSONArray coursesOf(JSONObject day) {
        return day == null ? null : day.optJSONArray("courses");
    }

    private static void renderColumn(
            RemoteViews views,
            boolean left,
            String title,
            List<JSONObject> courses,
            int maxLines
    ) {
        views.setTextViewText(left ? R.id.widget_left_title : R.id.widget_right_title, title);
        int[] ids = left ? leftLineIds(maxLines) : rightLineIds(maxLines);
        if (courses.isEmpty()) {
            views.setTextViewText(ids[0], "没有课程");
            views.setViewVisibility(ids[0], View.VISIBLE);
            for (int i = 1; i < ids.length; i++) {
                views.setViewVisibility(ids[i], View.GONE);
            }
            return;
        }
        int cursor = 0;
        for (JSONObject course : courses) {
            if (cursor >= ids.length) break;

            views.setTextViewText(ids[cursor], coursePrimaryLine(course, true));
            views.setViewVisibility(ids[cursor], View.VISIBLE);
            cursor++;

            String meta = courseMetaLine(course);
            if (!meta.isEmpty() && cursor < ids.length) {
                views.setTextViewText(ids[cursor], meta);
                views.setViewVisibility(ids[cursor], View.VISIBLE);
                cursor++;
            }
        }
        for (int i = cursor; i < ids.length; i++) {
            views.setViewVisibility(ids[i], View.GONE);
        }
    }

    private static List<JSONObject> singleLine(String message) {
        List<JSONObject> result = new ArrayList<>();
        try {
            result.add(new JSONObject().put("name", message));
        } catch (Exception ignored) {
        }
        return result;
    }

    private static boolean dateMatches(JSONObject day, String currentDate) {
        return day != null && currentDate.equals(day.optString("date", "").trim());
    }

    private static String deviceDateOffset(int offset) {
        SimpleDateFormat output = new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA);
        Calendar calendar = Calendar.getInstance();
        calendar.add(Calendar.DAY_OF_YEAR, offset);
        return output.format(calendar.getTime());
    }

    private static int deviceDayOfWeek() {
        Calendar calendar = Calendar.getInstance();
        int day = calendar.get(Calendar.DAY_OF_WEEK);
        if (day == Calendar.SUNDAY) return 7;
        return day - 1;
    }

    private static int currentMinutes() {
        Calendar calendar = Calendar.getInstance();
        return calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE);
    }

    private static String cacheBustedEndpoint(String endpoint) {
        Uri uri = Uri.parse(endpoint).buildUpon()
                .appendQueryParameter("_widgetRefresh", String.valueOf(System.currentTimeMillis()))
                .build();
        return uri.toString();
    }

    private static String dayTitle(JSONObject day, String fallback) {
        if (day == null) return fallback;
        String date = shortDate(day.optString("date", ""));
        String label = day.optString("label", fallback);
        return date.isEmpty() ? label : label + " " + date;
    }

    private static String compactLabel(JSONObject course, String fallback) {
        String time = timeRange(course);
        return time.isEmpty() ? fallback : fallback + " " + time;
    }

    private static String coursePrimaryLine(JSONObject course, boolean includeEndTime) {
        if (course == null) return "";
        String time = includeEndTime ? timeRange(course) : course.optString("startTime", "");
        String name = course.optString("name", "课程");
        return time.isEmpty() ? name : time + " " + name;
    }

    private static String courseMetaLine(JSONObject course) {
        if (course == null) return "";
        List<String> parts = new ArrayList<>();
        String location = course.optString("location", "");
        String teacher = course.optString("teacher", "");
        String note = course.optString("note", course.optString("slotNote", ""));
        if (!location.isEmpty()) parts.add("@" + location);
        if (!teacher.isEmpty()) parts.add(teacher);
        if (!note.isEmpty()) parts.add(note);
        return joinParts(parts);
    }

    private static String timeRange(JSONObject course) {
        if (course == null) return "";
        String start = course.optString("startTime", "");
        String end = course.optString("endTime", "");
        if (start.isEmpty()) return "";
        return end.isEmpty() ? start : start + "-" + end;
    }

    private static String locationLine(JSONObject course) {
        String location = course.optString("location", "");
        String teacher = course.optString("teacher", "");
        if (!location.isEmpty() && !teacher.isEmpty()) return "@" + location + " · " + teacher;
        if (!location.isEmpty()) return "@" + location;
        if (!teacher.isEmpty()) return teacher;
        return "地点待确认";
    }

    private static String joinParts(List<String> parts) {
        StringBuilder builder = new StringBuilder();
        for (String part : parts) {
            if (part == null || part.isEmpty()) continue;
            if (builder.length() > 0) builder.append(" · ");
            builder.append(part);
        }
        return builder.toString();
    }

    private static int courseStartMinutes(JSONObject course) {
        return parseMinutes(course == null ? "" : course.optString("startTime", ""));
    }

    private static int courseEndMinutes(JSONObject course) {
        String end = course == null ? "" : course.optString("endTime", "");
        int parsed = parseMinutes(end);
        if (parsed >= 0) return parsed;
        int start = courseStartMinutes(course);
        return start >= 0 ? start + 45 : 0;
    }

    private static int parseMinutes(String value) {
        if (value == null || value.length() < 5) return -1;
        try {
            int hour = Integer.parseInt(value.substring(0, 2));
            int minute = Integer.parseInt(value.substring(3, 5));
            return hour * 60 + minute;
        } catch (Exception ignored) {
            return -1;
        }
    }

    private static String shortDate(String value) {
        if (value == null || value.length() < 10) return "";
        return value.substring(5).replace("-", "/");
    }

    private static String weekDateRange(JSONArray days) {
        if (days == null || days.length() == 0) return "";
        JSONObject first = days.optJSONObject(0);
        JSONObject last = days.optJSONObject(days.length() - 1);
        String start = first == null ? "" : shortDate(first.optString("date", ""));
        String end = last == null ? "" : shortDate(last.optString("date", ""));
        if (start.isEmpty()) return end;
        return end.isEmpty() ? start : start + " - " + end;
    }

    private static void setFooter(RemoteViews views, JSONObject data) {
        String prefix = data.optBoolean("stale", false) ? "缓存 " : "更新 ";
        views.setTextViewText(R.id.widget_footer, prefix + formatTime(
                data.optString("cachedAt", data.optString("generatedAt", ""))
        ));
    }

    private static void setLineVisibility(RemoteViews views, int visibleCount) {
        for (int i = 0; i < COMPACT_LINE_COUNT; i++) {
            int id = compactLineId(i);
            views.setViewVisibility(id, i < visibleCount ? View.VISIBLE : View.GONE);
        }
    }

    private static int compactLineId(int index) {
        switch (index) {
            case 0: return R.id.widget_line_1;
            case 1: return R.id.widget_line_2;
            case 2: return R.id.widget_line_3;
            default: return R.id.widget_line_4;
        }
    }

    private static int[] leftLineIds(int maxLines) {
        int[] all = {
                R.id.widget_left_line_1,
                R.id.widget_left_line_2,
                R.id.widget_left_line_3,
                R.id.widget_left_line_4,
                R.id.widget_left_line_5,
                R.id.widget_left_line_6,
        };
        return trimIds(all, maxLines);
    }

    private static int[] rightLineIds(int maxLines) {
        int[] all = {
                R.id.widget_right_line_1,
                R.id.widget_right_line_2,
                R.id.widget_right_line_3,
                R.id.widget_right_line_4,
                R.id.widget_right_line_5,
        };
        return trimIds(all, maxLines);
    }

    private static int[] trimIds(int[] ids, int maxLines) {
        int count = Math.min(ids.length, Math.max(1, maxLines));
        int[] result = new int[count];
        System.arraycopy(ids, 0, result, 0, count);
        return result;
    }

    private static String readFully(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8)
        )) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        }
        return builder.toString();
    }

    private static String formatTime(String iso) {
        if (iso == null || iso.isEmpty()) return "--:--";
        String[] patterns = {
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                "yyyy-MM-dd'T'HH:mm:ss'Z'"
        };
        for (String pattern : patterns) {
            try {
                SimpleDateFormat input = new SimpleDateFormat(pattern, Locale.US);
                input.setTimeZone(TimeZone.getTimeZone("UTC"));
                Date date = input.parse(iso);
                SimpleDateFormat output = new SimpleDateFormat("HH:mm", Locale.CHINA);
                return output.format(date);
            } catch (Exception ignored) {
            }
        }
        return iso.length() >= 16 ? iso.substring(11, 16) : iso;
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        if (message == null || message.trim().isEmpty()) return "稍后会自动重试";
        return message.length() > 18 ? message.substring(0, 18) : message;
    }
}
