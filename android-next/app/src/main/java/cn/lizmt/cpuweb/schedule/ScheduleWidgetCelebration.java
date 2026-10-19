package cn.lizmt.cpuweb.schedule;

import android.animation.ValueAnimator;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** A short, user-triggered burst; no recurring animation or background timer. */
final class ScheduleWidgetCelebration {
    static final String ACTION = BuildConfig.APPLICATION_ID + ".WIDGET_CELEBRATE";
    private static final ScheduledExecutorService ANIMATION = Executors.newSingleThreadScheduledExecutor();
    private static final ConcurrentHashMap<Integer, Long> ROUNDS = new ConcurrentHashMap<>();

    static boolean eligible(String date, boolean empty, ScheduleWidgetProvider.WidgetMode mode) {
        String greeting = ChineseCalendarInfo.restGreeting(date);
        return empty && greeting != null && !greeting.startsWith("清明")
                && (mode == ScheduleWidgetProvider.WidgetMode.LARGE || mode == ScheduleWidgetProvider.WidgetMode.TODAY_LARGE);
    }

    static void attach(Context context, RemoteViews views, int id, boolean enabled) {
        views.setViewVisibility(R.id.widget_celebration_touch, enabled ? View.VISIBLE : View.GONE);
        if (!enabled) return;
        Intent intent = new Intent(context, ScheduleWidgetProvider.class).setAction(ACTION)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        views.setOnClickPendingIntent(R.id.widget_celebration_touch,
                PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
    }

    static void play(Context context, int id, ScheduleWidgetProvider.WidgetMode mode, Runnable finished) {
        if (Build.VERSION.SDK_INT >= 26 && !ValueAnimator.areAnimatorsEnabled()) { finished.run(); return; }
        long round = System.nanoTime();
        ROUNDS.put(id, round);
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        // Small transparent overlays avoid re-sending both full-resolution timetable bitmaps every frame.
        int layout = mode == ScheduleWidgetProvider.WidgetMode.LARGE ? R.layout.widget_schedule_two_day : R.layout.widget_schedule_today_large;
        for (int step = 0; step <= 15; step++) {
            final int frame = step;
            ANIMATION.schedule(() -> {
                try {
                    if (!Long.valueOf(round).equals(ROUNDS.get(id))) return;
                    RemoteViews views = new RemoteViews(context.getPackageName(), layout);
                    if (frame == 15) views.setViewVisibility(R.id.widget_fireworks, View.GONE);
                    else {
                        views.setViewVisibility(R.id.widget_fireworks, View.VISIBLE);
                        views.setImageViewBitmap(R.id.widget_fireworks, frame(frame / 14f, 364, 382));
                    }
                    manager.partiallyUpdateAppWidget(id, views);
                } finally {
                    if (frame == 15) { ROUNDS.remove(id, round); finished.run(); }
                }
            }, step * 130L, TimeUnit.MILLISECONDS);
        }
    }

    static Bitmap frame(float progress, int width, int height) {
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        int[] colors = {0xFFFF2D68, 0xFFFFB840, 0xFF54B4FF, 0xFF9A78FF, 0xFF38CBA0};
        for (int burst = 0; burst < 5; burst++) {
            float age = Math.max(0f, Math.min(1f, (progress - burst * 0.07f) / 0.7f));
            if (age == 0f || age >= 1f) continue;
            float radius = (1f - (1f - age) * (1f - age)) * width * 0.25f;
            float cx = width * (0.2f + (burst % 3) * 0.29f);
            float cy = height * (0.25f + (burst % 2) * 0.24f) + age * age * 42f;
            for (int particle = 0; particle < 16; particle++) {
                double angle = particle * Math.PI / 8 + burst;
                paint.setColor(colors[(particle + burst) % colors.length]);
                paint.setAlpha(Math.round(255f * (1f - age)));
                float length = radius * (particle % 2 == 0 ? 1f : 0.65f);
                canvas.drawCircle(cx + (float) Math.cos(angle) * length, cy + (float) Math.sin(angle) * length,
                        1.4f + (1f - age) * 1.7f, paint);
            }
        }
        return bitmap;
    }
}
