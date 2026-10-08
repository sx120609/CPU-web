package cn.lizmt.cpuweb.schedule

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The timetable features that follow the iOS client: styles, display priority, meeting times and shared timetables. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ScheduleParityTest {
    private fun block(name: String, start: Int, end: Int, day: Int = 1) =
        CourseBlock(day, (start + 1) / 2, start, end, ScheduleCourse(name = name, startSlot = start, endSlot = end))

    private fun course(name: String, start: Int, end: Int, weeks: List<Int> = emptyList()) =
        JSONObject().put("name", name).put("startSlot", start).put("endSlot", end).put("weeks", "").put("weekList", JSONArray(weeks))

    private fun weekDays(monday: Int) = JSONArray((0..6).map { "2026-09-%02d".format(monday + it) })

    private fun snapshot(cells: JSONArray, complete: Boolean = true, account: String = "acct-a"): String = JSONObject()
        .put("version", 1).put("completeSemester", complete).put("fetchedAt", System.currentTimeMillis())
        .put("periods", JSONArray().put(JSONObject().put("number", 1).put("startTime", "08:05").put("endTime", "08:50")))
        .put("data", JSONObject()
            .put("currentSemester", "2026-2027-1").put("currentWeek", "1")
            .put("semesters", JSONArray().put(JSONObject().put("value", "2026-2027-1").put("label", "秋").put("current", true)))
            .put("weeks", JSONArray((1..2).map { JSONObject().put("value", "$it").put("label", "第${it}周") }))
            .put("cells", cells))
        .put("calendar", JSONObject().put("currentWeek", 1).put("semesterStart", "2026-09-07").put("semesterEnd", "2026-09-20")
            .put("weeks", JSONArray()
                .put(JSONObject().put("week", 1).put("days", weekDays(7)))
                .put(JSONObject().put("week", 2).put("days", weekDays(14))))
            .put("adjustments", JSONArray().put(JSONObject().put("date", "2026-09-12").put("kind", "swap").put("source", "2026-09-08"))))
        .put("auth", JSONObject().put("authenticated", true).put("account", account))
        .toString()

    private fun cells(vararg entries: Pair<Int, JSONObject>) = JSONArray().apply {
        entries.forEach { (day, item) -> put(JSONObject().put("day", day).put("bigSlot", 1).put("courses", JSONArray().put(item))) }
    }

    // region Display priority

    @Test
    fun coursesWithoutAPrioritySitSideBySide() {
        val placed = SchedulePriority.place(listOf(block("生物化学", 1, 2), block("体育", 1, 2), block("英语", 5, 6)), emptyMap())
        assertEquals(listOf(0, 1, 0), placed.map { it.lane })
        assertEquals(listOf(2, 2, 1), placed.map { it.lanes })
        assertEquals(listOf(1, 1, 5), placed.map { it.startSlot })
    }

    @Test
    fun aCourseSetToShowFirstCoversThePeriodsItShares() {
        val blocks = listOf(block("实验", 1, 4), block("讲座", 2, 3), block("自习", 2, 3))
        val placed = SchedulePriority.place(blocks, mapOf("讲座" to 2, "自习" to 1))
        // The lecture is whole, the study hall is gone, the lab keeps periods 1 and 4.
        assertEquals(listOf("实验" to 1..1, "讲座" to 2..3, "实验" to 4..4), placed.map { it.course.name to it.startSlot..it.endSlot })
        assertTrue(placed.all { it.lane == 0 && it.lanes == 1 })
        // The piece still knows the whole course it belongs to.
        assertEquals(1 to 4, placed[0].block.startSlot to placed[0].block.endSlot)
    }

    @Test
    fun priorityKeysCollapseWhitespaceLikeTheServer() {
        assertEquals("大学 英语 III", SchedulePriority.key("  大学  英语\tIII "))
        assertEquals(3, SchedulePriority.value("大学  英语 III", mapOf("大学 英语 III" to 3)))
        assertEquals(0, SchedulePriority.value("大学英语", mapOf("大学 英语 III" to 3, "x" to -4)))
    }

    @Test
    fun theStoreKeepsPrioritiesPerSemesterAndDropsThemWithTheAccount() = runTest {
        var saved: String? = null
        val store = ScheduleStore(this, savePriorities = { saved = it })
        store.accept(snapshot(JSONArray()
            .put(JSONObject().put("day", 3).put("bigSlot", 1).put("courses", JSONArray().put(course("生物化学", 1, 2)).put(course("体育", 1, 2))))), false)
        assertEquals(2, store.placedBlocksForDay(3).size)
        store.setPriorities("2026-2027-1", mapOf("体育" to 1, "" to 4, "旧课" to 0))
        assertEquals(listOf("体育"), store.placedBlocksForDay(3).map { it.course.name })
        assertEquals(mapOf("体育" to 1), store.displayPriorities)

        // A relaunch reads what was saved; another account starts clean.
        val restored = ScheduleStore(this, savedPriorities = saved, savePriorities = { saved = it })
        restored.accept(snapshot(JSONArray()), false)
        assertEquals(mapOf("体育" to 1), restored.displayPriorities)
        assertTrue(restored.handleAuthChanged("acct-b"))
        assertTrue(restored.displayPriorities.isEmpty())
        assertEquals("{}", saved)
    }

    @Test
    fun prioritiesAreReadWithTheEditsOncePerSemester() = runTest {
        val asked = mutableListOf<String>()
        val store = ScheduleStore(this).apply {
            priorityLoader = { semester ->
                asked += semester
                mapOf("体育" to 2)
            }
            loader = { snapshot(JSONArray()) }
            markBridgeReady()
        }
        advanceUntilIdle()
        store.load(false)
        advanceUntilIdle()
        assertEquals(listOf("2026-2027-1"), asked)
        assertEquals(mapOf("体育" to 2), store.displayPriorities)
        store.load(true)
        advanceUntilIdle()
        assertEquals(2, asked.size)
    }

    // endregion

    // region Meeting times

    @Test
    fun anArrangementIsSavedAsOneRunPerStretchOfPeriods() {
        assertEquals(listOf(1..2, 5..6, 9..9), CourseArrangement(1, setOf(9, 5, 1, 6, 2), emptyList()).runs)
        assertEquals("第 1–2、5 节 · 08:00–09:40、13:30–14:15", CourseArrangement.summary(setOf(1, 2, 5)) { BUNDLED_PERIODS[it - 1] })
        assertEquals("轻点选择上课的节次，可以不连续", CourseArrangement.summary(emptySet()) { BUNDLED_PERIODS[it - 1] })
    }

    @Test
    fun conflictsNeedASharedWeekdayPeriodAndWeek() {
        val existing = listOf(
            ScheduleCell(1, 1, listOf(ScheduleCourse(name = "单周课", startSlot = 1, endSlot = 2, weekList = listOf(1, 3)))),
            ScheduleCell(1, 2, listOf(ScheduleCourse(name = "每周课", weekList = emptyList()))),
            ScheduleCell(2, 1, listOf(ScheduleCourse(name = "别的天", startSlot = 1, endSlot = 2))),
        )
        assertEquals(listOf("单周课", "每周课"), CourseArrangement(1, setOf(2, 3), listOf(3)).conflicts(existing))
        // Courses that only alternate weeks in the same periods do not count.
        assertEquals(listOf("每周课"), CourseArrangement(1, setOf(2, 3), listOf(2, 4)).conflicts(existing))
        assertEquals(emptyList<String>(), CourseArrangement(1, setOf(2, 3), listOf(3)).conflicts(existing) { _, _ -> true })
        assertEquals(emptyList<String>(), CourseArrangement(1, emptySet(), listOf(3)).conflicts(existing))
    }

    @Test
    fun theEditorSendsEveryMeetingTimeAndThePriorityChoice() = runTest {
        val sent = mutableListOf<JSONObject>()
        val saved = mutableListOf<Pair<String, Map<String, Int>?>>()
        val store = ScheduleStore(this)
        store.accept(snapshot(cells(1 to course("药理学", 1, 2, listOf(1, 2)), 1 to course("选修", 1, 2, listOf(1)))), false)
        val model = CourseEditorModel({ payload ->
            sent += payload
            if (payload.getString("action") == "open") """{"session":"s1","priority":{"药理学":2},"hidden":[]}"""
            else """{"saved":true,"priority":{"药理学":2}}"""
        }, this) { semester, priorities -> saved += semester to priorities }

        model.open(store, store.blocksForDay(1).first { it.course.name == "药理学" })
        advanceUntilIdle()
        assertEquals("s1", model.session)
        // The server says the course is in front; the other course on Monday is what it overlaps.
        assertTrue(model.preferred)
        assertEquals(listOf("选修"), model.overlappingNames)
        model.addArrangement()
        model.submit("save")
        assertEquals("上课时间 2：请选择至少一节", model.error)
        model.arrangements[1].day = 4
        model.arrangements[1].toggleSlot(9)
        model.arrangements[1].toggleSlot(11)
        model.submit("save")
        advanceUntilIdle()

        val form = sent.last().getJSONObject("form")
        assertEquals(true, form.getBoolean("preferred"))
        val groups = form.getJSONArray("arrangements")
        assertEquals("[1,2]", groups.getJSONObject(0).getJSONArray("slots").toString())
        assertEquals("[9,11]", groups.getJSONObject(1).getJSONArray("slots").toString())
        assertEquals(4, groups.getJSONObject(1).getInt("day"))
        assertEquals(listOf("2026-2027-1" to mapOf("药理学" to 2)), saved)
        assertFalse(model.visible)
    }

    // endregion

    // region Views

    @Test
    fun aWeekendDayWithClassesShowsWhenWeekendsAreHidden() = runTest {
        val store = ScheduleStore(this)
        store.accept(snapshot(cells(2 to course("周二的课", 1, 2), 7 to course("周日的课", 3, 4, listOf(2)))), false)
        assertEquals((1..7).toList(), store.visibleDays("1", showWeekend = true))
        // Saturday of week 1 is a make-up day; Sunday only has a class in week 2.
        assertEquals(listOf(1, 2, 3, 4, 5, 6), store.visibleDays("1", showWeekend = false))
        assertEquals(listOf(1, 2, 3, 4, 5, 7), store.visibleDays("2", showWeekend = false))
    }

    @Test
    fun saturdayAndSundayHideSeparatelyAndSundayCanLead() = runTest {
        val store = ScheduleStore(this)
        store.accept(snapshot(cells(2 to course("周二的课", 1, 2))), false)
        assertEquals(listOf(1, 2, 3, 4, 5, 6), store.visibleDays("2", showSaturday = true, showSunday = false))
        assertEquals(listOf(1, 2, 3, 4, 5, 7), store.visibleDays("2", showSaturday = false, showSunday = true))
        val none: (Int) -> Boolean = { false }
        assertEquals(listOf(7, 1, 2, 3, 4, 5, 6), ScheduleDisplayRules.weekColumns(true, true, true, none))
        assertEquals(listOf(1, 2, 3, 4, 5), ScheduleDisplayRules.weekColumns(false, false, true, none))
        // A hidden day with classes stays, in its Sunday-first place.
        assertEquals(listOf(7, 1, 2, 3, 4, 5), ScheduleDisplayRules.weekColumns(false, false, true) { it == 7 })
        assertEquals("1", store.previousWeek("2"))
        assertNull(store.previousWeek("1"))
        assertEquals("2026-09-06", ScheduleDisplayRules.shiftDate("2026-09-07", -1))
        assertEquals("", ScheduleDisplayRules.shiftDate("", -1))
    }

    @Test
    fun coursesOfOtherWeeksFillOnlyFreePeriods() = runTest {
        val store = ScheduleStore(this)
        store.accept(snapshot(JSONArray()
            .put(JSONObject().put("day", 1).put("bigSlot", 1).put("courses", JSONArray()
                .put(course("本周的课", 1, 2, listOf(1))).put(course("被挡住", 2, 3, listOf(2)))))
            .put(JSONObject().put("day", 1).put("bigSlot", 3).put("courses", JSONArray()
                .put(course("下周开", 5, 6, listOf(2))).put(course("每周都上", 7, 8))))), false)
        val taken = store.blocksForDay(1, "1")
        assertEquals(listOf("本周的课", "每周都上"), taken.map { it.course.name })
        assertEquals(listOf("下周开"), store.offWeekBlocksForDay(1, "1", taken).map { it.course.name })
        // Saturday of week 1 is a make-up day: it follows its own date.
        assertEquals(emptyList<CourseBlock>(), store.offWeekBlocksForDay(6, "1", emptyList()))
    }

    @Test
    fun theSoonestCourseWinsASharedFreePeriod() {
        fun off(name: String, weeks: List<Int>) =
            CourseBlock(3, 1, 1, 2, ScheduleCourse(name = name, weekList = weeks, startSlot = 1, endSlot = 2))
        val candidates = listOf(off("已结课", listOf(1, 2, 3, 4)), off("下周开", listOf(6, 7)), off("期末开", listOf(15)), off("没有周次", emptyList()))
        assertEquals(listOf("下周开"), ScheduleDisplayRules.offWeekBlocks(candidates, emptyList(), 5).map { it.course.name })
        assertEquals(listOf("期末开"), ScheduleDisplayRules.offWeekBlocks(candidates, emptyList(), 16).map { it.course.name })
        assertEquals(1.16f * 0.92f, ScheduleDisplayRules.textScale("large", true), 0.0001f)
        assertEquals(125, ScheduleDisplayRules.normalizedRowHeight(123))
        assertEquals(180, ScheduleDisplayRules.normalizedRowHeight(999))
    }

    @Test
    fun theMonthViewSelectsADateOfTheTerm() = runTest {
        val store = ScheduleStore(this)
        store.accept(snapshot(cells(2 to course("周二的课", 1, 2))), false)
        store.selectViewMode("month")
        assertEquals("month", store.viewMode)
        assertTrue(store.selectDate("2026-09-17"))
        assertEquals("2" to 4, store.selectedWeek to store.selectedDay)
        assertFalse(store.selectDate("2026-10-01"))
        store.selectViewMode("year")
        assertEquals("week", store.viewMode)
    }

    @Test
    fun theMonthGridCoversWholeWeeksFromMonday() {
        val grid = ScheduleMonth.grid("2026-10-07")
        assertEquals(35, grid.size)
        assertEquals("2026-09-28", grid.first())
        assertEquals("2026-11-01", grid.last())
        // February 2027 starts on a Monday and fills exactly four rows.
        assertEquals(28, ScheduleMonth.grid("2027-02-10").size)
        assertEquals("2027-01-01", ScheduleMonth.shift("2026-12-31", 1))
        assertEquals("2026-09-01", ScheduleMonth.shift("2026-10-07", -1))
        assertEquals(3, ScheduleMonth.weekday("2026-10-07"))
        assertEquals("2026 年 10 月", ScheduleMonth.title("2026-10-07"))
    }

    @Test
    fun aCourseIsFinishedCurrentOrComingUp() {
        val period: (Int) -> SchedulePeriod = { BUNDLED_PERIODS[it - 1] }
        val first = PlacedBlock(block("药理学", 1, 2), 1, 2)
        val second = PlacedBlock(block("英语", 3, 4), 3, 4)
        val morning = DayStatus(period, now = 9 * 60, completedBefore = null)
        assertEquals(DayStatus.Phase.Current, morning.phase(first))
        assertEquals("正在上 · 还剩 40 分", morning.label(first))
        assertEquals("55 分钟后", morning.label(second))
        val later = DayStatus(period, now = 12 * 60, completedBefore = null)
        assertEquals("已结束", later.label(second))
        // Another day has no "now": nothing counts down, a past day is all finished.
        assertNull(DayStatus(period, now = null, completedBefore = null).label(first))
        assertEquals(DayStatus.Phase.Completed, DayStatus(period, now = null, completedBefore = 24 * 60).phase(second))
    }

    @Test
    fun theStyleFallsBackToClassic() {
        assertEquals(ScheduleVisualStyle.Paper, ScheduleVisualStyle.fromId("paper"))
        assertEquals(ScheduleVisualStyle.Classic, ScheduleVisualStyle.fromId("neon"))
        assertEquals(ScheduleVisualStyle.Classic, ScheduleVisualStyle.fromId(null))
        assertEquals(listOf("classic", "minimal", "grid", "table", "paper", "board"), ScheduleVisualStyle.entries.map { it.id })
        assertEquals("二十一", ScheduleStyleTime.numeral(21))
        assertEquals("药学楼 302", ScheduleStyleTime.location(" @药学楼 302 "))
        assertEquals("晚上", ScheduleStyleTime.session("18:30"))
    }

    @Test
    fun theDayStripMarksTheSelectedDayAndTodayApart() {
        // The week header (no selection): only the table fills a cell, and it is today's.
        for (style in ScheduleVisualStyle.entries) {
            val expected = if (style == ScheduleVisualStyle.Table) DateHeaderMark.ThemeFill else DateHeaderMark.None
            assertEquals(style.id, expected, dateHeaderMark(style, today = true, selected = null))
            assertEquals(style.id, DateHeaderMark.None, dateHeaderMark(style, today = false, selected = null))
        }
        // The day strip: every style marks the selected day its own way, and today is never filled for it.
        val selected = mapOf(
            ScheduleVisualStyle.Table to DateHeaderMark.ThemeFill, ScheduleVisualStyle.Board to DateHeaderMark.Ink,
            ScheduleVisualStyle.Grid to DateHeaderMark.Tile, ScheduleVisualStyle.Paper to DateHeaderMark.Wash,
        )
        for ((style, mark) in selected) {
            for (today in listOf(false, true)) assertEquals(style.id, mark, dateHeaderMark(style, today, selected = true))
            assertEquals(style.id, DateHeaderMark.None, dateHeaderMark(style, today = true, selected = false))
        }
    }

    @Test
    fun theBoardKeepsItsMonospacedFaceForTimesAndDatesOnly() {
        assertEquals(androidx.compose.ui.text.font.FontFamily.Monospace, ScheduleVisualStyle.Board.fontFamily)
        assertEquals(androidx.compose.ui.text.font.FontFamily.Default, ScheduleVisualStyle.Board.textFamily)
        for (style in ScheduleVisualStyle.entries - ScheduleVisualStyle.Board) assertEquals(style.id, style.fontFamily, style.textFamily)
    }

    @Test
    fun themeTextClearsEverySurfaceForEveryPalette() {
        for (palette in SCHEDULE_THEME_ORDER) {
            val brand = scheduleThemeBrand(palette)
            val theme = ThemePalette.of(brand)
            assertTrue("$palette fill", ThemePalette.contrast(theme.fill, 0xFFFFFF) >= ThemePalette.MINIMUM_CONTRAST)
            for (dark in listOf(false, true)) {
                for (surface in ThemePalette.textSurfaces(brand, dark)) {
                    val contrast = ThemePalette.contrast(theme.text(dark), surface)
                    assertTrue("$palette dark=$dark on ${surface.toString(16)}: $contrast", contrast >= ThemePalette.MINIMUM_CONTRAST)
                }
            }
        }
        // A brand that already passes is used unchanged.
        assertEquals(0x116B5F, ThemePalette.of(0x116B5F).fill)
    }

    @Test
    fun styledCourseTextIsReadableOnItsOwnFill() {
        val names = listOf("药理学", "有机化学实验", "大学英语 III", "生物化学", "体育（羽毛球）", "形势与政策", "Advanced Pharmaceutics", "a")
        for (palette in SCHEDULE_THEME_ORDER) {
            for (name in names) {
                val color = StyleCourseColor(name, palette)
                val light = contrastRatio(color.accent(false), color.fill(false))
                assertTrue("$palette $name light $light", light >= 4.5)
                // The dark fill is translucent over the dark canvas.
                val fill = color.fill(true)
                val over = ThemePalette.overlaid(0x15181C, fill and 0xFFFFFF, ((fill ushr 24) and 0xFF) / 255.0)
                val dark = contrastRatio(color.accent(true), 0xFF000000.toInt() or over)
                assertTrue("$palette $name dark $dark", dark >= 4.5)
            }
        }
        // The multicolour palette follows the name hash; a single-colour one gives every course its hue.
        assertTrue(StyleCourseColor("药理学", "color-glass").hue != StyleCourseColor("体育", "color-glass").hue)
        assertEquals(StyleCourseColor("药理学", "blue").hue, StyleCourseColor("体育", "blue").hue, 0.0)
    }

    // endregion

    // region Shared timetables

    private fun shareDocument(updatedAt: String = "2026-10-07T02:00:00.000Z") = JSONObject()
        .put("code", "ABCD2345").put("owner", "阿青").put("semester", "2026-2027-1").put("courseCount", 2)
        .put("createdAt", "2026-10-01T02:00:00.000Z").put("updatedAt", updatedAt)
        .put("schedule", JSONObject().put("cells", JSONArray()
            .put(JSONObject().put("day", 1).put("bigSlot", 1).put("courses", JSONArray()
                .put(course("药理学", 1, 2, listOf(1, 2, 99)).put("sourceKey", "jwxt|1").put("customId", "custom-1").put("teacher", "王老师"))))
            .put(JSONObject().put("day", 9).put("bigSlot", 1).put("courses", JSONArray().put(course("越界", 1, 2))))))
        .put("calendar", JSONObject().put("semesterStart", "2026-09-07").put("semesterEnd", "2026-09-20")
            .put("weeks", JSONArray()
                // 教务 lists this week from Sunday.
                .put(JSONObject().put("week", 2).put("days", JSONArray(listOf("2026-09-13", "2026-09-14", "2026-09-15"))))
                .put(JSONObject().put("week", 1).put("days", weekDays(7)))
                .put(JSONObject().put("week", 3).put("days", JSONArray(listOf("", "")))))
            .put("periods", JSONArray()
                .put(JSONObject().put("id", 1).put("name", "第1节").put("start", "08:10").put("end", "08:55"))
                .put(JSONObject().put("number", 2).put("startTime", "09:05").put("endTime", "09:50")))
            .put("adjustments", JSONArray().put(JSONObject().put("date", "2026-09-12").put("kind", "off").put("note", "中秋节"))))

    @Test
    fun aShareCodeIsReadOutOfWhateverWasPasted() {
        assertEquals("ABCD2345", SharedSchedule.normalizedCode(" abcd-2345 "))
        assertEquals("ABCD2345", SharedSchedule.normalizedCode("https://cputime.cn/schedule/share/abcd2345?from=qq#top"))
        assertNull(SharedSchedule.normalizedCode("ABCD1234"))
        assertNull(SharedSchedule.normalizedCode("ABCD234"))
        assertNull(SharedSchedule.normalizedCode("我的课表"))
    }

    @Test
    fun aWeekIsReadMondayFirstWhateverItStartsWith() {
        val monday = (14..20).map { "2026-09-$it" }
        assertEquals(monday, SharedSchedule.mondayFirstDays(listOf("2026-09-13", "2026-09-14", "2026-09-15")))
        assertEquals(monday, SharedSchedule.mondayFirstDays(listOf("", "", "2026-09-16")))
        assertEquals(monday, SharedSchedule.mondayFirstDays(monday))
        assertNull(SharedSchedule.mondayFirstDays(listOf("", "2026-02-30", "soon")))
    }

    @Test
    fun aShareIsClampedAndLeavesThePublishersIdentitiesBehind() {
        val shared = SharedSchedule.read(shareDocument(), fetchedAt = 5L)
        assertEquals("阿青", shared.name)
        assertEquals(1, shared.courseCount)
        val course = shared.cells.single().courses.single()
        assertEquals(listOf(1, 2), course.weekList)
        assertNull(course.sourceKey)
        assertNull(course.customId)
        assertEquals("王老师", course.teacher)
        assertEquals(listOf(1, 2), shared.weeks.map { it.week })
        assertEquals("2026-09-14", shared.weeks[1].monday)
        assertEquals(listOf(SchedulePeriod(1, "08:10", "08:55"), SchedulePeriod(2, "09:05", "09:50")), shared.periods)
        assertEquals(1, shared.week("2026-08-01"))
        assertEquals(2, shared.week("2026-09-16"))
        assertEquals(2, shared.week("2027-01-01"))

        // It survives being saved, with the remark the reader gave it.
        val library = SharedScheduleLibrary().adopt("acct-a").save(shared, " 室友 ")
        val restored = SharedScheduleLibrary.fromJson(JSONObject(library.toJson().toString()))
        assertEquals(library, restored)
        assertEquals("室友", restored.schedules.single().name)

        val empty = shareDocument().put("schedule", JSONObject().put("cells", JSONArray()))
        assertEquals("这份共享课表里没有课程", assertThrows(SharedScheduleException::class.java) { SharedSchedule.read(empty, 0) }.message)
        val undated = shareDocument().put("calendar", JSONObject().put("weeks", JSONArray()))
        assertEquals("这份共享课表没有校历，无法按周显示", assertThrows(SharedScheduleException::class.java) { SharedSchedule.read(undated, 0) }.message)
    }

    @Test
    fun aSharedTimetableOpensReadOnlyOnItsOwnStore() = runTest {
        val shared = SharedSchedule.read(shareDocument(), fetchedAt = 0L).copy(remark = "室友小王")
        val store = ScheduleStore(this, readOnly = true).apply {
            loader = { shared.snapshot(today = "2026-09-16") }
            markBridgeReady()
        }
        advanceUntilIdle()
        assertEquals(ScheduleStatus.Loaded, store.status)
        assertEquals("share:ABCD2345", store.selectedSemester)
        assertEquals("2", store.selectedWeek)
        assertEquals("室友小王", store.semesterTitle())
        assertFalse(store.canEdit)
        assertEquals("08:10", store.periodTime(1).startTime)
        assertEquals(listOf("药理学"), store.blocksForDay(1, "1").map { it.course.name })
        // The publisher's own holiday applies, and nothing here is ranked or archived.
        assertEquals("off", store.adjustment(6, "1")?.kind)
        store.setPriorities(store.selectedSemester, mapOf("药理学" to 1))
        assertTrue(store.displayPriorities.isEmpty())
    }

    @Test
    fun publishingSendsWhatAReaderNeedsAndNothingElse() = runTest {
        val store = ScheduleStore(this)
        store.accept(snapshot(JSONArray().put(JSONObject().put("day", 1).put("bigSlot", 1).put("courses", JSONArray()
            .put(course("药理学", 1, 2, listOf(1, 2)).put("sourceKey", "jwxt|1").put("nativeId", "source:1").put("location", "A101"))))), false)
        val body = SharedSchedule.publishBody(store.completeSnapshot())
        assertEquals("2026-2027-1", body.getString("semester"))
        val sent = body.getJSONObject("schedule").getJSONArray("cells").getJSONObject(0).getJSONArray("courses").getJSONObject(0)
        assertEquals(setOf("name", "weeks", "weekList", "location", "startSlot", "endSlot"), sent.keys().asSequence().toSet())
        assertEquals(0, body.getJSONObject("schedule").getJSONArray("semesters").length())
        // Periods go out in the shape the Web share page reads.
        val period = body.getJSONObject("calendar").getJSONArray("periods").getJSONObject(0)
        assertEquals("""{"id":1,"name":"第1节","start":"08:05","end":"08:50"}""", period.toString())
        assertEquals("swap", body.getJSONObject("calendar").getJSONArray("adjustments").getJSONObject(0).getString("kind"))
        // What goes out can be read back by a reader.
        val reader = SharedSchedule.read(JSONObject(body.toString()).put("code", "ABCD2345"), 0)
        assertEquals(listOf("药理学"), reader.cells.single().courses.map { it.name })

        val partial = ScheduleStore(this)
        partial.accept(snapshot(cells(1 to course("药理学", 1, 2)), complete = false), false)
        assertEquals("整学期课表还没有加载完，请刷新课表后再试",
            assertThrows(SharedScheduleException::class.java) { SharedSchedule.publishBody(partial.completeSnapshot()) }.message)
        val vacant = ScheduleStore(this)
        vacant.accept(snapshot(JSONArray()), false)
        assertEquals("这个学期没有课程，没有可以分享的内容",
            assertThrows(SharedScheduleException::class.java) { SharedSchedule.publishBody(vacant.completeSnapshot()) }.message)
    }

    @Test
    fun theLibraryBelongsToOneAccount() {
        val shared = SharedSchedule.read(shareDocument(), 0)
        val library = SharedScheduleLibrary().adopt("acct-a").save(shared, "室友")
        assertEquals(library, library.adopt("acct-a"))
        // Signed out, or a Web build that sends no fingerprint, changes nothing.
        assertEquals(library, library.adopt(" "))
        assertEquals(SharedScheduleLibrary(account = "acct-b"), library.adopt("acct-b"))
        // A newer download keeps the remark; importing the code again replaces the copy.
        val newer = SharedSchedule.read(shareDocument("2026-10-08T02:00:00.000Z"), 9)
        assertEquals("室友", library.refresh(newer).schedules.single().remark)
        assertEquals("2026-10-08T02:00:00.000Z", library.refresh(newer).schedules.single().meta.updatedAt)
        assertEquals(1, library.save(newer, "同桌").schedules.size)
        assertTrue(library.markRevoked("ABCD2345").schedules.single().revoked)
        assertTrue(library.remove("ABCD2345").schedules.isEmpty())
        assertEquals("共享课表", shared.copy(meta = shared.meta.copy(owner = "同学")).name)
    }

    /** A stand-in for the page bridge: `get` and `meta` answer from [documents]. */
    private fun TestScope.sharing(documents: MutableMap<String, JSONObject>, metaRoute: Boolean = true, calls: MutableList<String> = mutableListOf()) =
        ScheduleSharing(this, null, { payload ->
            val code = payload.optString("code")
            calls += payload.getString("action") + (if (code.isEmpty()) "" else ":$code")
            fun missing() = """{"error":"分享课表不存在或已撤销","status":404}"""
            when (payload.getString("action")) {
                "mine" -> """{"data":{"shares":[{"code":"MYCQDE23","semester":"2026-2027-1","courseCount":3}]}}"""
                "publish" -> """{"data":{"code":"MYCQDE23","semester":"2026-2027-1","courseCount":1,"created":false,"changed":true}}"""
                "revoke" -> missing()
                "meta" -> if (!metaRoute) missing() else documents[code]?.let { JSONObject().put("data", JSONObject(it.toString()).apply { remove("schedule") }).toString() } ?: missing()
                "get" -> documents[code]?.let { JSONObject().put("data", it).toString() } ?: missing()
                else -> null
            }
        }, io = StandardTestDispatcher(testScheduler), clock = { 42L })

    @Test
    fun publishingUpdatesTheSameCodeAndRevokingAGoneCodeSucceeds() = runTest {
        val sharing = sharing(mutableMapOf())
        val store = ScheduleStore(this)
        store.accept(snapshot(cells(1 to course("药理学", 1, 2))), false)
        val published = sharing.publish(store.completeSnapshot())
        assertFalse(published.created)
        assertTrue(published.changed)
        assertEquals("MYCQDE23", sharing.share("2026-2027-1")?.code)
        sharing.revoke("MYCQDE23")
        assertNull(sharing.share("2026-2027-1"))
        assertTrue(runCatching { sharing.publish(null) }.exceptionOrNull() is SharedScheduleException)
    }

    @Test
    fun importingRejectsBadCodesOnesOwnShareAndMissingOnes() = runTest {
        val sharing = sharing(mutableMapOf("ABCD2345" to shareDocument()))
        suspend fun failure(input: String): String = runCatching { sharing.preview(input) }.exceptionOrNull()?.message.orEmpty()
        assertEquals("分享码是 8 位字母和数字，请检查后再试", failure("abc"))
        assertEquals("这是你自己分享的课表，直接看自己的课表就可以", failure("mycq-de23"))
        assertEquals("没有找到这份共享课表，可能已被撤销", failure("ZZZZ2222"))
        val preview = sharing.preview("https://cputime.cn/schedule/share/abcd2345")
        assertEquals(42L, preview.fetchedAt)
        assertTrue(sharing.library.schedules.isEmpty())
        sharing.adopt("acct-a")
        sharing.save(preview, "室友")
        sharing.rename("ABCD2345", "同桌")
        assertEquals(listOf("同桌"), sharing.library.schedules.map { it.name })
        sharing.adopt("acct-b")
        assertTrue(sharing.library.schedules.isEmpty())
    }

    @Test
    fun refreshingPicksUpAnUpdateAndMarksARevoke() = runTest {
        val documents = mutableMapOf("ABCD2345" to shareDocument())
        val calls = mutableListOf<String>()
        val sharing = sharing(documents, calls = calls)
        sharing.save(sharing.preview("ABCD2345"), "室友")
        calls.clear()
        sharing.refresh()
        // Nothing changed: the summary is enough.
        assertEquals(listOf("meta:ABCD2345"), calls)
        documents["ABCD2345"] = shareDocument("2026-10-09T02:00:00.000Z")
        sharing.refresh()
        assertEquals("2026-10-09T02:00:00.000Z", sharing.library.schedules.single().meta.updatedAt)
        assertEquals("室友", sharing.library.schedules.single().remark)
        documents.clear()
        sharing.refresh()
        assertTrue(sharing.library.schedules.single().revoked)
        // A withdrawn share is not asked about again.
        calls.clear()
        sharing.refresh()
        assertTrue(calls.isEmpty())
    }

    @Test
    fun aServerWithoutTheSummaryRouteDoesNotMarkEverythingRevoked() = runTest {
        val documents = mutableMapOf("ABCD2345" to shareDocument())
        val sharing = sharing(documents, metaRoute = false)
        sharing.save(sharing.preview("ABCD2345"), "室友")
        sharing.refresh()
        assertFalse(sharing.library.schedules.single().revoked)
        documents.clear()
        sharing.refresh()
        assertTrue(sharing.library.schedules.single().revoked)
    }

    @Test
    fun theInvitationCarriesTheCodeAndTheLink() {
        assertEquals(
            "我的课表分享码：ABCD2345\n在药大拾间「课表 → 更多 → 共享课表」里输入就能看，也可以直接打开：https://cputime.cn/schedule/share/ABCD2345",
            SharedSchedule.invitation("ABCD2345", "https://cputime.cn/"),
        )
        assertEquals("更新于 10月7日", SharedSchedule.updatedText("2026-10-06T18:30:00.000Z"))
        assertNull(SharedSchedule.updatedText("yesterday"))
        assertNotNull(SharedSchedule.updatedText("2026-10-06T18:30:00Z"))
    }

    // endregion

    // region Couple timetable

    private fun placed(name: String, start: Int, end: Int, lane: Int = 0, lanes: Int = 1) = PlacedBlock(block(name, start, end), start, end, lane, lanes)

    @Test
    fun coupleColoursMatchTheWeb() {
        // Values from `coupleCourseTone` in web/src/views/schedule/couple.ts.
        assertEquals(33278927L, CoupleRules.nameHash("药理学"))
        assertEquals(CoupleTint(0xFFD4E5FC.toInt(), 0xFF8DB6EC.toInt(), 0xFF1D406D.toInt()), CoupleRules.tone("blue", "药理学", dark = false))
        assertEquals(CoupleTint(0xFF792A47.toInt(), 0xFFD13D73.toInt(), 0xFFF5F7FF.toInt()), CoupleRules.tone("pink", "高等数学", dark = true))
        assertEquals(CoupleTint(0xFFFDE7F3.toInt(), 0xFFF1A7CE.toInt(), 0xFF6D1D48.toInt()), CoupleRules.tone("pink", "", dark = false))
        // A class both attend runs from the user's fill into the partner's.
        val both = CoupleRules.tint(CoupleOwner.Both, "药理学", "blue", "pink", dark = false)
        assertEquals(CoupleRules.tone("blue", "药理学", false).fill, both.fill)
        assertEquals(CoupleRules.tone("pink", "药理学", false).fill, both.fillEnd)
        assertNull(CoupleRules.tint(CoupleOwner.Mine, "药理学", "blue", "pink", dark = false).fillEnd)
    }

    @Test
    fun coursesShareTheColumnOnlyWhereTheTwoTimetablesMeet() {
        val mine = listOf(placed("药理学", 1, 2), placed("大学英语", 3, 4), placed("药物分析", 9, 10))
        val theirs = listOf(placed("药 理 学", 1, 2), placed("高等数学", 4, 5), placed("物理化学", 7, 8))
        val merged = CoupleRules.merge(mine, theirs).associateBy { it.course.name }
        // The same class in the same periods is drawn once, whatever the spacing of its name.
        assertEquals(5, merged.size)
        assertEquals(CoupleOwner.Both, merged.getValue("药理学").owner)
        assertEquals(1, merged.getValue("药理学").lanes)
        // Overlapping courses: the user's on the left half, the partner's on the right.
        assertEquals(listOf(CoupleOwner.Mine, 0, 2), merged.getValue("大学英语").let { listOf(it.owner, it.lane, it.lanes) })
        assertEquals(listOf(CoupleOwner.Partner, 1, 2), merged.getValue("高等数学").let { listOf(it.owner, it.lane, it.lanes) })
        // Everything else keeps the whole column.
        assertEquals(listOf(CoupleOwner.Mine, 0, 1), merged.getValue("药物分析").let { listOf(it.owner, it.lane, it.lanes) })
        assertEquals(listOf(CoupleOwner.Partner, 0, 1), merged.getValue("物理化学").let { listOf(it.owner, it.lane, it.lanes) })
        // Two of the user's courses already side by side keep to the left half between them.
        val crowded = CoupleRules.merge(listOf(placed("甲", 1, 2, 0, 2), placed("乙", 1, 2, 1, 2)), listOf(placed("丙", 1, 2)))
        assertEquals(listOf(0 to 4, 1 to 4, 1 to 2), crowded.map { it.lane to it.lanes })
        // Without a partner timetable the user's courses are only marked as theirs.
        assertEquals(listOf(CoupleOwner.Mine), CoupleRules.merge(listOf(placed("甲", 1, 2)), emptyList()).map { it.owner })
    }

    @Test
    fun theStatusLineSaysWhatThePartnerIsDoing() {
        val day = listOf(CoupleTimedCourse("高等数学", "10:00", "11:35"), CoupleTimedCourse("药理学", "08:00", "09:35"))
        assertEquals("小鹿 在上《药理学》· 09:35 下课", CoupleRules.nowText("小鹿", true, day, 8 * 60 + 30))
        assertEquals("小鹿 下一节《高等数学》· 10:00", CoupleRules.nowText("小鹿", true, day, 9 * 60 + 40))
        assertEquals("小鹿 今天的课都上完了", CoupleRules.nowText("小鹿", true, day, 12 * 60))
        assertEquals("小鹿 今天没有课", CoupleRules.nowText("小鹿", true, emptyList(), 600))
        assertEquals("小鹿 今天不在学期内", CoupleRules.nowText("小鹿", true, null, 600))
        assertEquals("TA 还没有同步课表", CoupleRules.nowText("", false, null, 600))
        assertEquals(1, CoupleRules.daysTogether("2026-10-08", "2026-10-08"))
        assertEquals(507, CoupleRules.daysTogether("2025-05-20", "2026-10-08"))
        assertNull(CoupleRules.daysTogether("2026-10-09", "2026-10-08"))
        assertNull(CoupleRules.daysTogether("", "2026-10-08"))
        assertNull(CoupleRules.daysTogether("2026-02-30", "2026-10-08"))
    }

    private fun coupleStatus(state: String): JSONObject = when (state) {
        "active" -> JSONObject().put("status", "active").put("anniversary", JSONObject.NULL)
            .put("me", JSONObject().put("color", "pink").put("nickname", "阿青").put("snapshot", JSONObject.NULL))
            .put("partner", JSONObject().put("color", "blue").put("nickname", "小鹿")
                .put("snapshot", JSONObject().put("syncedAt", "2026-10-08T01:30:00.000Z")))
        "pending" -> JSONObject().put("status", "pending").put("invite", JSONObject().put("code", "K7M2QX").put("expired", false))
        else -> JSONObject().put("status", "none")
    }

    @Test
    fun theBindingIsReadFromTheServerAnswer() {
        assertEquals(CoupleStatus.None, CoupleStatus.fromJson(coupleStatus("none")))
        assertEquals(CoupleStatus.Pending("K7M2QX", false), CoupleStatus.fromJson(coupleStatus("pending")))
        assertEquals(
            CoupleStatus.Active("", CoupleMember("阿青", "pink", ""), CoupleMember("小鹿", "blue", "2026-10-08T01:30:00.000Z")),
            CoupleStatus.fromJson(coupleStatus("active")),
        )
    }

    @Test
    fun thePartnerTimetableIsDrawnByDateAndTheOwnOneUploadedOnce() = runTest {
        val calls = mutableListOf<String>()
        var state = "active"
        var now = 1_000_000L
        val partner = JSONObject().put("semester", "2026-2027-1")
            .put("schedule", JSONObject().put("cells", JSONArray().put(JSONObject().put("day", 2).put("bigSlot", 1)
                .put("courses", JSONArray().put(course("高等数学", 1, 2))))))
            .put("calendar", JSONObject().put("weeks", JSONArray()
                .put(JSONObject().put("week", 1).put("days", weekDays(7)))
                .put(JSONObject().put("week", 2).put("days", weekDays(14)))))
        val couple = ScheduleCouple(backgroundScope, null, { payload ->
            val action = payload.getString("action")
            calls += action
            val data = when (action) {
                "schedules" -> JSONObject().put("me", JSONObject.NULL).put("partner", partner)
                "sync" -> JSONObject().put("changed", true)
                "unbind" -> coupleStatus("none").also { state = "none" }
                else -> coupleStatus(state)
            }
            JSONObject().put("data", data).toString()
        }, clock = { now })
        assertNull(couple.layer())
        couple.refresh()
        testScheduler.runCurrent()
        val layer = couple.layer()!!
        assertEquals("小鹿", layer.partnerName)
        assertEquals("blue", layer.partnerColor)
        // Tuesday of the partner's second week, found by its date.
        assertEquals(listOf("高等数学"), layer.blocksOn("2026-09-15")!!.map { it.course.name })
        assertEquals(emptyList<String>(), layer.blocksOn("2026-09-14")!!.map { it.course.name })
        assertNull(layer.blocksOn("2026-12-01"))
        assertEquals(listOf(CoupleOwner.Partner), layer.merge(emptyList(), "2026-09-15").map { it.owner })
        // Hidden courses leave the binding alone.
        couple.updateVisible(false)
        assertNull(couple.layer())
        assertNotNull(couple.statusText("2026-09-15", 600))
        couple.updateVisible(true)
        // A second look within the minute asks nothing.
        couple.refresh()
        assertEquals(listOf("status", "schedules"), calls)
        // Unbinding drops the partner's timetable at once.
        couple.unbind()
        assertEquals(CoupleStatus.None, couple.status)
        assertNull(couple.layer())
        assertNull(couple.statusText("2026-09-15", 600))
        // Nothing is uploaded while unbound.
        couple.sync(ScheduleJson.parseSnapshot(snapshot(JSONArray().put(JSONObject().put("day", 1).put("bigSlot", 1)
            .put("courses", JSONArray().put(course("药理学", 1, 2)))))))
        assertFalse("sync" in calls)
        now += 1
    }

    // endregion
}
