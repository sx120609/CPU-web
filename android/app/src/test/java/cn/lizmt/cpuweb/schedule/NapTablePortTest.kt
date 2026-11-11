package cn.lizmt.cpuweb.schedule

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The rules ported from the iOS NapTable work (single-meeting changes,
 * overlays, common free time, …), checked against the cases of the iOS
 * Checks.swift scripts under `ios_next/tests`.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NapTablePortTest {
    private val weeks = listOf(
        CalendarWeek(1, (9..15).map { "2026-09-%02d".format(it) }, "2026-09-09", "2026-09-15"),
        CalendarWeek(2, (16..22).map { "2026-09-%02d".format(it) }, "2026-09-16", "2026-09-22"),
    )

    // region Single meetings

    @Test
    fun occurrenceChangesRoundTripThroughJson() {
        val change = OccurrenceChange("k", "2026-09-10", toDate = "2026-09-12", startSlot = 9, endSlot = 10, location = " B305 ", note = "")
        val json = change.toJson()
        assertEquals("B305", json.getString("location"))
        assertFalse(json.has("note"))
        assertFalse(json.has("cancelled"))
        val parsed = OccurrenceChange.parse(json)!!
        assertEquals("2026-09-12", parsed.toDate)
        assertEquals(9, parsed.startSlot)
        assertNull(OccurrenceChange.parse(JSONObject().put("key", "k").put("date", "09-10")))
        assertNull(OccurrenceChange.parse(JSONObject().put("date", "2026-09-10")))
    }

    @Test
    fun snapshotWithoutChangeListHidesSingleMeetingActions() {
        val raw = JSONObject().put("version", 1).put("data", JSONObject().put("cells", JSONArray())).toString()
        assertNull(ScheduleJson.parseSnapshot(raw)!!.occurrenceChanges)
        val listed = JSONObject(raw).put("occurrenceChanges", JSONArray().put(JSONObject().put("key", "k").put("date", "2026-09-10").put("cancelled", true)))
        assertEquals(1, ScheduleJson.parseSnapshot(listed.toString())!!.occurrenceChanges!!.size)
        assertTrue(ScheduleJson.parseSnapshot(JSONObject(raw).put("occurrenceChanges", JSONArray()).toString())!!.occurrenceChanges!!.isEmpty())
    }

    @Test
    fun editKeyMatchesTheWebKeyAndKeepsTheOriginalWeekText() {
        val course = ScheduleCourse(name = "药理学 ", teacher = "王  老师", location = "A101", weeks = "1-16周", startSlot = 1, endSlot = 2)
        assertEquals("jwxt|1|1|1|2|药理学|王 老师|A101|1-16周", OccurrenceRules.editKey(1, 1, course))
        // A cancelled week rewrote the week text; the key does not change.
        assertEquals(OccurrenceRules.editKey(1, 1, course), OccurrenceRules.editKey(1, 1, course.copy(weeks = "1-2,4-16周", sourceWeeks = "1-16周")))
        assertEquals("src", OccurrenceRules.editKey(1, 1, course.copy(sourceKey = "src")))
        val block = CourseBlock(1, 1, 1, 2, course.copy(editKeys = listOf("a", "b")))
        assertEquals(listOf("a", "b"), OccurrenceRules.keys(block))
    }

    @Test
    fun replacingTheChangesOfOneMeetingKeepsTheRest() {
        val other = OccurrenceChange("x", "2026-09-10", cancelled = true)
        val list = listOf(OccurrenceChange("a", "2026-09-09", cancelled = true), OccurrenceChange("b", "2026-09-09", cancelled = true), other)
        val moved = OccurrenceRules.replace(list, listOf("b", "a"), "2026-09-09") { OccurrenceChange(it, "2026-09-09", toDate = "2026-09-11") }
        assertEquals(listOf("x", "a", "b"), moved.map { it.key })
        assertTrue(moved.drop(1).all { it.toDate == "2026-09-11" })
        assertEquals(listOf(other), OccurrenceRules.replace(list, listOf("a", "b"), "2026-09-09", null))
    }

    @Test
    fun movedRowsTravelTogether() {
        val changes = listOf(
            OccurrenceChange("a", "2026-09-09", toDate = "2026-09-11", startSlot = 9, endSlot = 10),
            OccurrenceChange("b", "2026-09-09", toDate = "2026-09-11", startSlot = 9, endSlot = 10),
            OccurrenceChange("c", "2026-09-09", toDate = "2026-09-12", startSlot = 9, endSlot = 10),
        )
        assertEquals(listOf("a", "b"), OccurrenceRules.movedKeys(changes, "a", "2026-09-09"))
        assertEquals(listOf("z"), OccurrenceRules.movedKeys(changes, "z", "2026-09-09"))
    }

    @Test
    fun aCancelledMeetingStandsInItsOldPlace() {
        val course = ScheduleCourse(name = "药理学", weekList = listOf(2), weeks = "第 2 周", sourceWeeks = "1-2周",
            startSlot = 1, endSlot = 2, editKeys = listOf("k"))
        val cells = listOf(ScheduleCell(1, 1, listOf(course)))
        val changes = listOf(OccurrenceChange("k", "2026-09-09", cancelled = true))
        val ghosts = OccurrenceRules.cancelledBlocks(changes, "2026-09-09", 1, cells, 12)
        assertEquals(1, ghosts.size)
        assertEquals("药理学", ghosts[0].course.name)
        assertEquals(changes[0], ghosts[0].cancelled)
        assertEquals("2026-09-09", ghosts[0].date)
        // Other dates, moved copies and an older site draw none.
        assertTrue(OccurrenceRules.cancelledBlocks(changes, "2026-09-16", 1, cells, 12).isEmpty())
        assertTrue(OccurrenceRules.cancelledBlocks(null, "2026-09-09", 1, cells, 12).isEmpty())
        val moved = listOf(ScheduleCell(1, 1, listOf(course.copy(occurrenceKey = "k", occurrenceFrom = "2026-09-02"))))
        assertTrue(OccurrenceRules.cancelledBlocks(changes, "2026-09-09", 1, moved, 12).isEmpty())
        // Two changes of one merged course give one card.
        val both = changes + OccurrenceChange("k2", "2026-09-09", cancelled = true)
        val merged = listOf(ScheduleCell(1, 1, listOf(course.copy(editKeys = listOf("k", "k2")))))
        assertEquals(1, OccurrenceRules.cancelledBlocks(both, "2026-09-09", 1, merged, 12).size)
    }

    @Test
    fun theStoreDrawsCancelledMeetingsAndHidesThemFromTheOverlapNotice() {
        val scope = kotlinx.coroutines.test.TestScope()
        val store = ScheduleStore(scope)
        val calendar = JSONObject().put("currentWeek", 1).put("weeks", JSONArray(weeks.map { week ->
            JSONObject().put("week", week.week).put("days", JSONArray(week.days)).put("monday", week.monday).put("sunday", week.sunday)
        }))
        val cancelled = JSONObject().put("name", "药理学").put("startSlot", 1).put("endSlot", 2).put("weekList", JSONArray(listOf(2)))
            .put("weeks", "第 2 周").put("sourceWeeks", "1-2周").put("editKeys", JSONArray().put("k"))
        val moved = JSONObject().put("name", "英语").put("startSlot", 1).put("endSlot", 2).put("weekList", JSONArray(listOf(1)))
            .put("weeks", "第 1 周").put("occurrenceKey", "e").put("occurrenceFrom", "2026-09-10")
        val raw = JSONObject().put("version", 1).put("completeSemester", true).put("fetchedAt", System.currentTimeMillis())
            .put("auth", JSONObject().put("authenticated", true).put("account", "a"))
            .put("data", JSONObject().put("currentSemester", "2026-2027-1").put("currentWeek", "1")
                .put("weeks", JSONArray().put(JSONObject().put("value", "1").put("label", "第1周")))
                .put("cells", JSONArray().put(JSONObject().put("day", 1).put("bigSlot", 1).put("courses", JSONArray().put(cancelled).put(moved)))))
            .put("calendar", calendar)
            .put("occurrenceChanges", JSONArray().put(JSONObject().put("key", "k").put("date", "2026-09-09").put("cancelled", true)))
        store.accept(raw.toString(), refreshed = false)
        val placed = store.placedBlocksForDay(1, "1")
        assertEquals(2, placed.size)
        assertTrue(placed.any { it.block.cancelled != null && it.course.name == "药理学" })
        assertTrue(placed.all { it.block.date == "2026-09-09" })
        assertEquals("调", occurrenceTag(placed.first { it.course.name == "英语" }))
        assertEquals("已停课", occurrenceTag(placed.first { it.course.name == "药理学" }))
        // The moved meeting is the user's own doing: no notice; the ghost is not a course of this week.
        assertTrue(store.noticeBlocksForDay(1, "1").isEmpty())
    }

    @Test
    fun theMeetingCanOnlyMoveWithinTheTerm() {
        val calendar = ScheduleCalendar(weeks = weeks, adjustments = listOf(
            ScheduleAdjustment("2026-09-10", "off", null, "中秋"), ScheduleAdjustment("2026-09-13", "swap", "2026-09-11", null),
        ))
        assertNull(OccurrenceRules.dateProblem(calendar, "2026-09-12"))
        assertEquals("这一天不在本学期内", OccurrenceRules.dateProblem(calendar, "2026-10-12"))
        assertEquals("这一天放假，课表上不会显示这节课", OccurrenceRules.dateProblem(calendar, "2026-09-10"))
        assertEquals("这一天是调休补课日，暂时不能把课调到这天", OccurrenceRules.dateProblem(calendar, "2026-09-13"))
        assertTrue(OccurrenceRules.canChange(emptyList(), calendar, "2026-09-12"))
        assertFalse(OccurrenceRules.canChange(null, calendar, "2026-09-12"))
        assertFalse(OccurrenceRules.canChange(emptyList(), calendar, "2026-09-10"))
    }

    @Test
    fun buildingAChangeSavesOnlyWhatChanged() {
        val same = OccurrenceRules.build("k", "2026-09-09", "2026-09-09", 1, 2, 1 to 2, "A101", "A101", " 线上 ")
        assertNull(same.toDate)
        assertNull(same.startSlot)
        assertNull(same.location)
        assertEquals("线上", same.note)
        val moved = OccurrenceRules.build("k", "2026-09-09", "2026-09-11", 1, 2, 1 to 2, "B305", "A101", "")
        assertEquals("2026-09-11", moved.toDate)
        // A new date carries the periods too.
        assertEquals(1, moved.startSlot)
        assertEquals(2, moved.endSlot)
        assertEquals("B305", moved.location)
        assertNull(moved.note)
    }

    @Test
    fun datesReadInChinese() {
        assertEquals("11月12日 周四", OccurrenceRules.dateText("2026-11-12"))
        assertEquals("第 3 节", OccurrenceRules.slotsText(3, 3))
        assertEquals("第 3–4 节", OccurrenceRules.slotsText(3, 4))
        assertEquals("2026-11-12", OccurrenceRules.fromUtcMillis(OccurrenceRules.utcMillis("2026-11-12")!!))
    }

    // endregion
}
