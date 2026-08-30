package cn.lizmt.cpuweb.schedule;

import android.graphics.Bitmap;
import android.graphics.Color;

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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class ScheduleWidgetWeekRendererTest {
    @Test
    public void rendersCourseCardsOnTopOfTheWeeklyGrid() throws Exception {
        String[] dates = {
                "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03",
                "2026-09-04", "2026-09-05", "2026-09-06",
        };
        JSONArray days = new JSONArray();
        for (int day = 1; day <= 7; day++) {
            JSONObject value = new JSONObject()
                    .put("day", day)
                    .put("date", dates[day - 1])
                    .put("courses", new JSONArray());
            if (day == 1) {
                value.getJSONArray("courses")
                        .put(course("药品包装设计学", "E205", 1, 2))
                        .put(course("化工原理与实验", "B202", 5, 8));
            } else if (day == 3) {
                value.getJSONArray("courses")
                        .put(course("药物化学", "B311", 3, 4))
                        .put(course("免疫学", "B201", 9, 10));
            } else if (day == 4) {
                value.getJSONArray("courses")
                        .put(course("药物分析", "B311", 1, 2))
                        .put(course("药物色谱分析", "B201", 3, 4))
                        .put(course("药物色谱分析实验", "实验楼", 5, 8))
                        .put(course("化工原理与实验", "B201", 9, 11));
            }
            days.put(value);
        }

        Bitmap bitmap = ScheduleWidgetWeekRenderer.render(days);

        assertEquals(840, bitmap.getWidth());
        assertEquals(600, bitmap.getHeight());
        assertTrue(Color.alpha(bitmap.getPixel(90, 82)) > 0);
        assertTrue(bitmap.getPixel(90, 82) != bitmap.getPixel(205, 82));
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output));
        assertTrue(output.size() > 10_000);
        File preview = new File("build/reports/widget-week-render.png");
        assertTrue(preview.getParentFile().exists() || preview.getParentFile().mkdirs());
        try (FileOutputStream stream = new FileOutputStream(preview)) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream));
        }
    }

    private static JSONObject course(String name, String location, int start, int end) throws Exception {
        return new JSONObject()
                .put("name", name)
                .put("location", location)
                .put("startSlot", start)
                .put("endSlot", end);
    }
}
