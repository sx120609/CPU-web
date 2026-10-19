package cn.lizmt.cpuweb.schedule

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import java.util.Calendar
import java.util.Locale
import kotlin.math.roundToInt

/**
 * How the week view is drawn: text size, what each card shows and whether the
 * period axis carries times. The defaults are the look before these options
 * existed, so anything outside the week grid (day view, thumbnails) is unchanged.
 */
data class ScheduleDisplayOptions(
    val textScale: Float = 1f,
    val compact: Boolean = false,
    val showTeacher: Boolean = false,
    val showSlotTime: Boolean = true,
)

val LocalScheduleDisplay = compositionLocalOf { ScheduleDisplayOptions() }

/** Scales the text of a course card without touching its frame. */
@Composable
internal fun ScheduleCardText(content: @Composable () -> Unit) {
    val scale = LocalScheduleDisplay.current.textScale
    if (scale == 1f) {
        content()
        return
    }
    val density = LocalDensity.current
    CompositionLocalProvider(LocalDensity provides Density(density.density, density.fontScale * scale), content = content)
}

/** The rules behind the display settings, kept free of Android so they can be unit tested. */
object ScheduleDisplayRules {
    const val ROW_HEIGHT_MIN = 70
    const val ROW_HEIGHT_MAX = 180
    const val ROW_HEIGHT_STEP = 5
    val TEXT_SIZES = listOf("small" to "小", "standard" to "标准", "large" to "大")

    fun normalizedRowHeight(value: Int): Int =
        ((value.toFloat() / ROW_HEIGHT_STEP).roundToInt() * ROW_HEIGHT_STEP).coerceIn(ROW_HEIGHT_MIN, ROW_HEIGHT_MAX)

    fun normalizedTextSize(value: String?): String = if (value == "small" || value == "large") value else "standard"

    /** Compact layout tightens the text a little more so one more line fits. */
    fun textScale(size: String, compact: Boolean): Float = when (normalizedTextSize(size)) {
        "small" -> 0.88f
        "large" -> 1.16f
        else -> 1f
    } * if (compact) 0.92f else 1f

    /**
     * The weekdays a week shows, left to right (1 is Monday, 7 is Sunday). A
     * hidden Saturday or Sunday stays when [keeps] says it has classes or is a
     * make-up day.
     */
    fun weekColumns(showSaturday: Boolean, showSunday: Boolean, sundayFirst: Boolean, keeps: (Int) -> Boolean): List<Int> {
        val days = mutableListOf(1, 2, 3, 4, 5)
        if (showSaturday || keeps(6)) days += 6
        if (showSunday || keeps(7)) {
            if (sundayFirst) days.add(0, 7) else days += 7
        }
        return days
    }

    /** Weeks until the course next runs; a course that only ran earlier sorts after every upcoming one. */
    private fun distance(weeks: List<Int>, week: Int): Int {
        weeks.filter { it > week }.minOrNull()?.let { return it - week }
        return weeks.filter { it < week }.maxOrNull()?.let { 1000 + week - it } ?: Int.MAX_VALUE
    }

    private fun overlaps(left: CourseBlock, right: CourseBlock) =
        left.startSlot <= right.endSlot && right.startSlot <= left.endSlot

    /**
     * The courses of one day that do not run in [week] and whose periods are
     * free this week. Where several share a period, the one that runs soonest stays.
     */
    fun offWeekBlocks(candidates: List<CourseBlock>, taken: List<CourseBlock>, week: Int): List<CourseBlock> {
        val chosen = mutableListOf<CourseBlock>()
        candidates
            .filter { block -> block.course.weekList.isNotEmpty() && week !in block.course.weekList && taken.none { overlaps(it, block) } }
            .map { it to distance(it.course.weekList, week) }
            .filter { it.second != Int.MAX_VALUE }
            .sortedWith(compareBy({ it.second }, { it.first.startSlot }))
            .forEach { (block, _) -> if (chosen.none { overlaps(it, block) }) chosen += block }
        return chosen
    }

    /** `yyyy-MM-dd` moved by [days]; empty when the date cannot be read. */
    fun shiftDate(date: String, days: Int): String {
        val parts = date.split('-').mapNotNull { it.toIntOrNull() }
        if (parts.size != 3) return ""
        val calendar = Calendar.getInstance()
        calendar.clear()
        calendar.set(parts[0], parts[1] - 1, parts[2])
        calendar.add(Calendar.DAY_OF_YEAR, days)
        return String.format(
            Locale.US, "%04d-%02d-%02d",
            calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH) + 1, calendar.get(Calendar.DAY_OF_MONTH),
        )
    }
}
