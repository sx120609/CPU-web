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
}
