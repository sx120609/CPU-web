package cn.lizmt.cpuweb.schedule;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.List;

import static org.junit.Assert.assertEquals;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class ScheduleWidgetCourseSelectionTest {
    @Test
    public void keepsOngoingCourseAndTheCourseAfterIt() throws Exception {
        JSONObject day = dayWithCourses();

        List<JSONObject> selected = ScheduleWidgetProvider.nextCourses(day, minutes("08:30"), 2);

        assertEquals(2, selected.size());
        assertEquals("第一节", selected.get(0).getString("name"));
        assertEquals("第二节", selected.get(1).getString("name"));
    }

    @Test
    public void dropsCoursesThatHaveAlreadyEnded() throws Exception {
        JSONObject day = dayWithCourses();

        List<JSONObject> selected = ScheduleWidgetProvider.nextCourses(day, minutes("08:55"), 2);

        assertEquals(2, selected.size());
        assertEquals("第二节", selected.get(0).getString("name"));
        assertEquals("第三节", selected.get(1).getString("name"));
    }

    private static JSONObject dayWithCourses() throws Exception {
        return new JSONObject().put("courses", new JSONArray()
                .put(course("第一节", "08:00", "08:50"))
                .put(course("第二节", "09:00", "09:50"))
                .put(course("第三节", "10:00", "10:50")));
    }

    private static JSONObject course(String name, String start, String end) throws Exception {
        return new JSONObject()
                .put("name", name)
                .put("startTime", start)
                .put("endTime", end);
    }

    private static int minutes(String value) {
        return Integer.parseInt(value.substring(0, 2)) * 60
                + Integer.parseInt(value.substring(3, 5));
    }
}
