package cn.lizmt.cpuweb.schedule;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
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
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class ScheduleWidgetProvider extends AppWidgetProvider {
    static final String ACTION_WIDGET_PINNED = BuildConfig.APPLICATION_ID + ".ACTION_WIDGET_PINNED";
    static final String ACTION_WIDGET_REFRESH = BuildConfig.APPLICATION_ID + ".ACTION_WIDGET_REFRESH";
    private static final Class<?>[] PROVIDERS = {
            ScheduleWidgetProvider.class,
            ScheduleWidgetProviderWide.class,
            ScheduleWidgetProviderLarge.class,
    };
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final int LINE_COUNT = 4;

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
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context.getApplicationContext(), manager, appWidgetId);
        }
    }

    static void updateAll(Context context) {
        Context appContext = context.getApplicationContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(appContext);
        for (Class<?> provider : PROVIDERS) {
            int[] ids = manager.getAppWidgetIds(new ComponentName(appContext, provider));
            for (int id : ids) {
                updateWidget(appContext, manager, id);
            }
        }
    }

    private static void updateWidget(Context context, AppWidgetManager manager, int appWidgetId) {
        RemoteViews loading = baseViews(context);
        loading.setTextViewText(R.id.widget_subtitle, "正在更新");
        loading.setTextViewText(R.id.widget_line_1, "正在读取课表...");
        setLineVisibility(loading, 1);
        loading.setTextViewText(R.id.widget_footer, "");
        manager.updateAppWidget(appWidgetId, loading);

        String endpoint = ScheduleWidgetPrefs.endpoint(context);
        if (endpoint == null || endpoint.trim().isEmpty()) {
            RemoteViews empty = baseViews(context);
            empty.setTextViewText(R.id.widget_subtitle, "未配置");
            empty.setTextViewText(R.id.widget_line_1, "打开 App 里的“更多”添加课表小组件");
            setLineVisibility(empty, 1);
            empty.setTextViewText(R.id.widget_footer, "配置后会自动刷新");
            manager.updateAppWidget(appWidgetId, empty);
            return;
        }

        EXECUTOR.execute(() -> {
            RemoteViews views = baseViews(context);
            try {
                JSONObject data = fetchSchedule(endpoint);
                renderSchedule(views, data);
            } catch (Exception error) {
                views.setTextViewText(R.id.widget_subtitle, "读取失败");
                views.setTextViewText(R.id.widget_line_1, "请打开 App 完成教务授权后重试");
                setLineVisibility(views, 1);
                views.setTextViewText(R.id.widget_footer, safeMessage(error));
            }
            manager.updateAppWidget(appWidgetId, views);
        });
    }

    private static RemoteViews baseViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_schedule);
        Intent intent = new Intent(context, MainActivity.class);
        intent.setData(Uri.parse(BuildConfig.APP_URL));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent, flags);
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);
        views.setOnClickPendingIntent(R.id.widget_refresh, refreshPendingIntent(context));
        views.setTextViewText(R.id.widget_title, "药大课表");
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
        HttpURLConnection connection = (HttpURLConnection) new URL(cacheBustedEndpoint(endpoint)).openConnection();
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
        connection.disconnect();

        JSONObject wrapper = new JSONObject(body);
        if (wrapper.optInt("code", -1) != 0) {
            throw new IllegalStateException(wrapper.optString("message", "课表读取失败"));
        }
        return wrapper.getJSONObject("data");
    }

    private static void renderSchedule(RemoteViews views, JSONObject data) {
        JSONObject today = resolveToday(data);
        JSONArray courses = today != null ? today.optJSONArray("courses") : null;

        String week = data.optString("week", "");
        String dayLabel = today != null ? today.optString("label", "") : chinaDayLabel();
        String date = today != null ? today.optString("date", "") : chinaToday();
        String subtitle = "第 " + (week.isEmpty() ? "--" : week) + " 周";
        if (!dayLabel.isEmpty()) subtitle += " · " + dayLabel;
        if (!date.isEmpty()) subtitle += " " + date;
        views.setTextViewText(R.id.widget_subtitle, subtitle);

        if (courses == null || courses.length() == 0) {
            views.setTextViewText(R.id.widget_line_1, "今天没有课程");
            setLineVisibility(views, 1);
        } else {
            int count = Math.min(LINE_COUNT, courses.length());
            for (int i = 0; i < count; i++) {
                setLine(views, i, courseLine(courses.optJSONObject(i)));
            }
            setLineVisibility(views, count);
        }

        String prefix = data.optBoolean("stale", false) ? "缓存 " : "更新 ";
        views.setTextViewText(R.id.widget_footer, prefix + formatTime(
                data.optString("cachedAt", data.optString("generatedAt", ""))
        ));
    }

    private static JSONObject resolveToday(JSONObject data) {
        String currentDate = chinaToday();
        JSONObject today = data.optJSONObject("today");
        if (dateMatches(today, currentDate)) return today;

        JSONArray days = data.optJSONArray("days");
        if (days != null) {
            for (int i = 0; i < days.length(); i++) {
                JSONObject day = days.optJSONObject(i);
                if (dateMatches(day, currentDate)) return day;
            }
        }

        if (today != null && today.optString("date", "").trim().isEmpty()) {
            return today;
        }
        return null;
    }

    private static boolean dateMatches(JSONObject day, String currentDate) {
        return day != null && currentDate.equals(day.optString("date", "").trim());
    }

    private static String chinaToday() {
        SimpleDateFormat output = new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA);
        output.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
        return output.format(new Date());
    }

    private static String chinaDayLabel() {
        Calendar calendar = Calendar.getInstance(TimeZone.getTimeZone("Asia/Shanghai"), Locale.CHINA);
        int day = calendar.get(Calendar.DAY_OF_WEEK);
        switch (day) {
            case Calendar.MONDAY: return "周一";
            case Calendar.TUESDAY: return "周二";
            case Calendar.WEDNESDAY: return "周三";
            case Calendar.THURSDAY: return "周四";
            case Calendar.FRIDAY: return "周五";
            case Calendar.SATURDAY: return "周六";
            default: return "周日";
        }
    }

    private static String cacheBustedEndpoint(String endpoint) {
        Uri uri = Uri.parse(endpoint).buildUpon()
                .appendQueryParameter("_widgetRefresh", String.valueOf(System.currentTimeMillis()))
                .build();
        return uri.toString();
    }

    private static String courseLine(JSONObject course) {
        if (course == null) return "";
        String time = course.optString("startTime", "");
        String name = course.optString("name", "课程");
        String location = course.optString("location", "");
        String text = time.isEmpty() ? name : time + " " + name;
        if (!location.isEmpty()) text += " @" + location;
        return text;
    }

    private static void setLine(RemoteViews views, int index, String text) {
        int id = lineId(index);
        views.setTextViewText(id, text);
        views.setViewVisibility(id, View.VISIBLE);
    }

    private static void setLineVisibility(RemoteViews views, int visibleCount) {
        for (int i = 0; i < LINE_COUNT; i++) {
            int id = lineId(i);
            views.setViewVisibility(id, i < visibleCount ? View.VISIBLE : View.GONE);
        }
    }

    private static int lineId(int index) {
        switch (index) {
            case 0: return R.id.widget_line_1;
            case 1: return R.id.widget_line_2;
            case 2: return R.id.widget_line_3;
            default: return R.id.widget_line_4;
        }
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
