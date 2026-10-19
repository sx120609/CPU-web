package cn.lizmt.cpuweb.schedule;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

/**
 * 按 iOS 截图脚本（/tmp/widget-snap 里 ScheduleWidgets.swift 的 SnapshotData）同一份课表、同样的时刻画预览，
 * 输出到 build/reports/widget-previews/ios-compare/，文件名和 iOS 那份一一对应，方便并排比对。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class ScheduleWidgetCardRendererTest {
    private static final String[][] MOMENTS = {
            {"1-class", "2026-09-28", "10:30"},
            {"2-before", "2026-09-28", "07:30"},
            {"3-evening", "2026-09-28", "21:00"},
            {"4-weekend", "2026-09-26", "10:00"},
            {"5-holiday", "2026-10-01", "10:00"},
            {"6-break", "2027-01-25", "10:00"},
    };
    private static final Object[][] WIDGETS = {
            {"upcoming-small", ScheduleWidgetProvider.WidgetMode.COMPACT},
            {"upcoming-medium", ScheduleWidgetProvider.WidgetMode.WIDE},
            {"today-medium", ScheduleWidgetProvider.WidgetMode.TODAY_WIDE},
            {"today-large", ScheduleWidgetProvider.WidgetMode.TODAY_LARGE},
            {"twoday-large", ScheduleWidgetProvider.WidgetMode.LARGE},
    };

    @Before
    public void useOfflineHolidays() {
        // iOS 截图脚本没有带服务端的放假安排，两边都按节日离线推算。
        ChineseCalendarInfo.usePublishedHolidays(new ArrayList<>());
    }

    @After
    public void resetHolidays() {
        ChineseCalendarInfo.usePublishedHolidays(new ArrayList<>());
    }

    @Test
    public void rendersTheSameMomentsAsTheIosSnapshots() throws Exception {
        JSONObject record = snapshotRecord();
        for (String[] moment : MOMENTS) {
            JSONObject data = ScheduleWidgetLocalDays.payload(record, moment[1]);
            for (Object[] widget : WIDGETS) {
                ScheduleWidgetProvider.WidgetMode mode = (ScheduleWidgetProvider.WidgetMode) widget[1];
                boolean withDark = moment[0].equals("1-class") || moment[0].equals("5-holiday");
                for (boolean dark : withDark ? new boolean[]{false, true} : new boolean[]{false}) {
                    Bitmap bitmap = render(data, mode, moment[1], moment[2], ScheduleWidgetPalette.DEFAULT_THEME, dark);
                    ScheduleWidgetCardRenderer.Family family = ScheduleWidgetProvider.family(mode);
                    assertEquals(Math.round(family.width * 3), bitmap.getWidth());
                    assertEquals(Math.round(family.height * 3), bitmap.getHeight());
                    save(framed(bitmap, dark), moment[0] + "_" + widget[0] + "_" + (dark ? "dark" : "light") + ".png");
                }
            }
        }
    }

    @Test
    public void rendersEveryTheme() throws Exception {
        JSONObject data = ScheduleWidgetLocalDays.payload(snapshotRecord(), "2026-09-28");
        for (String theme : ScheduleWidgetPalette.THEMES) {
            Bitmap bitmap = render(data, ScheduleWidgetProvider.WidgetMode.TODAY_LARGE, "2026-09-28", "10:30", theme, false);
            save(framed(bitmap, false), "theme-" + theme + "_today-large_light.png");
        }
    }

    /** 桌面「添加小组件」里的预览图（res/drawable-nodpi 和 drawable-night-nodpi 里那几张就是从这里拷的）。 */
    @Test
    public void rendersPickerPreviews() throws Exception {
        JSONObject data = ScheduleWidgetLocalDays.payload(snapshotRecord(), "2026-09-28");
        String[][] names = {
                {"widget_schedule_upcoming_compact_preview", "COMPACT"},
                {"widget_schedule_upcoming_wide_preview", "WIDE"},
                {"widget_schedule_today_wide_preview", "TODAY_WIDE"},
                {"widget_schedule_today_large_preview", "TODAY_LARGE"},
                {"widget_schedule_two_day_preview", "LARGE"},
        };
        for (String[] name : names) {
            ScheduleWidgetProvider.WidgetMode mode = ScheduleWidgetProvider.WidgetMode.valueOf(name[1]);
            for (boolean dark : new boolean[]{false, true}) {
                Bitmap bitmap = render(data, mode, "2026-09-28", "10:30", ScheduleWidgetPalette.DEFAULT_THEME, dark);
                save(bitmap, "../picker/" + (dark ? "night/" : "") + name[0] + ".png");
            }
        }
    }

    @Test
    public void scalesToTheWidgetSizeKeepingProportions() {
        ScheduleWidgetPalette palette = new ScheduleWidgetPalette(null, false);
        // 比 iOS 宽的中号格子：高度对齐 170，宽度放宽。
        ScheduleWidgetCardRenderer.Frame wide = ScheduleWidgetCardRenderer.Frame.fit(
                ScheduleWidgetCardRenderer.Family.MEDIUM, 400f, 170f, 2.75f, 0, palette);
        assertEquals(170f, wide.height, 0.01f);
        assertEquals(400f, wide.width, 0.01f);
        // 比 iOS 小的小号格子：等比缩小，逻辑尺寸仍是 170。
        ScheduleWidgetCardRenderer.Frame small = ScheduleWidgetCardRenderer.Frame.fit(
                ScheduleWidgetCardRenderer.Family.SMALL, 150f, 160f, 3f, 0, palette);
        assertEquals(170f, small.width, 0.01f);
        assertEquals(150f * 3f, small.width * small.scale, 0.5f);
        // 没拿到尺寸时按 iOS 尺寸画。
        ScheduleWidgetCardRenderer.Frame fallback = ScheduleWidgetCardRenderer.Frame.fit(
                ScheduleWidgetCardRenderer.Family.LARGE, 0f, 0f, 2f, 0, palette);
        assertEquals(364f, fallback.width, 0.01f);
        assertEquals(382f, fallback.height, 0.01f);
        // 像素超额时降清晰度。
        ScheduleWidgetCardRenderer.Frame capped = ScheduleWidgetCardRenderer.Frame.fit(
                ScheduleWidgetCardRenderer.Family.LARGE, 364f, 382f, 3f, 500_000, palette);
        assertTrue(capped.width * capped.height * capped.scale * capped.scale <= 500_001f);
    }

    @Test
    public void courseColoursMatchIos() {
        // iOS 截图里：药剂学蓝、药物分析黄、免疫学红、人工智能药学青、药理学粉。
        assertEquals(1, ScheduleWidgetPalette.colorIndex("药剂学"));
        assertEquals(4, ScheduleWidgetPalette.colorIndex("药物分析"));
        assertEquals(0, ScheduleWidgetPalette.colorIndex("免疫学"));
        assertEquals(3, ScheduleWidgetPalette.colorIndex("人工智能药学"));
        assertEquals(5, ScheduleWidgetPalette.colorIndex("药理学"));
        assertEquals(ScheduleWidgetPalette.colorIndex("课程"), ScheduleWidgetPalette.colorIndex("  "));
        assertEquals("color-glass", ScheduleWidgetPalette.normalizeTheme("colorful"));
        assertEquals("rose", ScheduleWidgetPalette.normalizeTheme("pink"));
        assertEquals("color-glass", ScheduleWidgetPalette.normalizeTheme("unknown"));
    }

    private static Bitmap render(
            JSONObject data,
            ScheduleWidgetProvider.WidgetMode mode,
            String date,
            String time,
            String theme,
            boolean dark
    ) {
        ScheduleWidgetCardRenderer.Frame frame = ScheduleWidgetCardRenderer.Frame.of(
                ScheduleWidgetProvider.family(mode), 3f, new ScheduleWidgetPalette(theme, dark));
        return ScheduleWidgetProvider.painter(data, mode, date, minutes(time)).paint(frame);
    }

    /** 和 iOS 截图一样：22 圆角的底色，外面 10pt 灰边。 */
    private static Bitmap framed(Bitmap content, boolean dark) {
        int margin = 30;
        Bitmap output = Bitmap.createBitmap(content.getWidth() + margin * 2, content.getHeight() + margin * 2,
                Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        canvas.drawColor(dark ? Color.rgb(26, 26, 26) : Color.rgb(217, 217, 217));
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(new ScheduleWidgetPalette(null, dark).background());
        canvas.drawRoundRect(new RectF(margin, margin, margin + content.getWidth(), margin + content.getHeight()),
                66f, 66f, paint);
        canvas.drawBitmap(content, margin, margin, null);
        return output;
    }

    private static void save(Bitmap bitmap, String name) throws Exception {
        // Normalised: on Linux "ios-compare/../picker" only resolves once ios-compare exists.
        File preview = new File("build/reports/widget-previews/ios-compare/" + name).toPath().normalize().toFile();
        assertTrue(preview.getParentFile().exists() || preview.getParentFile().mkdirs());
        try (FileOutputStream stream = new FileOutputStream(preview)) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream));
        }
    }

    /** iOS SnapshotData：2026-09-07 起 19 周，周一到周五固定的课，9.25 和国庆 10.1–10.7 放假。 */
    static JSONObject snapshotRecord() throws Exception {
        String[][][] pattern = {
                {{"药物设计学", "D301", "邹老师", "08:00", "09:40"}, {"药剂学", "C204", "苏老师", "10:00", "11:40"},
                        {"药物分析", "B211", "陈老师", "14:00", "15:40"}, {"免疫学", "B202", "徐老师", "16:00", "17:40"},
                        {"人工智能药学", "B201", "杨老师", "19:00", "20:40"}},
                {{"药理学", "A105", "王老师", "08:00", "09:40"}, {"有机化学", "C302", "李老师", "10:00", "11:40"},
                        {"体育", "体育馆", "张老师", "14:00", "15:40"}},
                {{"药物化学", "D201", "周老师", "08:00", "09:40"}, {"生物化学", "C101", "吴老师", "14:00", "15:40"}},
                {{"药剂学", "C204", "苏老师", "10:00", "11:40"}, {"药物分析实验", "实验楼 305", "陈老师", "14:00", "17:40"}},
                {{"药事管理", "A201", "郑老师", "08:00", "09:40"}, {"分子生物学", "B105", "孙老师", "10:00", "11:40"}},
        };
        Set<String> offDays = new HashSet<>(Arrays.asList("2026-09-25", "2026-10-01", "2026-10-02", "2026-10-03",
                "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"));
        String[] labels = {"周一", "周二", "周三", "周四", "周五", "周六", "周日"};
        JSONArray days = new JSONArray();
        for (int offset = 0; offset < 19 * 7; offset++) {
            String date = ScheduleWidgetProvider.addDays("2026-09-07", offset);
            int weekday = offset % 7;
            JSONArray courses = new JSONArray();
            if (!offDays.contains(date) && weekday < pattern.length) {
                String[][] items = pattern[weekday];
                for (int index = 0; index < items.length; index++) {
                    String[] c = items[index];
                    courses.put(new JSONObject()
                            .put("name", c[0]).put("location", c[1]).put("teacher", c[2])
                            .put("startTime", c[3]).put("endTime", c[4])
                            .put("startSlot", index * 2 + 1).put("endSlot", index * 2 + 2));
                }
            }
            days.put(new JSONObject()
                    .put("day", weekday + 1)
                    .put("label", labels[weekday])
                    .put("date", date)
                    .put("week", offset / 7 + 1)
                    .put("courses", courses));
        }
        return new JSONObject().put("semester", "2026-2027-1").put("days", days).put("holidays", new JSONArray());
    }

    private static int minutes(String value) {
        return Integer.parseInt(value.substring(0, 2)) * 60 + Integer.parseInt(value.substring(3, 5));
    }
}
