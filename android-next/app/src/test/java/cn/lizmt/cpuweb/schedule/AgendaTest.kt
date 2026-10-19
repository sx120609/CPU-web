package cn.lizmt.cpuweb.schedule

import cn.lizmt.cpuweb.schedule.agenda.AgendaCodec
import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import cn.lizmt.cpuweb.schedule.agenda.AgendaKind
import cn.lizmt.cpuweb.schedule.agenda.AgendaParser
import cn.lizmt.cpuweb.schedule.agenda.AgendaRemind
import cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat
import cn.lizmt.cpuweb.schedule.agenda.AgendaStore
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.LocalDateTime

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AgendaTest {
    @get:Rule val folder = TemporaryFolder()

    /** Monday 19 October 2026, 06:44. */
    private val now = LocalDateTime.of(2026, 10, 19, 6, 44)

    @Test
    fun theCodecKeepsItemsShowableAndDropsTheRest() {
        // Any item may go without a day; it then carries no time either.
        assertEquals("", AgendaCodec.normalize(AgendaItem("abcdef123456", AgendaKind.Event, "没有日期", start = "09:00"))!!.start)
        assertNull(AgendaCodec.normalize(AgendaItem("abcdef123456", AgendaKind.Todo, "   ")))
        val todo = AgendaCodec.normalize(AgendaItem("bcdefg234567", AgendaKind.Todo, "买  牛奶", start = "09:00", remind = 0, repeat = AgendaRepeat.Daily))!!
        assertEquals("买 牛奶", todo.title)
        // No day: no time, no reminder, no repeat.
        assertEquals("", todo.start)
        assertEquals(AgendaRemind.NONE, todo.remind)
        assertEquals(AgendaRepeat.None, todo.repeat)
        val event = AgendaCodec.normalize(AgendaItem("abcdef123456", AgendaKind.Event, "组会", "2026-10-23", "15:00", "14:00", until = "2026-01-01"))!!
        assertEquals("", event.end)
        assertEquals("", event.until)
        val round = AgendaCodec.decode(AgendaCodec.encode(listOf(event, todo)))
        assertEquals(listOf(event, todo), round)
        assertNull(AgendaCodec.fromJson(JSONObject().put("id", "BAD ID").put("kind", "todo").put("title", "x")))
    }

    @Test
    fun repeatsFollowTheirRuleAndEndDate() {
        val weekly = AgendaItem("abcdef123456", AgendaKind.Event, "羽毛球", "2026-10-21", "19:00", repeat = AgendaRepeat.Weekly, until = "2026-11-04")
        assertTrue(weekly.occursOn(LocalDate.of(2026, 10, 28)))
        assertFalse(weekly.occursOn(LocalDate.of(2026, 10, 29)))
        assertFalse(weekly.occursOn(LocalDate.of(2026, 11, 11)))
        assertFalse(weekly.occursOn(LocalDate.of(2026, 10, 14)))
        val weekdays = weekly.copy(repeat = AgendaRepeat.Weekdays, until = "")
        assertTrue(weekdays.occursOn(LocalDate.of(2026, 10, 23)))
        assertFalse(weekdays.occursOn(LocalDate.of(2026, 10, 24)))
        val monthly = weekly.copy(date = "2026-01-31", repeat = AgendaRepeat.Monthly, until = "")
        assertFalse(monthly.occursOn(LocalDate.of(2026, 2, 28)))
        assertTrue(monthly.occursOn(LocalDate.of(2026, 3, 31)))
    }

    @Test
    fun remindersFireBeforeTheNextOpenOccurrence() {
        val event = AgendaItem("abcdef123456", AgendaKind.Event, "组会", "2026-10-19", "15:00", remind = 15)
        assertEquals(LocalDateTime.of(2026, 10, 19, 14, 45), event.nextReminder(now)!!.second)
        assertNull(event.nextReminder(LocalDateTime.of(2026, 10, 19, 14, 50)))
        val untimed = AgendaItem("abcdef123456", AgendaKind.Todo, "交表", "2026-10-20", remind = 1440)
        assertEquals(LocalDateTime.of(2026, 10, 19, 8, 0), untimed.nextReminder(now)!!.second)
        // A repeating to-do skips the days already done.
        val daily = AgendaItem("abcdef123456", AgendaKind.Todo, "背单词", "2026-10-01", "07:00", remind = 0, repeat = AgendaRepeat.Daily,
            doneDates = setOf("2026-10-19"))
        assertEquals(LocalDate.of(2026, 10, 20), daily.nextReminder(now)!!.first)
        assertNull(event.copy(remind = AgendaRemind.NONE).nextReminder(now))
        assertNull(event.copy(kind = AgendaKind.Todo, done = true).nextReminder(now))
    }

    @Test
    fun theStoreSavesTicksAndOrdersOpenTodos() {
        var changes = 0
        val store = AgendaStore.forTest(folder.newFile("agenda.json")) { changes += 1 }
        val undated = store.save(AgendaItem("", AgendaKind.Todo, "买实验服"), now = 1)!!
        val overdue = store.save(AgendaItem("", AgendaKind.Todo, "还书", "2026-10-17"), now = 2)!!
        val event = store.save(AgendaItem("", AgendaKind.Event, "体检", "2026-10-19"), now = 3)!!
        assertEquals(12, undated.id.length)
        // A past timed item happened; a past untimed one left unticked is still to do.
        store.save(AgendaItem("", AgendaKind.Event, "上周的组会", "2026-10-16", "14:00"), now = 4)
        assertEquals(listOf(overdue.id, undated.id), store.open(LocalDate.of(2026, 10, 19)).map { it.id })
        store.setDone(overdue.id, "2026-10-17", true)
        assertEquals(listOf(undated.id), store.open(LocalDate.of(2026, 10, 19)).map { it.id })
        assertEquals(listOf(event.id), store.on(LocalDate.of(2026, 10, 19)).map { it.item.id })
        val removed = store.remove(event.id)!!
        store.restore(removed)
        assertEquals(4, store.items.size)
        assertTrue(changes >= 6)
        // A fresh store reads back what was written.
        val reread = AgendaStore.forTest(java.io.File(folder.root, "agenda.json"))
        assertEquals(store.items, reread.items)
    }

    @Test
    fun timetableGridsPlaceItemsByTheirClockTime() {
        // Two morning periods with a break, then lunch, then an afternoon period; rows of 50 with gaps of 4.
        val periods = listOf(
            SchedulePeriod(1, "08:00", "08:45"),
            SchedulePeriod(2, "08:55", "09:40"),
            SchedulePeriod(3, "13:30", "14:15"),
        )
        fun y(time: String) = agendaOffset(AgendaItem.parseTime(time)!!.let { it.hour * 60 + it.minute }, periods, 50f, 4f)
        assertEquals(0f, y("07:00"), 0.01f)
        assertEquals(0f, y("08:00"), 0.01f)
        // 22 of the period's 45 minutes.
        assertEquals(50f * 22 / 45, y("08:22"), 0.01f)
        assertEquals(50f, y("08:45"), 0.01f)
        // Halfway through the ten-minute break: halfway across the gap.
        assertEquals(52f, y("08:50"), 0.01f)
        assertEquals(54f, y("08:55"), 0.01f)
        // Lunch from 09:40 to 13:30 is the one gap before period 3.
        assertEquals(108f - 4f, y("09:40"), 0.01f)
        assertEquals(108f, y("13:30"), 0.01f)
        assertEquals(158f, y("14:15"), 0.01f)
        assertEquals(158f, y("22:00"), 0.01f)
    }

    @Test
    fun quickNotesBecomeItems() {
        fun parse(text: String) = AgendaParser.parse(text, now)

        parse("明天下午3点 实验报告").let {
            assertEquals("实验报告", it.title)
            assertEquals("2026-10-20", it.date)
            assertEquals("15:00", it.start)
            assertEquals(AgendaKind.Event, it.kind)
        }
        parse("周五 14:00-15:30 组会 @药学楼302").let {
            assertEquals("组会", it.title)
            assertEquals("2026-10-23", it.date)
            assertEquals("14:00", it.start)
            assertEquals("15:30", it.end)
            assertEquals("药学楼302", it.location)
        }
        parse("每周三晚上7点 羽毛球").let {
            assertEquals(AgendaRepeat.Weekly, it.repeat)
            assertEquals("2026-10-21", it.date)
            assertEquals("19:00", it.start)
            assertEquals("羽毛球", it.title)
        }
        parse("提醒我明早八点半取快递").let {
            assertEquals("取快递", it.title)
            assertEquals("2026-10-20", it.date)
            assertEquals("08:30", it.start)
            assertEquals(0, it.remind)
            assertEquals(AgendaKind.Todo, it.kind)
        }
        parse("10月25日 交论文 提前1天提醒").let {
            assertEquals("交论文", it.title)
            assertEquals("2026-10-25", it.date)
            assertEquals(1440, it.remind)
            assertEquals(AgendaKind.Todo, it.kind)
        }
        parse("下周一 体检").let {
            assertEquals("2026-10-26", it.date)
            assertEquals("", it.start)
            assertEquals(AgendaKind.Event, it.kind)
        }
        parse("买牛奶").let {
            assertEquals("买牛奶", it.title)
            assertEquals("", it.date)
            assertEquals(AgendaKind.Todo, it.kind)
        }
        // A time already past today means tomorrow; a bare 3 o'clock is the afternoon.
        assertEquals("18:00", parse("6点 跑步").start)
        assertEquals("2026-10-19", parse("6点 跑步").date)
        assertEquals("2026-10-20", parse("早上6点 跑步").date)
        assertEquals("2026-10-19", parse("3点 开会").date)
        assertEquals("15:00", parse("3点 开会").start)
        assertEquals("2026-10-20", parse("凌晨2点 看流星").date)
        assertEquals("02:00", parse("凌晨2点 看流星").start)
        assertNotNull(parse("").title)
    }
}
