package cn.lizmt.cpuweb.schedule;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

final class ScheduleWidgetWeekRenderer {
    private static final int WIDTH = 1080;
    private static final int HEIGHT = 820;
    private static final int SLOT_COUNT = ScheduleModelsKt.SLOT_COUNT;
    private static final float SUMMARY_HEIGHT = 70f;
    private static final float LABEL_WIDTH = 88f;
    private static final float HEADER_HEIGHT = 70f;
    private static final String[] START_TIMES = {
            "08:00", "08:55", "09:55", "10:50", "13:30", "14:25",
            "15:25", "16:20", "18:30", "19:25", "20:20", "21:15"
    };
    private static final String[] END_TIMES = {
            "08:45", "09:40", "10:40", "11:35", "14:15", "15:10",
            "16:10", "17:05", "19:15", "20:10", "21:05", "22:00"
    };
    private static final Typeface BOLD = Typeface.create(Typeface.DEFAULT, Typeface.BOLD);

    private ScheduleWidgetWeekRenderer() {
    }

    static Bitmap render(JSONArray days, int week) {
        return render(days, week, new ScheduleWidgetPalette(null, false));
    }

    /**
     * 整周课表。iOS 没有对应的小组件，配色、字重、课程色块照其他几个小组件（ScheduleWidgetPalette）：
     * 底色、主次文字色、带课程色条的浅底色块，今天那一列用主题色标出，周末用粉色。
     */
    static Bitmap render(JSONArray days, int week, ScheduleWidgetPalette palette) {
        Bitmap bitmap = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(palette.background());

        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        float columnWidth = (WIDTH - LABEL_WIDTH) / 7f;
        float rowHeight = (HEIGHT - SUMMARY_HEIGHT - HEADER_HEIGHT) / SLOT_COUNT;

        drawSummary(canvas, paint, days, week, palette);
        drawHeaders(canvas, paint, days, columnWidth, palette);
        drawGrid(canvas, paint, rowHeight, palette);
        drawCourses(canvas, paint, days, columnWidth, rowHeight, palette);
        return bitmap;
    }

    private static void drawSummary(Canvas canvas, Paint paint, JSONArray days, int week, ScheduleWidgetPalette palette) {
        paint.setTextAlign(Paint.Align.LEFT);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(palette.primary());
        paint.setTextSize(51f);
        paint.setTypeface(BOLD);
        canvas.drawText(week > 0 ? "第 " + week + " 周" : "整周课表", 36f, 52f, paint);

        paint.setTextAlign(Paint.Align.RIGHT);
        paint.setColor(palette.secondary());
        paint.setTextSize(30f);
        canvas.drawText(dateRange(days), WIDTH - 36f, 48f, paint);
        paint.setTypeface(Typeface.DEFAULT);
    }

    private static void drawHeaders(
            Canvas canvas,
            Paint paint,
            JSONArray days,
            float columnWidth,
            ScheduleWidgetPalette palette
    ) {
        String[] labels = {"一", "二", "三", "四", "五", "六", "日"};
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setStyle(Paint.Style.FILL);
        for (int index = 0; index < 7; index++) {
            JSONObject day = dayAt(days, index + 1);
            float left = LABEL_WIDTH + index * columnWidth + 6f;
            float top = SUMMARY_HEIGHT + 4f;
            RectF rect = new RectF(left, top, left + columnWidth - 12f, top + HEADER_HEIGHT - 12f);
            boolean today = day != null && day.optBoolean("isToday", false);
            int accent = index >= 5 ? palette.pink() : palette.accent();
            if (today) {
                paint.setColor(ScheduleWidgetPalette.withAlpha(accent, 0.16f));
                canvas.drawRoundRect(rect, 24f, 24f, paint);
            }
            paint.setColor(today || index >= 5 ? accent : palette.primary());
            paint.setTextSize(30f);
            paint.setTypeface(BOLD);
            canvas.drawText(labels[index], rect.centerX(), top + 30f, paint);
            paint.setTypeface(Typeface.DEFAULT);
            paint.setTextSize(22f);
            paint.setColor(today ? accent : palette.secondary());
            canvas.drawText(shortDate(day == null ? "" : ScheduleWidgetJson.text(day, "date", "")), rect.centerX(), top + 52f, paint);
        }
    }

    private static void drawGrid(Canvas canvas, Paint paint, float rowHeight, ScheduleWidgetPalette palette) {
        paint.setTextAlign(Paint.Align.CENTER);
        for (int slot = 0; slot < SLOT_COUNT; slot++) {
            float top = SUMMARY_HEIGHT + HEADER_HEIGHT + slot * rowHeight;
            paint.setStyle(Paint.Style.FILL);
            // 节与节之间一条细分隔线，不再给每格描边。
            paint.setColor(palette.separator());
            canvas.drawRect(LABEL_WIDTH, top, WIDTH - 6f, top + 1f, paint);
            paint.setColor(palette.secondary());
            paint.setTextSize(27f);
            paint.setTypeface(BOLD);
            canvas.drawText(String.valueOf(slot + 1), LABEL_WIDTH / 2f, top + rowHeight * 0.40f, paint);
            paint.setTypeface(Typeface.DEFAULT);
            paint.setColor(palette.muted());
            paint.setTextSize(15f);
            canvas.drawText(START_TIMES[slot], LABEL_WIDTH / 2f, top + rowHeight * 0.66f, paint);
            canvas.drawText(END_TIMES[slot], LABEL_WIDTH / 2f, top + rowHeight * 0.88f, paint);
        }
    }

    private static void drawCourses(
            Canvas canvas,
            Paint paint,
            JSONArray days,
            float columnWidth,
            float rowHeight,
            ScheduleWidgetPalette palette
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
                float top = SUMMARY_HEIGHT + HEADER_HEIGHT + (start - 1) * rowHeight + 5f;
                float right = left + columnWidth - 10f;
                float bottom = SUMMARY_HEIGHT + HEADER_HEIGHT + end * rowHeight - 4f;
                drawCourseCard(canvas, paint, new RectF(left, top, right, bottom), course, palette);
            }
        }
    }

    /** 和今日课表的一行一样：课程浅底色、圆角，左边一根课程色条。 */
    private static void drawCourseCard(
            Canvas canvas,
            Paint paint,
            RectF rect,
            JSONObject course,
            ScheduleWidgetPalette palette
    ) {
        String name = ScheduleWidgetPalette.displayName(ScheduleWidgetJson.text(course, "name", ""));
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(palette.tint(name));
        canvas.drawRoundRect(rect, 24f, 24f, paint);
        paint.setColor(palette.accent(name));
        canvas.drawRoundRect(new RectF(rect.left + 9f, rect.top + 12f, rect.left + 21f, rect.bottom - 12f), 6f, 6f, paint);

        float textLeft = rect.left + 30f;
        float textWidth = rect.right - 8f - textLeft;
        paint.setTextAlign(Paint.Align.LEFT);
        paint.setTypeface(BOLD);
        paint.setColor(palette.primary());
        String location = ScheduleWidgetJson.text(course, "location", "").trim();
        boolean showLocation = !location.isEmpty() && rect.height() >= 42f;
        float titleSize = rect.height() < 64f ? 15f : rect.height() < 112f ? 19f : 24f;
        paint.setTextSize(titleSize);
        int nameLines = showLocation
                ? (rect.height() >= 170f ? 3 : rect.height() >= 118f ? 2 : 1)
                : (rect.height() >= 140f ? 3 : rect.height() >= 98f ? 2 : 1);
        List<String> lines = wrap(name, paint, textWidth, nameLines);
        float titleLineHeight = titleSize * 1.2f;
        float locationSize = rect.height() < 64f ? 11f : rect.height() < 112f ? 15f : 19f;
        float locationLineHeight = locationSize * 1.2f;
        float totalHeight = lines.size() * titleLineHeight + (showLocation ? 4f + locationLineHeight : 0f);
        float y = rect.top + (rect.height() - totalHeight) / 2f + titleSize;
        for (String line : lines) {
            canvas.drawText(line, textLeft, y, paint);
            y += titleLineHeight;
        }
        if (showLocation) {
            paint.setTypeface(Typeface.DEFAULT);
            paint.setTextSize(locationSize);
            paint.setColor(palette.secondary());
            canvas.drawText(fit(location, paint, textWidth), textLeft, y + 2f, paint);
        }
        paint.setTypeface(Typeface.DEFAULT);
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
        String start = shortDate(first == null ? "" : ScheduleWidgetJson.text(first, "date", ""));
        String end = shortDate(last == null ? "" : ScheduleWidgetJson.text(last, "date", ""));
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
