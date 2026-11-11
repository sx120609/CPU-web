package cn.lizmt.cpuweb.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.YearMonth

/** Rules behind the fixes found while checking the NapTable port by hand. */
class NapTableQaTest {
    @Test
    fun textStopsAtTheLargestStandardSize() {
        assertEquals(1f, cappedFontScale(1f))
        assertEquals(1.15f, cappedFontScale(1.15f))
        assertEquals(MAX_FONT_SCALE, cappedFontScale(2f))
        assertEquals(0.85f, cappedFontScale(0.85f))
    }

    @Test
    fun monthGridStartsOnMondayInChinese() {
        assertEquals(listOf("一", "二", "三", "四", "五", "六", "日"), ChineseMonthGrid.WEEKDAYS)
        // November 2026 starts on a Sunday: six blanks, then the 1st.
        val rows = ChineseMonthGrid.rows(YearMonth.of(2026, 11))
        assertEquals(6, rows.size)
        rows.forEach { assertEquals(7, it.size) }
        assertNull(rows[0][5])
        assertEquals(LocalDate.of(2026, 11, 1), rows[0][6])
        assertEquals(LocalDate.of(2026, 11, 30), rows[5][0])
        assertEquals(30, rows.flatten().count { it != null })
        assertEquals("2026年11月", ChineseMonthGrid.title(YearMonth.of(2026, 11)))
    }

    @Test
    fun monthStartingOnMondayHasNoLeadingBlank() {
        // June 2026 starts on a Monday.
        val rows = ChineseMonthGrid.rows(YearMonth.of(2026, 6))
        assertEquals(LocalDate.of(2026, 6, 1), rows[0][0])
        assertEquals(5, rows.size)
    }
}
