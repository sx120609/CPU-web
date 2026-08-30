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
    private static final int WIDTH = 1080;
    private static final int HEIGHT = 820;
    private static final int SLOT_COUNT = 11;
    private static final float SUMMARY_HEIGHT = 70f;
    private static final float LABEL_WIDTH = 88f;
    private static final float HEADER_HEIGHT = 70f;
    private static final String[] START_TIMES = {
            "08:00", "08:55", "09:55", "10:50", "13:30", "14:25",
            "15:25", "16:20", "18:30", "19:25", "20:20"
    };
    private static final String[] END_TIMES = {
            "08:45", "09:40", "10:40", "11:35", "14:15", "15:10",
            "16:10", "17:05", "19:15", "20:10", "21:05"
    };
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

    static Bitmap render(JSONArray days, int week) {
        Bitmap bitmap = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.rgb(248, 251, 255));

        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        float columnWidth = (WIDTH - LABEL_WIDTH) / 7f;
        float rowHeight = (HEIGHT - SUMMARY_HEIGHT - HEADER_HEIGHT) / SLOT_COUNT;

        drawSummary(canvas, paint, days, week);
        drawHeaders(canvas, paint, days, columnWidth);
        drawGrid(canvas, paint, columnWidth, rowHeight);
        drawCourses(canvas, paint, days, columnWidth, rowHeight);
        return bitmap;
    }

    private static void drawSummary(Canvas canvas, Paint paint, JSONArray days, int week) {
        paint.setTextAlign(Paint.Align.LEFT);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(Color.rgb(67, 56, 202));
        paint.setTextSize(34f);
        paint.setFakeBoldText(true);
        canvas.drawText(week > 0 ? "第 " + week + " 周" : "整周课表", 30f, 45f, paint);

        paint.setTextAlign(Paint.Align.RIGHT);
        paint.setColor(Color.rgb(102, 112, 133));
        paint.setTextSize(23f);
        paint.setFakeBoldText(false);
        canvas.drawText(dateRange(days), WIDTH - 24f, 43f, paint);
    }

    private static void drawHeaders(Canvas canvas, Paint paint, JSONArray days, float columnWidth) {
        String[] labels = {"一", "二", "三", "四", "五", "六", "日"};
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(Color.rgb(102, 112, 133));
        paint.setTextSize(22f);
        paint.setFakeBoldText(true);
        canvas.drawText("节次", LABEL_WIDTH / 2f, SUMMARY_HEIGHT + 42f, paint);

        for (int index = 0; index < 7; index++) {
            JSONObject day = dayAt(days, index + 1);
            float left = LABEL_WIDTH + index * columnWidth + 4f;
            float top = SUMMARY_HEIGHT + 2f;
            RectF rect = new RectF(left, top, left + columnWidth - 8f, top + HEADER_HEIGHT - 6f);
            boolean today = day != null && day.optBoolean("isToday", false);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(today ? Color.rgb(228, 248, 244) : Color.rgb(248, 251, 255));
            canvas.drawRoundRect(rect, 15f, 15f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(today ? 3f : 1.6f);
            paint.setColor(today ? Color.rgb(44, 179, 154) : Color.rgb(220, 228, 238));
            canvas.drawRoundRect(rect, 15f, 15f, paint);

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(today ? Color.rgb(12, 132, 111) : Color.rgb(47, 59, 78));
            paint.setTextSize(25f);
            paint.setFakeBoldText(true);
            canvas.drawText(labels[index], rect.centerX(), top + 28f, paint);
            paint.setTextSize(18f);
            paint.setFakeBoldText(false);
            paint.setColor(Color.rgb(102, 112, 133));
            canvas.drawText(shortDate(day == null ? "" : day.optString("date", "")), rect.centerX(), top + 52f, paint);
        }
    }

    private static void drawGrid(Canvas canvas, Paint paint, float columnWidth, float rowHeight) {
        paint.setTextAlign(Paint.Align.CENTER);
        for (int slot = 0; slot < SLOT_COUNT; slot++) {
            float top = SUMMARY_HEIGHT + HEADER_HEIGHT + slot * rowHeight;
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(29, 41, 57));
            paint.setTextSize(22f);
            paint.setFakeBoldText(true);
            canvas.drawText(String.valueOf(slot + 1), LABEL_WIDTH / 2f, top + rowHeight * 0.38f, paint);
            paint.setColor(Color.rgb(102, 112, 133));
            paint.setTextSize(13f);
            paint.setFakeBoldText(false);
            canvas.drawText(START_TIMES[slot], LABEL_WIDTH / 2f, top + rowHeight * 0.65f, paint);
            canvas.drawText(END_TIMES[slot], LABEL_WIDTH / 2f, top + rowHeight * 0.86f, paint);

            for (int day = 0; day < 7; day++) {
                float left = LABEL_WIDTH + day * columnWidth + 4f;
                RectF rect = new RectF(left, top + 3f, left + columnWidth - 8f, top + rowHeight - 4f);
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.rgb(250, 252, 254));
                canvas.drawRoundRect(rect, 11f, 11f, paint);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.5f);
                paint.setColor(Color.rgb(220, 228, 238));
                canvas.drawRoundRect(rect, 11f, 11f, paint);
            }
        }
        paint.setFakeBoldText(false);
    }

    private static void drawCourses(Canvas canvas, Paint paint, JSONArray days, float columnWidth, float rowHeight) {
        for (int dayIndex = 0; dayIndex < 7; dayIndex++) {
            JSONObject day = dayAt(days, dayIndex + 1);
            JSONArray courses = day == null ? null : day.optJSONArray("courses");
            if (courses == null) continue;
            for (int index = 0; index < courses.length(); index++) {
                JSONObject course = courses.optJSONObject(index);
                if (course == null) continue;
                int start = clamp(course.optInt("startSlot", 1), 1, SLOT_COUNT);
                int end = clamp(course.optInt("endSlot", start), start, SLOT_COUNT);
                float left = LABEL_WIDTH + dayIndex * columnWidth + 7f;
                float top = SUMMARY_HEIGHT + HEADER_HEIGHT + (start - 1) * rowHeight + 6f;
                float right = left + columnWidth - 14f;
                float bottom = SUMMARY_HEIGHT + HEADER_HEIGHT + end * rowHeight - 7f;
                int colorIndex = Math.floorMod(course.optString("name", "课程").hashCode(), CARD_COLORS.length);
                drawCourseCard(canvas, paint, new RectF(left, top, right, bottom), course, colorIndex);
            }
        }
    }

    private static void drawCourseCard(Canvas canvas, Paint paint, RectF rect, JSONObject course, int colorIndex) {
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(CARD_COLORS[colorIndex]);
        canvas.drawRoundRect(rect, 13f, 13f, paint);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(2.6f);
        paint.setColor(BORDER_COLORS[colorIndex]);
        canvas.drawRoundRect(rect, 13f, 13f, paint);

        paint.setStyle(Paint.Style.FILL);
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setFakeBoldText(true);
        paint.setColor(TEXT_COLORS[colorIndex]);
        paint.setTextSize(20f);
        int nameLines = rect.height() >= 82f ? 2 : 1;
        List<String> lines = wrap(course.optString("name", "课程"), paint, rect.width() - 16f, nameLines);
        String location = course.optString("location", "").trim();
        boolean showLocation = !location.isEmpty() && rect.height() >= 92f;
        float lineHeight = 24f;
        float totalHeight = lines.size() * lineHeight + (showLocation ? 21f : 0f);
        float y = rect.centerY() - totalHeight / 2f + 18f;
        for (String line : lines) {
            canvas.drawText(line, rect.centerX(), y, paint);
            y += lineHeight;
        }
        if (showLocation) {
            paint.setFakeBoldText(false);
            paint.setTextSize(16f);
            canvas.drawText(fit("@" + location, paint, rect.width() - 16f), rect.centerX(), y + 1f, paint);
        }
        paint.setFakeBoldText(false);
    }

    private static List<String> wrap(String value, Paint paint, float maxWidth, int maxLines) {
        List<String> lines = new ArrayList<>();
        String source = value == null || value.trim().isEmpty() ? "课程" : value.trim();
        int cursor = 0;
        while (cursor < source.length() && lines.size() < maxLines) {
            int end = cursor + 1;
            while (end <= source.length() && paint.measureText(source.substring(cursor, end)) <= maxWidth) end++;
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
        int end = value.length();
        while (end > 0 && paint.measureText(value.substring(0, end) + "…") > maxWidth) end--;
        return value.substring(0, end) + "…";
    }

    private static JSONObject dayAt(JSONArray days, int dayNumber) {
        if (days == null) return null;
        for (int index = 0; index < days.length(); index++) {
            JSONObject day = days.optJSONObject(index);
            if (day != null && day.optInt("day", -1) == dayNumber) return day;
        }
        return null;
    }

    private static String dateRange(JSONArray days) {
        if (days == null || days.length() == 0) return "";
        JSONObject first = days.optJSONObject(0);
        JSONObject last = days.optJSONObject(days.length() - 1);
        String start = shortDate(first == null ? "" : first.optString("date", ""));
        String end = shortDate(last == null ? "" : last.optString("date", ""));
        if (start.isEmpty()) return end;
        return end.isEmpty() ? start : start + " - " + end;
    }

    private static String shortDate(String value) {
        if (value == null || value.length() < 10) return "";
        return value.substring(5).replace("-", "/");
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
