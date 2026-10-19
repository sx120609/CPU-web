package cn.lizmt.cpuweb.schedule

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
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

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ScheduleStoreTest {
    private var now = 1_800_000_000_000L

    private fun course(name: String, start: Int, end: Int, weeks: List<Int>, extra: JSONObject.() -> Unit = {}) =
        JSONObject().put("name", name).put("startSlot", start).put("endSlot", end)
            .put("weeks", "").put("weekList", JSONArray(weeks)).apply(extra)

    private fun snapshot(
        semester: String = "2026-2027-1",
        week: String = "3",
        complete: Boolean = false,
        cells: JSONArray = JSONArray().put(
            JSONObject().put("day", 1).put("bigSlot", 1).put("courses", JSONArray().put(course("药理学", 1, 2, listOf(1, 3, 5)))),
        ),
        account: String = "acct-a",
        fetchedAt: Long = now,
        semesters: List<String> = listOf(semester),
    ): String = JSONObject()
        .put("version", 1)
        .put("completeSemester", complete)
        .put("fetchedAt", fetchedAt)
        .put("data", JSONObject()
            .put("currentSemester", semester)
            .put("currentWeek", week)
            .put("semesters", JSONArray(semesters.map { JSONObject().put("value", it).put("label", it).put("current", it == semester) }))
            .put("weeks", JSONArray((1..6).map { JSONObject().put("value", "$it").put("label", "第${it}周").put("current", it == 3) }))
            .put("cells", cells))
        .put("auth", JSONObject().put("authenticated", true).put("account", account))
        .toString()

    private fun TestScope.store(responses: MutableList<String>, requests: MutableList<ScheduleRequest> = mutableListOf()) =
        ScheduleStore(this, clock = { now }).apply {
            loader = { request ->
                requests += request
                responses.removeAt(0)
            }
            markBridgeReady()
        }

    @Test
    fun loadsAndFiltersByWeek() = runTest {
        val store = store(mutableListOf(snapshot()))
        advanceUntilIdle()
        assertEquals(ScheduleStatus.Loaded, store.status)
        assertEquals("2026-2027-1", store.selectedSemester)
        assertEquals("3", store.selectedWeek)
        assertEquals(1, store.blocksForDay(1).size)
        assertEquals(0, store.blocksForDay(1, "2", store.result).size)
    }

    @Test
    fun semesterMenuUsesTheTimetableOptionsWithoutCalendarExpansionOrExtraRequests() = runTest {
        val terms = listOf("2026-2027-1", "2025-2026-2")
        val data = JSONObject(snapshot(semesters = terms)).put("calendar", JSONObject().put("semesters",
            JSONArray((2000..2026).map { year -> JSONObject().put("value", "$year-${year + 1}-1").put("label", "$year") })))
        val requests = mutableListOf<ScheduleRequest>()
        val store = store(mutableListOf(data.toString()), requests)
        advanceUntilIdle()
        assertEquals(terms, store.semesterOptions().map { it.value })
        assertEquals(1, requests.size)
    }

    @Test
    fun completeSemesterSwitchesWeeksWithoutAnotherRequest() = runTest {
        val requests = mutableListOf<ScheduleRequest>()
        val store = store(mutableListOf(snapshot(complete = true)), requests)
        advanceUntilIdle()
        store.selectWeek("5")
        advanceUntilIdle()
        assertEquals(1, requests.size)
        assertEquals("5", store.selectedWeek)
        assertEquals(1, store.blocksForDay(1).size)
        assertTrue(store.resultFor("1") != null)
    }

    @Test
    fun mergesRepeatedRowsOfOneOccurrence() = runTest {
        val cells = JSONArray()
            .put(JSONObject().put("day", 2).put("bigSlot", 2).put("courses", JSONArray().put(course("有机化学", 3, 4, listOf(3)) { put("location", "实验楼(201)") })))
            .put(JSONObject().put("day", 2).put("bigSlot", 3).put("courses", JSONArray().put(course("有机化学", 5, 5, listOf(3)) { put("location", "201") })))
        val store = store(mutableListOf(snapshot(cells = cells)))
        advanceUntilIdle()
        val blocks = store.blocksForDay(2)
        assertEquals(1, blocks.size)
        assertEquals(3, blocks[0].startSlot)
        assertEquals(5, blocks[0].endSlot)
        assertEquals("03-05节", blocks[0].course.slotNote)
    }

    @Test
    fun keepsParallelSectionsWithDifferentSourcesApart() = runTest {
        val cells = JSONArray().put(JSONObject().put("day", 3).put("bigSlot", 1).put("courses", JSONArray()
            .put(course("体育", 1, 2, listOf(3)) { put("sourceKey", "a") })
            .put(course("体育", 1, 2, listOf(3)) { put("sourceKey", "b") })))
        val store = store(mutableListOf(snapshot(cells = cells)))
        advanceUntilIdle()
        assertEquals(2, store.blocksForDay(3).size)
        assertEquals(2, store.overlapping(store.blocksForDay(3)[0]).size)
    }

    @Test
    fun expiredAuthorizationKeepsTheVisibleTimetable() = runTest {
        val unauthorized = JSONObject().put("version", 1)
            .put("auth", JSONObject().put("authenticated", false))
            .put("error", "教务授权已失效，已保留上次课表；完成教务授权后可继续更新。").toString()
        val store = store(mutableListOf(snapshot(), unauthorized))
        advanceUntilIdle()
        store.load(true)
        advanceUntilIdle()
        assertEquals(ScheduleStatus.Loaded, store.status)
        assertTrue(store.authorizationExpired)
        assertTrue(store.result != null)
        assertTrue(store.errorMessage.contains("教务授权"))
    }

    @Test
    fun unauthorizedWithoutDataShowsTheAuthorizationState() = runTest {
        val unauthorized = JSONObject().put("version", 1).put("auth", JSONObject().put("authenticated", false)).toString()
        val store = store(mutableListOf(unauthorized))
        advanceUntilIdle()
        assertEquals(ScheduleStatus.Unauthorized, store.status)
        assertNull(store.result)
    }

    @Test
    fun refreshFailureBecomesABannerNotAStatePage() = runTest {
        val failure = JSONObject().put("version", 1).put("auth", JSONObject().put("authenticated", true))
            .put("error", "网络连接失败").toString()
        val store = store(mutableListOf(snapshot(), failure))
        advanceUntilIdle()
        store.load(true)
        advanceUntilIdle()
        assertEquals(ScheduleStatus.Loaded, store.status)
        assertEquals("网络连接失败", store.errorMessage)
    }

    @Test
    fun cancelledSelectionLeavesTheGridUntouched() = runTest {
        val cancelled = JSONObject().put("version", 1).put("cancelled", true)
            .put("auth", JSONObject().put("authenticated", true)).toString()
        val store = store(mutableListOf(snapshot(), cancelled))
        advanceUntilIdle()
        store.load(true)
        advanceUntilIdle()
        assertEquals(ScheduleStatus.Loaded, store.status)
        assertEquals("", store.errorMessage)
    }

    @Test
    fun accountChangeClearsEverythingAndSameAccountKeepsIt() = runTest {
        val store = store(mutableListOf(snapshot(), snapshot(account = "acct-b")))
        advanceUntilIdle()
        assertFalse(store.handleAuthChanged("acct-a"))
        assertTrue(store.result != null)
        assertTrue(store.handleAuthChanged("acct-b"))
        assertEquals("", store.selectedSemester)
        advanceUntilIdle()
        assertEquals(ScheduleStatus.Loaded, store.status)
        assertEquals("acct-b", store.accountScope)
        assertTrue(store.handleAuthChanged(""))
        assertNull(store.result)
        assertEquals(ScheduleStatus.Idle, store.status)
    }

    @Test
    fun rejectsAResponseForAnotherSemester() = runTest {
        val store = store(mutableListOf(snapshot(), snapshot(semester = "2025-2026-2")))
        advanceUntilIdle()
        store.load(true)
        advanceUntilIdle()
        assertEquals("2026-2027-1", store.result?.currentSemester)
        assertTrue(store.errorMessage.contains("其他学期"))
    }

    @Test
    fun anOldTermsShorterListKeepsTheRunningTermSelectable() = runTest {
        val running = listOf("2026-2027-1", "2025-2026-2", "2025-2026-1")
        // The school's teaching-calendar page for an old term predates the running term.
        val old = snapshot(semester = "2025-2026-1", semesters = listOf("2025-2026-2", "2025-2026-1", "2024-2025-2"))
        val store = store(mutableListOf(snapshot(semesters = running), old))
        advanceUntilIdle()
        store.selectSemester("2025-2026-1")
        advanceUntilIdle()
        assertEquals("2025-2026-1", store.result?.currentSemester)
        assertEquals(
            listOf("2026-2027-1", "2025-2026-2", "2025-2026-1"),
            store.semesterOptions().map { it.value },
        )
    }

    @Test
    fun aTermThatCannotLoadReturnsToThePreviousTerm() = runTest {
        val failure = JSONObject().put("version", 1).put("auth", JSONObject().put("authenticated", true))
            .put("error", "教务返回的课表学期与请求不一致").toString()
        val requests = mutableListOf<ScheduleRequest>()
        val store = store(mutableListOf(snapshot(semesters = listOf("2026-2027-1", "2020-2021-1")), failure), requests)
        advanceUntilIdle()
        store.selectSemester("2020-2021-1")
        advanceUntilIdle()
        assertEquals("2020-2021-1", requests.last().semester)
        assertEquals(ScheduleStatus.Loaded, store.status)
        assertEquals("2026-2027-1", store.selectedSemester)
        assertEquals("3", store.selectedWeek)
        assertEquals("2026-2027-1", store.result?.currentSemester)
        assertTrue(store.errorMessage.contains("2020-2021-1"))
        assertTrue(store.semesterOptions().any { it.value == "2020-2021-1" })
    }

    @Test
    fun aFailedTermWithoutAFallbackStillListsEveryTerm() = runTest {
        val failure = JSONObject().put("version", 1).put("auth", JSONObject().put("authenticated", true))
            .put("error", "教务返回的课表学期与请求不一致").toString()
        val store = store(mutableListOf(snapshot(semesters = listOf("2026-2027-1", "2020-2021-1")), failure))
        advanceUntilIdle()
        // The previous term's copy has expired, so there is nothing to return to.
        now += ScheduleStore.CACHE_LIFETIME_MS + 1
        store.selectSemester("2020-2021-1")
        advanceUntilIdle()
        assertEquals(ScheduleStatus.Failed, store.status)
        assertNull(store.result)
        assertEquals("2020-2021-1", store.selectedSemester)
        assertEquals(listOf("2026-2027-1", "2020-2021-1"), store.semesterOptions().map { it.value })
    }

    @Test
    fun prefetchedWeeksFillTheCacheWithoutSwitchingTheVisibleWeek() = runTest {
        val requests = mutableListOf<ScheduleRequest>()
        val store = store(mutableListOf(snapshot()), requests)
        advanceUntilIdle()
        store.acceptPrefetched(snapshot(week = "4"))
        assertEquals("3", store.selectedWeek)
        store.selectWeek("4")
        advanceUntilIdle()
        assertEquals(1, requests.size)
        assertEquals("4", store.result?.currentWeek)
        // Another account's prefetch never enters this cache.
        store.acceptPrefetched(snapshot(week = "5", account = "intruder"))
        assertNull(store.resultFor("5"))
    }

    @Test
    fun duplicateLoadsShareOneRequest() = runTest {
        val gate = CompletableDeferred<String>()
        val requests = mutableListOf<ScheduleRequest>()
        val store = ScheduleStore(this, clock = { now }).apply {
            loader = { request ->
                requests += request
                gate.await()
            }
            markBridgeReady()
        }
        store.load(false)
        store.load(false)
        gate.complete(snapshot())
        advanceUntilIdle()
        assertEquals(1, requests.size)
        assertEquals(ScheduleStatus.Loaded, store.status)
    }

    @Test
    fun returningFromReauthorizationRevalidatesAFreshCache() = runTest {
        val unauthorized = JSONObject().put("version", 1)
            .put("auth", JSONObject().put("authenticated", false)).toString()
        val requests = mutableListOf<ScheduleRequest>()
        val store = store(mutableListOf(snapshot(), unauthorized, snapshot()), requests)
        advanceUntilIdle()
        store.load(true)
        advanceUntilIdle()
        assertTrue(store.authorizationExpired)
        // The cached copy is still fresh, but an expired authorization must be re-checked.
        store.load(false)
        advanceUntilIdle()
        assertEquals(3, requests.size)
        assertFalse(store.authorizationExpired)
        assertEquals("", store.errorMessage)
    }

    @Test
    fun bridgeReadyWithoutAutoLoadLeavesTheFirstRequestToTheCaller() = runTest {
        val requests = mutableListOf<ScheduleRequest>()
        val store = ScheduleStore(this, clock = { now }).apply {
            loader = { request -> requests += request; snapshot() }
        }
        store.markBridgeReady(autoLoad = false)
        advanceUntilIdle()
        assertEquals(0, requests.size)
        store.load(false)
        advanceUntilIdle()
        assertEquals(1, requests.size)
        assertEquals(ScheduleStatus.Loaded, store.status)
    }

    @Test
    fun snapshotsWithoutAFetchTimeKeepTheTimeTheyWereFirstSeen() {
        val raw = JSONObject(snapshot()).apply { remove("fetchedAt") }.toString()
        val first = ScheduleJson.parseSnapshot(raw)!!
        val again = ScheduleJson.parseSnapshot(first.raw)!!
        assertEquals(first.fetchedAt, again.fetchedAt)
    }

    @Test
    fun archiveWriteAfterClearIsNotLost() {
        val file = java.io.File.createTempFile("archive", ".json").apply { delete() }
        val archive = ScheduleArchive(file) { "fingerprint" }
        fun saved(account: String) = ScheduleArchive.Saved(account, "2026-2027-1", "3", 1, "week", listOf(snapshot(account = account)))
        archive.write(saved("acct-a"))
        archive.clear()
        archive.write(saved("acct-b"))
        val deadline = System.currentTimeMillis() + 5_000
        while (System.currentTimeMillis() < deadline && archive.read()?.account != "acct-b") Thread.sleep(20)
        assertEquals("acct-b", archive.read()?.account)
        file.delete()
    }

    @Test
    fun holidaysCancelClassesAndMakeUpDaysHoldTheSourceDate() = runTest {
        // Week 3 is 2026-09-14..20 and week 4 is 2026-09-21..27; 09-20 (Sunday)
        // holds the classes of 09-25 (Friday), and 09-25 itself is a day off.
        val days = { start: Int -> JSONArray((0 until 7).map { "2026-09-%02d".format(start + it) }) }
        val calendar = JSONObject().put("currentWeek", 3).put("weeks", JSONArray()
            .put(JSONObject().put("week", 3).put("days", days(14)))
            .put(JSONObject().put("week", 4).put("days", days(21))))
            .put("adjustments", JSONArray()
                .put(JSONObject().put("date", "2026-09-20").put("kind", "swap").put("source", "2026-09-25").put("note", "国庆节调休"))
                .put(JSONObject().put("date", "2026-09-25").put("kind", "off")))
        val cells = JSONArray()
            .put(JSONObject().put("day", 5).put("bigSlot", 1).put("courses", JSONArray().put(course("药事管理", 1, 2, listOf(3, 4)))))
            .put(JSONObject().put("day", 7).put("bigSlot", 1).put("courses", JSONArray().put(course("周日课", 1, 2, listOf(3, 4)))))
        val raw = JSONObject(snapshot(complete = true, cells = cells)).put("calendar", calendar).toString()
        val store = store(mutableListOf(raw))
        advanceUntilIdle()
        assertEquals(listOf("药事管理"), store.blocksForDay(5, "3").map { it.course.name })
        // Sunday of week 3 is a make-up day: Friday 09-25's classes, not its own.
        assertEquals(listOf("药事管理"), store.blocksForDay(7, "3").map { it.course.name })
        assertEquals(7, store.blocksForDay(7, "3")[0].day)
        assertEquals("swap", store.adjustment(7, "3")?.kind)
        assertEquals("国庆节调休 · 上 09.25 的课", store.adjustmentDetail(store.adjustment(7, "3")!!))
        // Friday of week 4 is off; Sunday of week 4 keeps its normal classes.
        assertTrue(store.blocksForDay(5, "4").isEmpty())
        assertEquals("放假，不上课", store.adjustmentDetail(store.adjustment(5, "4")!!))
        assertEquals(listOf("周日课"), store.blocksForDay(7, "4").map { it.course.name })
    }

    @Test
    fun aPastTermIsNeverTheCurrentWeek() = runTest {
        val today = ScheduleStore.todayKey()
        val calendar = JSONObject().put("currentWeek", 0).put("weeks", JSONArray()
            .put(JSONObject().put("week", 1).put("days", JSONArray((1..7).map { "2026-03-0$it" }))))
        val raw = JSONObject(snapshot(semester = "2025-2026-2", week = "1", complete = true)).put("calendar", calendar).toString()
        val store = store(mutableListOf(raw))
        advanceUntilIdle()
        assertFalse(today.startsWith("2026-03-0"))
        assertFalse(store.isCurrentWeek("1"))
    }

    @Test
    fun editorNotesDropGeneratedPeriodLabels() = runTest {
        val cells = JSONArray().put(JSONObject().put("day", 1).put("bigSlot", 1).put("courses", JSONArray()
            .put(course("药理学", 1, 2, listOf(3)) { put("slotNote", "第 1-2 节") })
            .put(course("自习", 1, 2, listOf(3)) { put("slotNote", "带实验服"); put("sourceKey", "b") })))
        val store = store(mutableListOf(snapshot(cells = cells)))
        advanceUntilIdle()
        val blocks = store.blocksForDay(1)
        assertEquals("01-02节", blocks.first { it.course.name == "药理学" }.course.slotNote)
        assertEquals("", blocks.first { it.course.name == "药理学" }.course.editableNote)
        assertEquals("带实验服", blocks.first { it.course.name == "自习" }.course.editableNote)
    }

    @Test
    fun widgetLocalRecordMatchesTheWebFormatAndSkipsHolidays() = runTest {
        val days = { start: Int -> JSONArray((0 until 7).map { "2026-09-%02d".format(start + it) }) }
        val calendar = JSONObject().put("currentWeek", 3).put("weeks", JSONArray()
            .put(JSONObject().put("week", 3).put("days", days(14)))
            .put(JSONObject().put("week", 4).put("days", days(21))))
            .put("adjustments", JSONArray()
                .put(JSONObject().put("date", "2026-09-20").put("kind", "swap").put("source", "2026-09-25"))
                .put(JSONObject().put("date", "2026-09-25").put("kind", "off").put("note", "中秋节（公开节假日）")))
        val cells = JSONArray().put(JSONObject().put("day", 5).put("bigSlot", 1).put("courses", JSONArray()
            .put(course("药事管理", 1, 2, listOf(3, 4)) { put("location", "B311"); put("weeks", "3-4周") })))
        val raw = JSONObject(snapshot(complete = true, cells = cells)).put("calendar", calendar).toString()
        val store = store(mutableListOf(raw))
        advanceUntilIdle()
        val record = store.widgetLocalRecord()!!
        assertEquals("2026-2027-1", record.getString("semester"))
        assertTrue(record.getBoolean("complete"))
        val byDate = (0 until record.getJSONArray("days").length()).map { record.getJSONArray("days").getJSONObject(it) }
            .associateBy { it.getString("date") }
        assertEquals(14, byDate.size)
        val friday = byDate.getValue("2026-09-18").getJSONArray("courses").getJSONObject(0)
        assertEquals("药事管理", friday.getString("name"))
        assertEquals("08:00", friday.getString("startTime"))
        assertEquals("09:40", friday.getString("endTime"))
        // The make-up Sunday holds Friday 09-25's class; the day off itself is empty.
        assertEquals("药事管理", byDate.getValue("2026-09-20").getJSONArray("courses").getJSONObject(0).getString("name"))
        assertEquals(0, byDate.getValue("2026-09-25").getJSONArray("courses").length())
        assertEquals("中秋节", record.getJSONArray("holidays").getJSONObject(0).getString("name"))
        // The upstream widget reader accepts it as is.
        assertTrue(ScheduleWidgetLocalDays.parse(record.toString()) != null)
    }

    @Test
    fun twelfthPeriodSurvivesRenderingExportAndOldBridgePeriodTables() = runTest {
        val cells = JSONArray().put(JSONObject().put("day", 1).put("bigSlot", 6).put("courses", JSONArray()
            .put(course("晚间实验", 11, 12, listOf(3)))))
        val calendar = JSONObject().put("currentWeek", 3).put("weeks", JSONArray().put(
            JSONObject().put("week", 3).put("days", JSONArray((14..20).map { "2026-09-$it" }))))
        val oldPeriods = JSONArray(BUNDLED_PERIODS.take(11).map {
            JSONObject().put("number", it.number).put("startTime", if (it.number == 1) "08:10" else it.startTime).put("endTime", it.endTime)
        })
        val raw = JSONObject(snapshot(cells = cells)).put("calendar", calendar).put("periods", oldPeriods).toString()
        val store = store(mutableListOf(raw))
        advanceUntilIdle()
        assertEquals(12, store.blocksForDay(1).single().endSlot)
        assertEquals("08:10", store.periodTime(1).startTime)
        assertEquals("21:15", store.periodTime(12).startTime)
        assertEquals("22:00", store.periodTime(12).endTime)
        assertTrue(ScheduleExport.text(store).contains("20:20–22:00 晚间实验"))
        assertTrue(ScheduleExport.calendar(store).contains("DTEND:20260914T140000Z"))
        val days = store.widgetLocalRecord()!!.getJSONArray("days")
        val monday = (0 until days.length()).map { days.getJSONObject(it) }.first { it.getString("date") == "2026-09-14" }
        assertEquals("22:00", monday.getJSONArray("courses").getJSONObject(0).getString("endTime"))
    }

    @Test
    fun weekTextCompressesRanges() {
        assertEquals("1-3、5、7-8周", ScheduleStore.weekText(listOf(1, 2, 3, 5, 7, 8)))
        assertEquals("01-02节", ScheduleStore.slotLabel(1, 2))
        assertEquals("09节", ScheduleStore.slotLabel(9, 9))
    }
}
