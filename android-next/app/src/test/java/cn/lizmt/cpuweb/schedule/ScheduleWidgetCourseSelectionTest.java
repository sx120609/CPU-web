package cn.lizmt.cpuweb.schedule;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

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

    @Test
    public void keepsCompletedCoursesWhenEverythingFits() throws Exception {
        List<JSONObject> courses = courseList(dayWithCourses());

        ScheduleWidgetCardRenderer.CourseWindow window =
                ScheduleWidgetCardRenderer.selectCourseWindow(courses, 3, minutes("09:50"));

        assertEquals(3, window.courses.size());
        assertEquals("第一节", window.courses.get(0).getString("name"));
        assertEquals(0, window.skippedCompletedCount);
        assertTrue(ScheduleWidgetCardRenderer.isCompleted(window.courses.get(0), minutes("09:50")));
        assertFalse(ScheduleWidgetCardRenderer.isCompleted(window.courses.get(1), minutes("09:50")));
    }

    @Test
    public void hidesOldestCompletedCoursesFirstWhenSpaceIsLimited() throws Exception {
        List<JSONObject> courses = courseList(dayWithCourses());

        ScheduleWidgetCardRenderer.CourseWindow window =
                ScheduleWidgetCardRenderer.selectCourseWindow(courses, 2, minutes("09:55"));

        assertEquals(2, window.courses.size());
        assertEquals("第二节", window.courses.get(0).getString("name"));
        assertEquals("第三节", window.courses.get(1).getString("name"));
        assertEquals(1, window.skippedCompletedCount);
        assertEquals(0, window.remainingCount);
    }

    @Test
    public void doesNotHideUpcomingCoursesFromTheTop() throws Exception {
        List<JSONObject> courses = courseList(dayWithCourses());

        ScheduleWidgetCardRenderer.CourseWindow window =
                ScheduleWidgetCardRenderer.selectCourseWindow(courses, 2, minutes("07:30"));

        assertEquals("第一节", window.courses.get(0).getString("name"));
        assertEquals("第二节", window.courses.get(1).getString("name"));
        assertEquals(0, window.skippedCompletedCount);
        assertEquals(1, window.remainingCount);
    }

    @Test
    public void findsTheFirstDayWithCoursesWithinTwentyOneDays() throws Exception {
        JSONObject data = new JSONObject()
                .put("weekDays", new JSONArray()
                        .put(day("2026-09-26", new JSONArray()))
                        .put(day("2026-09-27", new JSONArray())))
                .put("days", new JSONArray()
                        .put(day("2026-10-01", new JSONArray()))
                        .put(day("2026-10-09", new JSONArray().put(course("药剂学", "09:55", "11:35")))));

        assertEquals(13, ScheduleWidgetProvider.nextClassDayOffset(data, "2026-09-26"));
        assertEquals("10/9 的课", ScheduleWidgetProvider.otherDayTag(13, "2026-10-09"));
        assertEquals(-1, ScheduleWidgetProvider.nextClassDayOffset(data, "2026-09-17"));
    }

    @Test
    public void namesTomorrowAndTheDayAfter() {
        assertEquals("明天的课", ScheduleWidgetProvider.otherDayTag(1, "2026-09-27"));
        assertEquals("后天的课", ScheduleWidgetProvider.otherDayTag(2, "2026-09-28"));
        assertEquals("2026-10-01", ScheduleWidgetProvider.addDays("2026-09-30", 1));
    }

    @Test
    public void labelsOngoingAndUpcomingColumns() throws Exception {
        JSONObject first = course("第一节", "08:00", "08:50");

        assertEquals("当前", ScheduleWidgetProvider.upcomingLabels(first, minutes("08:10"))[0]);
        assertEquals("接下来", ScheduleWidgetProvider.upcomingLabels(first, minutes("08:10"))[1]);
        assertEquals("下一节", ScheduleWidgetProvider.upcomingLabels(first, minutes("07:30"))[0]);
        assertEquals("之后", ScheduleWidgetProvider.upcomingLabels(first, minutes("07:30"))[1]);
    }

    @Test
    public void refreshesOneMinuteAfterEachCourseBoundary() throws Exception {
        JSONObject day = dayWithCourses();

        assertEquals(at(8, 1), ScheduleWidgetProvider.nextRefreshAt(day, at(7, 50)));
        assertEquals(at(8, 51), ScheduleWidgetProvider.nextRefreshAt(day, at(8, 30)));
        assertEquals(at(9, 1), ScheduleWidgetProvider.nextRefreshAt(day, at(8, 51)));
    }

    @Test
    public void fallsBackToThirtyMinutesAndMidnight() throws Exception {
        JSONObject day = dayWithCourses();

        assertEquals(at(12, 30), ScheduleWidgetProvider.nextRefreshAt(day, at(12, 0)));
        assertEquals(at(8, 30), ScheduleWidgetProvider.nextRefreshAt(null, at(8, 0)));
        assertEquals(at(0, 1) + 24L * 60L * 60L * 1000L, ScheduleWidgetProvider.nextRefreshAt(day, at(23, 50)));
    }

    private static long at(int hour, int minute) {
        Calendar calendar = Calendar.getInstance();
        calendar.set(2026, Calendar.SEPTEMBER, 28, hour, minute, 0);
        calendar.set(Calendar.MILLISECOND, 0);
        return calendar.getTimeInMillis();
    }

    private static JSONObject day(String date, JSONArray courses) throws Exception {
        return new JSONObject().put("date", date).put("courses", courses);
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

    private static List<JSONObject> courseList(JSONObject day) {
        List<JSONObject> result = new ArrayList<>();
        JSONArray source = day.optJSONArray("courses");
        if (source == null) return result;
        for (int index = 0; index < source.length(); index++) {
            JSONObject course = source.optJSONObject(index);
            if (course != null) result.add(course);
        }
        return result;
    }

    private static int minutes(String value) {
        return Integer.parseInt(value.substring(0, 2)) * 60
                + Integer.parseInt(value.substring(3, 5));
    }
}
