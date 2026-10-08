package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.max

// Week-grid components of the minimal, grid, table, paper and board styles,
// ported from the iOS `ScheduleStyledWeekViews`. Course lanes, calendar
// resolution and editing stay in the store and the screen; these composables
// only draw what they are handed.

internal val StyledSlotGap = 3.dp
internal val StyledHeaderHeight = 48.dp
internal val StyledAxisWidth = 42.dp

/** The breathing room between the panel and its first row and last column; the table's rules run along the edge. */
internal fun styledPanelPadding(style: ScheduleVisualStyle): Dp = if (style == ScheduleVisualStyle.Table) 0.dp else 6.dp

/** Fit the twelve periods, the date header and the panel padding in the visible height. */
internal fun styledWeekRowHeight(availableHeight: Float, style: ScheduleVisualStyle): Float =
    max(32f, (availableHeight - 6f - StyledHeaderHeight.value - (SLOT_COUNT - 1) * StyledSlotGap.value -
        2 * styledPanelPadding(style).value) / SLOT_COUNT)

/** One content surface of the styled timetable: a flat fill and a hairline. */
@Composable
internal fun Modifier.scheduleSurface(cornerRadius: Dp, panel: Boolean = false, card: Boolean = false, border: Boolean = true): Modifier {
    val scope = LocalScheduleStyle.current
    val style = scope.style
    val radius = if (style == ScheduleVisualStyle.Minimal || style == ScheduleVisualStyle.Grid) cornerRadius else style.cornerRadius.dp
    val shape = RoundedCornerShape(radius)
    val fill = when {
        panel -> scope.panelSurface
        card -> scope.cardSurface
        else -> scope.canvas ?: scope.cellSurface
    }
    val base = clip(shape).background(fill)
    return when {
        // Paper frames its panel with a heavy outer and a fine inner rule.
        style == ScheduleVisualStyle.Paper && panel -> base.border(1.2.dp, scope.ink.copy(alpha = 0.6f), shape).drawWithContent {
            drawContent()
            val inset = 3.dp.toPx()
            drawRoundRect(
                scope.ink.copy(alpha = 0.24f), topLeft = Offset(inset, inset),
                size = Size(size.width - inset * 2, size.height - inset * 2),
                cornerRadius = CornerRadius(radius.toPx()), style = Stroke(0.6.dp.toPx()),
            )
        }
        border -> base.border(1.dp, scope.cellBorder, shape)
        else -> base
    }
}

/** The 休 / 班 badge beside a date. `onInk`: it sits on an ink-filled block, so ink and canvas trade places. */
@Composable
internal fun ScheduleAdjustmentMark(kind: String, onInk: Boolean = false) {
    val scope = LocalScheduleStyle.current
    val style = scope.style
    val label = if (kind == "off") "休" else "班"
    if (style == ScheduleVisualStyle.Paper || style == ScheduleVisualStyle.Board) {
        // A solid seal for a day off, an outlined one for a make-up day.
        val paper = scope.canvas ?: Color.White
        val ink = if (onInk) paper else scope.accent
        Box(
            Modifier.size(13.dp).background(if (kind == "off") ink else Color.Transparent).border(1.dp, ink).clearAndSetSemantics {},
            contentAlignment = Alignment.Center,
        ) {
            Text(label, fontSize = 9.sp, lineHeight = 10.sp, fontWeight = FontWeight.Bold, fontFamily = scope.fontFamily,
                color = if (kind == "off") (if (onInk) scope.ink else paper) else ink)
        }
    } else {
        // Opaque fills with white text, the same in both appearances.
        Box(
            Modifier.size(12.dp).clip(RoundedCornerShape(3.dp))
                .background(Color(if (kind == "off") 0xFFE11D48 else 0xFFC2410C)).clearAndSetSemantics {},
            contentAlignment = Alignment.Center,
        ) {
            Text(label, fontSize = 9.sp, lineHeight = 10.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
        }
    }
}

/** How a date header marks its day. */
internal enum class DateHeaderMark { None, ThemeFill, Ink, Tile, Wash }

/**
 * `selected` is null in the week header; the day strip passes whether this is
 * its selected day. The table fills one whole cell: today in the week header,
 * the selected day in the strip. The board inverts the selected day, as its
 * month view does, the grid frames it like one of its course tiles, and paper
 * washes it the way its week view washes today's column.
 */
internal fun dateHeaderMark(style: ScheduleVisualStyle, today: Boolean, selected: Boolean?): DateHeaderMark = when {
    style == ScheduleVisualStyle.Table && (selected ?: today) -> DateHeaderMark.ThemeFill
    selected != true -> DateHeaderMark.None
    style == ScheduleVisualStyle.Board -> DateHeaderMark.Ink
    style == ScheduleVisualStyle.Grid -> DateHeaderMark.Tile
    else -> DateHeaderMark.Wash
}

/**
 * The date header of a week column. With `selected` set it doubles as a day of
 * the day strip: the same header becomes a button, and today and the selection
 * each keep a mark of their own.
 */
@Composable
internal fun StyledDateHeader(day: Int, date: String, today: Boolean, adjustmentKind: String?, modifier: Modifier, selected: Boolean? = null) {
    val scope = LocalScheduleStyle.current
    val style = scope.style
    val mark = dateHeaderMark(style, today, selected)
    val ink = when {
        mark == DateHeaderMark.ThemeFill -> scope.onFill
        mark == DateHeaderMark.Ink -> scope.canvas ?: Color.White
        today -> scope.accent
        else -> scope.ink
    }
    if (style == ScheduleVisualStyle.Minimal) {
        // The day of the month above, the weekday below; today takes the theme colour.
        Box(modifier) {
            Column(Modifier.fillMaxSize().padding(top = 12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text(date, fontSize = 16.sp, lineHeight = 18.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Bold, maxLines = 1,
                    color = if (today) scope.themeText else scope.primary)
                Text(if (today) "今天" else WEEKDAY_LABELS[day - 1], fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.sp,
                    fontWeight = FontWeight.SemiBold, maxLines = 1, color = if (today) scope.themeText else scope.secondary)
            }
            if (adjustmentKind != null) Box(Modifier.align(Alignment.TopEnd).padding(end = 2.dp)) { ScheduleAdjustmentMark(adjustmentKind) }
        }
        return
    }
    val tile = RoundedCornerShape(style.cornerRadius.dp)
    val marked = when (mark) {
        DateHeaderMark.ThemeFill -> Modifier.background(scope.themeFill)
        DateHeaderMark.Ink -> Modifier.background(scope.ink)
        // A course tile of the grid: pale fill inside a border of the same colour.
        DateHeaderMark.Tile -> Modifier.clip(tile).background(scope.themeTint(if (scope.dark) 0.2f else 0.1f))
            .border(style.borderWidth.dp, scope.themeText, tile)
        DateHeaderMark.Wash -> Modifier.background(scope.accent.copy(alpha = if (scope.dark) 0.16f else 0.08f))
        DateHeaderMark.None -> Modifier
    }
    Column(
        modifier.then(marked).drawBehind {
            // Today's bar on the board; the selected day is inverted and needs none.
            if (style == ScheduleVisualStyle.Board && today && selected != true) {
                drawRect(scope.accent, topLeft = Offset(0f, size.height - 3.dp.toPx()), size = Size(size.width, 3.dp.toPx()))
            }
        },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        if (style == ScheduleVisualStyle.Grid) {
            Text(WEEKDAY_LABELS[day - 1].takeLast(1), fontSize = 16.sp, lineHeight = 18.sp, fontWeight = FontWeight.Bold, color = ink, maxLines = 1)
        } else {
            Text(if (today) (if (style == ScheduleVisualStyle.Paper) "今日" else "今天") else WEEKDAY_LABELS[day - 1],
                fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold,
                fontFamily = scope.fontFamily, color = ink, maxLines = 1)
        }
        Spacer(Modifier.height(2.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            val paper = style == ScheduleVisualStyle.Paper
            val board = style == ScheduleVisualStyle.Board
            // The strip is a control, so its dates are set a size up from the week header's.
            val large = selected != null && style != ScheduleVisualStyle.Grid
            Text(
                // 「05」 on the board, like the dates of a departure board.
                if (board) date.toIntOrNull()?.let { "%02d".format(it) } ?: date else date,
                fontSize = if (large) 15.sp else if (paper) 14.sp else 11.sp, lineHeight = if (large) 18.sp else if (paper) 16.sp else 14.sp,
                letterSpacing = 0.sp, fontWeight = if (board) FontWeight.Bold else FontWeight.Medium, fontFamily = scope.fontFamily,
                color = ink, maxLines = 1,
                modifier = if (paper && today) Modifier.border(1.dp, scope.accent, CircleShape).padding(horizontal = 4.dp) else Modifier,
            )
            if (adjustmentKind != null) ScheduleAdjustmentMark(adjustmentKind, onInk = mark == DateHeaderMark.Ink)
        }
    }
}

/** A course tile of the grid, table, paper and board styles. */
@Composable
internal fun StyledCourseTile(
    course: ScheduleCourse,
    modifier: Modifier,
    height: Dp,
    compact: Boolean = false,
    start: String? = null,
    current: Boolean = false,
    trailingInset: Dp = 0.dp,
    /** A full-width row of the day view: reading size, leading, centred vertically. */
    dayRow: Boolean = false,
    showLocation: Boolean = true,
    /** A small label above the name, such as 非本周. */
    tag: String? = null,
) {
    val scope = LocalScheduleStyle.current
    val display = LocalScheduleDisplay.current
    val style = scope.style
    val tint = scope.course(course.name)
    val accent = Color(tint.accent(scope.dark))
    val centered = style.centered && !dayRow
    val inverse = style == ScheduleVisualStyle.Board && current && !scope.static
    val ink = when {
        inverse -> scope.canvas ?: Color.White
        style == ScheduleVisualStyle.Paper || style == ScheduleVisualStyle.Board -> scope.ink
        else -> accent
    }
    // The course-colour bar on the leading edge; the text clears it by the same amount.
    val stripe = when (style.course) {
        StyleCourse.Stripe -> 3.dp
        StyleCourse.Ink -> 2.dp
        else -> 0.dp
    }
    val short = height < 64.dp
    val small = compact || short
    val fill = Color(tint.fill(scope.dark, scope.hasBackground))
    val background = when {
        inverse -> scope.ink
        style.course == StyleCourse.Card || style.course == StyleCourse.Stripe -> fill
        // Paper keeps its ink text; the course colour is only a faint wash.
        style.course == StyleCourse.Ink -> fill.copy(alpha = fill.alpha * 0.7f)
        else -> Color.Transparent
    }
    val shape = RoundedCornerShape(style.cornerRadius.dp)
    val highlighted = current && !scope.static
    Box(
        modifier.clip(shape).background(background)
            .then(if (style.borderWidth > 0f) Modifier.border(
                if (highlighted) 2.dp else style.borderWidth.dp, if (highlighted) scope.themeText else accent, shape) else Modifier)
            .drawBehind { if (stripe > 0.dp) drawRect(accent, size = Size(stripe.toPx(), size.height)) }
            .padding(start = stripe, end = trailingInset)
            .padding(horizontal = if (dayRow) 12.dp else if (small) 3.dp else 7.dp,
                vertical = if (display.compact) 2.dp else if (short) 3.dp else 6.dp),
        contentAlignment = if (centered) Alignment.Center else if (dayRow) Alignment.CenterStart else Alignment.TopStart,
    ) {
        ScheduleCardText {
        Column(
            horizontalAlignment = if (centered) Alignment.CenterHorizontally else Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(if (display.compact) 0.dp else if (small) 1.dp else 3.dp),
        ) {
            if (tag != null) ScheduleCardTag(tag, ink)
            if (style.course == StyleCourse.Departure) {
                // The board has no fill and no bar, so a small course-colour mark
                // sits beside the start time. The inverted tile takes the other scheme's colour.
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    Box(Modifier.size(if (small) 5.dp else 7.dp).clip(RoundedCornerShape(1.dp))
                        .background(if (inverse) Color(tint.accent(!scope.dark)) else accent))
                    if (start != null && showLocation) {
                        Text(start, fontSize = if (small) 9.sp else 14.sp, lineHeight = if (small) 11.sp else 16.sp, letterSpacing = 0.sp,
                            fontWeight = FontWeight.ExtraBold, fontFamily = FontFamily.Monospace, color = ink, maxLines = 1, softWrap = false)
                    }
                }
            }
            val nameSize = if (dayRow) 15.sp else if (small) 10.5.sp else 13.sp
            Text(
                course.name, fontSize = nameSize, lineHeight = nameSize * 1.18f, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold,
                fontFamily = scope.textFamily, color = ink, textAlign = if (centered) TextAlign.Center else TextAlign.Start,
                maxLines = if (dayRow) (if (short) 1 else 2) else if (short) 2 else if (!showLocation) 8 else if (display.compact) 6
                    else if (compact) 4 else 3,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
            )
            ScheduleStyleTime.location(course.location)?.takeIf { showLocation }?.let { location ->
                val size = if (dayRow) 12.sp else if (small) 9.sp else 11.sp
                Text(
                    "@$location", fontSize = size, lineHeight = size * 1.2f, letterSpacing = 0.sp, fontWeight = FontWeight.Medium,
                    fontFamily = scope.textFamily, color = ink, textAlign = if (centered) TextAlign.Center else TextAlign.Start,
                    maxLines = if (short || dayRow) 1 else 2, overflow = TextOverflow.Ellipsis,
                )
            }
            course.teacher?.trim()?.takeIf { display.showTeacher && !dayRow && !short && showLocation && it.isNotEmpty() }?.let { teacher ->
                val size = if (small) 9.sp else 11.sp
                Text(
                    teacher, fontSize = size, lineHeight = size * 1.2f, letterSpacing = 0.sp, fontWeight = FontWeight.Medium,
                    fontFamily = scope.textFamily, color = ink, textAlign = if (centered) TextAlign.Center else TextAlign.Start,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
        }
    }
}

/** The small outlined label on a course card: 非本周. */
@Composable
internal fun ScheduleCardTag(text: String, color: Color) {
    Text(
        text, fontSize = 8.sp, lineHeight = 10.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, color = color,
        maxLines = 1, softWrap = false,
        modifier = Modifier.border(0.5.dp, color, RoundedCornerShape(3.dp)).padding(horizontal = 3.dp),
    )
}

/** The minimal style's week card: a borderless pale tint, text at the top leading corner. */
@Composable
internal fun MinimalCourseCard(
    course: ScheduleCourse, modifier: Modifier, height: Dp, compact: Boolean, showLocation: Boolean = true, tag: String? = null,
) {
    val scope = LocalScheduleStyle.current
    val display = LocalScheduleDisplay.current
    val tint = scope.course(course.name)
    val accent = Color(tint.accent(scope.dark))
    val short = height < 64.dp
    val small = compact || short
    ScheduleCardText {
    Column(
        modifier.clip(RoundedCornerShape(9.dp)).background(Color(tint.fill(scope.dark, scope.hasBackground)))
            .padding(horizontal = if (compact) 3.dp else 7.dp, vertical = if (display.compact) 2.dp else if (short) 4.dp else 6.dp),
        verticalArrangement = Arrangement.spacedBy(if (display.compact) 0.dp else if (small) 1.dp else 3.dp),
    ) {
        if (tag != null) ScheduleCardTag(tag, accent)
        val nameSize = if (small) 10.5.sp else 13.sp
        Text(course.name, fontSize = nameSize, lineHeight = nameSize * 1.18f, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold,
            color = accent, overflow = TextOverflow.Ellipsis,
            maxLines = if (short) 2 else if (!showLocation) 8 else if (display.compact) 6 else if (compact) 4 else 3,
            modifier = Modifier.weight(1f, fill = false))
        ScheduleStyleTime.location(course.location)?.takeIf { showLocation }?.let { location ->
            val size = if (small) 9.sp else 11.sp
            Text("@$location", fontSize = size, lineHeight = size * 1.2f, letterSpacing = 0.sp, fontWeight = FontWeight.Medium,
                color = accent, maxLines = if (short) 1 else 2, overflow = TextOverflow.Ellipsis)
        }
        course.teacher?.trim()?.takeIf { display.showTeacher && !short && showLocation && it.isNotEmpty() }?.let { teacher ->
            val size = if (small) 9.sp else 11.sp
            Text(teacher, fontSize = size, lineHeight = size * 1.2f, letterSpacing = 0.sp, fontWeight = FontWeight.Medium,
                color = accent, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
    }
}

@Composable
internal fun StyledSlotLabel(period: SchedulePeriod, startsSession: Boolean, rowHeight: Dp, modifier: Modifier) {
    val scope = LocalScheduleStyle.current
    val style = scope.style
    val times = LocalScheduleDisplay.current.showSlotTime
    // Three lines need about 36sp. With larger text or a short row the last
    // line goes, so a label never runs into the period below it.
    val roomy = rowHeight.value >= 36f * LocalDensity.current.fontScale
    Column(
        modifier.clearAndSetSemantics { contentDescription = "第 ${period.number} 节，${period.startTime} 至 ${period.endTime}" },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        when (style) {
            ScheduleVisualStyle.Minimal -> {
                Text(period.number.toString(), fontSize = 14.sp, lineHeight = 16.sp, fontWeight = FontWeight.Bold, color = scope.primary, maxLines = 1)
                if (times) Text(period.startTime, fontSize = 10.sp, lineHeight = 12.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, color = scope.meta, maxLines = 1)
            }
            ScheduleVisualStyle.Board -> {
                // The board's axis leads with the time; without times it reads 第N节 alone.
                if (times && startsSession && roomy) Text(ScheduleStyleTime.session(period.startTime), fontSize = 8.sp, lineHeight = 9.sp, fontWeight = FontWeight.Bold, color = scope.ink, maxLines = 1)
                if (times) Text(period.startTime, fontSize = 11.5.sp, lineHeight = 13.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace, color = scope.ink, maxLines = 1, softWrap = false)
                Text("第${period.number}节", fontSize = if (times) 8.sp else 10.sp, lineHeight = if (times) 9.sp else 12.sp,
                    fontWeight = if (times) FontWeight.Normal else FontWeight.Bold, color = scope.ink, maxLines = 1)
            }
            else -> {
                val paper = style == ScheduleVisualStyle.Paper
                Text(if (paper) ScheduleStyleTime.numeral(period.number) else period.number.toString(),
                    fontSize = if (paper) 12.sp else 13.sp, lineHeight = 14.sp, fontWeight = FontWeight.Bold, fontFamily = scope.fontFamily,
                    color = scope.ink, maxLines = 1)
                if (times) Text(period.startTime, fontSize = 9.sp, lineHeight = 10.sp, letterSpacing = 0.sp, fontFamily = scope.fontFamily, color = scope.ink, maxLines = 1)
                if (times && roomy) {
                    Text(period.endTime, fontSize = 9.sp, lineHeight = 10.sp, letterSpacing = 0.sp, fontFamily = scope.fontFamily, color = scope.ink, maxLines = 1)
                }
            }
        }
    }
}

/** "Now" on the period axis: the current time in a theme-colour capsule. */
@Composable
internal fun ScheduleNowBadge(minutes: Int, modifier: Modifier = Modifier) {
    val scope = LocalScheduleStyle.current
    Box(modifier.height(16.dp).clip(CircleShape).background(scope.themeFill).padding(horizontal = 4.dp).clearAndSetSemantics {},
        contentAlignment = Alignment.Center) {
        Text("%d:%02d".format(minutes / 60, minutes % 60), fontSize = 10.sp, lineHeight = 12.sp, letterSpacing = 0.sp,
            fontWeight = FontWeight.SemiBold, color = scope.onFill, maxLines = 1, softWrap = false)
    }
}

/** "Now" across today's column: a theme-colour line with a dot at its leading end. */
@Composable
internal fun ScheduleNowLine(modifier: Modifier) {
    val scope = LocalScheduleStyle.current
    Box(modifier.height(7.dp).drawBehind {
        val middle = size.height / 2
        drawLine(scope.themeText, Offset(0f, middle), Offset(size.width, middle), 1.5.dp.toPx())
        drawCircle(scope.themeFill, 3.5.dp.toPx(), Offset(0f, middle))
    })
}

/** Where "now" falls down a grid of `rowHeight` rows, and the periods it lies on; null before the first and after the last. */
internal fun nowPosition(current: Int, periods: List<SchedulePeriod>, rowHeight: Float, gap: Float): Pair<Float, IntRange>? {
    val step = rowHeight + gap
    periods.forEachIndexed { index, period ->
        val start = ScheduleStyleTime.clockMinutes(period.startTime) ?: return null
        val end = ScheduleStyleTime.clockMinutes(period.endTime) ?: return null
        if (end <= start) return null
        // During a break the line rests in the gap between two periods.
        if (current < start) return if (index == 0) null else (index * step - gap / 2) to (period.number - 1..period.number)
        if (current <= end) return (index * step + rowHeight * (current - start) / (end - start)) to (period.number..period.number)
    }
    return null
}

/**
 * One day of a styled week grid, and the grid column of the grid style's day
 * view. Tiles are drawn on top of the empty cells, so a course always wins a tap.
 */
@Composable
internal fun StyledDayColumn(
    day: Int,
    blocks: List<PlacedBlock>,
    periods: List<SchedulePeriod>,
    columnWidth: Dp,
    rowHeight: Dp,
    today: Boolean,
    adjustmentKind: String?,
    compact: Boolean,
    now: Int?,
    canAdd: Boolean,
    onCourse: (PlacedBlock) -> Unit,
    onAddSlot: (Int) -> Unit,
    /** A course's state label in the day view; week columns pass none. */
    statusLabel: ((PlacedBlock) -> String?)? = null,
    isCurrent: (PlacedBlock) -> Boolean = { false },
    dayRow: Boolean = false,
    /** Off for a thumbnail: nothing in it takes a tap or speaks. */
    interactive: Boolean = true,
    /** Courses that do not run this week, drawn faded under the others. */
    offWeek: List<PlacedBlock> = emptyList(),
    onOffWeek: (PlacedBlock) -> Unit = {},
) {
    val scope = LocalScheduleStyle.current
    val style = scope.style
    val marksToday = today && !scope.static
    val gap = StyledSlotGap
    val step = rowHeight + gap
    val height = rowHeight * periods.size + gap * (periods.size - 1).coerceAtLeast(0)
    Box(Modifier.width(columnWidth).height(height)) {
        Column(verticalArrangement = Arrangement.spacedBy(if (style == ScheduleVisualStyle.Table) 0.dp else gap)) {
            periods.forEachIndexed { index, period ->
                val covering = blocks.filter { it.startSlot <= period.number && period.number <= it.endSlot }
                // Side-by-side courses that do not fill the row leave the rest of the cell showing.
                val covered = covering.isNotEmpty() && covering.map { it.lane }.distinct().size >= covering[0].lanes
                val startsSession = index == 0 ||
                    ScheduleStyleTime.session(periods[index - 1].startTime) != ScheduleStyleTime.session(period.startTime)
                val last = index == periods.lastIndex
                StyledWeekCell(
                    today = marksToday, holiday = adjustmentKind == "off", startsSession = startsSession, covered = covered,
                    joinsBelow = covering.any { it.endSlot > period.number }, joinsAbove = covering.any { it.startSlot < period.number },
                    closesColumn = last,
                    modifier = Modifier.width(columnWidth)
                        .height(if (style == ScheduleVisualStyle.Table && !last) rowHeight + gap else rowHeight)
                        .then(if (canAdd && covering.isEmpty()) Modifier.clickable { onAddSlot(period.number) }.semantics {
                            contentDescription = WEEKDAY_LABELS[day - 1] + "第${period.number}节，添加课程"
                        } else Modifier),
                )
            }
        }
        // Only the grid style runs the "now" line beneath its course tiles; the
        // others draw it above the courses for the whole row.
        if (style == ScheduleVisualStyle.Grid && now != null && marksToday) {
            nowPosition(now, periods, rowHeight.value, gap.value)?.let { (y, slots) ->
                // Drawn only where no course covers it: dark course fills are translucent.
                val covering = blocks.filter { it.startSlot <= slots.first && slots.last <= it.endSlot }
                val lanes = covering.firstOrNull()?.lanes ?: 1
                (0 until lanes).filter { lane -> covering.none { it.lane == lane } }.forEach { lane ->
                    Box(Modifier.offset(x = columnWidth / lanes * lane, y = y.dp).width(columnWidth / lanes).height(1.5.dp).background(scope.themeText))
                }
            }
        }
        (offWeek.map { it to true } + blocks.map { it to false }).forEach { (block, ghost) ->
            val lanes = block.lanes
            // Grid tiles are the cell itself, the same size as the empty cells beside
            // them; table tiles sit just inside the rules; the rest keep 1dp all round.
            val inset = if (style == ScheduleVisualStyle.Table) 0.5.dp else if (style == ScheduleVisualStyle.Grid && lanes == 1) 0.dp else 1.dp
            // Table rules sit at the top of each period, so a tile reaches across the row gap to the next one.
            val reach = if (style == ScheduleVisualStyle.Table && block.endSlot < (periods.lastOrNull()?.number ?: SLOT_COUNT)) gap else 0.dp
            val first = periods.indexOfFirst { it.number == block.startSlot }.coerceAtLeast(0)
            val tileHeight = (rowHeight * block.span + gap * (block.span - 1) + reach - inset * 2).coerceAtLeast(rowHeight - inset * 2)
            val tileWidth = (columnWidth / lanes - inset * 2).coerceAtLeast(12.dp)
            val label = if (dayRow && lanes == 1) statusLabel?.invoke(block) else null
            val narrow = compact || columnWidth / lanes < 70.dp
            // A lane this narrow holds two characters a line: the name takes all of it.
            val showLocation = columnWidth / lanes >= 30.dp
            val tile = Modifier.offset(x = inset + columnWidth / lanes * block.lane, y = step * first + inset)
                .width(tileWidth).height(tileHeight)
                .then(if (ghost) Modifier.alpha(0.5f) else Modifier)
                .then(if (interactive) Modifier.clickable { if (ghost) onOffWeek(block) else onCourse(block) }.semantics {
                    contentDescription = (if (ghost) "非本周，" else "") + courseAccessibility(block.block) +
                        (statusLabel?.invoke(block)?.let { "，$it" } ?: "")
                } else Modifier)
            val tag = if (ghost) "非本周" else null
            if (style == ScheduleVisualStyle.Minimal) {
                MinimalCourseCard(block.course, tile, tileHeight, narrow, showLocation, tag)
            } else {
                Box(tile) {
                    StyledCourseTile(
                        block.course, Modifier.fillMaxSize(), tileHeight, compact = narrow,
                        start = periods.firstOrNull { it.number == block.startSlot }?.startTime, current = !ghost && isCurrent(block),
                        trailingInset = if (label != null) 80.dp else 0.dp, dayRow = dayRow, showLocation = showLocation, tag = tag,
                    )
                    if (label != null) {
                        Text(label, fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.End,
                            color = if (style == ScheduleVisualStyle.Board && isCurrent(block)) scope.canvas ?: Color.White else scope.themeText,
                            modifier = Modifier.align(Alignment.CenterEnd).width(86.dp).padding(end = 10.dp))
                    }
                }
            }
        }
    }
}

/** One empty period of a styled week column, on the shared row pitch. */
@Composable
private fun StyledWeekCell(
    today: Boolean,
    holiday: Boolean,
    startsSession: Boolean,
    /** A course tile covers the whole cell; a cell left underneath would show through a translucent tile. */
    covered: Boolean,
    joinsBelow: Boolean,
    joinsAbove: Boolean,
    closesColumn: Boolean,
    modifier: Modifier,
) {
    val scope = LocalScheduleStyle.current
    val style = scope.style
    val drawn = when (style.grid) {
        StyleGrid.Cells -> if (covered) Modifier else {
            val radius = style.cornerRadius.dp
            Modifier.drawBehind {
                val corner = CornerRadius(radius.toPx())
                drawRoundRect(scope.canvas ?: scope.cellSurface, cornerRadius = corner)
                if (today) drawRoundRect(scope.themeTint(0.12f), cornerRadius = corner)
                val stroke = 1.dp.toPx()
                drawRoundRect(
                    scope.cellBorder, topLeft = Offset(stroke / 2, stroke / 2), size = Size(size.width - stroke, size.height - stroke),
                    cornerRadius = corner,
                    style = Stroke(stroke, pathEffect = if (holiday) PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 3.dp.toPx())) else null),
                )
            }
        }
        // The table's rules are stroked once for the whole table, behind the columns.
        StyleGrid.Table -> if (today) Modifier.background(scope.themeTint(0.08f)) else Modifier
        // The heavy rule between morning, afternoon and evening always runs through;
        // the hairline is left out inside a multi-period course.
        StyleGrid.Sessions -> Modifier.drawBehind {
            if (startsSession || !joinsAbove) {
                val weight = if (startsSession) 2.dp.toPx() else 0.5.dp.toPx()
                drawRect(scope.ink.copy(alpha = if (startsSession) 0.65f else 0.12f), size = Size(size.width, weight))
            }
        }
        StyleGrid.Rows -> if (style == ScheduleVisualStyle.Minimal) Modifier else Modifier.drawBehind {
            if (!joinsBelow && !closesColumn) {
                val weight = 0.5.dp.toPx()
                drawRect(scope.ink.copy(alpha = 0.16f), topLeft = Offset(0f, size.height - weight), size = Size(size.width, weight))
            }
        }
    }
    Box(modifier.then(drawn))
}

/** What one day column of a styled week needs. */
internal class StyledWeekDay(
    val day: Int,
    /** "yyyy-MM-dd", or empty when the calendar has no date. */
    val date: String,
    val today: Boolean,
    val adjustmentKind: String?,
    val blocks: List<PlacedBlock>,
    /** The teaching week this column belongs to: with Sunday first, Sunday is the week before. Empty when there is none. */
    val week: String = "",
    /** Courses that do not run this week, for the periods left free. */
    val offWeek: List<PlacedBlock> = emptyList(),
    val canAdd: Boolean = true,
)

/**
 * The styled week grid: period axis, day columns, the style's rules and the
 * "now" indicator.
 */
@Composable
internal fun StyledWeekGrid(
    days: List<StyledWeekDay>,
    periods: List<SchedulePeriod>,
    rowHeight: Dp,
    now: Int?,
    canAdd: Boolean,
    onCourse: (StyledWeekDay, PlacedBlock) -> Unit,
    onAddSlot: (Int, Int) -> Unit,
    onDay: ((Int) -> Unit)?,
    showsHeader: Boolean = true,
    panelRadius: Dp = 20.dp,
    interactive: Boolean = true,
    onOffWeek: (PlacedBlock) -> Unit = {},
) {
    val scope = LocalScheduleStyle.current
    val style = scope.style
    val pad = styledPanelPadding(style)
    val gap = style.columnGap.dp
    val header = if (showsHeader) StyledHeaderHeight else 0.dp
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val count = days.size.coerceAtLeast(1)
        val columnWidth = ((maxWidth - pad * 2 - StyledAxisWidth - gap * count) / count).coerceAtLeast(24.dp)
        val tracksNow = now != null && !scope.static && days.any { it.today }
        val nowOffset = if (tracksNow) nowPosition(now!!, periods, rowHeight.value, StyledSlotGap.value)?.first else null
        Box(Modifier.fillMaxWidth().scheduleSurface(panelRadius, panel = true, border = style.framesPanel).padding(pad)) {
            Row(
                Modifier.drawBehind {
                    val rule = scope.cellBorder
                    val headerPx = header.toPx()
                    val step = (rowHeight + StyledSlotGap).toPx()
                    val axis = StyledAxisWidth.toPx()
                    val column = columnWidth.toPx()
                    if (style == ScheduleVisualStyle.Minimal) {
                        // Hairlines between periods, right of the period axis.
                        val leading = axis + gap.toPx() / 2
                        val lines = mutableListOf<Float>()
                        if (headerPx > 0) lines += headerPx - 0.5f
                        for (index in 1 until periods.size) lines += headerPx + index * step - StyledSlotGap.toPx() / 2
                        lines.forEach { y -> drawLine(rule, Offset(leading, y), Offset(size.width, y), 0.5.dp.toPx()) }
                    } else if (style == ScheduleVisualStyle.Table) {
                        // One set of rules, every shared edge stroked once. A rule that
                        // would cross a course spanning several periods is left out.
                        val width = 0.6.dp.toPx()
                        drawRect(rule, topLeft = Offset(width / 2, width / 2), size = Size(size.width - width, size.height - width), style = Stroke(width))
                        for (index in days.indices) {
                            val x = axis + index * column
                            drawLine(rule, Offset(x, 0f), Offset(x, size.height), width)
                        }
                        for (row in periods.indices) {
                            val y = headerPx + row * step
                            drawLine(rule, Offset(0f, y), Offset(axis, y), width)
                            days.forEachIndexed { index, day ->
                                val above = periods.getOrNull(row - 1)?.number
                                val below = periods[row].number
                                val joined = above != null && day.blocks.any { it.startSlot <= above && below <= it.endSlot }
                                if (!joined) {
                                    val x = axis + index * column
                                    drawLine(rule, Offset(x, y), Offset(x + column, y), width)
                                }
                            }
                        }
                    }
                },
                horizontalArrangement = Arrangement.spacedBy(gap),
            ) {
                Column(Modifier.width(StyledAxisWidth)) {
                    if (showsHeader) {
                        // The headers carry only the day of the month; the month reads here, as on a calendar.
                        Box(Modifier.width(StyledAxisWidth).height(StyledHeaderHeight), contentAlignment = Alignment.Center) {
                            Text(monthLabel(days.firstOrNull()?.date.orEmpty()) ?: "节次", fontSize = 11.sp, lineHeight = 14.sp,
                                fontWeight = FontWeight.Bold, fontFamily = scope.fontFamily, color = scope.meta, maxLines = 1)
                        }
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(StyledSlotGap)) {
                        periods.forEachIndexed { index, period ->
                            StyledSlotLabel(
                                period,
                                startsSession = index == 0 ||
                                    ScheduleStyleTime.session(periods[index - 1].startTime) != ScheduleStyleTime.session(period.startTime),
                                rowHeight = rowHeight,
                                modifier = Modifier.width(StyledAxisWidth).height(rowHeight),
                            )
                        }
                    }
                }
                days.forEach { day ->
                    val marksToday = day.today && !scope.static
                    Column(
                        Modifier.width(columnWidth).styledColumnBackground(day, marksToday, header),
                    ) {
                        if (showsHeader) {
                            StyledDateHeader(
                                day.day, dayOfMonth(day.date) ?: "–", marksToday, day.adjustmentKind,
                                Modifier.width(columnWidth).height(StyledHeaderHeight)
                                    .then(if (onDay != null) Modifier.clickable { onDay(day.day) } else Modifier)
                                    .semantics {
                                        contentDescription = WEEKDAY_LABELS[day.day - 1] + " " + day.date +
                                            (day.adjustmentKind?.let { if (it == "off") "，休息" else "，补班" } ?: "") + "，查看当天课程"
                                    },
                            )
                        }
                        StyledDayColumn(
                            day = day.day, blocks = day.blocks, periods = periods, columnWidth = columnWidth, rowHeight = rowHeight,
                            today = day.today, adjustmentKind = day.adjustmentKind, compact = true,
                            now = if (day.today) now else null, canAdd = canAdd && day.canAdd,
                            onCourse = { onCourse(day, it) }, onAddSlot = { onAddSlot(day.day, it) }, interactive = interactive,
                            offWeek = day.offWeek, onOffWeek = onOffWeek,
                        )
                    }
                }
            }
            if (nowOffset != null) {
                // A capsule on the axis and a line across today's column, at one height.
                val todayIndex = days.indexOfFirst { it.today }
                if (style != ScheduleVisualStyle.Grid && todayIndex >= 0) {
                    ScheduleNowLine(Modifier.offset(
                        x = StyledAxisWidth + gap + (columnWidth + gap) * todayIndex, y = header + nowOffset.dp - 3.5.dp,
                    ).width(columnWidth))
                }
                Box(Modifier.offset(y = header + nowOffset.dp - 8.dp).width(StyledAxisWidth), contentAlignment = Alignment.Center) {
                    ScheduleNowBadge(now!!)
                }
            }
        }
    }
}

@Composable
private fun Modifier.styledColumnBackground(day: StyledWeekDay, marksToday: Boolean, header: Dp): Modifier {
    val scope = LocalScheduleStyle.current
    return when (scope.style) {
        ScheduleVisualStyle.Minimal ->
            if (marksToday) clip(RoundedCornerShape(12.dp)).background(scope.themeTint(scope.todayStrength)) else this
        // A holiday column is hatched and a weekend one greyed; a weekend worked as a make-up day stays plain.
        ScheduleVisualStyle.Table -> when {
            day.adjustmentKind == "off" -> drawBehind {
                clipRect(top = header.toPx()) {
                    val spacing = 6.dp.toPx()
                    var x = -size.height
                    while (x < size.width) {
                        drawLine(scope.cellBorder, Offset(x, size.height), Offset(x + size.height, 0f), 0.6.dp.toPx())
                        x += spacing
                    }
                }
            }
            day.day >= 6 && day.adjustmentKind != "swap" -> background(scope.primary.copy(alpha = 0.035f))
            else -> this
        }
        ScheduleVisualStyle.Paper -> if (marksToday) background(scope.accent.copy(alpha = if (scope.dark) 0.10f else 0.07f)) else this
        else -> this
    }
}

internal fun monthLabel(date: String): String? = date.split('-').takeIf { it.size >= 3 }?.get(1)?.toIntOrNull()?.let { "${it}月" }

internal fun dayOfMonth(date: String): String? = date.split('-').takeIf { it.size >= 3 }?.get(2)?.toIntOrNull()?.toString()
