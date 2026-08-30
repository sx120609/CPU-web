package cn.lizmt.cpuweb.schedule;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

final class ScheduleWidgetWeekRenderer {
    private static final int WIDTH = 840;
    private static final int HEIGHT = 600;
    private static final int SLOT_COUNT = 11;
    private static final float LABEL_WIDTH = 38f;
    private static final float HEADER_HEIGHT = 58f;
    private static final int[] CARD_COLORS = {
            Color.rgb(255, 225, 232),
            Color.rgb(237, 228, 255),
            Color.rgb(222, 232, 255),
            Color.rgb(211, 246, 246),
            Color.rgb(255, 244, 207),
            Color.rgb(255, 231, 213),
    };
    private static final int[] BORDER_COLORS = {
            Color.rgb(241, 105, 139),
            Color.rgb(148, 113, 227),
            Color.rgb(91, 137, 232),
            Color.rgb(48, 185, 184),
            Color.rgb(222, 174, 56),
            Color.rgb(232, 139, 81),
    };
    private static final int[] TEXT_COLORS = {
            Color.rgb(128, 33, 62),
            Color.rgb(73, 52, 145),
            Color.rgb(38, 70, 143),
            Color.rgb(18, 103, 103),
            Color.rgb(112, 83, 17),
            Color.rgb(126, 66, 30),
    };

    private ScheduleWidgetWeekRenderer() {
    }

    static Bitmap render(JSONArray days) {
        Bitmap bitmap = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.TRANSPARENT);

        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        float columnWidth = (WIDTH - LABEL_WIDTH) / 7f;
        float rowHeight = (HEIGHT - HEADER_HEIGHT) / SLOT_COUNT;

        drawHeaders(canvas, paint, days, columnWidth);
        drawGrid(canvas, paint, columnWidth, rowHeight);
        drawCourses(canvas, paint, days, columnWidth, rowHeight);
        return bitmap;
    }

    private static void drawHeaders(Canvas canvas, Paint paint, JSONArray days, float columnWidth) {
        String[] labels = {"一", "二", "三", "四", "五", "六", "日"};
        paint.setTextAlign(Paint.Align.CENTER);
        for (int index = 0; index < 7; index++) {
            JSONObject day = dayAt(days, index + 1);
            float left = LABEL_WIDTH + index * columnWidth + 3f;
            RectF rect = new RectF(left, 2f, left + columnWidth - 6f, HEADER_HEIGHT - 4f);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(day != null && day.optBoolean("isToday", false)
                    ? Color.rgb(222, 247, 242)
                    : Color.rgb(245, 248, 252));
            canvas.drawRoundRect(rect, 11f, 11f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(2f);
            paint.setColor(day != null && day.optBoolean("isToday", false)
                    ? Color.rgb(67, 181, 159)
                    : Color.rgb(217, 226, 237));
            canvas.drawRoundRect(rect, 11f, 11f, paint);

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(47, 59, 78));
            paint.setTextSize(22f);
            paint.setFakeBoldText(true);
            canvas.drawText(labels[index], rect.centerX(), 23f, paint);
            paint.setTextSize(15f);
            paint.setFakeBoldText(false);
            paint.setColor(Color.rgb(102, 112, 133));
            String date = day == null ? "" : shortDate(day.optString("date", ""));
            canvas.drawText(date, rect.centerX(), 44f, paint);
        }
    }

    private static void drawGrid(Canvas canvas, Paint paint, float columnWidth, float rowHeight) {
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setFakeBoldText(true);
        paint.setTextSize(16f);
        paint.setColor(Color.rgb(71, 84, 103));
        paint.setStyle(Paint.Style.FILL);
        for (int slot = 0; slot < SLOT_COUNT; slot++) {
            float top = HEADER_HEIGHT + slot * rowHeight;
            canvas.drawText(String.valueOf(slot + 1), LABEL_WIDTH / 2f, top + rowHeight * 0.64f, paint);
            for (int day = 0; day < 7; day++) {
                float left = LABEL_WIDTH + day * columnWidth + 3f;
                RectF rect = new RectF(left, top + 2f, left + columnWidth - 6f, top + rowHeight - 3f);
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.rgb(249, 251, 253));
                canvas.drawRoundRect(rect, 9f, 9f, paint);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.5f);
                paint.setColor(Color.rgb(222, 230, 240));
                canvas.drawRoundRect(rect, 9f, 9f, paint);
            }
        }
        paint.setFakeBoldText(false);
    }

    private static void drawCourses(
            Canvas canvas,
            Paint paint,
            JSONArray days,
            float columnWidth,
            float rowHeight
    ) {
        for (int dayIndex = 0; dayIndex < 7; dayIndex++) {
            JSONObject day = dayAt(days, dayIndex + 1);
            JSONArray courses = day == null ? null : day.optJSONArray("courses");
            if (courses == null) continue;
            for (int index = 0; index < courses.length(); index++) {
                JSONObject course = courses.optJSONObject(index);
                if (course == null) continue;
                int start = clamp(course.optInt("startSlot", 1), 1, SLOT_COUNT);
                int end = clamp(course.optInt("endSlot", start), start, SLOT_COUNT);
                float left = LABEL_WIDTH + dayIndex * columnWidth + 5f;
                float top = HEADER_HEIGHT + (start - 1) * rowHeight + 4f;
                float right = left + columnWidth - 10f;
                float bottom = HEADER_HEIGHT + end * rowHeight - 5f;
                int colorIndex = Math.floorMod(course.optString("name", "课程").hashCode(), CARD_COLORS.length);
                drawCourseCard(canvas, paint, new RectF(left, top, right, bottom), course, colorIndex);
            }
        }
    }

    private static void drawCourseCard(
            Canvas canvas,
            Paint paint,
            RectF rect,
            JSONObject course,
            int colorIndex
    ) {
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(CARD_COLORS[colorIndex]);
        canvas.drawRoundRect(rect, 11f, 11f, paint);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(2.5f);
        paint.setColor(BORDER_COLORS[colorIndex]);
        canvas.drawRoundRect(rect, 11f, 11f, paint);

        paint.setStyle(Paint.Style.FILL);
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setFakeBoldText(true);
        paint.setColor(TEXT_COLORS[colorIndex]);
        paint.setTextSize(17f);
        int nameLines = rect.height() >= 74f ? 2 : 1;
        List<String> lines = wrap(course.optString("name", "课程"), paint, rect.width() - 12f, nameLines);
        String location = course.optString("location", "").trim();
        boolean showLocation = !location.isEmpty() && rect.height() >= 82f;
        float lineHeight = 20f;
        float totalHeight = lines.size() * lineHeight + (showLocation ? 18f : 0f);
        float y = rect.centerY() - totalHeight / 2f + 15f;
        for (String line : lines) {
            canvas.drawText(line, rect.centerX(), y, paint);
            y += lineHeight;
        }
        if (showLocation) {
            paint.setFakeBoldText(false);
            paint.setTextSize(14f);
            canvas.drawText(fit("@" + location, paint, rect.width() - 12f), rect.centerX(), y + 1f, paint);
        }
        paint.setFakeBoldText(false);
    }

    private static List<String> wrap(String value, Paint paint, float maxWidth, int maxLines) {
        List<String> lines = new ArrayList<>();
        String source = value == null || value.trim().isEmpty() ? "课程" : value.trim();
        int cursor = 0;
        while (cursor < source.length() && lines.size() < maxLines) {
            int end = cursor + 1;
            while (end <= source.length() && paint.measureText(source.substring(cursor, end)) <= maxWidth) {
                end++;
            }
            int safeEnd = Math.max(cursor + 1, end - 1);
            String line = source.substring(cursor, safeEnd);
            cursor = safeEnd;
            if (lines.size() == maxLines - 1 && cursor < source.length()) {
                line = fit(line + "…", paint, maxWidth);
                cursor = source.length();
            }
            lines.add(line);
        }
        return lines;
    }

    private static String fit(String value, Paint paint, float maxWidth) {
        if (paint.measureText(value) <= maxWidth) return value;
        String suffix = "…";
        int end = value.length();
        while (end > 0 && paint.measureText(value.substring(0, end) + suffix) > maxWidth) end--;
        return value.substring(0, end) + suffix;
    }

    private static JSONObject dayAt(JSONArray days, int dayNumber) {
        if (days == null) return null;
        for (int index = 0; index < days.length(); index++) {
            JSONObject day = days.optJSONObject(index);
            if (day != null && day.optInt("day", -1) == dayNumber) return day;
        }
        return null;
    }

    private static String shortDate(String value) {
        if (value == null || value.length() < 10) return "";
        return value.substring(5).replace("-", "/");
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
