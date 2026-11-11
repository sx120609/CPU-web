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

    // region Overlays

    private val njmu = listOf(
        "08:00" to "08:40", "08:50" to "09:30", "09:40" to "10:20", "10:30" to "11:10", "11:20" to "12:00",
        "12:10" to "12:50", "14:00" to "14:40", "14:50" to "15:30",
    ).mapIndexed { index, (start, end) -> SchedulePeriod(index + 1, start, end) }

    @Test
    fun overlayTimingFollowsTheIosChecks() {
        val cpu = OverlayTiming.periods(BUNDLED_PERIODS)
        val theirs = OverlayTiming.periods(njmu)
        assertTrue(OverlayTiming.sameBells(cpu, cpu))
        assertFalse(OverlayTiming.sameBells(theirs, cpu))
        // Fewer periods with the same bells still count as the same.
        assertTrue(OverlayTiming.sameBells(cpu.take(4), cpu))
        // NJMU 1–2 (08:00–09:30) covers CPU 1–2.
        assertEquals(1 to 2, OverlayTiming.place(480, 570, cpu))
        // NJMU 3–4 (09:40–11:10) starts in the break before CPU 3.
        assertEquals(3 to 4, OverlayTiming.place(580, 670, cpu))
        // NJMU 7–8 (14:00–15:30) covers CPU 5–7.
        assertEquals(5 to 7, OverlayTiming.place(840, 930, cpu))
        // NJMU 6 (12:10–12:50) falls in CPU's lunch break: the nearest period.
        assertEquals(4 to 4, OverlayTiming.place(730, 770, cpu))
        assertEquals(12 to 12, OverlayTiming.place(23 * 60, 23 * 60 + 30, cpu))
        assertNull(OverlayTiming.place(600, 650, emptyList()))
        assertEquals(485, OverlayTiming.minutes("8:05"))
        assertNull(OverlayTiming.minutes("24:00"))
        assertEquals("08:05", OverlayTiming.clock(485))
    }

    @Test
    fun aCourseAtAnotherSchoolKeepsItsOwnTimes() {
        val cpu = OverlayTiming.periods(BUNDLED_PERIODS)
        val block = CourseBlock(1, 4, 7, 8, ScheduleCourse(name = "系统解剖学", startSlot = 7, endSlot = 8, nativeId = "x"))
        val moved = OverlayTiming.remap(block, OverlayTiming.periods(njmu), cpu)
        assertEquals(5, moved.startSlot)
        assertEquals(7, moved.endSlot)
        assertEquals("14:00" to "15:30", moved.course.customTime)
        assertEquals("x", moved.course.nativeId)
        // Same bells: nothing changes.
        assertEquals(block, OverlayTiming.remap(block, cpu, cpu))
        assertEquals("南京医科大学", OverlayTiming.otherSchool(" 南京医科大学 ", "中国药科大学"))
        assertNull(OverlayTiming.otherSchool("中国药科大学", "中国药科大学"))
        assertNull(OverlayTiming.otherSchool("", "中国药科大学"))
    }

    @Test
    fun theStripStartsOnTheSelectedDayAndStopsAtItsLastScreen() {
        val pages = OverlayStripRules.pages(ScheduleCalendar(weeks = weeks))
        assertEquals(14, pages.size)
        assertEquals(OverlayStripPage(2, 1, "2026-09-16"), pages[7])
        assertEquals(3, OverlayStripRules.dayCount(360f, 42f))
        assertEquals(7, OverlayStripRules.dayCount(1200f, 42f))
        assertEquals(2, OverlayStripRules.leadingIndex("2026-09-11", pages, 3))
        // A date between pages: the first one after it.
        assertEquals(0, OverlayStripRules.leadingIndex("2026-09-01", pages, 3))
        // Near the end of term: the last full screen.
        assertEquals(11, OverlayStripRules.leadingIndex("2026-09-22", pages, 3))
        assertEquals(11, OverlayStripRules.leadingIndex(null, pages, 3))
        assertNull(OverlayStripRules.leadingIndex("2026-09-11", emptyList(), 3))
    }

    @Test
    fun overlappingCoursesInAHalfColumnBecomeOneCard() {
        fun placed(name: String, start: Int, end: Int) =
            PlacedBlock(CourseBlock(1, (start + 1) / 2, start, end, ScheduleCourse(name = name)), start, end)
        val clusters = OverlayStripRules.clusters(listOf(placed("乙", 3, 4), placed("甲", 1, 2), placed("丙", 4, 6), placed("丁", 9, 10)))
        assertEquals(listOf("甲", "乙", "丁"), clusters.map { it.first.course.name })
        assertEquals(listOf(0, 1, 0), clusters.map { it.second })
        // The card reaches to the end of the last course behind it.
        assertEquals(6, clusters[1].first.endSlot)
    }

    @Test
    fun sharedSchedulesKeepTheirSchoolAndBells() {
        val document = JSONObject().put("code", "ABCD2345").put("owner", "小林").put("semester", "2026-2027-1")
            .put("schedule", JSONObject().put("cells", JSONArray().put(JSONObject().put("day", 1).put("bigSlot", 1)
                .put("courses", JSONArray().put(JSONObject().put("name", "病理学").put("startSlot", 1).put("endSlot", 2).put("weekList", JSONArray(listOf(1))))))))
            .put("calendar", JSONObject().put("school", "南京医科大学")
                .put("weeks", JSONArray(weeks.map { JSONObject().put("week", it.week).put("days", JSONArray(it.days)) }))
                .put("periods", JSONArray(njmu.map { JSONObject().put("number", it.number).put("startTime", it.startTime).put("endTime", it.endTime) })))
        val shared = SharedSchedule.read(document, 0L)
        assertEquals("南京医科大学", shared.school)
        assertEquals("南京医科大学", SharedSchedule.fromJson(shared.toJson())!!.school)
        val snapshot = ScheduleJson.parseSnapshot(shared.snapshot("2026-09-10"))!!
        assertTrue(snapshot.periodsComplete)
        assertEquals("南京医科大学", snapshot.calendar!!.school)
        // Eight periods of their own, not completed with this school's twelve.
        assertEquals(8, mergeSuppliedPeriods(snapshot.periods, snapshot.periodsComplete).size)
    }

    // endregion

    // region Meetings and common free time

    private fun snapshotOf(
        cells: List<ScheduleCell>, weeks: List<CalendarWeek>, periods: List<SchedulePeriod> = BUNDLED_PERIODS,
        adjustments: List<ScheduleAdjustment> = emptyList(), complete: Boolean = true,
    ) = ScheduleSnapshot(
        version = 1, completeSemester = complete, source = "jwxt", fetchedAt = 0L, periods = periods, periodsComplete = true,
        data = ScheduleResult(semesters = emptyList(), weeks = emptyList(), currentSemester = "2026-2027-1", currentWeek = "1", cells = cells),
        calendar = ScheduleCalendar(currentSemester = "2026-2027-1", currentWeek = 1, weeks = weeks, adjustments = adjustments),
        authenticated = true, identity = null, account = null, error = null, cancelled = false, raw = "",
    )

    private fun days(start: Int) = (start until start + 7).map { "2026-09-%02d".format(it) }

    @Test
    fun meetingsFollowDaysOffMakeUpDaysAndOwnTimes() {
        val calendarWeeks = listOf(CalendarWeek(1, days(7), "2026-09-07", "2026-09-13"), CalendarWeek(2, days(14), "2026-09-14", "2026-09-20"))
        val math = ScheduleCourse(name = "高等数学", nativeId = "m", weekList = listOf(1, 2), location = "教学楼A102", startSlot = 1, endSlot = 2)
        val lab = ScheduleCourse(name = "实验, 第一组", nativeId = "l", weekList = listOf(2), startSlot = 11, endSlot = 12,
            customStartTime = "18:30", customEndTime = "20:00")
        val cells = listOf(ScheduleCell(1, 1, listOf(math)), ScheduleCell(3, 6, listOf(lab)))
        // Week 2 Monday is off; that Saturday runs week 1's Monday.
        val adjustments = listOf(ScheduleAdjustment("2026-09-14", "off", null, null), ScheduleAdjustment("2026-09-19", "swap", "2026-09-07", null))
        val found = ScheduleMeetings.make(snapshotOf(cells, calendarWeeks, adjustments = adjustments))
        assertEquals(listOf("2026-09-07", "2026-09-16", "2026-09-19"), found.map { it.date })
        assertEquals("2026-09-07", found[2].sourceDate)
        assertEquals(2, found[2].week)
        assertEquals(6, found[2].day)
        assertEquals("08:00" to "09:40", found[0].start to found[0].end)
        assertEquals("18:30" to "20:00", found[1].start to found[1].end)
        assertEquals("2026-2027-1|1|1|1|2|m", found[0].key)
        // A single week only covers that week.
        assertEquals(listOf("2026-09-07"), ScheduleMeetings.make(snapshotOf(cells, calendarWeeks, adjustments = adjustments, complete = false)).map { it.date })
    }

    @Test
    fun commonFreeTimeFollowsTheIosChecks() {
        val both = listOf(CalendarWeek(1, days(7), "2026-09-07", "2026-09-13"), CalendarWeek(2, days(14), "2026-09-14", "2026-09-20"))
        // Me: Monday periods 1–2 (08:00–09:40) and 5–6 (13:30–15:10).
        val me = snapshotOf(listOf(
            ScheduleCell(1, 1, listOf(ScheduleCourse(name = "高数", weekList = listOf(1, 2), startSlot = 1, endSlot = 2))),
            ScheduleCell(1, 3, listOf(ScheduleCourse(name = "化学", weekList = listOf(1), startSlot = 5, endSlot = 6))),
        ), both)
        // Them, at another school: Monday 09:40–11:10 by their own bells, and only week 1 in their term.
        val theirBells = listOf(SchedulePeriod(1, "09:40", "10:20"), SchedulePeriod(2, "10:30", "11:10"))
        val them = snapshotOf(listOf(ScheduleCell(1, 1, listOf(ScheduleCourse(name = "解剖", weekList = listOf(1), startSlot = 1, endSlot = 2)))),
            listOf(CalendarWeek(1, days(7), "2026-09-07", "2026-09-13")), periods = theirBells)
        val result = ScheduleCommonFree.days(listOf(me, them), "2026-09-07", "2026-09-20", 8 * 60, 18 * 60, 60, "2026-09-01", 0)
        assertEquals(days(7), result.map { it.date })
        assertEquals(listOf(480..670, 810..910), result[0].busy)
        // 11:10–13:30 and 15:10–18:00; 08:00–09:40 is taken, nothing under an hour.
        assertEquals(listOf(670 to 810, 910 to 1080), result[0].windows.map { it.start to it.end })
        assertEquals(listOf(480 to 1080), result[1].windows.map { it.start to it.end })
        // Today starts at the next quarter hour; earlier days are left out.
        val today = ScheduleCommonFree.days(listOf(me), "2026-09-07", "2026-09-08", 480, 1080, 30, "2026-09-08", 11 * 60 + 5)
        assertEquals(listOf("2026-09-08"), today.map { it.date })
        assertEquals(11 * 60 + 15, today[0].windows.first().start)
        assertEquals(listOf(1..4, 5..9, 12..13), ScheduleCommonFree.merge(listOf(5..9, 1..3, 3..4, 12..13)))
        assertEquals("1 小时 45 分", ScheduleCommonFree.durationText(105))
        assertEquals("2 小时", ScheduleCommonFree.durationText(120))
        assertEquals(listOf("2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"), ScheduleCommonFree.range("2026-02-27", "2026-03-02"))
    }

    // endregion

    // region 日程 around a class

    @Test
    fun aMeetingListsTheAgendaAtItsTimeOrNamingIt() {
        val day = java.time.LocalDate.parse("2026-09-07")
        fun entry(title: String, start: String = "", end: String = "", note: String = "") = cn.lizmt.cpuweb.schedule.agenda.AgendaOccurrence(
            cn.lizmt.cpuweb.schedule.agenda.AgendaItem("a" + title.hashCode().toUInt(), cn.lizmt.cpuweb.schedule.agenda.AgendaKind.Event,
                title, "2026-09-07", start, end, note = note, createdAt = 1), day)
        val entries = listOf(
            entry("答疑", "08:30", "09:00"), entry("交药理学报告"), entry("小测", note = "药理学第三章"),
            entry("午饭", "12:00", "12:30"), entry("刚好下课", "09:40"), // Starts as the class ends: not during it.
        )
        val related = AgendaCourseRules.related(entries, "药理学", 8 * 60, 9 * 60 + 40)
        assertEquals(listOf("答疑", "交药理学报告", "小测"), related.map { it.item.title })
        // A one-letter name matches nothing by name.
        assertEquals(listOf("答疑"), AgendaCourseRules.related(entries, "药", 8 * 60, 9 * 60 + 40).map { it.item.title })
        assertTrue(AgendaCourseRules.related(entries, "体育", null, null).isEmpty())
    }

    // endregion

    // region Backgrounds

    @Test
    fun backgroundFramingIsKeptAsFractionsOfTheOriginal() {
        val crop = BackgroundCrop(0.25f, 0.1f, 0.5f, 0.8f)
        assertEquals(crop.text(), BackgroundCrop.parse(crop.text())!!.text())
        // Practically the whole photo, or next to nothing, is no framing.
        assertNull(BackgroundCrop(0f, 0f, 0.999f, 1f).normalized())
        assertNull(BackgroundCrop(0.5f, 0.5f, 0.01f, 0.5f).normalized())
        assertNull(BackgroundCrop.parse("1,2,3"))
        assertNull(BackgroundCrop.parse(""))
        // Clipped to the photo.
        assertEquals(BackgroundCrop(0.5f, 0f, 0.5f, 1f).text(), BackgroundCrop(0.5f, -0.2f, 0.8f, 1.5f).normalized()!!.text())
        val pixels = crop.pixels(1600, 1200)!!
        assertEquals(listOf(400, 120, 1200, 1080), listOf(pixels.left, pixels.top, pixels.right, pixels.bottom))
        // A 1600×1200 photo in a 450×1000 viewport, filled to its height and centred, then panned 100 px.
        val scale = 1000f / 1200f
        val framed = BackgroundCrop.of(1600f, 1200f, 450f, 1000f, scale, -(1600f * scale - 450f) / 2 + 100f, 0f)
        assertEquals(0f, framed.y, 0.0001f)
        assertEquals(1f, framed.height, 0.0001f)
        assertEquals(450f / (1600f * scale), framed.width, 0.0001f)
        assertEquals(((1600f * scale - 450f) / 2 - 100f) / (1600f * scale), framed.x, 0.0001f)
    }

    // endregion

    // region Calendar file

    @Test
    fun theSemesterCalendarFileFollowsTheMeetings() {
        val calendarWeeks = listOf(CalendarWeek(1, days(7), "2026-09-07", "2026-09-13"), CalendarWeek(2, days(14), "2026-09-14", "2026-09-20"))
        val math = ScheduleCourse(name = "高等数学", nativeId = "m", weekList = listOf(1, 2), location = "教学楼A102", startSlot = 1, endSlot = 2)
        val lab = ScheduleCourse(name = "实验, 第一组", nativeId = "l", weekList = listOf(2), startSlot = 11, endSlot = 12,
            customStartTime = "18:30", customEndTime = "20:00")
        val adjustments = listOf(ScheduleAdjustment("2026-09-14", "off", null, null), ScheduleAdjustment("2026-09-19", "swap", "2026-09-07", null))
        val meetings = ScheduleMeetings.make(snapshotOf(listOf(ScheduleCell(1, 1, listOf(math)), ScheduleCell(3, 6, listOf(lab))), calendarWeeks, adjustments = adjustments))
        val ics = ScheduleExport.semesterCalendar(meetings, "课表-2026秋", java.util.Date(0))
        assertTrue(ics.startsWith("BEGIN:VCALENDAR\r\n"))
        assertTrue(ics.endsWith("END:VCALENDAR\r\n"))
        assertEquals(4, ics.split("BEGIN:VEVENT").size)
        // 18:30 in Beijing is 10:30 UTC.
        assertTrue(ics.contains("DTSTART:20260916T103000Z"))
        assertTrue(ics.contains("SUMMARY:实验\\, 第一组"))
        assertTrue(ics.contains("LOCATION:A102"))
        assertTrue(ics.contains("调休补 2026-09-07 的课"))
        // Every physical line stays within 75 octets, and the identifiers are ASCII.
        ics.split("\r\n").forEach { assertTrue(it, it.toByteArray().size <= 75) }
        ics.split("\r\n").filter { it.startsWith("UID:") }.forEach { line -> assertTrue(line.all { it.code < 128 }) }
    }

    // endregion

    // region 上课闹钟

    @Test
    fun routineAlarmsRingBeforeTheMorningAndAfterTheNoonBreak() {
        fun meeting(date: String, start: String, end: String, name: String) =
            ScheduleMeeting("t", 1, 1, date, start, end, 1, 2, ScheduleCourse(name = name))
        val meetings = listOf(
            meeting("2026-09-07", "08:00", "09:40", "高数"), meeting("2026-09-07", "13:30", "15:10", "化学"),
            // A class running into the afternoon: no noon alarm that day.
            meeting("2026-09-08", "10:00", "13:10", "实验"), meeting("2026-09-08", "13:30", "15:10", "英语"),
            meeting("2026-09-09", "14:00", "15:00", "体育"),
        )
        val plan = RoutineAlarmRules.plan(meetings, "2026-09-07", 0, morning = 60, nap = 15)
        assertEquals(listOf("morning@2026-09-07@07:00", "nap@2026-09-07@13:15", "morning@2026-09-08@09:00", "nap@2026-09-09@13:45"),
            plan.map { "${it.kind}@${it.date}@${it.clock}" })
        assertEquals("早课：08:00「高数」", plan[0].title)
        // Already past today: left out; switched off: none.
        assertEquals(listOf("nap"), RoutineAlarmRules.plan(meetings, "2026-09-07", 8 * 60, 60, 15).filter { it.date == "2026-09-07" }.map { it.kind })
        assertTrue(RoutineAlarmRules.plan(meetings, "2026-09-07", 0, null, null).isEmpty())
        // One weekly system alarm per weekday and kind; 2026-09-07 is a Monday.
        val weekly = RoutineAlarmRules.weekly(plan)
        assertEquals(java.util.Calendar.MONDAY, weekly[0].first)
        assertEquals(4, weekly.size)
    }

    // endregion
}
