package cn.lizmt.cpuweb.schedule

import kotlinx.coroutines.test.TestScope
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Date

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ScheduleExportAndVisualsTest {
    private fun loadedStore(withDates: Boolean): ScheduleStore {
        val store = ScheduleStore(TestScope())
        val calendar = JSONObject().put("currentWeek", 2).put("weeks", JSONArray().put(
            JSONObject().put("week", 2).put("days", JSONArray(if (withDates) (21..27).map { "2026-09-$it" } else emptyList<String>())),
        ))
        val cells = JSONArray().put(JSONObject().put("day", 1).put("bigSlot", 1).put("courses", JSONArray().put(
            JSONObject().put("name", "药物化学, 实验;一").put("startSlot", 1).put("endSlot", 2)
                .put("weekList", JSONArray(listOf(2))).put("location", "A101").put("teacher", "王老师"),
        )))
        val raw = JSONObject().put("version", 1).put("fetchedAt", System.currentTimeMillis())
            .put("data", JSONObject().put("currentSemester", "2026-2027-1").put("currentWeek", "2")
                .put("weeks", JSONArray().put(JSONObject().put("value", "2").put("label", "第2周")))
                .put("cells", cells))
            .put("calendar", calendar)
            .put("auth", JSONObject().put("authenticated", true).put("account", "a")).toString()
        store.accept(raw, refreshed = false)
        return store
    }

    @Test
    fun calendarUsesBeijingTimeAndEscapesText() {
        val ics = ScheduleExport.calendar(loadedStore(withDates = true), Date(0))
        assertTrue(ics.startsWith("BEGIN:VCALENDAR\r\n"))
        assertTrue(ics.contains("DTSTART:20260921T000000Z"))
        assertTrue(ics.contains("DTEND:20260921T014000Z"))
        assertTrue(ics.contains("SUMMARY:药物化学\\, 实验\\;一"))
        assertTrue(ics.endsWith("END:VCALENDAR\r\n"))
    }

    @Test(expected = IllegalStateException::class)
    fun calendarRefusesWeeksWithoutDates() {
        ScheduleExport.calendar(loadedStore(withDates = false))
    }

    @Test
    fun foldingCountsUtf8Octets() {
        val folded = ScheduleExport.fold("SUMMARY:" + "课".repeat(40))
        folded.split("\r\n").forEach { line -> assertTrue(line.toByteArray().size <= 75) }
        assertEquals("SUMMARY:" + "课".repeat(40), folded.replace("\r\n ", ""))
    }

    @Test
    fun sharedTextListsTheSelectedWeek() {
        val text = ScheduleExport.text(loadedStore(withDates = true))
        assertTrue(text.startsWith("药大拾间 · 2026-2027-1 第 2 周"))
        assertTrue(text.contains("08:00–09:40 药物化学"))
    }

    @Test
    fun everyPaletteKeepsCourseTextReadable() {
        for (theme in SCHEDULE_THEME_ORDER) {
            for (dark in listOf(false, true)) {
                for (name in listOf("药理学", "有机化学实验", "体育", "大学英语 III", "形势与政策")) {
                    val tone = scheduleCardTone(name, theme, dark)
                    val ratio = contrastRatio(tone.text, tone.fill or (0xFF shl 24))
                    assertTrue("$theme/$dark/$name contrast $ratio", ratio >= 4.5)
                }
            }
        }
    }

    @Test
    fun paletteNamesAndFallbacksMatchTheWeb() {
        assertEquals(9, SCHEDULE_PALETTES.size)
        assertEquals("color-glass", normalizedScheduleTheme("unknown"))
        assertEquals("green", normalizedScheduleTheme(" GREEN "))
        assertEquals(courseNameHash("药理学"), courseNameHash("  药理学 "))
    }

    @Test
    fun colorfulCoursesUseTheWebHueSpaceInsteadOfEightBuckets() {
        val names = listOf("药理学", "药事管理", "药物化学", "有机化学", "分析化学", "物理化学", "生物化学", "药物分析", "药剂学", "药用植物学", "微生物学", "人体解剖学", "高等数学", "大学英语", "大学物理", "细胞生物学", "免疫学", "药物代谢动力学", "临床医学概论", "中药鉴定学")
        val tones = names.map { scheduleCardTone(it, "color-glass", false) }
        assertTrue(tones.map { it.fill }.distinct().size > 16)
        names.forEach { name ->
            val web = scheduleCourseTone(name, "color-glass", false)
            val native = scheduleCardTone(name, "color-glass", false)
            assertEquals(web.fill, native.fill)
            assertEquals(web.border, native.border)
        }
    }

    @Test
    fun portraitWeekFitsTwelveRowsWithoutClippingPeriodLabels() {
        for (height in listOf(460f, 480f, 540f, 640f)) {
            assertTrue(compactWeekRowHeight(height) * SLOT_COUNT + 46 <= height + 0.01f)
        }
    }
}
