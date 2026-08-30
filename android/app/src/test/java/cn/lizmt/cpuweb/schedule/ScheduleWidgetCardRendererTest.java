package cn.lizmt.cpuweb.schedule;

import android.graphics.Bitmap;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class ScheduleWidgetCardRendererTest {
    @Test
    public void rendersAllFourReferenceCardStyles() throws Exception {
        JSONObject day = new JSONObject()
                .put("date", "2026-08-31")
                .put("label", "周一")
                .put("courses", new JSONArray()
                        .put(course("高等数学", "东教楼123", "小洁", "08:00", "08:50"))
                        .put(course("数据库原理", "文成楼125", "小越", "09:00", "09:50"))
                        .put(course("工程伦理", "A302-1", "史静", "09:55", "11:35"))
                        .put(course("药物色谱分析实验", "B201", "周老师", "13:30", "17:05"))
                        .put(course("免疫学", "B202", "徐老师", "18:30", "20:10")));
        List<JSONObject> firstTwo = new ArrayList<>();
        firstTwo.add(day.getJSONArray("courses").getJSONObject(0));
        firstTwo.add(day.getJSONArray("courses").getJSONObject(1));

        assertPreview(ScheduleWidgetCardRenderer.renderUpcoming(day, firstTwo, false), 520, 520, "upcoming-compact.png");
        assertPreview(ScheduleWidgetCardRenderer.renderUpcoming(day, firstTwo, true), 920, 410, "upcoming-wide.png");
        assertPreview(ScheduleWidgetCardRenderer.renderToday(day, false), 920, 410, "today-wide.png");
        assertPreview(ScheduleWidgetCardRenderer.renderToday(day, true), 920, 920, "today-large.png");
    }

    private static void assertPreview(Bitmap bitmap, int width, int height, String name) throws Exception {
        assertEquals(width, bitmap.getWidth());
        assertEquals(height, bitmap.getHeight());
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output));
        assertTrue(output.size() > 10_000);
        File preview = new File("build/reports/widget-previews/" + name);
        assertTrue(preview.getParentFile().exists() || preview.getParentFile().mkdirs());
        try (FileOutputStream stream = new FileOutputStream(preview)) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream));
        }
    }

    private static JSONObject course(
            String name,
            String location,
            String teacher,
            String start,
            String end
    ) throws Exception {
        return new JSONObject()
                .put("name", name)
                .put("location", location)
                .put("teacher", teacher)
                .put("startTime", start)
                .put("endTime", end);
    }
}
