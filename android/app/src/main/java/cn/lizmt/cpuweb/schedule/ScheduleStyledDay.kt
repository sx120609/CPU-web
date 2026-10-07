package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// Day layouts of the minimal, grid, table, paper and board styles, ported from
// the iOS `ScheduleStyledDayViews`. Each style reads the same placed blocks and
// bell schedule; tapping a course opens its quick look.

/** A course's place relative to "now" on the day being shown. */
internal class DayStatus(
    private val period: (Int) -> SchedulePeriod,
    /** Minutes since midnight when the day shown is today and "now" is marked. */
    val now: Int?,
    /** Courses ending by this minute are finished; also set for past days. */
    val completedBefore: Int?,
) {
    enum class Phase { Current, Upcoming, Completed }

    fun start(block: PlacedBlock): String = period(block.startSlot).startTime
    fun end(block: PlacedBlock): String = period(block.endSlot).endTime
    fun endOf(slot: Int): String = period(slot).endTime

    fun phase(block: PlacedBlock): Phase {
        val start = ScheduleStyleTime.clockMinutes(start(block)) ?: return Phase.Upcoming
        val end = ScheduleStyleTime.clockMinutes(end(block)) ?: return Phase.Upcoming
        val limit = completedBefore ?: now
        if (limit != null && end <= limit) return Phase.Completed
        if (now != null && start <= now && now < end) return Phase.Current
        return Phase.Upcoming
    }

    fun label(block: PlacedBlock): String? = when (phase(block)) {
        Phase.Completed -> "已结束"
        Phase.Current -> "正在上 · 还剩 ${max(1, (ScheduleStyleTime.clockMinutes(end(block)) ?: 0) - (now ?: 0))} 分"
        Phase.Upcoming -> {
            val start = ScheduleStyleTime.clockMinutes(start(block))
            if (now != null && start != null && start > now && start - now < 60) "${start - now} 分钟后" else null
        }
    }
}

/** "高等数学，教室 A101，第 1–2 节，08:00 至 09:40，已结束" */
private fun spokenLabel(block: PlacedBlock, status: DayStatus, state: String?): String = listOfNotNull(
    block.course.name,
    ScheduleStyleTime.location(block.course.location)?.let { "教室 $it" },
    ScheduleStyleTime.slotText(block.startSlot, block.endSlot),
    "${status.start(block)} 至 ${status.end(block)}",
    state,
).joinToString("，")

private fun Modifier.courseAction(block: PlacedBlock, status: DayStatus, state: String?, onCourse: (PlacedBlock) -> Unit): Modifier =
    clickable { onCourse(block) }.clearAndSetSemantics { contentDescription = spokenLabel(block, status, state) }

/** Standard card height of the styled day views. */
internal val StyledDayCardHeight = 108.dp

/** Minimal, paper and board show the rest card on a free day; grid and table keep their empty rows so a course can still be added there. */
internal fun showsRestCard(style: ScheduleVisualStyle, blocks: List<PlacedBlock>): Boolean =
    blocks.isEmpty() && (style == ScheduleVisualStyle.Minimal || style == ScheduleVisualStyle.Paper || style == ScheduleVisualStyle.Board)

/** The day view of every style except classic. */
@Composable
internal fun StyledDayView(
    day: Int,
    blocks: List<PlacedBlock>,
    periods: List<SchedulePeriod>,
    status: DayStatus,
    /** Shown under the rest card, e.g. the reason for a day off. */
    emptyNote: String?,
    /** The visible height to centre the rest card in. */
    emptyHeight: Dp,
    canAdd: Boolean,
    onCourse: (PlacedBlock) -> Unit,
    onAddSlot: (Int) -> Unit,
) {
    val scope = LocalScheduleStyle.current
    val style = scope.style
    val ordered = blocks.sortedWith(compareBy({ it.startSlot }, { it.endSlot }, { it.lane }))
    if (showsRestCard(style, blocks)) {
        Box(Modifier.fillMaxWidth().height(max(emptyHeight.value, 360f).dp), contentAlignment = Alignment.Center) {
            ScheduleRestCard(emptyNote)
        }
        return
    }
    when (style) {
        ScheduleVisualStyle.Minimal -> DayTimelineView(ordered, status, onCourse)
        ScheduleVisualStyle.Grid -> {
            val rowHeight = max(48f, StyledDayCardHeight.value * 0.52f).dp
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val columnWidth = (maxWidth - 56.dp).coerceAtLeast(24.dp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(verticalArrangement = Arrangement.spacedBy(StyledSlotGap)) {
                        periods.forEach { StyledSlotLabel(it, startsSession = false, rowHeight = rowHeight, modifier = Modifier.width(48.dp).height(rowHeight)) }
                    }
                    StyledDayColumn(
                        day = day, blocks = blocks, periods = periods, columnWidth = columnWidth, rowHeight = rowHeight,
                        today = status.now != null, adjustmentKind = null, compact = false, now = status.now, canAdd = canAdd,
                        onCourse = onCourse, onAddSlot = onAddSlot, statusLabel = { status.label(it) },
                        isCurrent = { status.phase(it) == DayStatus.Phase.Current }, dayRow = true,
                    )
                }
            }
        }
        ScheduleVisualStyle.Table -> DayTableView(blocks, periods, status, canAdd, onCourse, onAddSlot)
        ScheduleVisualStyle.Paper -> DayPaperView(ordered, status, onCourse)
        ScheduleVisualStyle.Board -> DayBoardView(ordered, status, onCourse)
        ScheduleVisualStyle.Classic -> Unit
    }
}

// region Minimal: timeline

private sealed interface TimelinePhase {
    data object None : TimelinePhase
    data object Past : TimelinePhase
    data class Current(val remaining: Int) : TimelinePhase
    data class Next(val minutesUntil: Int) : TimelinePhase
}

private val TimelineGroupGap = 20.dp
private val TimelineCardGap = 10.dp
/** The node's position in each group, level with the first line of the time. */
private val TimelineNodeY = 28.dp

/**
 * Courses in order of their start time, with no rows reserved for empty
 * periods. Courses starting together share one node on the rail.
 */
@Composable
private fun DayTimelineView(blocks: List<PlacedBlock>, status: DayStatus, onCourse: (PlacedBlock) -> Unit) {
    val scope = LocalScheduleStyle.current
    val groups = blocks.groupBy { it.startSlot }.toSortedMap().values.map { courses ->
        courses.sortedWith(compareBy({ it.lane }, { it.endSlot }))
    }
    fun range(courses: List<PlacedBlock>): Pair<Int, Int>? {
        val start = ScheduleStyleTime.clockMinutes(status.start(courses.first())) ?: return null
        val end = ScheduleStyleTime.clockMinutes(status.endOf(courses.maxOf { it.endSlot })) ?: return null
        return start to end
    }
    val ranges = groups.map(::range)
    val now = status.now
    val inClass = now != null && ranges.any { it != null && it.first <= now && now <= it.second }
    var foundNext = false
    val phases = ranges.map { range ->
        when {
            range == null -> TimelinePhase.None
            // A past day: everything is finished, without a "now" to count from.
            now == null -> if (status.completedBefore != null && range.second <= status.completedBefore) TimelinePhase.Past else TimelinePhase.None
            now > range.second -> TimelinePhase.Past
            now >= range.first -> TimelinePhase.Current(range.second - now)
            !inClass && !foundNext -> {
                foundNext = true
                TimelinePhase.Next(range.first - now)
            }
            else -> TimelinePhase.None
        }
    }
    val cardHeight = StyledDayCardHeight.value
    val groupGap = TimelineGroupGap.value
    val nodeY = TimelineNodeY.value
    fun heightOf(courses: List<PlacedBlock>): Float = courses.size * cardHeight + (courses.size - 1) * TimelineCardGap.value
    val tops = groups.indices.map { index -> groups.take(index).sumOf { (heightOf(it) + groupGap).toDouble() }.toFloat() }
    // Where "now" falls down the rail; the rail above it takes the theme colour.
    val progress: Float? = if (now == null) null else run {
        val knots = mutableListOf<Pair<Int, Float>>()
        groups.forEachIndexed { index, courses ->
            ranges[index]?.let { range ->
                knots += max(range.first, knots.lastOrNull()?.first ?: range.first) to tops[index] + nodeY
                knots += max(range.second, knots.lastOrNull()?.first ?: range.second) to tops[index] + max(nodeY, heightOf(courses))
            }
        }
        val first = knots.firstOrNull()
        var value = if (first == null || now < first.first) 0f else knots.last().second
        if (first != null && now >= first.first) {
            for (index in 0 until knots.size - 1) {
                val a = knots[index]
                val b = knots[index + 1]
                if (now < b.first) {
                    value = a.second + (b.second - a.second) * (now - a.first) / max(1, b.first - a.first)
                    break
                }
            }
        }
        // The coloured rail always reaches the highlighted node, even when the
        // interpolated time has not caught up with it during a break.
        val highlighted = groups.indices.filter { phases[it] is TimelinePhase.Current || phases[it] is TimelinePhase.Next }
            .maxOfOrNull { tops[it] + nodeY } ?: 0f
        max(value, highlighted)
    }
    val railColor = scope.secondary.copy(alpha = 0.15f)
    val filledColor = scope.themeText.copy(alpha = 0.6f)
    Column(verticalArrangement = Arrangement.spacedBy(TimelineGroupGap)) {
        groups.forEachIndexed { index, courses ->
            val phase = phases[index]
            val startSlot = courses[0].startSlot
            val endSlot = courses.maxOf { it.endSlot }
            val groupHeight = heightOf(courses)
            val lineTop = if (index == 0) nodeY else 0f
            val lineBottom = if (index == groups.lastIndex) {
                if (inClass) max(nodeY, (progress ?: 0f) - tops[index]) else nodeY
            } else groupHeight + groupGap
            val filled = progress?.let { min(max(it - tops[index] - lineTop, 0f), max(0f, lineBottom - lineTop)) } ?: 0f
            val nodeDiameter = when (phase) {
                is TimelinePhase.Current, TimelinePhase.Past -> 7f
                is TimelinePhase.Next -> 8f
                TimelinePhase.None -> 5f
            }
            Row(
                Modifier.fillMaxWidth().drawBehind {
                    // The rail runs outside the times and breaks around each node, so a
                    // solid dot covers it and a ring stays open.
                    val x = 2.5.dp.toPx()
                    val radius = (nodeDiameter / 2).dp.toPx()
                    val node = nodeY.dp.toPx()
                    fun segment(color: Color, from: Float, to: Float) {
                        if (to > from) drawLine(color, Offset(x, from), Offset(x, to), 1.dp.toPx())
                    }
                    fun rail(color: Color, limit: Float) {
                        segment(color, lineTop.dp.toPx(), min(min(lineBottom.dp.toPx(), node - radius), limit))
                        segment(color, max(lineTop.dp.toPx(), node + radius), min(lineBottom.dp.toPx(), limit))
                    }
                    rail(railColor, Float.MAX_VALUE)
                    rail(filledColor, (lineTop + filled).dp.toPx())
                    when (phase) {
                        // In class: a solid dot with a halo. Next up: a ring. Finished: a solid dot.
                        is TimelinePhase.Current -> {
                            drawCircle(scope.themeTint(0.2f), 6.5.dp.toPx(), Offset(x, node))
                            drawCircle(scope.themeFill, radius, Offset(x, node))
                        }
                        is TimelinePhase.Next -> drawCircle(scope.themeText, radius - 0.75.dp.toPx(), Offset(x, node), style = Stroke(1.5.dp.toPx()))
                        TimelinePhase.Past -> drawCircle(filledColor, radius, Offset(x, node))
                        TimelinePhase.None -> drawCircle(scope.secondary.copy(alpha = 0.45f), radius, Offset(x, node))
                    }
                    if (inClass && progress != null) {
                        val local = progress - tops[index]
                        if (local > lineTop && local <= lineBottom && abs(local - nodeY) > nodeDiameter / 2 + 1) {
                            drawLine(scope.themeText, Offset(x - 4.5.dp.toPx(), local.dp.toPx()), Offset(x + 4.5.dp.toPx(), local.dp.toPx()),
                                2.dp.toPx(), cap = StrokeCap.Round)
                        }
                    }
                }.padding(start = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                // The start time leads; the end time and the periods step back beneath
                // it. In class or next up, the third line becomes a countdown.
                Column(Modifier.width(56.dp).padding(top = 17.dp), horizontalAlignment = Alignment.End) {
                    Text(status.start(courses[0]), fontSize = 17.sp, lineHeight = 22.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
                        color = when (phase) {
                            is TimelinePhase.Current, is TimelinePhase.Next -> scope.themeText
                            TimelinePhase.Past -> scope.meta
                            TimelinePhase.None -> scope.primary
                        })
                    Text(status.endOf(endSlot), fontSize = 12.sp, lineHeight = 15.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Medium, color = scope.meta, maxLines = 1)
                    Spacer(Modifier.height(4.dp))
                    val countdown = when (phase) {
                        is TimelinePhase.Current -> "还剩 ${max(1, phase.remaining)} 分"
                        is TimelinePhase.Next -> if (phase.minutesUntil < 60) "${max(1, phase.minutesUntil)} 分钟后"
                        else "约 ${(phase.minutesUntil / 60.0).roundToInt()} 小时后"
                        else -> null
                    }
                    if (countdown != null) {
                        Text(countdown, fontSize = 10.sp, lineHeight = 13.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, color = scope.themeText, maxLines = 1,
                            softWrap = false, modifier = Modifier.clip(CircleShape).background(scope.themeTint(0.12f)).padding(horizontal = 5.dp, vertical = 2.dp))
                    } else {
                        Text(if (startSlot == endSlot) "第 $startSlot 节" else "$startSlot–$endSlot 节", fontSize = 11.sp, lineHeight = 14.sp,
                            letterSpacing = 0.sp, fontWeight = FontWeight.Medium, color = scope.meta, maxLines = 1)
                    }
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(TimelineCardGap)) {
                    courses.forEach { block ->
                        TimelineCourseCard(
                            block.course,
                            completed = status.phase(block) == DayStatus.Phase.Completed,
                            // The left column already names the periods; a card repeats
                            // them only when several courses start together.
                            slotLabel = if (courses.size > 1) {
                                "${ScheduleStyleTime.slotText(block.startSlot, block.endSlot)} · ${status.start(block)}–${status.end(block)}"
                            } else null,
                            modifier = Modifier.fillMaxWidth().height(StyledDayCardHeight).courseAction(block, status, status.label(block), onCourse),
                        )
                    }
                }
            }
        }
    }
}

/** The minimal day card: a pale tint held by a light edge and a soft shadow. */
@Composable
private fun TimelineCourseCard(course: ScheduleCourse, completed: Boolean, slotLabel: String?, modifier: Modifier) {
    val scope = LocalScheduleStyle.current
    val tint = scope.course(course.name)
    val accent = Color(tint.accent(scope.dark))
    val shape = RoundedCornerShape(20.dp)
    val detail = listOfNotNull(ScheduleStyleTime.location(course.location)?.let { "@$it" }, course.teacher?.trim()?.takeIf { it.isNotEmpty() })
    Box(modifier) {
        Column(
            // A shadow shows through the translucent dark fill, so only light cards carry one.
            Modifier.fillMaxSize().shadow(if (completed || scope.dark) 0.dp else 3.dp, shape, clip = false)
                .clip(shape).background(Color(tint.fill(scope.dark, scope.hasBackground)))
                .border(1.dp, if (completed) scope.secondary.copy(alpha = 0.12f) else Color(tint.border(scope.dark)), shape)
                .padding(horizontal = 18.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp, Alignment.CenterVertically),
        ) {
            Text(course.name, fontSize = 17.sp, lineHeight = 22.sp, fontWeight = if (completed) FontWeight.Medium else FontWeight.SemiBold,
                color = accent, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(end = if (completed) 26.dp else 0.dp))
            if (detail.isNotEmpty()) {
                Text(detail.joinToString(" · "), fontSize = 13.sp, lineHeight = 17.sp, color = accent, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (slotLabel != null) {
                Text(slotLabel, fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.Medium, color = if (completed) scope.meta else accent,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (completed) {
            Box(
                Modifier.align(Alignment.TopEnd).padding(end = 12.dp).offset(y = (-10).dp).rotate(10f).size(25.dp)
                    .clip(RoundedCornerShape(8.dp)).background(scope.panelSurface).background(accent.copy(alpha = if (scope.dark) 0.20f else 0.12f))
                    .border(1.dp, accent.copy(alpha = 0.22f), RoundedCornerShape(8.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Rounded.Check, contentDescription = null, tint = accent, modifier = Modifier.size(15.dp))
            }
        }
    }
}

// endregion

// region Table

@Composable
private fun DayTableView(
    blocks: List<PlacedBlock>,
    periods: List<SchedulePeriod>,
    status: DayStatus,
    canAdd: Boolean,
    onCourse: (PlacedBlock) -> Unit,
    onAddSlot: (Int) -> Unit,
) {
    val scope = LocalScheduleStyle.current
    val rule = scope.cellBorder
    val rowHeight = max(58f, StyledDayCardHeight.value * 0.60f).dp
    // The frame is stroked on top: course rows fill their cells edge to edge.
    Column(Modifier.fillMaxWidth().background(scope.panelSurface).border(0.5.dp, rule)) {
        Row(Modifier.fillMaxWidth().height(32.dp).background(scope.primary.copy(alpha = 0.06f)), verticalAlignment = Alignment.CenterVertically) {
            listOf("节" to 28.dp, "时间" to 58.dp).forEach { (title, width) ->
                Text(title, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = scope.primary, textAlign = TextAlign.Center, modifier = Modifier.width(width))
            }
            Text("课程", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = scope.primary, modifier = Modifier.weight(1f).padding(start = 8.dp))
            Text("教室", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = scope.primary, modifier = Modifier.width(80.dp).padding(start = 6.dp))
        }
        periods.forEachIndexed { index, period ->
            val covering = blocks.filter { it.startSlot <= period.number && period.number <= it.endSlot }
            Row(
                Modifier.fillMaxWidth().height(rowHeight * max(1, covering.size)).drawBehind {
                    // The last row sits on the table frame, which already closes it.
                    if (index != periods.lastIndex) drawRect(rule, topLeft = Offset(0f, size.height - 0.5.dp.toPx()), size = Size(size.width, 0.5.dp.toPx()))
                },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(period.number.toString(), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = scope.primary, textAlign = TextAlign.Center,
                    modifier = Modifier.width(28.dp))
                Box(Modifier.fillMaxHeight().width(0.5.dp).background(rule))
                Column(Modifier.width(57.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(period.startTime, fontSize = 10.sp, lineHeight = 12.sp, letterSpacing = 0.sp, fontFamily = FontFamily.Monospace, color = scope.primary, maxLines = 1)
                    Text(period.endTime, fontSize = 10.sp, lineHeight = 12.sp, letterSpacing = 0.sp, fontFamily = FontFamily.Monospace, color = scope.primary, maxLines = 1)
                }
                Box(Modifier.fillMaxHeight().width(0.5.dp).background(rule))
                if (covering.isEmpty()) {
                    Row(
                        Modifier.weight(1f).fillMaxHeight()
                            .then(if (canAdd) Modifier.clickable { onAddSlot(period.number) }.semantics { contentDescription = "第 ${period.number} 节，空节次，添加课程" } else Modifier),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("—", color = scope.meta, modifier = Modifier.weight(1f).padding(start = 8.dp))
                        Box(Modifier.fillMaxHeight().width(0.5.dp).background(rule))
                        Text("—", color = scope.meta, modifier = Modifier.width(79.5.dp).padding(start = 6.dp))
                    }
                } else {
                    Column(Modifier.weight(1f)) {
                        covering.forEach { block ->
                            val tint = scope.course(block.course.name)
                            val ink = Color(tint.accent(scope.dark))
                            val continuation = period.number > block.startSlot
                            Row(
                                Modifier.fillMaxWidth().height(rowHeight).background(Color(tint.fill(scope.dark)))
                                    .courseAction(block, status, status.label(block), onCourse),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(Modifier.fillMaxHeight().width(3.dp).background(ink))
                                Column(Modifier.weight(1f).padding(horizontal = 5.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(block.course.name, fontSize = 14.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold, color = ink,
                                        maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    // The status belongs to the course, so it is written once, on its first period.
                                    val note = if (continuation) "续课" else status.label(block)
                                    if (note != null) Text(note, fontSize = 11.sp, lineHeight = 13.sp, color = ink, maxLines = 1)
                                }
                                Box(Modifier.fillMaxHeight().width(0.5.dp).background(rule))
                                Text(ScheduleStyleTime.location(block.course.location) ?: "—", fontSize = 12.sp, lineHeight = 15.sp, color = ink,
                                    maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(79.5.dp).padding(horizontal = 6.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

// endregion

// region Paper

@Composable
private fun DayPaperView(blocks: List<PlacedBlock>, status: DayStatus, onCourse: (PlacedBlock) -> Unit) {
    val scope = LocalScheduleStyle.current
    val ink = scope.ink
    val sections = listOf("上午", "下午", "晚上", "课程").map { session ->
        session to blocks.filter { ScheduleStyleTime.session(status.start(it)) == session }
    }.filter { it.second.isNotEmpty() }
    Column(Modifier.fillMaxWidth().scheduleSurface(2.dp, panel = true).padding(12.dp)) {
        sections.forEachIndexed { sectionIndex, (title, courses) ->
            Row(Modifier.fillMaxWidth().height(40.dp).padding(horizontal = 12.dp).semantics { heading() },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(title, fontSize = 13.sp, fontWeight = FontWeight.Bold, fontFamily = scope.fontFamily, color = ink)
                Box(Modifier.weight(1f).height(0.5.dp).background(ink.copy(alpha = 0.2f)))
            }
            courses.forEachIndexed { index, block ->
                // The last row closes the list; one more rule there would sit on the panel's edge.
                val last = sectionIndex == sections.lastIndex && index == courses.lastIndex
                val label = status.label(block)
                Row(
                    Modifier.fillMaxWidth().height(StyledDayCardHeight).courseAction(block, status, label, onCourse).drawBehind {
                        if (!last) drawRect(ink.copy(alpha = 0.15f), topLeft = Offset(0f, size.height - 0.5.dp.toPx()), size = Size(size.width, 0.5.dp.toPx()))
                    }.padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Column(Modifier.width(64.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(status.start(block), fontSize = 20.sp, lineHeight = 24.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Bold,
                            fontFamily = scope.fontFamily, color = ink, maxLines = 1, softWrap = false)
                        Text(status.end(block), fontSize = 12.sp, lineHeight = 15.sp, letterSpacing = 0.sp, fontFamily = scope.fontFamily, color = ink, maxLines = 1)
                    }
                    Box(Modifier.fillMaxHeight().padding(vertical = 16.dp).width(2.dp).background(Color(scope.course(block.course.name).accent(scope.dark))))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(block.course.name, fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold, fontFamily = scope.fontFamily,
                            color = ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        ScheduleStyleTime.location(block.course.location)?.let {
                            Text("@$it", fontSize = 14.sp, lineHeight = 18.sp, fontFamily = scope.fontFamily, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Text(ScheduleStyleTime.slotText(block.startSlot, block.endSlot), fontSize = 11.sp, lineHeight = 14.sp, fontFamily = scope.fontFamily, color = ink, maxLines = 1)
                        if (label != null) {
                            Text(label, fontSize = 12.sp, lineHeight = 15.sp, fontWeight = FontWeight.SemiBold, fontFamily = scope.fontFamily,
                                color = scope.accent, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
    }
}

// endregion

// region Board

/** Counts and countdowns of the board: the system face with digits of one width, so a ticking number does not shift the line. */
private val TabularDigits = TextStyle(fontFeatureSettings = "tnum")

/**
 * The board's day view: what is on now, what comes next and how long is left.
 * Any other day, and a day with the "now" indicator off, has no "now" and
 * shows one plain timetable instead.
 */
@Composable
private fun DayBoardView(blocks: List<PlacedBlock>, status: DayStatus, onCourse: (PlacedBlock) -> Unit) {
    val scope = LocalScheduleStyle.current
    val ink = scope.ink
    val heroHeight = max(148f, StyledDayCardHeight.value * 1.38f).dp
    val rowHeight = max(68f, StyledDayCardHeight.value * 0.66f).dp
    val finishedHeight = max(34f, StyledDayCardHeight.value * 0.34f).dp

    @Composable
    fun heading(title: String, ruled: Boolean = true) {
        // The heavy rule opens a list. 已结束 is a quieter footer and goes without.
        Column(Modifier.fillMaxWidth().height(40.dp).semantics { heading() }, verticalArrangement = Arrangement.Bottom) {
            Text(title, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace,
                color = ink.copy(alpha = 0.72f), modifier = Modifier.padding(horizontal = 12.dp))
            Spacer(Modifier.height(6.dp))
            Box(Modifier.fillMaxWidth().height(2.dp).background(ink.copy(alpha = if (ruled) 0.65f else 0f)))
        }
    }

    @Composable
    fun list(title: String, courses: List<PlacedBlock>, countsDown: Boolean) {
        if (courses.isEmpty()) return
        heading(title)
        courses.forEachIndexed { index, block ->
            // The trailing edge: a countdown for the next course, and 已结束 for a
            // finished course in the plain timetable. Every other row leaves it
            // empty; the times already lead.
            val start = ScheduleStyleTime.clockMinutes(status.start(block))
            val now = status.now
            val note: Pair<String, Boolean>? = when {
                status.phase(block) == DayStatus.Phase.Completed -> "已结束" to false
                countsDown && index == 0 && now != null && start != null && start > now -> {
                    val wait = start - now
                    (if (wait < 60) "$wait 分钟后" else if (wait % 60 == 0) "${wait / 60} 小时后" else "${wait / 60} 小时 ${wait % 60} 分后") to true
                }
                else -> null
            }
            Row(
                Modifier.fillMaxWidth().height(rowHeight).courseAction(block, status, note?.first, onCourse).drawBehind {
                    if (index != courses.lastIndex) drawRect(ink.copy(alpha = 0.15f), topLeft = Offset(0f, size.height - 0.5.dp.toPx()), size = Size(size.width, 0.5.dp.toPx()))
                }.padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(Modifier.width(82.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text(status.start(block), fontSize = 24.sp, lineHeight = 28.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace, color = ink, maxLines = 1, softWrap = false)
                    Text(status.end(block), fontSize = 12.sp, lineHeight = 14.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Medium,
                        fontFamily = FontFamily.Monospace, color = ink.copy(alpha = 0.72f), maxLines = 1, softWrap = false)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                        Box(Modifier.size(9.dp).clip(RoundedCornerShape(1.5.dp)).background(Color(scope.course(block.course.name).accent(scope.dark))))
                        Text(block.course.name, fontSize = 16.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold, fontFamily = scope.textFamily,
                            color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Text(
                        listOfNotNull(ScheduleStyleTime.location(block.course.location), ScheduleStyleTime.slotText(block.startSlot, block.endSlot)).joinToString(" · "),
                        fontSize = 12.sp, lineHeight = 15.sp, fontFamily = scope.textFamily, color = ink.copy(alpha = 0.72f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                if (note != null) {
                    Text(note.first, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, style = TabularDigits, maxLines = 1, softWrap = false,
                        color = if (note.second) scope.themeText else ink.copy(alpha = 0.72f))
                }
            }
        }
    }

    Column(Modifier.fillMaxWidth().scheduleSurface(0.dp, panel = true, border = false).padding(vertical = 8.dp)) {
        val now = status.now
        if (now == null) {
            list("课程安排", blocks, countsDown = false)
        } else {
        val current = blocks.filter { status.phase(it) == DayStatus.Phase.Current }
        val upcoming = blocks.filter { status.phase(it) == DayStatus.Phase.Upcoming }
        val finished = blocks.filter { status.phase(it) == DayStatus.Phase.Completed }
        Row(Modifier.fillMaxWidth().height(36.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("现在", fontSize = 11.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace, color = ink.copy(alpha = 0.72f))
            Text("%02d:%02d".format(now / 60, now % 60), fontSize = 16.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace, color = ink)
            Spacer(Modifier.weight(1f))
            val remaining = current.size + upcoming.size
            Text(if (remaining > 0) "今天还有 $remaining 门课" else "今天的课上完了", fontSize = 12.sp, fontWeight = FontWeight.Medium,
                style = TabularDigits, color = ink.copy(alpha = 0.72f), maxLines = 1)
        }
        current.forEach { block ->
            BoardHero(block, status, now, Modifier.fillMaxWidth().height(heroHeight).courseAction(block, status, "正在上", onCourse))
            Spacer(Modifier.height(4.dp))
        }
        list("接下来", upcoming, countsDown = true)
        if (finished.isNotEmpty()) {
            heading("已结束", ruled = false)
            finished.forEach { block ->
                // A finished course folds down to one quiet line.
                val quiet = ink.copy(alpha = 0.62f)
                Row(Modifier.fillMaxWidth().height(finishedHeight).courseAction(block, status, "已结束", onCourse).padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(status.start(block), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace, color = quiet,
                        maxLines = 1, modifier = Modifier.width(82.dp))
                    Text(block.course.name, fontSize = 14.sp, fontFamily = scope.textFamily, color = quiet, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f))
                    ScheduleStyleTime.location(block.course.location)?.let {
                        Text(it, fontSize = 12.sp, fontFamily = scope.textFamily, color = quiet, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.widthIn(max = 120.dp))
                    }
                }
            }
        }
        }
    }
}

/** The course in progress, inverted: time range, name, room and teacher, time left and progress. */
@Composable
private fun BoardHero(block: PlacedBlock, status: DayStatus, now: Int, modifier: Modifier) {
    val scope = LocalScheduleStyle.current
    val paper = scope.canvas ?: Color.White
    // The block swaps light and dark, so the colours on it come from the other scheme.
    val accent = scope.copy(dark = !scope.dark).themeText
    val start = ScheduleStyleTime.clockMinutes(status.start(block))
    val end = ScheduleStyleTime.clockMinutes(status.end(block))
    val remaining = max(1, (end ?: now) - now)
    val fraction = if (start != null && end != null && end > start) ((now - start).toFloat() / (end - start)).coerceIn(0f, 1f) else 0f
    val detail = listOfNotNull(ScheduleStyleTime.location(block.course.location), block.course.teacher?.trim()?.takeIf { it.isNotEmpty() }).joinToString(" · ")
    Column(modifier.background(scope.ink).padding(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("正在上 · ${ScheduleStyleTime.slotText(block.startSlot, block.endSlot)}", fontSize = 11.sp, letterSpacing = 1.sp, fontWeight = FontWeight.Bold,
                color = paper.copy(alpha = 0.72f), maxLines = 1, modifier = Modifier.weight(1f))
            Text("还剩 $remaining 分", fontSize = 13.sp, fontWeight = FontWeight.Bold, style = TabularDigits, color = accent, maxLines = 1)
        }
        Spacer(Modifier.weight(1f))
        Text("${status.start(block)} — ${status.end(block)}", fontSize = 28.sp, lineHeight = 34.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace, color = paper, maxLines = 1, softWrap = false)
        Spacer(Modifier.weight(1f))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Box(Modifier.size(9.dp).clip(RoundedCornerShape(1.5.dp)).background(Color(scope.course(block.course.name).accent(!scope.dark))))
            Text(block.course.name, fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.Bold, fontFamily = scope.textFamily, color = paper,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (detail.isNotEmpty()) {
            Text(detail, fontSize = 14.sp, lineHeight = 18.sp, fontFamily = scope.textFamily, color = paper.copy(alpha = 0.72f), maxLines = 1,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 3.dp))
        }
        Spacer(Modifier.height(8.dp))
        Box(Modifier.fillMaxWidth().height(3.dp).background(paper.copy(alpha = 0.25f))) {
            Box(Modifier.fillMaxWidth(fraction).height(3.dp).background(accent))
        }
    }
}

// endregion

// region Rest day

/** The rest card of a day with no courses. */
@Composable
internal fun ScheduleRestCard(note: String?) {
    val scope = LocalScheduleStyle.current
    val style = scope.style
    val shape = RoundedCornerShape(if (style == ScheduleVisualStyle.Paper || style == ScheduleVisualStyle.Board) 2.dp else 32.dp)
    val canvas = scope.canvas
    Column(
        Modifier.padding(horizontal = 12.dp).widthIn(max = 360.dp).fillMaxWidth().clip(shape)
            .then(
                if (canvas != null) Modifier.background(canvas).border(1.dp, scope.ink.copy(alpha = 0.18f), shape)
                else Modifier.background(scope.cardSurface).background(scope.themeTint(if (scope.dark) 0.06f else 0.025f))
                    .border(1.dp, scope.themeText.copy(alpha = if (scope.dark) 0.12f else 0.07f), shape),
            )
            .padding(horizontal = 24.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        RestIllustration(Modifier.size(width = 184.dp, height = 140.dp))
        Spacer(Modifier.height(24.dp))
        Text("这天没有课程", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, fontFamily = scope.fontFamily, color = scope.ink, textAlign = TextAlign.Center)
        Spacer(Modifier.height(10.dp))
        Text(note?.trim()?.takeIf { it.isNotEmpty() } ?: "留点时间，做喜欢的事", fontSize = 14.sp, lineHeight = 20.sp, fontFamily = scope.fontFamily,
            color = scope.meta, textAlign = TextAlign.Center)
    }
}

/** A dozing cloud, drawn in the theme colour for both appearances. */
@Composable
private fun RestIllustration(modifier: Modifier) {
    val scope = LocalScheduleStyle.current
    val dark = scope.dark
    val accent = scope.accent
    Canvas(modifier.clearAndSetSemantics {}) {
        scale(size.width / 116f, size.height / 88f, pivot = Offset.Zero) {
            drawOval(accent.copy(alpha = if (dark) 0.10f else 0.05f), topLeft = Offset(15f, 4f), size = Size(78f, 78f))
            drawOval(accent.copy(alpha = if (dark) 0.10f else 0.07f), topLeft = Offset(24f, 75f), size = Size(65f, 5f))
            drawOval(accent.copy(alpha = if (dark) 0.48f else 0.24f), topLeft = Offset(65f, 11f), size = Size(29f, 29f))
            val cloud = Path().apply {
                moveTo(32f, 67f)
                cubicTo(11f, 67f, 10f, 39f, 30f, 37f)
                cubicTo(29f, 15f, 60f, 11f, 66f, 30f)
                cubicTo(76f, 26f, 87f, 32f, 85f, 42f)
                cubicTo(105f, 43f, 103f, 67f, 84f, 67f)
                close()
            }
            drawPath(cloud, if (dark) Color(0xFF333333) else Color.White)
            drawPath(cloud, accent.copy(alpha = if (dark) 0.09f else 0.025f))
            drawPath(cloud, accent.copy(alpha = if (dark) 0.35f else 0.20f), style = Stroke(1.2f))
            val eyes = Path().apply {
                for (x in listOf(41f, 63f)) {
                    moveTo(x, 48f)
                    quadraticTo(x + 5f, 54f, x + 10f, 48f)
                }
            }
            drawPath(eyes, accent.copy(alpha = if (dark) 0.85f else 0.70f), style = Stroke(1.8f, cap = StrokeCap.Round))
        }
    }
}

// endregion
