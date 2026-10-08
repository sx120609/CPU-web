package cn.lizmt.cpuweb.schedule;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.DisplayMetrics;
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
    static final String ACTION_WIDGET_TICK = BuildConfig.APPLICATION_ID + ".ACTION_WIDGET_TICK";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final int COMPACT_LINE_COUNT = 4;
    // 今天的课上完后，往后找最近有课的一天，最远看这么多天（见 docs/schedule-widget-rules.md）。
    static final int LOOKAHEAD_DAYS = 21;
    private static final long FALLBACK_REFRESH_MILLIS = 30L * 60L * 1000L;

    public enum WidgetMode {
        COMPACT,
        WIDE,
        TODAY_WIDE,
        TODAY_LARGE,
        LARGE
    }

    protected WidgetMode widgetMode() {
        return WidgetMode.COMPACT;
    }

    static WidgetMode modeForProvider(String name) {
        if (name.endsWith("ProviderTodayLarge")) return WidgetMode.TODAY_LARGE;
        if (name.endsWith("ProviderTodayWide")) return WidgetMode.TODAY_WIDE;
        if (name.endsWith("ProviderLarge")) return WidgetMode.LARGE;
        if (name.endsWith("ProviderWide")) return WidgetMode.WIDE;
        return WidgetMode.COMPACT;
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        for (int id : ids) ScheduleWidgetOptions.remove(context, id);
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
        } else if (intent != null && ACTION_WIDGET_TICK.equals(intent.getAction())) {
            updateAll(context);
        } else if (intent != null && ScheduleWidgetCelebration.ACTION.equals(intent.getAction())) {
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
            android.appwidget.AppWidgetProviderInfo info = AppWidgetManager.getInstance(context).getAppWidgetInfo(id);
            if (info == null || !context.getPackageName().equals(info.provider.getPackageName())) return;
            WidgetMode mode = modeForProvider(info.provider.getClassName());
            JSONObject record = ScheduleWidgetLocalDays.read(context);
            if (record == null) return;
            ChineseCalendarInfo.usePublishedHolidays(ScheduleWidgetLocalDays.holidays(record));
            String date = deviceDateOffset(0);
            JSONObject data = ScheduleWidgetLocalDays.payload(record, date);
            JSONObject today = fullDayForDate(data, date, 0);
            JSONArray courses = coursesOf(today);
            if (!ScheduleWidgetCelebration.eligible(date, courses == null || courses.length() == 0, mode)) return;
            PendingResult result = goAsync();
            ScheduleWidgetCelebration.play(context.getApplicationContext(), id, mode, result::finish);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        WidgetMode mode = widgetMode();
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context.getApplicationContext(), manager, appWidgetId, mode);
        }
    }

    /** 拖动改了大小：按新尺寸重画，保持和 iOS 一样的比例。 */
    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int appWidgetId, Bundle newOptions) {
        updateWidget(context.getApplicationContext(), manager, appWidgetId, widgetMode());
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
        EXECUTOR.execute(() -> {
            // 优先读 App 写在本地的课表；本地没有（还没打开过新版 App）才退回服务端小组件接口。
            JSONObject record = ScheduleWidgetLocalDays.read(context);
            if (record != null) {
                ChineseCalendarInfo.usePublishedHolidays(ScheduleWidgetLocalDays.holidays(record));
                render(context, manager, appWidgetId, mode,
                        ScheduleWidgetLocalDays.payload(record, deviceDateOffset(0)));
                return;
            }
            ChineseCalendarInfo.usePublishedHolidays(new ArrayList<>());
            String endpoint = ScheduleWidgetPrefs.endpoint(context);
            if (endpoint == null || endpoint.trim().isEmpty()) {
                RemoteViews empty = baseViews(context, mode);
                renderMessage(empty, mode, "未配置", "打开 App 里的课表页面即可同步", "配置后会自动刷新");
                manager.updateAppWidget(appWidgetId, empty);
                return;
            }
            RemoteViews loading = baseViews(context, mode);
            renderMessage(loading, mode, "正在更新", "正在读取课表...", "");
            manager.updateAppWidget(appWidgetId, loading);
            try {
                render(context, manager, appWidgetId, mode, fetchSchedule(endpoint));
            } catch (Exception error) {
                RemoteViews views = baseViews(context, mode);
                renderFailure(views, mode, error);
                scheduleNextRefresh(context, null);
                manager.updateAppWidget(appWidgetId, views);
            }
        });
    }

    private static void render(
            Context context,
            AppWidgetManager manager,
            int appWidgetId,
            WidgetMode mode,
            JSONObject data
    ) {
        RemoteViews views = baseViews(context, mode);
        if (data == null) {
            renderMessage(views, mode, "读取失败", "本地课表无法读取，请打开 App 刷新", "");
            scheduleNextRefresh(context, null);
        } else {
            renderSchedule(context, manager, appWidgetId, views, data, mode);
            scheduleNextRefresh(context, data);
        }
        manager.updateAppWidget(appWidgetId, views);
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
        // The native shell opens straight on its timetable tab.
        Intent intent = new Intent(context, MainActivity.class)
                .putExtra(MainActivity.EXTRA_OPEN_SCHEDULE, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent, flags);
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);
        return views;
    }

    private static PendingIntent refreshPendingIntent(Context context) {
        Intent intent = new Intent(context, ScheduleWidgetProvider.class)
                .setAction(ACTION_WIDGET_REFRESH);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, 2001, intent, flags);
    }

    private static void scheduleNextRefresh(Context context, JSONObject data) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        JSONObject today = data == null ? null : fullDayForDate(data, deviceDateOffset(0), 0);
        long at = nextRefreshAt(today, System.currentTimeMillis());
        Intent intent = new Intent(context, ScheduleWidgetProvider.class).setAction(ACTION_WIDGET_TICK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        // 不唤醒设备：息屏时没人看小组件，亮屏后系统补发即可，也用不着精确闹钟权限。
        alarms.setWindow(AlarmManager.RTC, at, 60_000L, PendingIntent.getBroadcast(context, 2002, intent, flags));
    }

    /** 下一次刷新：今天每节课开始、结束后 1 分钟，次日 00:01，最迟 30 分钟兜底。 */
    static long nextRefreshAt(JSONObject today, long nowMillis) {
        Calendar midnight = Calendar.getInstance();
        midnight.setTimeInMillis(nowMillis);
        midnight.set(Calendar.HOUR_OF_DAY, 0);
        midnight.set(Calendar.MINUTE, 0);
        midnight.set(Calendar.SECOND, 0);
        midnight.set(Calendar.MILLISECOND, 0);
        long dayStart = midnight.getTimeInMillis();
        midnight.add(Calendar.DAY_OF_YEAR, 1);
        long next = Math.min(nowMillis + FALLBACK_REFRESH_MILLIS, midnight.getTimeInMillis() + 60_000L);
        JSONArray courses = coursesOf(today);
        if (courses == null) return next;
        for (int i = 0; i < courses.length(); i++) {
            JSONObject course = courses.optJSONObject(i);
            if (course == null) continue;
            for (int minute : new int[]{courseStartMinutes(course), courseEndMinutes(course)}) {
                if (minute < 0) continue;
                long at = dayStart + (minute + 1) * 60_000L;
                if (at > nowMillis && at < next) next = at;
            }
        }
        return next;
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
                throw new WidgetAuthorizationException(ScheduleWidgetJson.text(wrapper, "message", "教务授权已失效"));
            }
            if (wrapper.optInt("code", -1) != 0) {
                throw new IllegalStateException(ScheduleWidgetJson.text(wrapper, "message", "课表读取失败"));
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

    /** 按当前时刻画一张课表图：先决定显示哪天的哪些课，再交给渲染器按给定的尺寸和配色画。 */
    /**
     * The in-app preview in the native widget settings: the local record drawn
     * at the family's nominal size. Null when there is no local record yet.
     */
    static Bitmap preview(Context context, WidgetMode mode, boolean dark) {
        JSONObject record = ScheduleWidgetLocalDays.read(context);
        if (record == null) return null;
        String today = deviceDateOffset(0);
        JSONObject data = ScheduleWidgetLocalDays.payload(record, today);
        if (data == null) return null;
        ChineseCalendarInfo.usePublishedHolidays(ScheduleWidgetLocalDays.holidays(record));
        DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        ScheduleWidgetCardRenderer.Family family = family(mode);
        return painter(data, mode, today, currentMinutes()).paint(ScheduleWidgetCardRenderer.Frame.fit(
                family, family.width, family.height, metrics.density, 1_200_000,
                new ScheduleWidgetPalette(ScheduleWidgetPrefs.theme(context), dark)));
    }

    interface Painter {
        Bitmap paint(ScheduleWidgetCardRenderer.Frame frame);
    }

    static ScheduleWidgetCardRenderer.Family family(WidgetMode mode) {
        switch (mode) {
            case COMPACT: return ScheduleWidgetCardRenderer.Family.SMALL;
            case WIDE:
            case TODAY_WIDE: return ScheduleWidgetCardRenderer.Family.MEDIUM;
            default: return ScheduleWidgetCardRenderer.Family.LARGE;
        }
    }

    static Painter painter(JSONObject data, WidgetMode mode, String todayDate, int now) {
        return painter(data, mode, todayDate, now, ScheduleWidgetOptions.defaults(mode));
    }

    static Painter painter(JSONObject data, WidgetMode mode, String todayDate, int now, ScheduleWidgetOptions options) {
        Painter content;
        if (mode == WidgetMode.LARGE) content = twoDayPainter(data, todayDate, now, options);
        else if (mode == WidgetMode.TODAY_WIDE || mode == WidgetMode.TODAY_LARGE) {
            content = todayPainter(data, todayDate, now, mode == WidgetMode.TODAY_LARGE, options);
        } else content = upcomingPainter(data, todayDate, now, mode == WidgetMode.WIDE, options);
        return frame -> content.paint(frame.withOptions(options));
    }

    private static void renderSchedule(
            Context context,
            AppWidgetManager manager,
            int appWidgetId,
            RemoteViews views,
            JSONObject data,
            WidgetMode mode
    ) {
        showBitmap(context, manager, appWidgetId, views, mode,
                painter(data, mode, deviceDateOffset(0), currentMinutes(), ScheduleWidgetOptions.load(context, appWidgetId, mode)));
        if (mode == WidgetMode.LARGE || mode == WidgetMode.TODAY_LARGE) {
            String date = deviceDateOffset(0);
            JSONObject today = fullDayForDate(data, date, 0);
            JSONArray courses = coursesOf(today);
            ScheduleWidgetOptions options = ScheduleWidgetOptions.load(context, appWidgetId, mode);
            boolean showsGreeting = mode == WidgetMode.LARGE || options.todayOnly || nextClassDayOffset(data, date) < 0;
            ScheduleWidgetCelebration.attach(context, views, appWidgetId, showsGreeting &&
                    ScheduleWidgetCelebration.eligible(date, courses == null || courses.length() == 0, mode));
        }
        views.setContentDescription(R.id.widget_content_image, accessibilitySummary(data, mode,
                deviceDateOffset(0), currentMinutes(), ScheduleWidgetOptions.load(context, appWidgetId, mode)));
    }

    static String accessibilitySummary(JSONObject data, WidgetMode mode, String date, int now, ScheduleWidgetOptions options) {
        StringBuilder text = new StringBuilder(date).append(" ").append(ChineseCalendarInfo.weekdayLabel(date));
        JSONObject today = fullDayForDate(data, date, 0);
        List<JSONObject> selected = mode == WidgetMode.COMPACT || mode == WidgetMode.WIDE
                ? nextCourses(today, now, mode == WidgetMode.COMPACT ? options.courseCount : 2) : firstCourses(today, Integer.MAX_VALUE);
        boolean finished = nextCourses(today, now, 1).isEmpty();
        if (mode != WidgetMode.LARGE && finished && !options.todayOnly) selected = new ArrayList<>();
        if ((selected.isEmpty() && !options.todayOnly) || mode == WidgetMode.LARGE) {
            int offset = mode == WidgetMode.LARGE && options.tomorrow ? 1 : nextClassDayOffset(data, date);
            if (offset > 0) {
                text.append("，").append(courseDayBanner(offset, addDays(date, offset)));
                selected.addAll(firstCourses(dayForDate(data, addDays(date, offset)),
                        mode == WidgetMode.COMPACT ? options.courseCount : mode == WidgetMode.WIDE ? 2 : Integer.MAX_VALUE));
            }
        }
        if (selected.isEmpty()) text.append("，").append(coursesOf(today) != null && coursesOf(today).length() > 0 ? "今日课程已结束" : "今日无课");
        for (JSONObject course : selected) {
            if (options.showCourseName) text.append("，").append(ScheduleWidgetJson.text(course, "name", ""));
            if (options.showTime) text.append(" ").append(timeRange(course));
            if (options.showRoom) text.append(" ").append(room(course));
            if (options.showTeacher) text.append(" ").append(ScheduleWidgetJson.text(course, "teacher", ""));
        }
        return text.toString();
    }

    private static Painter upcomingPainter(JSONObject data, String todayDate, int now, boolean wide, ScheduleWidgetOptions options) {
        JSONObject today = fullDayForDate(data, todayDate, 0);
        int count = wide ? 2 : options.courseCount;
        List<JSONObject> courses = nextCourses(today, now, count);
        String tag = "";
        String[] labels = courses.isEmpty() ? null : upcomingLabels(courses.get(0), now);
        if (courses.isEmpty() && !options.todayOnly) {
            int offset = nextClassDayOffset(data, todayDate);
            if (offset > 0) {
                JSONObject day = dayForDate(data, addDays(todayDate, offset));
                courses = firstCourses(day, count);
                tag = courseDayBanner(offset, ScheduleWidgetJson.text(day, "date", ""));
                labels = new String[]{"第一节", "接下来"};
            }
        }
        List<JSONObject> shown = courses;
        String shownTag = tag;
        String[] shownLabels = labels;
        String week = weekForDay(data, today);
        return frame -> ScheduleWidgetCardRenderer.renderUpcoming(
                frame, today, week, shownTag, shown, shownLabels, wide);
    }

    private static Painter todayPainter(JSONObject data, String todayDate, int now, boolean large, ScheduleWidgetOptions options) {
        JSONObject today = fullDayForDate(data, todayDate, 0);
        JSONObject shown = today;
        String tag = "";
        int shownNow = now;
        // 今天上完了：换到 21 天内最近有课的一天；都没课就是休息状态（docs/schedule-widget-rules.md 第 2 节）。
        if (nextCourses(today, now, 1).isEmpty() && !options.todayOnly) {
            int offset = nextClassDayOffset(data, todayDate);
            if (offset > 0) {
                shown = dayForDate(data, addDays(todayDate, offset));
                tag = courseDayBanner(offset, ScheduleWidgetJson.text(shown, "date", ""));
                shownNow = -1;
            } else {
                shown = new JSONObject();
            }
        }
        JSONObject day = shown;
        String shownTag = tag;
        int minutes = shownNow;
        String week = weekForDay(data, today);
        return frame -> ScheduleWidgetCardRenderer.renderToday(frame, today, week, day, shownTag, large, minutes);
    }

    private static Painter twoDayPainter(JSONObject data, String todayDate, int now, ScheduleWidgetOptions options) {
        JSONObject today = fullDayForDate(data, todayDate, 0);
        int offset = options.tomorrow ? 1 : nextClassDayOffset(data, todayDate);
        JSONObject other = offset > 0
                ? dayForDate(data, addDays(todayDate, offset))
                : fullDayForDate(data, addDays(todayDate, 1), 1);
        String tag = offset > 1 ? otherDayTag(offset, ScheduleWidgetJson.text(other, "date", "")) : "";
        String todayWeek = weekForDay(data, today);
        String otherWeek = weekForDay(data, other);
        return frame -> ScheduleWidgetCardRenderer.renderTwoDay(frame, today, todayWeek, other, otherWeek, tag, now);
    }

    /** 今天之后 21 天内第一个有课的日子距今天几天；没有返回 -1。只认服务端给出的真实日期。 */
    static int nextClassDayOffset(JSONObject data, String todayDate) {
        for (int offset = 1; offset <= LOOKAHEAD_DAYS; offset++) {
            JSONArray courses = coursesOf(dayForDate(data, addDays(todayDate, offset)));
            if (courses != null && courses.length() > 0) return offset;
        }
        return -1;
    }

    static JSONObject dayForDate(JSONObject data, String date) {
        if (data == null || date == null || date.isEmpty()) return null;
        for (String key : new String[]{"weekDays", "days"}) {
            JSONArray days = data.optJSONArray(key);
            if (days == null) continue;
            for (int index = 0; index < days.length(); index++) {
                JSONObject day = days.optJSONObject(index);
                if (dateMatches(day, date)) return day;
            }
        }
        return null;
    }

    static String otherDayTag(int offset, String date) {
        if (offset == 1) return "明天的课";
        if (offset == 2) return "后天的课";
        if (date == null || date.length() < 10) return "";
        try {
            return Integer.parseInt(date.substring(5, 7)) + "/" + Integer.parseInt(date.substring(8, 10)) + " 的课";
        } catch (Exception ignored) {
            return "";
        }
    }

    static String courseDayBanner(int offset, String date) {
        String label = offset == 1 ? "明天" : offset == 2 ? "后天" : otherDayTag(offset, date).replace(" 的课", "");
        String weekday = ChineseCalendarInfo.weekdayLabel(date);
        return label + (weekday == null ? "" : " " + weekday);
    }

    static String[] upcomingLabels(JSONObject first, int now) {
        int start = courseStartMinutes(first);
        return start >= 0 && start <= now
                ? new String[]{"当前", "接下来"}
                : new String[]{"下一节", "之后"};
    }

    static String addDays(String date, int offset) {
        try {
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA);
            format.setLenient(false);
            Calendar calendar = Calendar.getInstance();
            calendar.setTime(format.parse(date));
            calendar.add(Calendar.DAY_OF_YEAR, offset);
            return format.format(calendar.getTime());
        } catch (Exception ignored) {
            return "";
        }
    }

    /**
     * 按小组件实际大小画图。Android 12 起浅色、深色各画一张，由桌面跟着系统深色模式挑，
     * 切换时不用等下一次刷新；更早的系统按此刻的深色模式画。
     */
    private static void showBitmap(
            Context context,
            AppWidgetManager manager,
            int appWidgetId,
            RemoteViews views,
            WidgetMode mode,
            Painter painter
    ) {
        views.setViewVisibility(R.id.widget_message, View.GONE);
        views.setViewVisibility(R.id.widget_content_image, View.VISIBLE);
        Bundle options = manager.getAppWidgetOptions(appWidgetId);
        float width = options == null ? 0f : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        float height = options == null ? 0f : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        String theme = ScheduleWidgetPrefs.theme(context);
        boolean both = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
        // RemoteViews 里的位图总量上限约为整屏像素的 1.5 倍，两张图各留一半余量。
        int screen = Math.max(1, metrics.widthPixels) * Math.max(1, metrics.heightPixels);
        int maxPixels = Math.min(2_400_000, both ? screen * 6 / 10 : screen);
        ScheduleWidgetCardRenderer.Family family = family(mode);
        if (both) {
            Bitmap light = painter.paint(ScheduleWidgetCardRenderer.Frame.fit(family, width, height,
                    metrics.density, maxPixels, new ScheduleWidgetPalette(theme, false)));
            Bitmap dark = painter.paint(ScheduleWidgetCardRenderer.Frame.fit(family, width, height,
                    metrics.density, maxPixels, new ScheduleWidgetPalette(theme, true)));
            views.setIcon(R.id.widget_content_image, "setImageIcon",
                    Icon.createWithBitmap(light), Icon.createWithBitmap(dark));
        } else {
            views.setImageViewBitmap(R.id.widget_content_image, painter.paint(
                    ScheduleWidgetCardRenderer.Frame.fit(family, width, height, metrics.density, maxPixels,
                            new ScheduleWidgetPalette(theme, isNightMode(context)))));
        }
    }

    private static boolean isNightMode(Context context) {
        int mode = context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
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
        String dateText = day != null ? shortDate(ScheduleWidgetJson.text(day, "date", "")) : "";
        String subtitle = "第 " + (week.isEmpty() ? "--" : week) + " 周 · " + modeText;
        if (!dateText.isEmpty()) subtitle += " " + dateText;
        views.setTextViewText(R.id.widget_subtitle, subtitle);
    }

    private static void setSubtitle(RemoteViews views, JSONObject data, JSONObject day, String modeText) {
        String week = weekForDay(data, day);
        String label = day != null ? ScheduleWidgetJson.text(day, "label", modeText) : modeText;
        String date = day != null ? shortDate(ScheduleWidgetJson.text(day, "date", "")) : "";
        String subtitle = "第 " + (week.isEmpty() ? "--" : week) + " 周 · " + label;
        if (!date.isEmpty()) subtitle += " " + date;
        views.setTextViewText(R.id.widget_subtitle, subtitle);
    }

    private static JSONObject resolveDay(JSONObject data, String targetDate, int offset) {
        JSONObject today = data.optJSONObject("today");
        if (offset == 0 && dateMatches(today, targetDate)) return today;

        JSONArray days = data.optJSONArray("days");
        if (days != null) {
            for (int i = 0; i < days.length(); i++) {
                JSONObject day = days.optJSONObject(i);
                if (dateMatches(day, targetDate)) return day;
            }
        }

        int targetDay = dayOfWeek(targetDate);
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
        return resolveDay(data, targetDate, fallbackOffset);
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
        return day != null && currentDate.equals(ScheduleWidgetJson.text(day, "date", "").trim());
    }

    private static String deviceDateOffset(int offset) {
        SimpleDateFormat output = new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA);
        Calendar calendar = Calendar.getInstance();
        calendar.add(Calendar.DAY_OF_YEAR, offset);
        return output.format(calendar.getTime());
    }

    /** 1 = 周一 … 7 = 周日。 */
    private static int dayOfWeek(String date) {
        String label = ChineseCalendarInfo.weekdayLabel(date);
        String[] labels = {"周一", "周二", "周三", "周四", "周五", "周六", "周日"};
        for (int index = 0; index < labels.length; index++) {
            if (labels[index].equals(label)) return index + 1;
        }
        return 1;
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
        String date = shortDate(ScheduleWidgetJson.text(day, "date", ""));
        String label = ScheduleWidgetJson.text(day, "label", fallback);
        return date.isEmpty() ? label : label + " " + date;
    }

    private static String compactLabel(JSONObject course, String fallback) {
        String time = timeRange(course);
        return time.isEmpty() ? fallback : fallback + " " + time;
    }

    private static String coursePrimaryLine(JSONObject course, boolean includeEndTime) {
        if (course == null) return "";
        String time = includeEndTime ? timeRange(course) : ScheduleWidgetJson.text(course, "startTime", "");
        String name = ScheduleWidgetJson.text(course, "name", "课程");
        return time.isEmpty() ? name : time + " " + name;
    }

    /** The room as the timetable shows it: "教学楼A102" is "A102". */
    private static String room(JSONObject course) {
        return ScheduleStyleTime.INSTANCE.classroomOnly(ScheduleWidgetJson.text(course, "location", ""));
    }

    private static String courseMetaLine(JSONObject course) {
        if (course == null) return "";
        List<String> parts = new ArrayList<>();
        String location = room(course);
        String teacher = ScheduleWidgetJson.text(course, "teacher", "");
        String note = ScheduleWidgetJson.text(course, "note", ScheduleWidgetJson.text(course, "slotNote", ""));
        if (!location.isEmpty()) parts.add("@" + location);
        if (!teacher.isEmpty()) parts.add(teacher);
        if (!note.isEmpty()) parts.add(note);
        return joinParts(parts);
    }

    private static String timeRange(JSONObject course) {
        if (course == null) return "";
        String start = ScheduleWidgetJson.text(course, "startTime", "");
        String end = ScheduleWidgetJson.text(course, "endTime", "");
        if (start.isEmpty()) return "";
        return end.isEmpty() ? start : start + "-" + end;
    }

    private static String locationLine(JSONObject course) {
        String location = room(course);
        String teacher = ScheduleWidgetJson.text(course, "teacher", "");
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
        return parseMinutes(course == null ? "" : ScheduleWidgetJson.text(course, "startTime", ""));
    }

    private static int courseEndMinutes(JSONObject course) {
        String end = course == null ? "" : ScheduleWidgetJson.text(course, "endTime", "");
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
        String start = first == null ? "" : shortDate(ScheduleWidgetJson.text(first, "date", ""));
        String end = last == null ? "" : shortDate(ScheduleWidgetJson.text(last, "date", ""));
        if (start.isEmpty()) return end;
        return end.isEmpty() ? start : start + " - " + end;
    }

    private static void setFooter(RemoteViews views, JSONObject data) {
        views.setTextViewText(R.id.widget_footer, "更新 " + formatTime(
                ScheduleWidgetJson.text(data, "cachedAt", ScheduleWidgetJson.text(data, "generatedAt", ""))
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
