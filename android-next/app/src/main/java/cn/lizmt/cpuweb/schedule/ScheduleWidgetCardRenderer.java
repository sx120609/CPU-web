package cn.lizmt.cpuweb.schedule;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 把课表画成小组件的整张图。排版逐项照 iOS ScheduleWidgets.swift：尺寸、字号、间距都按 iOS 的 pt 写，
 * 1 pt 画成 1 dp；小组件格子比 iOS 大时等比放大、多出来的那一边照 SwiftUI 的弹性布局撑开。
 * 背景（圆角底色）由布局里的 widget_background 画，这张图本身是透明的。
 */
final class ScheduleWidgetCardRenderer {
    static final String REST_TEXT = ChineseCalendarInfo.REST_TEXT;
    static final float PADDING = 16f;
    // SwiftUI 按 SF 的行高排中文：行高 1.193 倍字号，基线在行顶下 0.952 倍字号。
    private static final float LINE_HEIGHT = 1.193f;
    private static final float ASCENT = 0.952f;
    // Roboto 的数字和字母比 SF 窄一成左右；中文字宽两边一样。只给非中文加字距，宽度才对得上。
    private static final float LATIN_TRACKING = 0.06f;
    // 已下课、别的日子的课：去色再 56% 不透明，同 iOS 的 saturation(0).opacity(0.56)。
    private static final int DIMMED_ALPHA = Math.round(255 * 0.56f);
    // 每一行字的高度按像素向上取整（SwiftUI 也这样），渲染入口里按这张图的清晰度设。
    private static float pixelGrid = 3f;
    private static final Typeface[] TYPEFACES = new Typeface[10];

    enum Family {
        SMALL(170f, 170f),
        MEDIUM(364f, 170f),
        LARGE(364f, 382f);

        final float width;
        final float height;

        Family(float width, float height) {
            this.width = width;
            this.height = height;
        }
    }

    /** 一张图的逻辑尺寸（pt）、每 pt 多少像素、配色。 */
    static final class Frame {
        final float width;
        final float height;
        final float scale;
        final ScheduleWidgetPalette palette;
        ScheduleWidgetOptions options = new ScheduleWidgetOptions();
        boolean largeHeader;

        Frame(float width, float height, float scale, ScheduleWidgetPalette palette) {
            this.width = width;
            this.height = height;
            this.scale = scale;
            this.palette = palette;
        }

        Frame withOptions(ScheduleWidgetOptions options) {
            Frame result = new Frame(width, height, scale, palette);
            result.options = options;
            return result;
        }

        static Frame of(Family family, float scale, ScheduleWidgetPalette palette) {
            return new Frame(family.width, family.height, scale, palette);
        }

        /**
         * 按小组件实际大小（dp）排版：等比缩放到有一边正好是 iOS 的尺寸，另一边放宽，
         * 这样字号和间距的比例不变、内容也不会溢出。像素总数超过 maxPixels 时降低清晰度。
         */
        static Frame fit(
                Family family,
                float widthDp,
                float heightDp,
                float density,
                int maxPixels,
                ScheduleWidgetPalette palette
        ) {
            if (widthDp <= 0f || heightDp <= 0f) {
                widthDp = family.width;
                heightDp = family.height;
            }
            float zoom = Math.min(widthDp / family.width, heightDp / family.height);
            float width = widthDp / zoom;
            float height = heightDp / zoom;
            float scale = zoom * Math.max(1f, density);
            if (maxPixels > 0 && width * height * scale * scale > maxPixels) {
                scale = (float) Math.sqrt(maxPixels / (width * height));
            }
            return new Frame(width, height, scale, palette);
        }

        Bitmap createBitmap() {
            pixelGrid = Math.max(1f, scale);
            return Bitmap.createBitmap(
                    Math.max(1, Math.round(width * scale)),
                    Math.max(1, Math.round(height * scale)),
                    Bitmap.Config.ARGB_8888
            );
        }
    }

    private ScheduleWidgetCardRenderer() {
    }

    // MARK: 临近课程

    /** iOS UpcomingScheduleView：小号放当前一节和接下来一节，中号两栏。 */
    static synchronized Bitmap renderUpcoming(
            Frame frame,
            JSONObject today,
            String week,
            String tag,
            List<JSONObject> courses,
            String[] labels,
            boolean wide
    ) {
        Bitmap bitmap = frame.createBitmap();
        Ink ink = new Ink(bitmap, frame);
        float left = PADDING;
        float top = PADDING;
        float width = frame.width - PADDING * 2f;
        float bottom = frame.height - PADDING;
        String hint = emptyToNull(tag);
        float headerHeight = drawHeader(ink, today, week, !wide, null, false, left, top, width);
        float y = top + headerHeight;

        if (courses == null || courses.isEmpty()) {
            drawRest(ink, today, left, y + 8f, width, bottom);
            return bitmap;
        }
        boolean dimmed = false;
        if (hint != null) {
            drawOtherDayBanner(ink, hint, left, y + 8f, width);
            y += 24f;
        }
        if (wide) {
            String[] safeLabels = hint != null ? new String[]{null, null} : labels != null && labels.length >= 2 ? labels : new String[]{"当前", "接下来"};
            float columnTop = y + 8f;
            float divider = hairline(frame);
            float columnWidth = (width - 28f - divider) / 2f;
            if (dimmed) ink.beginDimmed(left, columnTop, left + width, bottom);
            float labelHeight = hint == null ? lineHeight(11f) + 7f : 0f;
            boolean roomy = courseSummaryHeight(ink, courses.get(0), true, false, columnWidth) + labelHeight <= bottom - columnTop
                    && (courses.size() < 2 || courseSummaryHeight(ink, courses.get(1), true, false, columnWidth) + labelHeight <= bottom - columnTop);
            drawUpcomingColumn(ink, safeLabels[0], courses.get(0), left, columnTop, columnWidth, roomy);
            ink.fill(left + columnWidth + 14f, columnTop, left + columnWidth + 14f + divider, bottom,
                    frame.palette.separator());
            drawUpcomingColumn(ink, safeLabels[1], courses.size() > 1 ? courses.get(1) : null,
                    left + columnWidth + 28f + divider, columnTop, columnWidth, roomy);
            if (dimmed) ink.end();
            return bitmap;
        }

        JSONObject first = courses.get(0);
        boolean showsNext = courses.size() > 1;
        if (dimmed) ink.beginDimmed(left, y, left + width, bottom);
        if (showsNext) {
            // 两节挤在小号里：第一节色条跟着文字走、课名一行；两段空白平分剩下的高度。
            float summary = courseSummaryHeight(ink, first, false, true, width);
            float next = compactNextHeight();
            float free = bottom - y - summary - next;
            float gap = Math.max(8f, free / 2f);
            drawCourseSummary(ink, first, false, true, left, y + gap, width);
            drawCompactNext(ink, courses.get(1), left, y + gap + summary + Math.max(6f, free - gap), width);
        } else {
            // 只有一节：上面的空白撑满，课贴着底边。
            String label = hint == null && labels != null ? labels[0] : null;
            boolean roomy = courseSummaryHeight(ink, first, true, false, width) + (label == null ? 0f : 21f) <= bottom - y - 8f;
            float summary = courseSummaryHeight(ink, first, roomy, false, width);
            float labelHeight = label == null ? 0f : lineHeight(11f) + 7f;
            if (summary + labelHeight > bottom - y - 8f) { label = null; labelHeight = 0f; }
            float inset = bottom - y - summary - labelHeight > 36f ? 14f : 0f;
            drawUpcomingColumn(ink, label, first, left, Math.max(y + 8f, bottom - summary - labelHeight - inset), width, roomy);
        }
        if (dimmed) ink.end();
        return bitmap;
    }

    private static void drawUpcomingColumn(Ink ink, String label, JSONObject course, float x, float y, float width, boolean roomy) {
        ScheduleWidgetPalette palette = ink.frame.palette;
        Paint labelPaint = ink.text(11f, 600, palette.secondary());
        if (label != null) ink.drawText(ellipsize(label, labelPaint, width), x, y, labelPaint);
        float top = y + (label == null ? 0f : lineHeight(11f) + 7f);
        if (course != null) {
            drawCourseSummary(ink, course, roomy, false, x, top, width);
        } else {
            Paint empty = ink.text(11f, 400, palette.muted());
            ink.drawText("暂无课程", x, top, empty);
        }
    }

    // CourseSummary：色条 + 课名 / 地点·老师 / 时间。
    private static float courseSummaryHeight(Ink ink, JSONObject course, boolean roomy, boolean fits, float width) {
        float text = summaryText(ink, course, roomy, fits, width, 0f, 0f, false);
        return text;
    }

    private static void drawCourseSummary(
            Ink ink,
            JSONObject course,
            boolean roomy,
            boolean fits,
            float x,
            float y,
            float width
    ) {
        float gap = 9f;
        float text = summaryText(ink, course, roomy, fits, width, x + 5f + gap, y, true);
        float bar = text;
        ink.bar(x, y, bar, ink.frame.palette.accent(nameOf(course)));
    }

    /** 画（或只量）CourseSummary 右边那一列字，返回高度。 */
    private static float summaryText(
            Ink ink,
            JSONObject course,
            boolean roomy,
            boolean fits,
            float width,
            float x,
            float y,
            boolean draw
    ) {
        ScheduleWidgetPalette palette = ink.frame.palette;
        float textWidth = width - 5f - 9f;
        float spacing = 3f;
        float cursor = y;

        Paint name = ink.text(roomy ? 17f : 15f, 700, palette.primary());
        List<String> lines = fitLines(primaryValue(ink, course), name, textWidth, fits ? 1 : 2, 0.76f);
        for (String line : lines) {
            if (draw) ink.drawText(line, x, cursor, name);
            cursor += lineHeight(name.getTextSize());
        }
        String meta = metadata(ink, course);
        if (meta != null) {
            cursor += spacing;
            Paint metaPaint = ink.text(roomy ? 11f : 10f, 400, palette.secondary());
            if (draw) ink.drawText(ellipsize(meta, metaPaint, textWidth), x, cursor, metaPaint);
            cursor += lineHeight(metaPaint.getTextSize());
        }
        if (!ink.frame.options.showTime) return cursor - y;
        cursor += spacing;
        Paint time = ink.text(roomy ? 12f : 11f, 600, palette.primary());
        String range = timeRange(ink, course);
        shrinkToFit(time, range, textWidth, 0.75f);
        if (draw) ink.drawText(ellipsize(range, time, textWidth), x, cursor, time);
        cursor += lineHeight(time.getTextSize());
        return cursor - y;
    }

    // CompactNextCourse：小号里第二节，色条 27 高，课名 + 时间。
    private static float compactNextHeight() {
        return Math.max(27f, lineHeight(12f) + 1f + lineHeight(9f));
    }

    private static void drawCompactNext(Ink ink, JSONObject course, float x, float y, float width) {
        ScheduleWidgetPalette palette = ink.frame.palette;
        float height = compactNextHeight();
        ink.bar(x, y + (height - 27f) / 2f, 27f, palette.accent(nameOf(course)));
        float textX = x + 5f + 8f;
        float textWidth = width - 13f;
        float textHeight = lineHeight(12f) + 1f + lineHeight(9f);
        float top = y + (height - textHeight) / 2f;
        Paint name = ink.text(12f, 700, palette.primary());
        ink.drawText(ellipsize(primaryValue(ink, course), name, textWidth), textX, top, name);
        String meta = metadata(ink, course);
        String range = timeRange(ink, course);
        String details = meta == null ? range : range.isEmpty() ? meta : meta + " · " + range;
        Paint detail = ink.text(9f, 400, palette.secondary());
        ink.drawText(ellipsize(details, detail, textWidth), textX, top + lineHeight(12f) + 1f, detail);
    }

    // MARK: 今日课表

    /**
     * iOS TodayScheduleView。`tag` 不为空时 `day` 是别的日子的课：日期栏照旧是今天、标上「明天的课」，
     * 课全部压暗。`nowMinutes` 小于 0 表示不按时间灰显。
     */
    static synchronized Bitmap renderToday(
            Frame frame,
            JSONObject today,
            String week,
            JSONObject day,
            String tag,
            boolean large,
            int nowMinutes
    ) {
        Bitmap bitmap = frame.createBitmap();
        Ink ink = new Ink(bitmap, frame);
        float left = PADDING;
        float top = PADDING;
        float width = frame.width - PADDING * 2f;
        float bottom = frame.height - PADDING;
        frame.largeHeader = large;
        float spacing = large ? 8f : 7f;
        List<JSONObject> courses = courseList(day);
        String hint = emptyToNull(tag);

        if (courses.isEmpty()) {
            float header = drawHeader(ink, today, week, false, null, false, left, top, width);
            if (large && courseList(today).isEmpty() && ChineseCalendarInfo.restGreeting(dateOf(today)) != null) {
                drawHolidayGreeting(ink, dateOf(today), left, top + header + spacing, width, bottom);
            } else drawRest(ink, today, left, top + header + spacing, width, bottom);
            return bitmap;
        }
        boolean otherDay = hint != null;
        float headerHeight = headerHeight(ink, today, false, hint);
        float available = bottom - top;

        if (large && frame.options.timeline) {
            float cursor = top + drawHeader(ink, today, week, false, null, false, left, top, width) + 11f;
            if (hint != null) { drawOtherDayBanner(ink, hint, left, cursor, width); cursor += 24f; }
            drawTimeline(ink, courses, nowMinutes, false, left, cursor, width, bottom);
            return bitmap;
        }

        if (large) {
            // 从 7 门往少试，挑第一个放得下的，「后面还有几门」才数得准。
            CourseWindow window = selectCourseWindow(courses, 1, nowMinutes);
            for (int limit = 7; limit >= 1; limit--) {
                window = selectCourseWindow(courses, limit, nowMinutes);
                if (todayListHeight(ink, window, headerHeight, true, spacing, spacing, true) <= available) break;
            }
            drawTodayList(ink, window, today, week, hint, true, otherDay, nowMinutes, left, top, width, spacing, spacing, true);
            return bitmap;
        }

        // 中号固定两门：放不下时两门之间的间隔一档档收，最低 4；还放不下才把提示贴到右下角。
        CourseWindow window = selectCourseWindow(courses, 2, nowMinutes);
        for (float rowSpacing : new float[]{7f, 6f, 5f, 4f}) {
            float height = todayListHeight(ink, window, headerHeight, false, 5f, rowSpacing, true);
            if (height <= available) {
                // 内容比格子矮时整块竖着居中，和 WidgetKit 的默认一样。
                drawTodayList(ink, window, today, week, hint, false, otherDay, nowMinutes,
                        left, top + (available - height) / 2f, width, 5f, rowSpacing, true);
                return bitmap;
            }
        }
        drawTodayList(ink, window, today, week, hint, false, otherDay, nowMinutes, left, top, width, 5f, 6f, false);
        if (window.remainingCount > 0) {
            Paint paint = ink.text(9f, 500, frame.palette.muted());
            String text = remainingText(window.remainingCount);
            ink.drawText(text, left + width - measure(paint, text), bottom + 8f - lineHeight(9f), paint);
        }
        return bitmap;
    }

    private static float todayListHeight(
            Ink ink,
            CourseWindow window,
            float headerHeight,
            boolean large,
            float headerGap,
            float rowSpacing,
            boolean showsRemaining
    ) {
        float height = headerHeight + headerGap;
        for (int index = 0; index < window.courses.size(); index++) {
            if (index > 0) height += rowSpacing;
            height += rowHeight(ink, window.courses.get(index), large, false, large ? 6f : 3f);
        }
        if (showsRemaining && window.remainingCount > 0) height += (large ? 10f : 8f) + lineHeight(9f);
        return height;
    }

    private static void drawTodayList(
            Ink ink,
            CourseWindow window,
            JSONObject today,
            String week,
            String hint,
            boolean large,
            boolean otherDay,
            int nowMinutes,
            float x,
            float y,
            float width,
            float headerGap,
            float rowSpacing,
            boolean showsRemaining
    ) {
        float cursor = y + drawHeader(ink, today, week, false, null, false, x, y, width) + headerGap;
        if (hint != null) { drawOtherDayBanner(ink, hint, x, cursor, width); cursor += 20f; }
        float padding = large ? 6f : 3f;
        for (int index = 0; index < window.courses.size(); index++) {
            JSONObject course = window.courses.get(index);
            if (index > 0) cursor += rowSpacing;
            boolean completed = !otherDay && isCompleted(course, nowMinutes);
            drawRow(ink, course, large, false, completed, padding, x, cursor, width);
            cursor += rowHeight(ink, course, large, false, padding);
        }
        if (showsRemaining && window.remainingCount > 0) {
            // 和上面那门课拉开一点，不然像是那门课的附注。
            cursor += large ? 10f : 8f;
            Paint paint = ink.text(9f, 500, ink.frame.palette.muted());
            String text = remainingText(window.remainingCount);
            ink.drawText(text, x + width - measure(paint, text), cursor, paint);
        }
    }

    private static String remainingText(int count) {
        return "后面还有 " + count + " 门课";
    }

    // TodayCourseRow：带底色的一行课。
    private static float rowHeight(Ink ink, JSONObject course, boolean large, boolean timeOnSeparateLine, float verticalPadding) {
        float bar = large ? 40f : (timeOnSeparateLine ? 39f : 29f);
        return Math.max(bar, rowTextHeight(ink, course, large, timeOnSeparateLine)) + verticalPadding * 2f;
    }

    private static float rowTextHeight(Ink ink, JSONObject course, boolean large, boolean timeOnSeparateLine) {
        float height = lineHeight(large ? 14f : 12f);
        if (metadata(ink, course) != null) height += 2f + lineHeight(large ? 10f : 9f);
        if (timeOnSeparateLine && ink.frame.options.showTime) height += 2f + lineHeight(large ? 10f : 9f);
        return height;
    }

    private static void drawRow(
            Ink ink,
            JSONObject course,
            boolean large,
            boolean timeOnSeparateLine,
            boolean completed,
            float verticalPadding,
            float x,
            float y,
            float width
    ) {
        ScheduleWidgetPalette palette = ink.frame.palette;
        String name = nameOf(course);
        float height = rowHeight(ink, course, large, timeOnSeparateLine, verticalPadding);
        if (completed) ink.beginDimmed(x, y, x + width, y + height);
        float radius = large ? 11f : 8f;
        ink.roundRect(x, y, x + width, y + height, radius, palette.tint(name));

        float horizontal = large ? 9f : 7f;
        float spacing = large ? 9f : 6f;
        float bar = large ? 40f : (timeOnSeparateLine ? 39f : 29f);
        float innerTop = y + verticalPadding;
        float inner = height - verticalPadding * 2f;
        ink.bar(x + horizontal, innerTop + (inner - bar) / 2f, bar, palette.accent(name));

        float textX = x + horizontal + 5f + spacing;
        float right = x + width - horizontal;
        float timeSize = large ? 10f : 9f;
        Paint time = ink.text(timeSize, 600, palette.primary());
        String range = timeRange(ink, course);
        float textRight = right;
        if (!timeOnSeparateLine && ink.frame.options.showTime) {
            // 时间在右边：和左边的字之间至少隔 Spacer(5) 加两份 HStack 间距。
            float maxTime = (right - textX) * 0.5f;
            shrinkToFit(time, range, maxTime, 0.72f);
            String shown = ellipsize(range, time, maxTime);
            float timeWidth = measure(time, shown);
            ink.drawText(shown, right - timeWidth, innerTop + (inner - lineHeight(time.getTextSize())) / 2f, time);
            textRight = right - timeWidth - spacing * 2f - 5f;
        }
        float textWidth = Math.max(0f, textRight - textX);
        float cursor = innerTop + (inner - rowTextHeight(ink, course, large, timeOnSeparateLine)) / 2f;
        Paint namePaint = ink.text(large ? 14f : 12f, 700, palette.primary());
        ink.drawText(ellipsize(primaryValue(ink, course), namePaint, textWidth), textX, cursor, namePaint);
        cursor += lineHeight(namePaint.getTextSize());
        String meta = metadata(ink, course);
        if (meta != null) {
            cursor += 2f;
            Paint metaPaint = ink.text(large ? 10f : 9f, 500, palette.secondary());
            ink.drawText(ellipsize(meta, metaPaint, textWidth), textX, cursor, metaPaint);
            cursor += lineHeight(metaPaint.getTextSize());
        }
        if (timeOnSeparateLine && ink.frame.options.showTime) {
            cursor += 2f;
            shrinkToFit(time, range, textWidth, 0.72f);
            ink.drawText(ellipsize(range, time, textWidth), textX, cursor, time);
        }
        if (completed) ink.end();
    }

    /** iOS DayTimeline / ProportionalStack: minimum readable heights, duration weights and caps. */
    private static void drawTimeline(Ink ink, List<JSONObject> courses, int now, boolean compact,
            float x, float top, float width, float bottom) {
        float timeWidth = ink.frame.options.showTime ? (compact ? 31f : 38f) : 0f;
        float columnGap = timeWidth > 0f ? (compact ? 5f : 8f) : 0f;
        float cardX = x + timeWidth + columnGap;
        float cardWidth = width - timeWidth - columnGap;
        float padding = compact ? 7f : 9f;
        float titleSize = compact ? 12f : 14f;
        float metaSize = compact ? 9f : 10f;
        float textWidth = cardWidth - padding * 2f - 5f - (compact ? 6f : 9f);
        CourseWindow window = selectCourseWindow(courses, 1, now);
        float[] minimum = null, weights = null, caps = null;
        float available = bottom - top;
        for (int limit = Math.min(7, courses.size()); limit >= 1; limit--) {
            window = selectCourseWindow(courses, limit, now);
            int size = window.courses.size() * 2 - 1;
            minimum = new float[size]; weights = new float[size]; caps = new float[size];
            for (int index = 0; index < window.courses.size(); index++) {
                JSONObject course = window.courses.get(index);
                if (index > 0) {
                    int gap = courseGap(window.courses.get(index - 1), course);
                    minimum[index * 2 - 1] = gap >= 30 ? 22f : 6f;
                    weights[index * 2 - 1] = gap * 0.5f;
                    caps[index * 2 - 1] = gap >= 30 ? (compact ? 36f : 44f) : 12f;
                }
                Paint title = ink.text(titleSize, 700, ink.frame.palette.primary());
                int lines = primaryValue(ink, course).isEmpty() ? 0 : 1;
                float textHeight = lines * lineHeight(title.getTextSize());
                if (metadata(ink, course) != null) textHeight += 2f + lineHeight(metaSize);
                minimum[index * 2] = Math.max(34f, 10f + textHeight);
                int start = parseMinutes(ScheduleWidgetJson.text(course, "startTime", ""));
                int end = parseMinutes(ScheduleWidgetJson.text(course, "endTime", ""));
                weights[index * 2] = start < 0 || end < 0 ? 45f : Math.max(20, end - start);
                caps[index * 2] = Math.max(minimum[index * 2], compact ? 96f : 108f);
            }
            available = bottom - top - (window.remainingCount > 0 ? 22f : 0f);
            float sum = 0f;
            for (float value : minimum) sum += value;
            if (sum <= available || limit == 1) break;
        }
        if (minimum == null) return;
        float[] heights = proportionalHeights(minimum, weights, caps, available);
        float y = top;
        for (int index = 0; index < window.courses.size(); index++) {
            JSONObject course = window.courses.get(index);
            if (index > 0) {
                int gap = courseGap(window.courses.get(index - 1), course);
                float h = heights[index * 2 - 1];
                if (gap >= 30) {
                    Paint caption = ink.text(compact ? 9f : 10f, 500, ink.frame.palette.muted());
                    String label = "休息 " + gap + " 分钟";
                    ink.drawText(ellipsize(label, caption, cardWidth - padding - 12f), cardX + padding + 12f,
                            y + (h - lineHeight(caption.getTextSize())) / 2f, caption);
                    for (float dot = y + 3f; dot < y + h - 2f; dot += 5f) {
                        ink.fill(cardX + padding + 2f, dot, cardX + padding + 3f, dot + 2f, ink.frame.palette.separator());
                    }
                }
                y += h;
            }
            float h = heights[index * 2];
            boolean completed = isCompleted(course, now);
            int start = parseMinutes(ScheduleWidgetJson.text(course, "startTime", ""));
            boolean current = now >= 0 && start >= 0 && start <= now && !completed;
            int accent = ink.frame.palette.accent(nameOf(course));
            if (completed) ink.beginDimmed(x, y, x + width, y + h);
            ink.roundRect(cardX, y, cardX + cardWidth, y + h, compact ? 9f : 11f, ink.frame.palette.tint(nameOf(course)));
            ink.bar(cardX + padding, y + 5f, Math.max(2f, h - 10f), accent);
            if (timeWidth > 0f) {
                Paint startPaint = ink.text(compact ? 11f : 12f, 700, current ? accent : ink.frame.palette.primary());
                Paint endPaint = ink.text(compact ? 9f : 10f, 500, ink.frame.palette.secondary());
                String from = ScheduleWidgetJson.text(course, "startTime", "—");
                String to = ScheduleWidgetJson.text(course, "endTime", "");
                shrinkToFit(startPaint, from, timeWidth, 0.7f);
                shrinkToFit(endPaint, to, timeWidth, 0.7f);
                ink.drawText(from, x + timeWidth - measure(startPaint, from), y + 2f, startPaint);
                ink.drawText(to, x + timeWidth - measure(endPaint, to), y + h - 2f - lineHeight(endPaint.getTextSize()), endPaint);
            }
            float tx = cardX + padding + 5f + (compact ? 6f : 9f);
            float cursor = y + 5f;
            Paint title = ink.text(titleSize, 700, ink.frame.palette.primary());
            ink.drawText(ellipsize(primaryValue(ink, course), title, textWidth), tx, cursor, title);
            cursor += lineHeight(titleSize) + 2f;
            Paint meta = ink.text(metaSize, 500, ink.frame.palette.secondary());
            ScheduleWidgetOptions options = ink.frame.options;
            String teacher = options.showTeacher && (options.showCourseName || options.showRoom) ? ScheduleWidgetJson.text(course, "teacher", "") : "";
            String room = options.showCourseName && options.showRoom ? ScheduleWidgetJson.text(course, "location", "") : "";
            float threeLines = 10f + lineHeight(titleSize) + 2f + (teacher.isEmpty() ? 0f : lineHeight(metaSize) + 2f) + lineHeight(metaSize);
            if (!room.isEmpty() && h >= threeLines) {
                if (!teacher.isEmpty()) ink.drawText(ellipsize(teacher, meta, textWidth), tx, cursor, meta);
                ink.drawText(ellipsize(room, meta, textWidth), tx, y + h - 5f - lineHeight(metaSize), meta);
            } else {
                String metadata = metadata(ink, course);
                if (metadata != null) ink.drawText(ellipsize(metadata, meta, textWidth), tx, cursor, meta);
            }
            if (completed) ink.end();
            y += h;
        }
        if (window.remainingCount > 0) {
            Paint paint = ink.text(9f, 500, ink.frame.palette.muted());
            String text = ellipsize(remainingText(window.remainingCount), paint, width);
            ink.drawText(text, x + width - measure(paint, text), y + 10f, paint);
        }
    }

    static float[] proportionalHeights(float[] minimum, float[] weights, float[] caps, float available) {
        float low = 0f, high = Math.max(1f, available);
        for (int step = 0; step < 32; step++) {
            float scale = (low + high) / 2f, sum = 0f;
            for (int i = 0; i < minimum.length; i++) sum += Math.min(caps[i], Math.max(minimum[i], weights[i] * scale));
            if (sum > available) high = scale; else low = scale;
        }
        float[] result = new float[minimum.length];
        for (int i = 0; i < result.length; i++) result[i] = Math.min(caps[i], Math.max(minimum[i], weights[i] * low));
        return result;
    }

    private static int courseGap(JSONObject previous, JSONObject next) {
        int end = parseMinutes(ScheduleWidgetJson.text(previous, "endTime", ""));
        int start = parseMinutes(ScheduleWidgetJson.text(next, "startTime", ""));
        return end < 0 || start < 0 ? 0 : Math.max(0, start - end);
    }

    // MARK: 两日课表

    /**
     * iOS TwoDayScheduleView：左列今天，右列 `other`，中间一条分隔线，没有标题、没有卡片边框。
     * 右列不是明天时两列日期栏下都留一行「后天的课」的位置（左列不显示），两列的课才对得齐。
     */
    static synchronized Bitmap renderTwoDay(
            Frame frame,
            JSONObject today,
            String todayWeek,
            JSONObject other,
            String otherWeek,
            String otherTag,
            int nowMinutes
    ) {
        Bitmap bitmap = frame.createBitmap();
        Ink ink = new Ink(bitmap, frame);
        float left = PADDING;
        float top = PADDING;
        float width = frame.width - PADDING * 2f;
        float bottom = frame.height - PADDING;
        float divider = hairline(frame);
        float columnWidth = (width - 26f - divider) / 2f;
        String hint = emptyToNull(otherTag);
        // 明天那一列没课就照常说「没有课程」，祝福只属于今天。
        drawDayColumn(ink, today, todayWeek.equals(otherWeek) ? "" : todayWeek, hint, true, nowMinutes,
                "今日无课", left, top, columnWidth, bottom);
        ink.fill(left + columnWidth + 13f, top, left + columnWidth + 13f + divider, bottom, frame.palette.separator());
        drawDayColumn(ink, other, otherWeek, hint, false, -1, "没有课程",
                left + columnWidth + 26f + divider, top, columnWidth, bottom);
        return bitmap;
    }

    private static void drawDayColumn(
            Ink ink,
            JSONObject day,
            String week,
            String hint,
            boolean hidesHint,
            int nowMinutes,
            String emptyText,
            float x,
            float y,
            float width,
            float bottom
    ) {
        // 日期栏和下面的课拉开 18，比课与课之间松。
        float cursor = y + drawHeader(ink, day, week, true, hint, hidesHint, x, y, width) + 18f;
        List<JSONObject> courses = courseList(day);
        if (courses.isEmpty()) {
            if (hidesHint && ChineseCalendarInfo.restGreeting(dateOf(day)) != null) {
                drawHolidayGreeting(ink, dateOf(day), x, cursor, width, bottom);
                return;
            }
            Paint paint = ink.text(12f, 600, ink.frame.palette.muted());
            String text = ellipsize(emptyText, paint, width);
            ink.drawText(text, x + (width - measure(paint, text)) / 2f,
                    (cursor + bottom) / 2f - lineHeight(12f) / 2f, paint);
            return;
        }
        if (ink.frame.options.timeline) {
            drawTimeline(ink, courses, nowMinutes, true, x, cursor, width, bottom);
            return;
        }
        int limit = Math.max(1, Math.min(5, (int) ((bottom - cursor + 7f) / 54f)));
        CourseWindow window = selectCourseWindow(courses, limit, nowMinutes);
        for (int index = 0; index < window.courses.size(); index++) {
            JSONObject course = window.courses.get(index);
            if (index > 0) cursor += 7f;
            drawRow(ink, course, false, true, isCompleted(course, nowMinutes), 4f, x, cursor, width);
            cursor += rowHeight(ink, course, false, true, 4f);
        }
        if (window.remainingCount > 0) {
            Paint paint = ink.text(9f, 500, ink.frame.palette.muted());
            ink.drawText(ellipsize(remainingText(window.remainingCount), paint, width), x, Math.min(cursor + 7f, bottom - lineHeight(9f)), paint);
        }
    }

    // MARK: 日期栏

    private static float headerHeight(Ink ink, JSONObject day, boolean compact, String hint) {
        HeaderParts parts = new HeaderParts(ink, day, compact);
        return parts.rowHeight + (hint == null ? 0f : 20f);
    }

    /**
     * iOS WidgetDateHeader：日期 | 星期 | 农历（竖排，一字一行），右边节日徽标和「第 N 周」；
     * 显示的是别的日子时第二行右边一个「明天的课」胶囊。窄的（小号、两日课表的列）没有徽标，
     * 节日顶替农历那一列。返回高度。
     */
    private static float drawHeader(
            Ink ink,
            JSONObject day,
            String week,
            boolean compact,
            String hint,
            boolean hidesHint,
            float x,
            float y,
            float width
    ) {
        ScheduleWidgetPalette palette = ink.frame.palette;
        HeaderParts parts = new HeaderParts(ink, day, compact);
        float spacing = compact ? 4f : (ink.frame.largeHeader ? 8f : 6f);
        float dateSize = ink.frame.largeHeader && !compact ? 26f : 19f;
        float columnHeight = ink.frame.largeHeader && !compact ? 32f : 24f;
        float center = y + parts.rowHeight / 2f;

        Paint datePaint = ink.text(dateSize, 700, palette.primary());
        ink.drawText(parts.date, x, center - lineHeight(dateSize) / 2f, datePaint);
        float cursor = x + measure(datePaint, parts.date) + spacing;
        ink.fill(cursor, center - columnHeight / 2f, cursor + 1f, center + columnHeight / 2f, palette.columnDivider());
        float end = cursor + 1f;
        cursor = end + spacing;
        if (parts.weekday != null) {
            int color = "周六".equals(parts.weekday) || "周日".equals(parts.weekday) ? palette.pink() : palette.accent();
            end = cursor + drawVertical(ink, parts.weekday, 700, color, cursor, center);
            cursor = end + spacing;
        }
        if (parts.weekday != null && parts.detail != null) {
            ink.fill(cursor, center - columnHeight / 2f, cursor + 1f, center + columnHeight / 2f, palette.columnDivider());
            end = cursor + 1f;
            cursor = end + spacing;
        }
        if (parts.detail != null) {
            int color = parts.detailHighlighted
                    ? (parts.statutory ? palette.pink() : palette.accent())
                    : palette.secondary();
            end = cursor + drawVertical(ink, parts.detail, 500, color, cursor, center);
        }

        float right = x + width;
        float badgeWidth = 0f;
        Paint pillPaint = ink.text(9f, 700, palette.accent());
        if (!compact && parts.badge != null) badgeWidth = measure(pillPaint, parts.badge) + 10f;
        if (week != null && !week.isEmpty()) {
            // 放不下「第 N 周」先去掉空格、再缩字，都放不下才不显示；也别去挤左边的日期。
            float available = right - end - spacing * 2f - 4f - (badgeWidth > 0f ? badgeWidth + spacing : 0f);
            String[] texts = {"第 " + week + " 周", "第" + week + "周", "第" + week + "周", "第" + week + "周"};
            float[] sizes = {ink.frame.largeHeader && !compact ? 12f : 10f, 10f, 9f, 8f};
            for (int index = 0; index < texts.length; index++) {
                Paint paint = ink.text(sizes[index], 600, palette.secondary());
                float textWidth = measure(paint, texts[index]);
                if (textWidth <= available) {
                    ink.drawText(texts[index], right - textWidth, center - lineHeight(sizes[index]) / 2f, paint);
                    right -= textWidth + spacing;
                    break;
                }
            }
        }
        if (badgeWidth > 0f) {
            drawPill(ink, parts.badge, parts.statutory ? palette.pink() : palette.accent(),
                    right - badgeWidth, center - pillHeight() / 2f);
        }

        if (hint == null) return parts.rowHeight;
        // 「明天的课」胶囊比字高，和上一行留 4 的空。两日课表今天那一列只占位不显示。
        if (!hidesHint) {
            float hintWidth = measure(pillPaint, hint) + 10f;
            drawPill(ink, hint, palette.accent(), x + width - hintWidth, y + parts.rowHeight + 4f);
        }
        return parts.rowHeight + 4f + pillHeight();
    }

    private static final class HeaderParts {
        final String date;
        final String weekday;
        final String detail;
        final String badge;
        final boolean statutory;
        final boolean detailHighlighted;
        final float rowHeight;

        HeaderParts(Ink ink, JSONObject day, boolean compact) {
            String compactDate = compactDate(day == null ? "" : ScheduleWidgetJson.text(day, "date", ""));
            date = compactDate.isEmpty() ? "课表" : compactDate;
            weekday = emptyToNull(cleanDayLabel(day == null ? "" : ScheduleWidgetJson.text(day, "label", "")));
            ChineseCalendarInfo.CalendarDay info = ChineseCalendarInfo.info(dateOf(day));
            badge = info == null || !ink.frame.options.showHoliday ? null : info.badge();
            statutory = info != null && info.isStatutoryHoliday();
            // 宽的日期栏放农历（节日已经在右侧徽标里），窄的没有徽标，节日顶上来。
            detailHighlighted = compact && badge != null;
            detail = detailHighlighted ? badge : (info == null || !ink.frame.options.showLunarDate ? null : info.lunar.shortLabel());
            float height = ink.frame.largeHeader && !compact ? 32f : 24f;


            if (!compact && badge != null) height = Math.max(height, pillHeight());
            rowHeight = height;
        }
    }

    private static float verticalSize(String value) {
        return value.codePointCount(0, value.length()) > 2 ? 8f : 10f;
    }

    /** 一字一行的竖排；三个字的节日名收一号字、行距收 1，免得把日期栏撑高。 */
    private static float verticalHeight(String value) {
        int count = value.codePointCount(0, value.length());
        float spacing = count > 2 ? -1f : 0f;
        return count * lineHeight(verticalSize(value)) + Math.max(0, count - 1) * spacing;
    }

    /** 画竖排字，以 `center` 竖直居中，返回列宽。 */
    private static float drawVertical(Ink ink, String value, int weight, int color, float x, float center) {
        float size = verticalSize(value) + (ink.frame.largeHeader ? 3f : 0f);
        Paint paint = ink.text(size, weight, color);
        List<String> characters = new ArrayList<>();
        float columnWidth = 0f;
        for (int offset = 0; offset < value.length(); ) {
            int codePoint = value.codePointAt(offset);
            String character = new String(Character.toChars(codePoint));
            characters.add(character);
            columnWidth = Math.max(columnWidth, measure(paint, character));
            offset += Character.charCount(codePoint);
        }
        float spacing = characters.size() > 2 ? -1f : 0f;
        float cursor = center - verticalHeight(value) / 2f;
        for (String character : characters) {
            ink.drawText(character, x + (columnWidth - measure(paint, character)) / 2f, cursor, paint);
            cursor += lineHeight(size) + spacing;
        }
        return columnWidth;
    }

    /** 节日徽标和「明天的课」：9pt 粗体，左右 5 上下 2，底色是字色 16%。 */
    private static void drawPill(Ink ink, String text, int color, float x, float y) {
        Paint paint = ink.text(9f, 700, color);
        float width = measure(paint, text) + 10f;
        ink.roundRect(x, y, x + width, y + pillHeight(), pillHeight() / 2f,
                ScheduleWidgetPalette.withAlpha(color, 0.16f));
        ink.drawText(text, x + 5f, y + 2f, paint);
    }

    // MARK: 休息状态

    /** iOS RestStateView: status above, holiday's three lines aligned to the bottom. */
    private static void drawRest(Ink ink, JSONObject today, float x, float top, float width, float bottom) {
        String date = dateOf(today);
        String status = courseList(today).isEmpty() ? "今日无课" : "今日课程已结束";
        ChineseCalendarInfo.HolidayCountdown holiday = ink.frame.options.showHoliday
                ? ChineseCalendarInfo.countdown(date, ChineseCalendarInfo.REST_COUNTDOWN_DAYS) : null;
        if (holiday == null) {
            centered(ink, status, 13f, 600, ink.frame.palette.muted(), x, (top + bottom) / 2f - 8f, width);
            return;
        }
        if (holiday.daysAway > 0) {
            Paint statusPaint = ink.text(11f, 600, ink.frame.palette.muted());
            ink.drawText(ellipsize(status, statusPaint, width), x, top, statusPaint);
        }
        String caption = holiday.daysAway == 0 ? "放假中" : holiday.daysAway == 1 ? "明天" : holiday.daysAway + " 天后";
        String title = holiday.daysAway == 0 ? ChineseCalendarInfo.restGreeting(date) : holiday.window.name;
        float cursor = Math.max(top + (holiday.daysAway > 0 ? 20f : 0f), bottom - lineHeight(11f) - 5f - lineHeight(15f) - 2f - lineHeight(10f));
        Paint label = ink.text(11f, 600, ink.frame.palette.secondary());
        ink.drawText(caption, x, cursor, label);
        cursor += lineHeight(11f) + 5f;
        Paint heading = ink.text(15f, 700, ink.frame.palette.primary());
        shrinkToFit(heading, title, width, 0.76f);
        ink.drawText(ellipsize(title, heading, width), x, cursor, heading);
        cursor += lineHeight(15f) + 2f;
        Paint detail = ink.text(10f, 500, ink.frame.palette.secondary());
        shrinkToFit(detail, holiday.dateLabel(), width, 0.8f);
        ink.drawText(ellipsize(holiday.dateLabel(), detail, width), x, cursor, detail);
    }

    private static void centered(Ink ink, String text, float size, int weight, int color, float x, float y, float width) {
        Paint paint = ink.text(size, weight, color);
        shrinkToFit(paint, text, width, 0.8f);
        String shown = ellipsize(text, paint, width);
        ink.drawText(shown, x + (width - measure(paint, shown)) / 2f, y, paint);
    }

    private static void drawOtherDayBanner(Ink ink, String hint, float x, float y, float width) {
        String[] pieces = hint.split(" ", 2);
        Paint label = ink.text(10f, 800, android.graphics.Color.WHITE);
        float pill = measure(label, pieces[0]) + 12f;
        ink.roundRect(x, y, x + pill, y + 16f, 8f, ink.frame.palette.accent());
        ink.drawText(pieces[0], x + 6f, y + 2f, label);
        if (pieces.length > 1) {
            Paint detail = ink.text(11f, 600, ink.frame.palette.secondary());
            ink.drawText(ellipsize(pieces[1], detail, Math.max(0, width - pill - 5f)), x + pill + 5f, y + 1f, detail);
        }
    }

    private static void drawHolidayGreeting(Ink ink, String date, float x, float top, float width, float bottom) {
        String greeting = ChineseCalendarInfo.restGreeting(date);
        ChineseCalendarInfo.HolidayCountdown holiday = ink.frame.options.showHoliday ? ChineseCalendarInfo.countdown(date, 0) : null;
        int total = holiday == null ? 0 : holiday.window.dayCount();
        boolean progress = total > 1 && total <= 12;
        float height = 44f + 10f + lineHeight(17f) + (holiday == null ? 0 : 4f + lineHeight(10f)) + (progress ? 36f : 0);
        float y = Math.max(top, (top + bottom - height) / 2f - 8f);
        if (greeting != null && greeting.startsWith("清明")) {
            Paint leaf = ink.text(30f, 600, ink.frame.palette.pink());
            Path path = new Path();
            float cx = x + width / 2f;
            path.moveTo(cx - 12f, y + 32f); path.cubicTo(cx - 20f, y, cx + 10f, y + 4f, cx + 15f, y);
            path.cubicTo(cx + 20f, y + 24f, cx, y + 42f, cx - 12f, y + 32f);
            ink.canvas.drawPath(path, leaf);
        } else drawPartyPopper(ink, x + width / 2f, y, 30f, ink.frame.palette.pink());
        y += 54f;
        centered(ink, greeting == null ? "今日无课" : greeting, 17f, 700, ink.frame.palette.primary(), x, y, width);
        y += lineHeight(17f) + 4f;
        if (holiday != null) {
            String detail = progress ? ChineseCalendarInfo.monthDayLabel(holiday.window.start) + " - " + ChineseCalendarInfo.monthDayLabel(holiday.window.end) : holiday.dateLabel();
            centered(ink, detail, 10f, 500, ink.frame.palette.secondary(), x, y, width);
            y += lineHeight(10f) + 12f;
        }
        if (progress) {
            int day = Math.max(1, Math.min(total, ChineseCalendarInfo.dayGap(holiday.window.start, date) + 1));
            float dotsX = x + (width - (total * 10f - 4f)) / 2f;
            for (int i = 0; i < total; i++) ink.roundRect(dotsX + i * 10f, y, dotsX + i * 10f + 6f, y + 6f, 3f,
                    i < day ? ink.frame.palette.pink() : ink.frame.palette.separator());
            y += 12f;
            centered(ink, day == total ? "假期最后一天" : "第 " + day + " 天 · 还剩 " + (total - day) + " 天", 9f, 600, ink.frame.palette.muted(), x, y, width);
        }
    }

    /**
     * SF Symbols 的 party.popper 在安卓上没有，照着描一个：左下角的喇叭筒加右上方的彩屑。
     * 坐标按 15pt 的图标量出来，`frameTop` 是图标所在那一行的顶。
     */
    private static void drawPartyPopper(Ink ink, float centerX, float frameTop, float size, int color) {
        float unit = size / 15f;
        float width = 19.3f * unit;
        float left = centerX - width / 2f;
        float top = frameTop + 1f * unit;
        Canvas canvas = ink.canvas;
        canvas.save();
        canvas.translate(left, top);
        canvas.scale(unit, unit);
        Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(1.25f);
        stroke.setStrokeCap(Paint.Cap.ROUND);
        stroke.setStrokeJoin(Paint.Join.ROUND);
        stroke.setColor(color);
        Path cone = new Path();
        cone.moveTo(5.0f, 7.4f);
        cone.lineTo(0.8f, 17.2f);
        cone.quadTo(0.4f, 18.2f, 1.4f, 17.9f);
        cone.lineTo(12.3f, 12.8f);
        cone.quadTo(9.1f, 12.9f, 7.0f, 10.9f);
        cone.quadTo(5.2f, 9.1f, 5.0f, 7.4f);
        canvas.drawPath(cone, stroke);
        // 筒里的两道彩带
        canvas.drawLine(3.5f, 11.3f, 7.1f, 14.7f, stroke);
        canvas.drawLine(7.3f, 2.9f, 7.9f, 8.4f, stroke);
        canvas.drawLine(8.6f, 7.1f, 12.4f, 4.2f, stroke);
        canvas.drawLine(10.0f, 11.0f, 15.9f, 10.9f, stroke);
        canvas.drawLine(14.3f, 4.0f, 16.0f, 2.2f, stroke);
        Paint dot = new Paint(Paint.ANTI_ALIAS_FLAG);
        dot.setColor(color);
        float[][] dots = {
                {7.2f, 0.8f, 0.75f}, {11.4f, 1.5f, 1.15f}, {17.6f, 1.2f, 0.7f}, {10.2f, 5.0f, 0.7f},
                {15.2f, 7.8f, 1.15f}, {18.4f, 8.0f, 0.8f}, {18.0f, 11.6f, 0.8f},
        };
        for (float[] d : dots) canvas.drawCircle(d[0], d[1], d[2], dot);
        canvas.restore();
    }

    // MARK: 选课

    static CourseWindow selectCourseWindow(List<JSONObject> courses, int limit, int nowMinutes) {
        int safeLimit = Math.max(0, limit);
        int overflow = Math.max(0, courses.size() - safeLimit);
        int completedPrefix = 0;
        if (nowMinutes >= 0) {
            while (completedPrefix < courses.size() && isCompleted(courses.get(completedPrefix), nowMinutes)) {
                completedPrefix++;
            }
        }
        int skip = Math.min(overflow, completedPrefix);
        int end = Math.min(courses.size(), skip + safeLimit);
        List<JSONObject> selected = new ArrayList<>(courses.subList(skip, end));
        return new CourseWindow(selected, Math.max(0, courses.size() - end), skip);
    }

    static boolean isCompleted(JSONObject course, int nowMinutes) {
        if (course == null || nowMinutes < 0) return false;
        int end = parseMinutes(ScheduleWidgetJson.text(course, "endTime", ""));
        if (end < 0) {
            int start = parseMinutes(ScheduleWidgetJson.text(course, "startTime", ""));
            end = start < 0 ? -1 : start + 45;
        }
        return end >= 0 && end < nowMinutes;
    }

    static final class CourseWindow {
        final List<JSONObject> courses;
        final int remainingCount;
        final int skippedCompletedCount;

        CourseWindow(List<JSONObject> courses, int remainingCount, int skippedCompletedCount) {
            this.courses = courses;
            this.remainingCount = remainingCount;
            this.skippedCompletedCount = skippedCompletedCount;
        }
    }

    // MARK: 画笔

    /** 画布和画笔。画布已经按 frame.scale 缩放，下面的坐标一律是 pt。 */
    private static final class Ink {
        final Canvas canvas;
        final Frame frame;
        private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);

        Ink(Bitmap bitmap, Frame frame) {
            this.canvas = new Canvas(bitmap);
            this.frame = frame;
            canvas.scale(frame.scale, frame.scale);
        }

        Paint text(float size, int weight, int color) {
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
            paint.setTypeface(typeface(weight));
            paint.setTextSize(size);
            paint.setColor(color);
            return paint;
        }

        void drawText(String text, float x, float top, Paint paint) {
            float baseline = top + paint.getTextSize() * ASCENT;
            float cursor = x;
            for (String run : runs(text)) {
                paint.setLetterSpacing(isCjk(run.codePointAt(0)) ? 0f : LATIN_TRACKING);
                canvas.drawText(run, cursor, baseline, paint);
                cursor += paint.measureText(run);
            }
            paint.setLetterSpacing(0f);
        }

        void fill(float left, float top, float right, float bottom, int color) {
            fill.setColor(color);
            canvas.drawRect(left, top, right, bottom, fill);
        }

        void roundRect(float left, float top, float right, float bottom, float radius, int color) {
            fill.setColor(color);
            canvas.drawRoundRect(new RectF(left, top, right, bottom), radius, radius, fill);
        }

        /** 课程色条：5 宽，圆角 3。 */
        void bar(float x, float y, float height, int color) {
            roundRect(x, y, x + 5f, y + height, 3f, color);
        }

        /** 之后画的内容去色、56% 不透明，到 end() 为止。 */
        void beginDimmed(float left, float top, float right, float bottom) {
            ColorMatrix matrix = new ColorMatrix();
            matrix.setSaturation(0f);
            Paint layer = new Paint();
            layer.setColorFilter(new ColorMatrixColorFilter(matrix));
            layer.setAlpha(DIMMED_ALPHA);
            canvas.saveLayer(new RectF(left - 1f, top - 1f, right + 1f, bottom + 1f), layer);
        }

        void end() {
            canvas.restore();
        }
    }

    private static Typeface typeface(int weight) {
        int slot = Math.max(1, Math.min(9, weight / 100));
        Typeface cached = TYPEFACES[slot];
        if (cached != null) return cached;
        Typeface created = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? Typeface.create(Typeface.DEFAULT, slot * 100, false)
                : (slot >= 6 ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        TYPEFACES[slot] = created;
        return created;
    }

    // MARK: 文字

    /** 按中文 / 非中文分段量宽度：非中文那段加一点字距，见 LATIN_TRACKING。 */
    private static float measure(Paint paint, String text) {
        float width = 0f;
        for (String run : runs(text)) {
            paint.setLetterSpacing(isCjk(run.codePointAt(0)) ? 0f : LATIN_TRACKING);
            width += paint.measureText(run);
        }
        paint.setLetterSpacing(0f);
        return width;
    }

    private static List<String> runs(String text) {
        List<String> runs = new ArrayList<>();
        if (text == null || text.isEmpty()) return runs;
        int start = 0;
        boolean cjk = isCjk(text.codePointAt(0));
        for (int offset = 0; offset < text.length(); ) {
            int codePoint = text.codePointAt(offset);
            boolean next = isCjk(codePoint);
            if (next != cjk) {
                runs.add(text.substring(start, offset));
                start = offset;
                cjk = next;
            }
            offset += Character.charCount(codePoint);
        }
        runs.add(text.substring(start));
        return runs;
    }

    private static boolean isCjk(int codePoint) {
        Character.UnicodeScript script = Character.UnicodeScript.of(codePoint);
        return script == Character.UnicodeScript.HAN
                || (codePoint >= 0x3000 && codePoint <= 0x303F)
                || (codePoint >= 0xFF00 && codePoint <= 0xFFEF);
    }

    private static float lineHeight(float size) {
        return (float) Math.ceil(size * LINE_HEIGHT * pixelGrid - 0.01f) / pixelGrid;
    }

    private static float pillHeight() {
        return lineHeight(9f) + 4f;
    }

    /** SwiftUI 的 Divider：一个物理像素宽。 */
    private static float hairline(Frame frame) {
        return 1f / Math.max(1f, frame.scale);
    }

    /** minimumScaleFactor：放不下时缩字，最多缩到 minScale。 */
    private static void shrinkToFit(Paint paint, String text, float maxWidth, float minScale) {
        float size = paint.getTextSize();
        float min = size * minScale;
        while (measure(paint, text) > maxWidth && paint.getTextSize() > min) {
            paint.setTextSize(Math.max(min, paint.getTextSize() - 0.25f));
        }
    }

    /** lineLimit + minimumScaleFactor：先按字折行，折不下再缩字，最后一行放不下加省略号。 */
    private static List<String> fitLines(String text, Paint paint, float maxWidth, int maxLines, float minScale) {
        List<String> lines = wrap(text, paint, maxWidth, maxLines);
        float min = paint.getTextSize() * minScale;
        while (lines == null && paint.getTextSize() > min) {
            paint.setTextSize(Math.max(min, paint.getTextSize() - 0.25f));
            lines = wrap(text, paint, maxWidth, maxLines);
        }
        if (lines != null) return lines;
        lines = wrap(text, paint, maxWidth, Integer.MAX_VALUE);
        List<String> kept = new ArrayList<>(lines.subList(0, Math.min(maxLines, lines.size())));
        StringBuilder rest = new StringBuilder();
        for (int index = maxLines - 1; index < lines.size(); index++) rest.append(lines.get(index));
        kept.set(kept.size() - 1, ellipsize(rest.toString(), paint, maxWidth));
        return kept;
    }

    /** 按字折行；超过 maxLines 行返回 null。 */
    private static List<String> wrap(String text, Paint paint, float maxWidth, int maxLines) {
        List<String> lines = new ArrayList<>();
        String source = text == null ? "" : text;
        int start = 0;
        while (start < source.length()) {
            int end = start + Character.charCount(source.codePointAt(start));
            while (end < source.length()) {
                int next = end + Character.charCount(source.codePointAt(end));
                if (measure(paint, source.substring(start, next)) > maxWidth) break;
                end = next;
            }
            lines.add(source.substring(start, end));
            if (lines.size() > maxLines) return null;
            start = end;
        }
        if (lines.isEmpty()) lines.add("");
        return lines;
    }

    private static String ellipsize(String value, Paint paint, float maxWidth) {
        if (value == null) return "";
        if (measure(paint, value) <= maxWidth) return value;
        int end = value.length();
        while (end > 0 && measure(paint, value.substring(0, end) + "…") > maxWidth) end--;
        return value.substring(0, end) + "…";
    }

    // MARK: 数据

    private static List<JSONObject> courseList(JSONObject day) {
        List<JSONObject> courses = new ArrayList<>();
        JSONArray source = day == null ? null : day.optJSONArray("courses");
        if (source == null) return courses;
        for (int index = 0; index < source.length(); index++) {
            JSONObject course = source.optJSONObject(index);
            if (course != null) courses.add(course);
        }
        return courses;
    }

    private static String nameOf(JSONObject course) {
        return ScheduleWidgetPalette.displayName(course == null ? "" : ScheduleWidgetJson.text(course, "name", ""));
    }

    private static String primaryValue(Ink ink, JSONObject course) {
        ScheduleWidgetOptions options = ink.frame.options;
        if (options.showCourseName) return nameOf(course);
        if (options.showRoom) return ScheduleWidgetJson.text(course, "location", "");
        if (options.showTeacher) return ScheduleWidgetJson.text(course, "teacher", "");
        return options.showTime ? timeRange(ink, course) : "";
    }

    /** 「C204 · 苏老师」；两样都没有就不显示这一行。 */
    private static String metadata(Ink ink, JSONObject course) {
        String location = course == null || !ink.frame.options.showRoom ? "" : ScheduleWidgetJson.text(course, "location", "").trim();
        String teacher = course == null || !ink.frame.options.showTeacher ? "" : ScheduleWidgetJson.text(course, "teacher", "").trim();
        if (!location.isEmpty() && !teacher.isEmpty()) return location + " · " + teacher;
        if (!location.isEmpty()) return location;
        return teacher.isEmpty() ? null : teacher;
    }

    private static String timeRange(Ink ink, JSONObject course) {
        if (!ink.frame.options.showTime) return "";
        String start = course == null ? "" : ScheduleWidgetJson.text(course, "startTime", "").trim();
        String end = course == null ? "" : ScheduleWidgetJson.text(course, "endTime", "").trim();
        if (start.isEmpty()) return "时间待确认";
        return end.isEmpty() ? start : start + " - " + end;
    }

    private static String compactDate(String value) {
        if (value == null || value.length() < 10) return "";
        try {
            return Integer.parseInt(value.substring(5, 7)) + "." + Integer.parseInt(value.substring(8, 10));
        } catch (Exception ignored) {
            return value.substring(5).replace("-", ".");
        }
    }

    private static String dateOf(JSONObject day) {
        return day == null ? "" : ScheduleWidgetJson.text(day, "date", "").trim();
    }

    private static String cleanDayLabel(String value) {
        return value == null ? "" : value.replace("今天", "").trim();
    }

    private static String emptyToNull(String value) {
        return value == null || value.trim().isEmpty() ? null : value;
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
}
