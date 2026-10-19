package cn.lizmt.cpuweb.schedule;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class ScheduleWidgetLocalDaysTest {
    @Test
    public void weekOnlySnapshotKeepsTheOtherWeeksOfTheSameSemester() throws Exception {
        JSONObject existing = record("2026-2027-1", false,
                day("2026-09-21", 4, course("药剂学", "08:00", "09:40")),
                day("2026-09-28", 5, course("药物分析", "13:30", "15:10")))
                .put("holidays", new JSONArray().put(holiday("2026-10-01", "国庆节")));
        JSONObject incoming = record("2026-2027-1", false,
                day("2026-09-28", 5, course("免疫学", "18:30", "20:10")));

        JSONObject merged = ScheduleWidgetLocalDays.merge(incoming, existing);

        JSONArray days = merged.getJSONArray("days");
        assertEquals(2, days.length());
        assertEquals("2026-09-21", days.getJSONObject(0).getString("date"));
        assertEquals("免疫学", days.getJSONObject(1).getJSONArray("courses").getJSONObject(0).getString("name"));
        // 这次没带放假安排：沿用上次的。
        assertEquals("国庆节", merged.getJSONArray("holidays").getJSONObject(0).getString("name"));
        assertFalse(merged.has("complete"));
    }

    @Test
    public void completeSnapshotOrAnotherSemesterReplacesEverything() throws Exception {
        JSONObject existing = record("2026-2027-1", true,
                day("2026-09-21", 4, course("药剂学", "08:00", "09:40")));
        JSONObject complete = record("2026-2027-1", true, day("2026-09-28", 5));
        JSONObject otherTerm = record("2025-2026-2", false, day("2026-03-02", 1));

        assertEquals(1, ScheduleWidgetLocalDays.merge(complete, existing).getJSONArray("days").length());
        assertEquals("2025-2026-2", ScheduleWidgetLocalDays.merge(otherTerm, existing).getString("semester"));
        assertEquals(1, ScheduleWidgetLocalDays.merge(otherTerm, existing).getJSONArray("days").length());
        assertNull(ScheduleWidgetLocalDays.merge(record("", true, day("2026-09-28", 5)), existing));
        assertNull(ScheduleWidgetLocalDays.merge(record("2026-2027-1", true), existing));
    }

    @Test
    public void payloadFindsTodayAndTheNextDayWithClasses() throws Exception {
        JSONObject stored = ScheduleWidgetLocalDays.merge(record("2026-2027-1", true,
                day("2026-09-26", 4),
                day("2026-09-27", 4),
                // 调休补课日写成被调换那天的课。
                day("2026-10-09", 6, course("药剂学", "09:55", "11:35"))), null);

        JSONObject payload = ScheduleWidgetLocalDays.payload(stored, "2026-09-26");

        assertEquals("2026-09-26", payload.getJSONObject("today").getString("date"));
        assertEquals(4, payload.getInt("week"));
        assertEquals(2, payload.getJSONArray("weekDays").length());
        assertEquals(13, ScheduleWidgetProvider.nextClassDayOffset(payload, "2026-09-26"));
        assertEquals("10/9 的课", ScheduleWidgetProvider.otherDayTag(13, "2026-10-09"));
    }

    @Test
    public void payloadGivesAnEmptyTodayOutsideTheTerm() throws Exception {
        JSONObject stored = ScheduleWidgetLocalDays.merge(record("2026-2027-1", true,
                day("2026-09-28", 5, course("药物分析", "13:30", "15:10"))), null);

        JSONObject payload = ScheduleWidgetLocalDays.payload(stored, "2026-09-26");

        JSONObject today = payload.getJSONObject("today");
        assertEquals("周六", today.getString("label"));
        assertEquals(6, today.getInt("day"));
        assertEquals(0, today.getJSONArray("courses").length());
        assertTrue(payload.isNull("week"));
        assertEquals(2, ScheduleWidgetProvider.nextClassDayOffset(payload, "2026-09-26"));
    }

    @Test
    public void savesReadsAndClearsTheFile() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        ScheduleWidgetLocalDays.clear(context);
        assertNull(ScheduleWidgetLocalDays.read(context));

        JSONObject incoming = record("2026-2027-1", true, day("2026-09-28", 5, course("药物分析", "13:30", "15:10")))
                .put("holidays", new JSONArray().put(holiday("2026-10-01", "国庆节")));
        assertTrue(ScheduleWidgetLocalDays.save(context, incoming.toString()));
        // 内容没变：照样算收下，只是不重写。
        assertTrue(ScheduleWidgetLocalDays.save(context, incoming.toString()));
        assertFalse(ScheduleWidgetLocalDays.save(context, "not json"));

        JSONObject stored = ScheduleWidgetLocalDays.read(context);
        assertNotNull(stored);
        List<ChineseCalendarInfo.PublishedHoliday> holidays = ScheduleWidgetLocalDays.holidays(stored);
        assertEquals(1, holidays.size());
        assertEquals("国庆节", holidays.get(0).name);

        ScheduleWidgetLocalDays.clear(context);
        assertNull(ScheduleWidgetLocalDays.read(context));
    }

    private static JSONObject record(String semester, boolean complete, JSONObject... days) throws Exception {
        JSONArray list = new JSONArray();
        for (JSONObject day : days) list.put(day);
        return new JSONObject().put("semester", semester).put("complete", complete).put("days", list);
    }

    private static JSONObject day(String date, int week, JSONObject... courses) throws Exception {
        JSONArray list = new JSONArray();
        for (JSONObject course : courses) list.put(course);
        return new JSONObject()
                .put("day", 1)
                .put("label", "周一")
                .put("date", date)
                .put("week", week)
                .put("courses", list);
    }

    private static JSONObject course(String name, String start, String end) throws Exception {
        return new JSONObject().put("name", name).put("startTime", start).put("endTime", end);
    }

    private static JSONObject holiday(String date, String name) throws Exception {
        return new JSONObject().put("date", date).put("name", name);
    }
}
