package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import cn.lizmt.cpuweb.schedule.agenda.AgendaKind
import cn.lizmt.cpuweb.schedule.agenda.AgendaOccurrence
import java.time.LocalDate
import kotlin.math.min

/**
 * The user's own events and to-dos inside the timetable (ported from 药大拾间
 * NEXT). Only the user's own timetable provides it; shared timetables and style
 * thumbnails go without. [occurrences] answers for one day, from [AgendaRemote].
 */
internal class ScheduleAgendaLayer(
    private val occurrences: (LocalDate) -> List<AgendaOccurrence>,
    val onOpen: (AgendaItem) -> Unit,
    val onToggle: (AgendaOccurrence) -> Unit,
) {
    /** Everything on a `yyyy-MM-dd` day, all-day first; nothing for a column without a date. */
    fun on(date: String): List<AgendaOccurrence> = AgendaItem.parseDate(date)?.let(occurrences).orEmpty()
}

internal val LocalScheduleAgenda = staticCompositionLocalOf<ScheduleAgendaLayer?> { null }

/** Items placed at a time, the ones a grid column draws. */
private fun timed(occurrences: List<AgendaOccurrence>) = occurrences.filter { it.item.timed }

/** How long an item without an end takes up on the grid, so it can be read and tapped. */
private const val UNTIMED_SPAN_MINUTES = 45

/**
 * Where a clock time falls down a grid of `rowHeight` periods `gap` apart: inside a
 * period in proportion to it, in a break across the gap, and clamped to the grid
 * before the first and after the last period.
 */
internal fun agendaOffset(minutes: Int, periods: List<SchedulePeriod>, rowHeight: Float, gap: Float): Float {
    val step = rowHeight + gap
    var previousEnd: Int? = null
    periods.forEachIndexed { index, period ->
        val start = ScheduleStyleTime.clockMinutes(period.startTime) ?: return 0f
        val end = ScheduleStyleTime.clockMinutes(period.endTime) ?: return 0f
        if (minutes < start) {
            if (index == 0) return 0f
            val breakStart = previousEnd ?: start
            val length = (start - breakStart).coerceAtLeast(1)
            return index * step - gap + gap * (minutes - breakStart).coerceIn(0, length) / length
        }
        if (minutes <= end) return index * step + rowHeight * (minutes - start) / (end - start).coerceAtLeast(1)
        previousEnd = end
    }
    return (periods.size * step - gap).coerceAtLeast(0f)
}


/**
 * The day's timed items over one week column. An item clear of classes spans
 * the column; one that overlaps a class keeps to the right edge so the class
 * stays readable beside it.
 */
@Composable
internal fun AgendaColumnChips(date: String, blocks: List<PlacedBlock>, periods: List<SchedulePeriod>, columnWidth: Dp, rowHeight: Float, gap: Float) {
    val layer = LocalScheduleAgenda.current ?: return
    val items = timed(layer.on(date))
    if (items.isEmpty()) return
    val scope = LocalScheduleStyle.current
    val colors = LocalScheduleColors.current
    // Where each course is drawn, as the Web grid decides: an item pinned onto a class
    // (one before the first period, say) keeps beside it too.
    val courses = blocks.map { (it.startSlot - 1) * (rowHeight + gap) to it.endSlot * (rowHeight + gap) - gap }
    val bottom = (periods.size * (rowHeight + gap) - gap).coerceAtLeast(0f)
    items.forEach { occurrence ->
        val item = occurrence.item
        val start = AgendaItem.parseTime(item.start)?.let { it.hour * 60 + it.minute } ?: return@forEach
        val end = AgendaItem.parseTime(item.end)?.let { it.hour * 60 + it.minute }?.takeIf { it > start } ?: (start + UNTIMED_SPAN_MINUTES)
        val top = agendaOffset(start, periods, rowHeight, gap)
        val height = (agendaOffset(end, periods, rowHeight, gap) - top).coerceAtLeast(20f).coerceAtMost((bottom - top).coerceAtLeast(20f))
        val beside = courses.any { (from, to) -> from < top + height && top < to }
        val width = if (beside) columnWidth * 0.44f else columnWidth - 2.dp
        val x = if (beside) columnWidth - width - 1.dp else 1.dp
        // The style's typeface, corners, ink and alignment, as its classes have; the dashed
        // outline tells an item from a class.
        val style = scope.style
        val radius = min(style.cornerRadius, 6f).dp
        val shape = RoundedCornerShape(radius)
        val ink = if (style == ScheduleVisualStyle.Paper || style == ScheduleVisualStyle.Board) scope.ink else scope.themeText
        Box(
            Modifier.offset(x = x, y = top.dp).width(width).height(height.dp)
                .alpha(if (occurrence.done) 0.55f else 1f)
                .clip(shape).background(scope.canvas ?: colors.surface)
                // The board's classes have no fill, and paper's only a faint wash.
                .background(when (style.course) {
                    StyleCourse.Departure -> Color.Transparent
                    StyleCourse.Ink -> scope.themeTint(if (scope.dark) 0.16f else 0.09f)
                    else -> scope.themeTint(if (scope.dark) 0.32f else 0.18f)
                })
                .drawBehind {
                    val stroke = 1.dp.toPx()
                    drawRoundRect(
                        ink.copy(alpha = 0.6f), topLeft = Offset(stroke / 2, stroke / 2), size = Size(size.width - stroke, size.height - stroke),
                        cornerRadius = CornerRadius((radius.toPx() - stroke / 2).coerceAtLeast(0f)),
                        style = Stroke(stroke, pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 2.dp.toPx()))),
                    )
                }
                .clickable { layer.onOpen(item) }
                .semantics { contentDescription = "日程，${item.title}，${item.start}" + (if (item.end.isNotEmpty()) " 至 ${item.end}" else "") + (if (occurrence.done) "，已完成" else "") }
                .padding(horizontal = 3.dp, vertical = 2.dp),
            contentAlignment = if (style.centered) Alignment.TopCenter else Alignment.TopStart,
        ) {
            Text(
                (if (occurrence.done) "✓ " else "") + item.title,
                fontSize = 9.sp, lineHeight = 11.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, fontFamily = scope.textFamily,
                color = ink, textAlign = if (style.centered) TextAlign.Center else TextAlign.Start,
                maxLines = (height / 11f).toInt().coerceAtLeast(1), overflow = TextOverflow.Ellipsis,
                textDecoration = if (occurrence.done) TextDecoration.LineThrough else null,
            )
        }
    }
}

/** A dot for a day that has all-day items or to-dos without a time, for a week column's header. */
@Composable
internal fun AgendaHeaderDot(date: String, modifier: Modifier) {
    val layer = LocalScheduleAgenda.current ?: return
    if (layer.on(date).none { !it.item.timed && !it.done }) return
    Box(modifier.size(5.dp).clip(CircleShape).background(LocalScheduleStyle.current.themeFill))
}

/**
 * The day view's list of the user's own items, above the classes in every
 * style: the time (or 全天), a check, the title and the place.
 */
@Composable
internal fun AgendaDayStrip(date: String) {
    val layer = LocalScheduleAgenda.current ?: return
    val items = layer.on(date)
    if (items.isEmpty()) return
    val scope = LocalScheduleStyle.current
    Column(Modifier.fillMaxWidth().padding(bottom = 10.dp).scheduleSurface(14.dp, card = true).padding(vertical = 4.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("日程", fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.SemiBold, color = scope.meta, modifier = Modifier.weight(1f))
            Text("${items.size} 项", fontSize = 11.sp, lineHeight = 14.sp, color = scope.meta)
        }
        items.forEach { occurrence ->
            val item = occurrence.item
            Row(
                Modifier.fillMaxWidth().clickable { layer.onOpen(item) }.heightIn(min = 38.dp).padding(horizontal = 12.dp, vertical = 4.dp)
                    .alpha(if (occurrence.done) 0.55f else 1f),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (!item.timed) "全天" else if (item.end.isNotEmpty()) "${item.start}–${item.end}" else item.start,
                    fontSize = 12.sp, lineHeight = 15.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, color = scope.themeText,
                    modifier = Modifier.width(84.dp), maxLines = 1,
                )
                run {
                    Box(
                        Modifier.size(28.dp).clip(CircleShape).clickable { layer.onToggle(occurrence) }
                            .semantics { contentDescription = if (occurrence.done) "标为未完成" else "标为完成" },
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(
                            Modifier.size(16.dp).clip(CircleShape)
                                .then(if (occurrence.done) Modifier.background(scope.themeFill) else Modifier.border(1.5.dp, scope.meta, CircleShape)),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (occurrence.done) Icon(Icons.Rounded.Check, contentDescription = null, tint = scope.onFill, modifier = Modifier.size(11.dp))
                        }
                    }
                    Spacer(Modifier.width(4.dp))
                }
                Text(
                    item.title, fontSize = 14.sp, lineHeight = 18.sp, letterSpacing = 0.sp, color = scope.ink, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    textDecoration = if (occurrence.done) TextDecoration.LineThrough else null, modifier = Modifier.weight(1f),
                )
                if (item.location.isNotBlank()) {
                    Spacer(Modifier.width(8.dp))
                    Text(item.location, fontSize = 12.sp, lineHeight = 15.sp, letterSpacing = 0.sp, color = scope.meta, maxLines = 1,
                        overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 110.dp))
                }
            }
        }
    }
}
