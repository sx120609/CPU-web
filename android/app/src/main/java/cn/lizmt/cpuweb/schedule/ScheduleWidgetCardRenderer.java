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

final class ScheduleWidgetCardRenderer {
    private static final int COMPACT_SIZE = 520;
    private static final int WIDE_WIDTH = 920;
    private static final int WIDE_HEIGHT = 410;
    private static final int LARGE_SIZE = 920;
    private static final int BACKGROUND = Color.rgb(248, 251, 255);
    private static final int PRIMARY_TEXT = Color.rgb(23, 32, 51);
    private static final int SECONDARY_TEXT = Color.rgb(71, 84, 103);
    private static final int MUTED_TEXT = Color.rgb(152, 162, 179);
    private static final int[] ACCENTS = {
            Color.rgb(232, 91, 75),
            Color.rgb(74, 120, 242),
            Color.rgb(139, 92, 246),
            Color.rgb(23, 166, 154),
            Color.rgb(224, 162, 36),
            Color.rgb(236, 112, 161),
    };
    private static final int[] TINTS = {
            Color.rgb(253, 236, 233),
            Color.rgb(234, 240, 255),
            Color.rgb(242, 236, 255),
            Color.rgb(229, 248, 245),
            Color.rgb(255, 247, 224),
            Color.rgb(253, 235, 244),
    };

    private ScheduleWidgetCardRenderer() {
    }

    static Bitmap renderUpcoming(JSONObject day, List<JSONObject> courses, boolean wide) {
        Bitmap bitmap = Bitmap.createBitmap(
                wide ? WIDE_WIDTH : COMPACT_SIZE,
                wide ? WIDE_HEIGHT : COMPACT_SIZE,
                Bitmap.Config.ARGB_8888
        );
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(BACKGROUND);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        drawDate(canvas, paint, day, 42f, wide ? 58f : 62f, wide ? 31f : 30f);
        if (courses == null || courses.isEmpty()) {
            drawEmpty(canvas, paint, bitmap.getWidth(), bitmap.getHeight(), "今天没有课程");
        } else if (wide) {
            drawUpcomingWide(canvas, paint, courses);
        } else {
            drawUpcomingCompact(canvas, paint, courses);
        }
        return bitmap;
    }

    static Bitmap renderToday(JSONObject day, boolean large) {
        Bitmap bitmap = Bitmap.createBitmap(
                large ? LARGE_SIZE : WIDE_WIDTH,
                large ? LARGE_SIZE : WIDE_HEIGHT,
                Bitmap.Config.ARGB_8888
        );
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(BACKGROUND);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        drawDate(canvas, paint, day, 38f, large ? 66f : 56f, large ? 34f : 30f);
        JSONArray source = day == null ? null : day.optJSONArray("courses");
        List<JSONObject> courses = new ArrayList<>();
        if (source != null) {
            for (int index = 0; index < source.length(); index++) {
                JSONObject course = source.optJSONObject(index);
                if (course != null) courses.add(course);
            }
        }
        if (courses.isEmpty()) {
            drawEmpty(canvas, paint, bitmap.getWidth(), bitmap.getHeight(), "今日暂无课程");
            return bitmap;
        }
        drawTodayRows(canvas, paint, courses, large);
        return bitmap;
    }

    private static void drawUpcomingCompact(Canvas canvas, Paint paint, List<JSONObject> courses) {
        JSONObject current = courses.get(0);
        int color = colorIndex(current);
        drawBar(canvas, paint, 44f, 112f, 12f, 192f, ACCENTS[color]);
        drawCourseDetails(canvas, paint, current, 78f, 138f, 395f, 38f, true);

        if (courses.size() > 1) {
            JSONObject next = courses.get(1);
            int nextColor = colorIndex(next);
            paint.setColor(MUTED_TEXT);
            paint.setTextSize(21f);
            paint.setFakeBoldText(true);
            canvas.drawText("接下来", 78f, 354f, paint);
            drawBar(canvas, paint, 44f, 368f, 10f, 86f, ACCENTS[nextColor]);
            paint.setColor(PRIMARY_TEXT);
            paint.setTextSize(31f);
            paint.setFakeBoldText(true);
            canvas.drawText(fit(next.optString("name", "课程"), paint, 390f), 78f, 405f, paint);
            paint.setColor(SECONDARY_TEXT);
            paint.setTextSize(23f);
            paint.setFakeBoldText(false);
            canvas.drawText(fit(timeRange(next), paint, 390f), 78f, 440f, paint);
        }
        paint.setFakeBoldText(false);
    }

    private static void drawUpcomingWide(Canvas canvas, Paint paint, List<JSONObject> courses) {
        paint.setStrokeWidth(2f);
        paint.setColor(Color.rgb(225, 231, 239));
        canvas.drawLine(460f, 102f, 460f, 372f, paint);
        drawUpcomingColumn(canvas, paint, courses.get(0), "当前", 42f, 432f);
        if (courses.size() > 1) {
            drawUpcomingColumn(canvas, paint, courses.get(1), "接下来", 498f, 878f);
        } else {
            paint.setColor(SECONDARY_TEXT);
            paint.setTextSize(27f);
            paint.setFakeBoldText(true);
            canvas.drawText("接下来", 498f, 132f, paint);
            paint.setColor(MUTED_TEXT);
            paint.setTextSize(25f);
            paint.setFakeBoldText(false);
            canvas.drawText("暂无下一节", 530f, 220f, paint);
        }
    }

    private static void drawUpcomingColumn(
            Canvas canvas,
            Paint paint,
            JSONObject course,
            String label,
            float left,
            float right
    ) {
        int color = colorIndex(course);
        paint.setColor(SECONDARY_TEXT);
        paint.setTextSize(27f);
        paint.setFakeBoldText(true);
        canvas.drawText(label, left, 132f, paint);
        drawBar(canvas, paint, left, 158f, 10f, 164f, ACCENTS[color]);
        drawCourseDetails(canvas, paint, course, left + 28f, 192f, right - left - 35f, 34f, false);
    }

    private static void drawCourseDetails(
            Canvas canvas,
            Paint paint,
            JSONObject course,
            float x,
            float y,
            float width,
            float nameSize,
            boolean roomy
    ) {
        paint.setColor(PRIMARY_TEXT);
        paint.setTextSize(nameSize);
        paint.setFakeBoldText(true);
        canvas.drawText(fit(course.optString("name", "课程"), paint, width), x, y, paint);
        paint.setColor(SECONDARY_TEXT);
        paint.setTextSize(roomy ? 27f : 24f);
        paint.setFakeBoldText(false);
        String meta = courseMeta(course);
        canvas.drawText(fit(meta.isEmpty() ? "地点待确认" : meta, paint, width), x, y + 42f, paint);
        paint.setColor(PRIMARY_TEXT);
        paint.setTextSize(roomy ? 29f : 25f);
        paint.setFakeBoldText(true);
        canvas.drawText(fit(timeRange(course), paint, width), x, y + 84f, paint);
        paint.setFakeBoldText(false);
    }

    private static void drawTodayRows(
            Canvas canvas,
            Paint paint,
            List<JSONObject> courses,
            boolean large
    ) {
        int limit = large ? 7 : 2;
        int count = Math.min(courses.size(), limit);
        float top = large ? 104f : 82f;
        float available = (large ? 876f : 392f) - top;
        float gap = large ? 13f : 10f;
        float rowHeight = Math.min(large ? 103f : 140f, (available - gap * (count - 1)) / count);
        for (int index = 0; index < count; index++) {
            JSONObject course = courses.get(index);
            int color = colorIndex(course);
            float rowTop = top + index * (rowHeight + gap);
            RectF row = new RectF(38f, rowTop, (large ? LARGE_SIZE : WIDE_WIDTH) - 38f, rowTop + rowHeight);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(TINTS[color]);
            canvas.drawRoundRect(row, 22f, 22f, paint);
            drawBar(canvas, paint, 38f, rowTop + 8f, 10f, rowHeight - 16f, ACCENTS[color]);

            float textX = 66f;
            paint.setColor(PRIMARY_TEXT);
            paint.setTextSize(large ? 29f : 31f);
            paint.setFakeBoldText(true);
            float timeWidth = large ? 150f : 165f;
            canvas.drawText(fit(course.optString("name", "课程"), paint, row.width() - timeWidth - 48f), textX, rowTop + rowHeight * 0.42f, paint);
            paint.setColor(SECONDARY_TEXT);
            paint.setTextSize(large ? 23f : 25f);
            paint.setFakeBoldText(false);
            canvas.drawText(fit(courseMeta(course), paint, row.width() - timeWidth - 48f), textX, rowTop + rowHeight * 0.72f, paint);
            drawTimes(canvas, paint, course, row.right - 26f, rowTop, rowHeight, large ? 24f : 27f);
        }
        if (large && courses.size() > limit) {
            paint.setColor(MUTED_TEXT);
            paint.setTextSize(22f);
            paint.setTextAlign(Paint.Align.RIGHT);
            canvas.drawText("还有 " + (courses.size() - limit) + " 门课程", (large ? LARGE_SIZE : WIDE_WIDTH) - 42f, (large ? LARGE_SIZE : WIDE_HEIGHT) - 20f, paint);
            paint.setTextAlign(Paint.Align.LEFT);
        }
    }

    private static void drawTimes(
            Canvas canvas,
            Paint paint,
            JSONObject course,
            float right,
            float top,
            float height,
            float size
    ) {
        paint.setColor(PRIMARY_TEXT);
        paint.setTextSize(size);
        paint.setFakeBoldText(true);
        paint.setTextAlign(Paint.Align.RIGHT);
        String start = course.optString("startTime", "");
        String end = course.optString("endTime", "");
        canvas.drawText(start, right, top + height * 0.40f, paint);
        canvas.drawText(end, right, top + height * 0.72f, paint);
        paint.setTextAlign(Paint.Align.LEFT);
        paint.setFakeBoldText(false);
    }

    private static void drawDate(Canvas canvas, Paint paint, JSONObject day, float x, float y, float size) {
        String date = compactDate(day == null ? "" : day.optString("date", ""));
        String label = day == null ? "" : day.optString("label", "").replace("周", "周");
        paint.setTextSize(size);
        paint.setFakeBoldText(true);
        paint.setColor(PRIMARY_TEXT);
        String prefix = date.isEmpty() ? "课表" : date;
        canvas.drawText(prefix, x, y, paint);
        float offset = paint.measureText(prefix) + 12f;
        paint.setColor("周六".equals(label) || "周日".equals(label)
                ? Color.rgb(244, 63, 94)
                : Color.rgb(15, 143, 127));
        canvas.drawText(label, x + offset, y, paint);
        paint.setFakeBoldText(false);
    }

    private static void drawBar(
            Canvas canvas,
            Paint paint,
            float left,
            float top,
            float width,
            float height,
            int color
    ) {
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(color);
        canvas.drawRoundRect(new RectF(left, top, left + width, top + height), width / 2f, width / 2f, paint);
    }

    private static void drawEmpty(Canvas canvas, Paint paint, int width, int height, String message) {
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setColor(MUTED_TEXT);
        paint.setTextSize(30f);
        paint.setFakeBoldText(true);
        canvas.drawText(message, width / 2f, height / 2f + 18f, paint);
        paint.setTextAlign(Paint.Align.LEFT);
        paint.setFakeBoldText(false);
    }

    private static int colorIndex(JSONObject course) {
        return Math.floorMod(course.optString("name", "课程").hashCode(), ACCENTS.length);
    }

    private static String compactDate(String value) {
        if (value == null || value.length() < 10) return "";
        try {
            return Integer.parseInt(value.substring(5, 7)) + "." + Integer.parseInt(value.substring(8, 10));
        } catch (Exception ignored) {
            return value.substring(5).replace("-", ".");
        }
    }

    private static String courseMeta(JSONObject course) {
        String location = course.optString("location", "").trim();
        String teacher = course.optString("teacher", "").trim();
        if (!location.isEmpty() && !teacher.isEmpty()) return location + "  " + teacher;
        return !location.isEmpty() ? location : teacher;
    }

    private static String timeRange(JSONObject course) {
        String start = course.optString("startTime", "").trim();
        String end = course.optString("endTime", "").trim();
        if (start.isEmpty()) return "时间待确认";
        return end.isEmpty() ? start : start + " - " + end;
    }

    private static String fit(String value, Paint paint, float maxWidth) {
        if (value == null) return "";
        if (paint.measureText(value) <= maxWidth) return value;
        int end = value.length();
        while (end > 0 && paint.measureText(value.substring(0, end) + "…") > maxWidth) end--;
        return value.substring(0, end) + "…";
    }
}
