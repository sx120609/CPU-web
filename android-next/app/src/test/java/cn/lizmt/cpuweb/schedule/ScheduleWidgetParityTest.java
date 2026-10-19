package cn.lizmt.cpuweb.schedule;

import android.content.Context;
import android.graphics.Bitmap;
import android.widget.RemoteViews;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import java.io.File;
import java.io.FileOutputStream;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class ScheduleWidgetParityTest {
    @Test public void configurationsAreIndependentAndOlderValuesKeepDefaults() {
        Context context = RuntimeEnvironment.getApplication();
        ScheduleWidgetOptions first = ScheduleWidgetOptions.defaults(ScheduleWidgetProvider.WidgetMode.TODAY_LARGE);
        assertTrue(first.timeline);
        first.todayOnly = true; first.showTeacher = false; first.save(context, 701);
        ScheduleWidgetOptions second = ScheduleWidgetOptions.load(context, 702, ScheduleWidgetProvider.WidgetMode.LARGE);
        assertFalse(second.todayOnly); assertFalse(second.timeline); assertTrue(second.showTeacher);
        ScheduleWidgetOptions restored = ScheduleWidgetOptions.load(context, 701, ScheduleWidgetProvider.WidgetMode.TODAY_LARGE);
        assertTrue(restored.todayOnly); assertFalse(restored.showTeacher);
        assertTrue(ScheduleWidgetOptions.decode("{\"courseCount\":9}", ScheduleWidgetProvider.WidgetMode.COMPACT).showLunarDate);
        ScheduleWidgetOptions.remove(context, 701);
        assertFalse(ScheduleWidgetOptions.load(context, 701, ScheduleWidgetProvider.WidgetMode.TODAY_LARGE).todayOnly);
    }

    @Test public void afterClassAndPrivacyOptionsChangeActualSelectedContent() throws Exception {
        JSONObject data = ScheduleWidgetLocalDays.payload(ScheduleWidgetCardRendererTest.snapshotRecord(), "2026-09-28");
        ScheduleWidgetOptions options = ScheduleWidgetOptions.defaults(ScheduleWidgetProvider.WidgetMode.COMPACT);
        String next = ScheduleWidgetProvider.accessibilitySummary(data, ScheduleWidgetProvider.WidgetMode.COMPACT, "2026-09-28", 1260, options);
        assertTrue(next.contains("明天 周二"));
        options.todayOnly = true;
        String rest = ScheduleWidgetProvider.accessibilitySummary(data, ScheduleWidgetProvider.WidgetMode.COMPACT, "2026-09-28", 1260, options);
        assertTrue(rest.contains("今日课程已结束")); assertFalse(rest.contains("明天"));
        options.showCourseName = false; options.showTeacher = false; options.showRoom = false; options.showTime = false;
        String hidden = ScheduleWidgetProvider.accessibilitySummary(data, ScheduleWidgetProvider.WidgetMode.TODAY_LARGE, "2026-09-28", 630, options);
        assertFalse(hidden.contains("药剂学")); assertFalse(hidden.contains("苏老师")); assertFalse(hidden.contains("C204"));
    }

    @Test public void timelineFitsAndDoesNotTurnOneCourseIntoAWall() {
        float[] heights = ScheduleWidgetCardRenderer.proportionalHeights(
                new float[]{40,22,40,6,40}, new float[]{100,70,100,10,100}, new float[]{108,44,108,12,108}, 285);
        float sum = 0; for (float value : heights) sum += value;
        assertEquals(285f, sum, 0.01f); assertTrue(heights[1] <= 44f); assertTrue(heights[3] <= 12f);
        assertEquals(108f, ScheduleWidgetCardRenderer.proportionalHeights(new float[]{40},new float[]{100},new float[]{108},300)[0],0.01f);
    }

    @Test public void holidayInteractionsExcludeQingmingAndClassDays() {
        assertTrue(ScheduleWidgetCelebration.eligible("2026-10-01", true, ScheduleWidgetProvider.WidgetMode.LARGE));
        assertFalse(ScheduleWidgetCelebration.eligible("2026-10-01", false, ScheduleWidgetProvider.WidgetMode.LARGE));
        assertFalse(ScheduleWidgetCelebration.eligible("2026-04-05", true, ScheduleWidgetProvider.WidgetMode.LARGE));
        assertFalse(ScheduleWidgetCelebration.eligible("2026-09-28", true, ScheduleWidgetProvider.WidgetMode.LARGE));
    }

    @Test public void launcherCanInflateInteractiveLayouts() {
        Context context = RuntimeEnvironment.getApplication();
        for (int layout : new int[]{R.layout.widget_schedule_two_day, R.layout.widget_schedule_today_large}) {
            RemoteViews views = new RemoteViews(context.getPackageName(), layout);
            assertNotNull(views.apply(context, null).findViewById(R.id.widget_celebration_touch));
        }
    }

    @Test public void rendersAllConfigurationBranchesAndSmallLauncherSizes() throws Exception {
        JSONObject record = ScheduleWidgetCardRendererTest.snapshotRecord();
        File root = new File("build/reports/widget-previews/parity"); root.mkdirs();
        for (ScheduleWidgetProvider.WidgetMode mode : ScheduleWidgetProvider.WidgetMode.values()) {
            for (boolean dark : new boolean[]{false,true}) for (int variant = 0; variant < 4; variant++) {
                ScheduleWidgetOptions options = ScheduleWidgetOptions.defaults(mode);
                options.timeline = variant % 2 == 0;
                options.todayOnly = variant > 1; options.tomorrow = variant > 1; options.courseCount = variant > 1 ? 1 : 2;
                String date = variant == 3 ? "2026-10-01" : "2026-09-28";
                if (variant == 2) { options.showTeacher = false; options.showLunarDate = false; options.showHoliday = false; }
                JSONObject data = ScheduleWidgetLocalDays.payload(record, date);
                ScheduleWidgetCardRenderer.Family family = ScheduleWidgetProvider.family(mode);
                ScheduleWidgetCardRenderer.Frame frame = ScheduleWidgetCardRenderer.Frame.fit(family, family.width * 0.8f, family.height * 0.8f, 3f, 1200000, new ScheduleWidgetPalette(null,dark));
                Bitmap bitmap = ScheduleWidgetProvider.painter(data, mode, date, variant == 1 ? 1260 : 630, options).paint(frame);
                assertTrue(bitmap.getWidth() > 0);
                try(FileOutputStream out = new FileOutputStream(new File(root,mode + "-" + variant + "-" + dark + ".png"))) { bitmap.compress(Bitmap.CompressFormat.PNG,100,out); }
            }
        }
    }
}
