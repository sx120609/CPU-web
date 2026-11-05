package cn.lizmt.cpuweb.schedule

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The dorm maths against the Web's cases (web/tests/dormSchedule.test.ts). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class DormScheduleParityTest {
    private val tuesday = "2026-09-08"
    private val week = CalendarWeek(1, (7..13).map { "2026-09-%02d".format(it) }, "2026-09-07", "2026-09-13")
    private val periods = listOf(
        SchedulePeriod(1, "08:00", "08:45"), SchedulePeriod(2, "08:55", "09:40"),
        SchedulePeriod(3, "10:00", "10:45"), SchedulePeriod(4, "10:55", "11:40"),
    )

    /** Someone with these classes on [tuesday] only, as (start, end, first period). */
    private fun person(id: Int, vararg classes: Triple<String, String, Int>) = DormPerson(id, "人$id", "blue", periods, listOf(week)) { date ->
        if (date !in week.days) null
        else if (date != tuesday) emptyList()
        else classes.map { (start, end, slot) -> DormCourse("课$slot", DormRules.minutes(start)!!, DormRules.minutes(end)!!, slot, slot) }
    }

    private fun noData(id: Int) = DormPerson(id, "人$id", "blue", emptyList(), emptyList()) { null }

    @Test
    fun theWindowComesFromThePeriodsAndFallsBackWithoutAny() {
        assertEquals(DormSpan(480, 700), DormRules.dayWindow(listOf(person(1))))
        assertEquals(DormSpan(480, 1300), DormRules.dayWindow(listOf(noData(1))))
    }

    @Test
    fun byDefaultEveryoneWithDataMustBeFree() {
        val people = listOf(person(1, Triple("08:00", "09:40", 1)), person(2, Triple("10:00", "10:45", 3)))
        val day = DormRules.availability(people, tuesday)
        assertEquals(listOf(DormFreeWindow(580, 600, listOf(1, 2)), DormFreeWindow(645, 700, listOf(1, 2))), day.windows)
        assertEquals("全宿舍都有空", DormRules.windowLabel(day.windows[0], day))
    }

    @Test
    fun anExplicitHeadCountIsNotLoweredToThePeopleWithData() {
        val people = listOf(person(1), person(2), noData(3))
        val day = DormRules.availability(people, tuesday, minFree = 3)
        assertTrue(day.insufficientData)
        assertTrue(day.windows.isEmpty())
        assertEquals("已同步的 2 人都有空", DormRules.availability(people, tuesday).let { DormRules.windowLabel(it.windows[0], it) })
    }

    @Test
    fun aRelaxedCountKeepsAnHourTwoShareWhileAThirdComesAndGoes() {
        val third = person(3, Triple("10:00", "10:10", 3), Triple("10:20", "10:30", 3), Triple("10:40", "10:50", 3))
        val people = listOf(person(1), person(2), third)
        val hour = DormSpan(600, 660)
        assertEquals(listOf(DormFreeWindow(600, 660, listOf(1, 2))), DormRules.availability(people, tuesday, minFree = 2, span = hour).windows)
        assertTrue(DormRules.availability(people, tuesday, span = hour).windows.isEmpty())
    }

    @Test
    fun windowsNeverChainDifferentPairs() {
        val people = listOf(person(1, Triple("10:15", "10:40", 3)), person(2), person(3, Triple("10:00", "10:15", 3)))
        val day = DormRules.availability(people, tuesday, minFree = 2, span = DormSpan(600, 640))
        assertEquals(listOf(DormFreeWindow(615, 640, listOf(2, 3))), day.windows)
    }

    @Test
    fun aShortTailDoesNotDissolveALongerWindowWithMorePeople() {
        val people = listOf(person(1), person(2), person(3, Triple("10:00", "10:10", 3)))
        val day = DormRules.availability(people, tuesday, minFree = 2, span = DormSpan(600, 780))
        assertEquals(listOf(DormFreeWindow(610, 780, listOf(1, 2, 3))), day.windows)
    }

    @Test
    fun peopleWithoutDataAreReportedNotCountedFree() {
        val day = DormRules.availability(listOf(person(1), noData(2)), tuesday)
        assertEquals(listOf(1), day.knownIds)
        assertEquals(listOf(2), day.unknownIds)
        assertTrue(DormRules.availability(listOf(noData(1)), tuesday).windows.isEmpty())
    }

    @Test
    fun onlyAClassInPeriodOneIsAnEarlyClass() {
        // A class moved to 07:40 in period 3 is not one.
        val people = listOf(person(1, Triple("08:00", "08:45", 1)), person(2, Triple("07:40", "08:20", 3)))
        assertEquals(listOf(1), DormRules.duties(people, tuesday).map { it.id })
        val days = DormRules.mornings(people + noData(3), "2026-09-07", 3)
        assertEquals(listOf(0, 1, 0), days.map { it.duties.size })
        assertEquals(listOf(1, 1, 1), days.map { it.unknownCount })
    }

    @Test
    fun theNextEarlyClassSkipsTodayOnceItHasBegun() {
        val days = DormRules.mornings(listOf(person(1, Triple("08:00", "08:45", 1))), tuesday, 2)
        assertEquals(tuesday, DormRules.nextMorning(days, tuesday, 7 * 60)?.date)
        assertNull(DormRules.nextMorning(days, tuesday, 8 * 60 + 30))
    }

    @Test
    fun theWeekGridCountsWhoIsFreeInEachPeriod() {
        val people = listOf(person(1, Triple("08:00", "08:45", 1)), person(2), noData(3))
        val grid = DormRules.weekGrid(people, "2026-09-07", meId = 1)
        assertEquals(1, grid.teachingWeek)
        val first = grid.rows[0].cells[1]
        assertEquals(listOf(2), first.freeIds)
        assertEquals(listOf(1 to listOf("课1")), first.busy)
        assertEquals(listOf(3), first.unknownIds)
        assertEquals("1 人有空", DormRules.cellSummary(first))
        assertEquals("已同步的 2 人都有空", DormRules.cellSummary(grid.rows[1].cells[1]))
        // 09:40 → 10:00 is not a break; it takes 30 minutes.
        assertTrue(grid.rows.none { it.breakBefore })
    }

    @Test
    fun statusReadsTheServerReply() {
        val json = JSONObject("""{"status":"active","name":"302","memberLimit":6,"isOwner":true,
            "invite":{"code":"D6K3PQ","expired":false},"me":{"id":1,"nickname":"阿青","color":"teal","isOwner":true,"snapshot":null},
            "members":[{"id":1,"nickname":"阿青","color":"teal","isOwner":true,"snapshot":null},
            {"id":2,"nickname":"小王","color":"nope","isOwner":false,"snapshot":{"syncedAt":"2026-10-08T01:30:00.000Z"}}]}""")
        val status = DormStatus.fromJson(json) as DormStatus.Active
        assertEquals("D6K3PQ", status.invite?.code)
        assertEquals("blue", status.members[1].color)
        assertEquals("", status.members[0].syncedAt)
        assertEquals(DormStatus.None, DormStatus.fromJson(JSONObject("""{"status":"none"}""")))
    }
}
