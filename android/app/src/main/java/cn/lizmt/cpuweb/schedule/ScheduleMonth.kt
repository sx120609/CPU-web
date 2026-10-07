package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Calendar
import java.util.GregorianCalendar
import java.util.Locale
import java.util.TimeZone

/** Month arithmetic for the month view, on `yyyy-MM-dd` strings. */
object ScheduleMonth {
    private fun calendar(date: String): Calendar? {
        val parts = date.split('-').mapNotNull { it.toIntOrNull() }
        if (parts.size != 3) return null
        return GregorianCalendar(TimeZone.getTimeZone("UTC"), Locale.US).apply {
            clear()
            set(parts[0], parts[1] - 1, parts[2])
        }
    }

    private fun key(calendar: Calendar): String = String.format(
        Locale.US, "%04d-%02d-%02d", calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH) + 1, calendar.get(Calendar.DAY_OF_MONTH),
    )

    /** The month of `anchor` in whole weeks, Monday first: the grid starts on the Monday of the week holding the 1st. */
    fun grid(anchor: String): List<String> {
        val first = calendar(anchor)?.apply { set(Calendar.DAY_OF_MONTH, 1) } ?: return emptyList()
        val leading = (first.get(Calendar.DAY_OF_WEEK) + 5) % 7
        val total = (leading + first.getActualMaximum(Calendar.DAY_OF_MONTH) + 6) / 7 * 7
        return (0 until total).map { offset ->
            key((first.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, offset - leading) })
        }
    }

    /** The first day of the month `months` away from the one holding `anchor`. */
    fun shift(anchor: String, months: Int): String {
        val first = calendar(anchor)?.apply { set(Calendar.DAY_OF_MONTH, 1) } ?: return anchor
        first.add(Calendar.MONTH, months)
        return key(first)
    }

    fun sameMonth(first: String, second: String): Boolean = first.take(7) == second.take(7) && first.length >= 7

    /** "2026 年 10 月". */
    fun title(anchor: String): String {
        val parts = anchor.split('-').mapNotNull { it.toIntOrNull() }
        return if (parts.size >= 2) "${parts[0]} 年 ${parts[1]} 月" else anchor
    }

    /** 1 is Monday, 7 is Sunday. */
    fun weekday(date: String): Int = calendar(date)?.let { (it.get(Calendar.DAY_OF_WEEK) + 5) % 7 + 1 } ?: 1
}

private val HolidayPink = Color(0xFFE11D48)

/**
 * The month view: a calendar with one cell per day (date, lunar day or
 * festival, a dot per course) and the selected day's courses underneath. The
 * teaching week stays in the gutter of each row, so the calendar and the term's
 * week numbers still line up.
 */
@Composable
internal fun ScheduleMonthView(
    store: ScheduleStore,
    anchor: String,
    selectedDate: String,
    onSelect: (String) -> Unit,
    onOpenDay: (String) -> Unit,
    onCourse: (PlacedBlock, String) -> Unit,
) {
    val colors = LocalScheduleColors.current
    val scope = LocalScheduleStyle.current
    val classic = scope.style == ScheduleVisualStyle.Classic
    val glass = LocalScheduleGlass.current
    val today = ScheduleStore.todayKey()
    val calendar = store.calendar
    // Date -> (teaching week, weekday). Dates outside the term are not in it.
    val index = remember(calendar) {
        val map = HashMap<String, Pair<Int, Int>>()
        calendar?.weeks?.forEach { week -> week.days.forEachIndexed { offset, date -> if (date.isNotEmpty()) map[date] = week.week to offset + 1 } }
        map
    }
    val adjustments = remember(calendar) { calendar?.adjustments.orEmpty().associateBy { it.date } }
    val revision = store.dataRevision
    val priorities = store.displayPriorities
    val days = remember(anchor) { ScheduleMonth.grid(anchor) }
    val courses = remember(anchor, revision, store.result, priorities) {
        days.associateWith { date ->
            index[date]?.let { (week, day) -> store.placedBlocksForDay(day, week.toString()) }.orEmpty()
        }
    }
    val accent = scope.themeText
    val container = if (classic) {
        Modifier.clip(RoundedCornerShape(16.dp)).background(glass ?: colors.surface)
    } else Modifier.scheduleSurface(16.dp, panel = true)

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(Modifier.fillMaxWidth().then(container).padding(horizontal = 8.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("周", fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = colors.secondary.copy(alpha = 0.7f), textAlign = TextAlign.Center,
                    modifier = Modifier.width(26.dp))
                listOf("一", "二", "三", "四", "五", "六", "日").forEachIndexed { position, label ->
                    Text(label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, fontFamily = scope.fontFamily, textAlign = TextAlign.Center,
                        color = if (position >= 5) HolidayPink.copy(alpha = 0.8f) else colors.secondary, modifier = Modifier.weight(1f))
                }
            }
            days.chunked(7).forEach { row ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(row.firstNotNullOfOrNull { index[it]?.first }?.toString().orEmpty(), fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
                        color = colors.secondary.copy(alpha = 0.7f), textAlign = TextAlign.Center, modifier = Modifier.width(26.dp))
                    row.forEach { date ->
                        val inMonth = ScheduleMonth.sameMonth(date, anchor)
                        val selected = date == selectedDate
                        val isToday = date == today
                        val info = ChineseCalendarInfo.info(date)
                        val adjustment = adjustments[date]
                        val weekday = ScheduleMonth.weekday(date)
                        val dayCourses = courses[date].orEmpty()
                        val holiday = info?.isStatutoryHoliday == true
                        Box(
                            Modifier.weight(1f).height(50.dp).padding(horizontal = 1.dp).clip(RoundedCornerShape(10.dp))
                                .then(when {
                                    selected -> Modifier.background(accent.copy(alpha = 0.16f))
                                    isToday -> Modifier.border(1.dp, accent.copy(alpha = 0.45f), RoundedCornerShape(10.dp))
                                    else -> Modifier
                                })
                                .clickable { onSelect(date) }
                                .semantics {
                                    this.selected = selected
                                    contentDescription = listOfNotNull(
                                        "${date.takeLast(2).toIntOrNull() ?: date} 日", info?.displayLabel(),
                                        index[date]?.let { "第 ${it.first} 周" }, adjustment?.let { store.adjustmentDetail(it) },
                                        if (dayCourses.isEmpty()) "没有课程" else "${dayCourses.size} 门课程",
                                    ).joinToString("，")
                                },
                        ) {
                            Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    (date.takeLast(2).toIntOrNull() ?: 0).toString(), fontSize = 16.sp, lineHeight = 19.sp, fontFamily = scope.fontFamily,
                                    fontWeight = if (isToday || selected) FontWeight.Bold else FontWeight.Medium,
                                    color = when {
                                        !inMonth -> colors.secondary.copy(alpha = 0.45f)
                                        isToday || selected -> accent
                                        holiday -> HolidayPink
                                        weekday >= 6 -> HolidayPink.copy(alpha = 0.85f)
                                        else -> colors.text
                                    },
                                )
                                Text(
                                    info?.displayLabel().orEmpty(), fontSize = 9.sp, lineHeight = 11.sp, letterSpacing = 0.sp, maxLines = 1,
                                    overflow = TextOverflow.Clip, softWrap = false,
                                    fontWeight = if (info?.badge() != null) FontWeight.Bold else FontWeight.Normal,
                                    color = if (holiday) HolidayPink else if (info?.badge() != null) accent else colors.secondary,
                                    modifier = Modifier.alpha(if (inMonth) 1f else 0.4f),
                                )
                                Row(Modifier.height(6.dp).alpha(if (inMonth) 1f else 0.45f), verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                    dayCourses.distinctBy { it.course.name }.take(3).forEach { block ->
                                        Box(Modifier.size(4.dp).clip(CircleShape).background(Color(scope.course(block.course.name).accent(scope.dark))))
                                    }
                                }
                            }
                            if (adjustment != null) {
                                Box(Modifier.align(Alignment.TopEnd).padding(1.dp).alpha(if (inMonth) 1f else 0.45f)) { ScheduleAdjustmentMark(adjustment.kind) }
                            }
                        }
                    }
                }
            }
        }

        // The selected day.
        val slot = index[selectedDate]
        val selectedCourses = courses[selectedDate] ?: slot?.let { (week, day) -> store.placedBlocksForDay(day, week.toString()) }.orEmpty()
        val adjustment = adjustments[selectedDate]
        Column(Modifier.fillMaxWidth().then(container).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    val parts = selectedDate.split('-').mapNotNull { it.toIntOrNull() }
                    Text(
                        if (parts.size == 3) "${parts[1]} 月 ${parts[2]} 日 · ${WEEKDAY_LABELS[ScheduleMonth.weekday(selectedDate) - 1]}" else selectedDate,
                        fontSize = 17.sp, fontWeight = FontWeight.SemiBold, fontFamily = scope.textFamily, color = colors.text,
                    )
                    val info = ChineseCalendarInfo.info(selectedDate)
                    Text(
                        listOfNotNull(slot?.let { "第 ${it.first} 周" }, info?.lunar?.fullLabel(), info?.badge()).joinToString(" · "),
                        fontSize = 12.sp, color = colors.secondary,
                    )
                }
                if (slot != null) {
                    TextButton(onClick = { onOpenDay(selectedDate) }) { Text("日视图", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = accent) }
                }
            }
            if (adjustment != null) {
                Text(store.adjustmentDetail(adjustment), fontSize = 12.sp, color = if (adjustment.kind == "off") HolidayPink else Color(0xFFC2410C))
            }
            when {
                slot == null -> Text("这一天不在当前学期的教学周内。", fontSize = 13.sp, color = colors.secondary)
                selectedCourses.isEmpty() -> Text(
                    if (adjustment?.kind == "off") "这一天放假，没有课程。" else "这一天没有课程。", fontSize = 13.sp, color = colors.secondary,
                )
                else -> selectedCourses.sortedWith(compareBy({ it.startSlot }, { it.lane })).forEach { block ->
                    MonthAgendaRow(store, block, classic) { onCourse(block, slot.first.toString()) }
                }
            }
        }
        Spacer(Modifier.height(4.dp))
    }
}

@Composable
private fun MonthAgendaRow(store: ScheduleStore, block: PlacedBlock, classic: Boolean, onClick: () -> Unit) {
    val colors = LocalScheduleColors.current
    val scope = LocalScheduleStyle.current
    val course = block.course
    val shape = RoundedCornerShape(if (classic) 12.dp else scope.style.cornerRadius.coerceAtLeast(2f).dp)
    val accent = Color(scope.course(course.name).accent(scope.dark))
    val tone = scheduleCardTone(course.name, scope.palette, scope.dark)
    val text = if (classic) Color(tone.text) else if (scope.style == ScheduleVisualStyle.Paper || scope.style == ScheduleVisualStyle.Board) scope.ink else accent
    val background = if (classic) {
        Modifier.background(colors.surface).background(Brush.verticalGradient(listOf(Color(tone.highlight), Color(tone.fill))))
            .border(1.dp, Color(tone.border), shape)
    } else Modifier.background(Color(scope.course(course.name).fill(scope.dark, scope.hasBackground)))
    Row(
        Modifier.fillMaxWidth().clip(shape).then(background).clickable(onClick = onClick)
            .semantics { contentDescription = courseAccessibility(block.block) }.padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(width = 4.dp, height = 34.dp).clip(RoundedCornerShape(3.dp)).background(if (classic) Color(tone.border) else accent))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(course.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, fontFamily = scope.textFamily, color = text, maxLines = 1,
                overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(
                    course.location?.trim()?.takeIf { it.isNotEmpty() }, course.teacher?.trim()?.takeIf { it.isNotEmpty() },
                    ScheduleStyleTime.slotText(block.startSlot, block.endSlot),
                ).joinToString(" · "),
                fontSize = 12.sp, fontFamily = scope.textFamily, color = text.copy(alpha = 0.85f), maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        Text("${store.periodTime(block.startSlot).startTime}\n${store.periodTime(block.endSlot).endTime}", fontSize = 12.sp, lineHeight = 15.sp,
            fontWeight = FontWeight.SemiBold, color = text.copy(alpha = 0.85f), textAlign = TextAlign.End)
    }
}
