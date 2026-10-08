package cn.lizmt.cpuweb.schedule

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
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
import kotlin.math.abs
import kotlinx.coroutines.launch

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

    /**
     * What a month cell writes: at most `limit` lines. When the day has more
     * courses, the last line goes to "+N", so `limit - 1` names show and the
     * second value is how many are left out.
     */
    fun <T> courseLines(courses: List<T>, limit: Int): Pair<List<T>, Int> {
        if (courses.size <= limit) return courses to 0
        val shown = courses.take((limit - 1).coerceAtLeast(1))
        return shown to courses.size - shown.size
    }
}

private val HolidayPink = Color(0xFFE11D48)

/**
 * The month view: a calendar with one cell per day. A cell holds the date, the
 * lunar day or festival, and that day's courses, one line each; a tap opens
 * the day. The teaching week stays in the gutter of each row, so the calendar
 * and the term's week numbers still line up.
 */
@Composable
internal fun ScheduleMonthView(
    store: ScheduleStore,
    anchor: String,
    selectedDate: String,
    onSelect: (String) -> Unit,
    onOpenDay: (String) -> Unit,
    /** Dragging the grid up or down turns the month: 1 is the next one, -1 the one before. */
    onMove: (Int) -> Unit = {},
    /** The partner's timetable while the couple timetable is drawn. */
    couple: CoupleLayer? = null,
) {
    val colors = LocalScheduleColors.current
    val scope = LocalScheduleStyle.current
    val classic = scope.style == ScheduleVisualStyle.Classic
    // The grid follows the finger; past the threshold it turns the month and
    // the new one slides in from the side it was pulled from.
    val move by rememberUpdatedState(onMove)
    val pull = remember { Animatable(0f) }
    val motion = rememberCoroutineScope()
    val turnDistance = with(LocalDensity.current) { 44.dp.toPx() }
    val enterDistance = with(LocalDensity.current) { 36.dp.toPx() }
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
            Column(
                Modifier.fillMaxWidth()
                    .pointerInput(Unit) {
                        var total = 0f
                        detectVerticalDragGestures(
                            onDragStart = { total = 0f },
                            onDragCancel = { motion.launch { pull.animateTo(0f) } },
                            onDragEnd = {
                                val delta = if (total < 0) 1 else -1
                                val turns = abs(total) >= turnDistance
                                motion.launch {
                                    if (turns) {
                                        move(delta)
                                        pull.snapTo(if (delta > 0) enterDistance else -enterDistance)
                                    }
                                    pull.animateTo(0f, tween(220))
                                }
                            },
                        ) { change, amount ->
                            change.consume()
                            total += amount
                            motion.launch { pull.snapTo(total * 0.55f) }
                        }
                    }
                    .graphicsLayer {
                        translationY = pull.value
                        alpha = 1f - (abs(pull.value) / (enterDistance * 2.4f)).coerceIn(0f, 0.6f)
                    },
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
            days.chunked(7).forEach { row ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                    Text(row.firstNotNullOfOrNull { index[it]?.first }?.toString().orEmpty(), fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
                        color = colors.secondary.copy(alpha = 0.7f), textAlign = TextAlign.Center, modifier = Modifier.width(26.dp).padding(top = 7.dp))
                    row.forEach { date ->
                        val inMonth = ScheduleMonth.sameMonth(date, anchor)
                        val selected = date == selectedDate
                        val isToday = date == today
                        val info = ChineseCalendarInfo.info(date)
                        val adjustment = adjustments[date]
                        val weekday = ScheduleMonth.weekday(date)
                        val dayCourses = courses[date].orEmpty()
                        val holiday = info?.isStatutoryHoliday == true
                        // The day's courses by name, in the order they start.
                        val names = dayCourses.sortedWith(compareBy({ it.startSlot }, { it.lane })).map { it.course.name }.distinct()
                        val (shown, more) = ScheduleMonth.courseLines(names, 3)
                        // The partner's day is one line of its own: how many courses they have.
                        val theirs = couple?.blocksOn(date).orEmpty().map { it.course.name }.distinct().size
                        Box(
                            Modifier.weight(1f).height(if (couple != null) 106.dp else 88.dp).padding(horizontal = 1.dp).clip(RoundedCornerShape(10.dp))
                                // A day of the term opens as that day; any other one is only picked.
                                .clickable { if (index[date] != null) onOpenDay(date) else onSelect(date) }
                                .semantics {
                                    this.selected = selected
                                    contentDescription = listOfNotNull(
                                        "${date.takeLast(2).toIntOrNull() ?: date} 日", info?.displayLabel(),
                                        index[date]?.let { "第 ${it.first} 周" }, adjustment?.let { store.adjustmentDetail(it) },
                                        if (names.isEmpty()) "没有课程" else "${names.size} 门课程：${names.joinToString("、")}",
                                        if (theirs > 0) "TA $theirs 门课" else null,
                                    ).joinToString("，")
                                },
                        ) {
                            Column(
                                Modifier.fillMaxWidth().padding(top = 3.dp).alpha(if (inMonth) 1f else 0.42f),
                                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(1.dp),
                            ) {
                                // Today: the date sits in a disc of the theme colour.
                                Box(
                                    Modifier.size(22.dp).then(if (isToday) Modifier.clip(CircleShape).background(scope.themeFill) else Modifier),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        (date.takeLast(2).toIntOrNull() ?: 0).toString(), fontSize = 14.sp, lineHeight = 17.sp, fontFamily = scope.fontFamily,
                                        fontWeight = if (isToday) FontWeight.Bold else FontWeight.Medium,
                                        color = when {
                                            isToday -> scope.onFill
                                            holiday -> HolidayPink
                                            weekday >= 6 -> HolidayPink.copy(alpha = 0.85f)
                                            else -> colors.text
                                        },
                                    )
                                }
                                Text(
                                    info?.displayLabel().orEmpty(), fontSize = 9.sp, lineHeight = 11.sp, letterSpacing = 0.sp, maxLines = 1,
                                    overflow = TextOverflow.Clip, softWrap = false,
                                    fontWeight = if (info?.badge() != null) FontWeight.Bold else FontWeight.Normal,
                                    color = if (holiday) HolidayPink else if (info?.badge() != null) accent else colors.secondary,
                                )
                                val own = couple?.let { CoupleRules.personTone(it.myColor, colors.dark) }
                                shown.forEach { name -> MonthCourseLine(name, classic, own) }
                                if (more > 0) {
                                    Text("+$more", fontSize = 9.sp, lineHeight = 11.sp, fontWeight = FontWeight.SemiBold, color = colors.secondary,
                                        modifier = Modifier.fillMaxWidth().padding(start = 3.dp))
                                }
                                if (couple != null && theirs > 0) {
                                    val tone = CoupleRules.personTone(couple.partnerColor, colors.dark)
                                    Text("TA $theirs 门", fontSize = 10.sp, lineHeight = 13.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold,
                                        color = Color(tone.text), maxLines = 1, softWrap = false, textAlign = TextAlign.Center,
                                        modifier = Modifier.padding(top = 1.dp).fillMaxWidth().height(14.dp).clip(CircleShape).background(Color(tone.fill)))
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
        }
        Spacer(Modifier.height(4.dp))
    }
}

/** One course in a month cell: its name on a line of its own colour. */
@Composable
private fun MonthCourseLine(name: String, classic: Boolean, person: CoupleTint? = null) {
    val scope = LocalScheduleStyle.current
    val fill: Color
    val ink: Color
    if (person != null) {
        // The couple timetable: all of the user's courses in the user's colour.
        fill = Color(person.fill); ink = Color(person.text)
    } else if (classic) {
        val tone = scheduleCardTone(name, scope.palette, scope.dark)
        fill = Color(tone.fill); ink = Color(tone.text)
    } else {
        val tint = scope.course(name)
        fill = Color(tint.fill(scope.dark, scope.hasBackground)); ink = Color(tint.accent(scope.dark))
    }
    Text(
        name, fontSize = 10.sp, lineHeight = 13.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, fontFamily = scope.textFamily,
        color = ink, maxLines = 1, softWrap = false, overflow = TextOverflow.Clip,
        modifier = Modifier.fillMaxWidth().height(14.dp).clip(RoundedCornerShape(if (classic) 3.dp else scope.style.cornerRadius.coerceIn(0f, 3f).dp))
            .background(fill).padding(horizontal = 2.dp),
    )
}
