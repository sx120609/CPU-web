package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** One day of the day view's seven-day strip. */
internal class StyledStripDay(
    /** Weekday, 1–7. */
    val day: Int,
    /** Day of the month, 「9」; null when the calendar has no date. */
    val number: String?,
    val today: Boolean,
    /** "off" or "swap" when the date is adjusted. */
    val adjustmentKind: String?,
    /** Read out by TalkBack: weekday, date, what an adjustment means and how many courses. */
    val description: String,
)

internal val StyledDayStripHeight = 50.dp

/**
 * The day view's seven-day selector in every style except classic (iOS
 * `ScheduleDayStrip`). Each draws it as the header row of its own week view,
 * so switching between the two views keeps the row in place, and the strip and
 * the day list under it read as one design. The classic style keeps its own strip.
 */
@Composable
internal fun StyledDayStrip(days: List<StyledStripDay>, selectedDay: Int, modifier: Modifier = Modifier, onSelect: (Int) -> Unit) {
    val scope = LocalScheduleStyle.current
    val style = scope.style
    val rule = scope.cellBorder
    val ink = scope.ink
    val framed = when (style) {
        // The table rules between its days, like the columns of its week view. Stroked
        // on top: the selected day fills its cell edge to edge.
        ScheduleVisualStyle.Table -> Modifier.background(scope.panelSurface).drawWithContent {
            drawContent()
            val width = 0.6.dp.toPx()
            drawRect(rule, topLeft = Offset(width / 2, width / 2), size = Size(size.width - width, size.height - width), style = Stroke(width))
            for (index in 1 until days.size) {
                val x = size.width * index / days.size
                drawLine(rule, Offset(x, 0f), Offset(x, size.height), width)
            }
        }
        // Paper and board sit on their own page colour, as their week and day panels do.
        // The board ends the strip on the hairline it rules its rows with.
        ScheduleVisualStyle.Paper -> Modifier.background(scope.panelSurface)
        ScheduleVisualStyle.Board -> Modifier.background(scope.panelSurface).drawWithContent {
            drawContent()
            val weight = 0.5.dp.toPx()
            drawRect(ink.copy(alpha = 0.15f), topLeft = Offset(0f, size.height - weight), size = Size(size.width, weight))
        }
        else -> Modifier
    }
    // Same gaps as the week view: only minimal and grid keep space between days.
    Row(modifier.fillMaxWidth().height(StyledDayStripHeight).then(framed), horizontalArrangement = Arrangement.spacedBy(style.columnGap.dp)) {
        days.forEach { day ->
            val selected = day.day == selectedDay
            val cell = Modifier.weight(1f).fillMaxHeight().clickable { onSelect(day.day) }.semantics {
                contentDescription = day.description
                this.selected = selected
            }
            val today = day.today && !scope.static
            if (style == ScheduleVisualStyle.Minimal) {
                MinimalStripDay(day, today, selected, cell)
            } else {
                StyledDateHeader(day.day, day.number ?: "–", today, day.adjustmentKind, cell, selected = selected)
            }
        }
    }
}

/**
 * The day of the month above and the weekday below, as in the minimal week
 * header; the selected day sits on a pale rounded tile.
 */
@Composable
private fun MinimalStripDay(day: StyledStripDay, today: Boolean, selected: Boolean, modifier: Modifier) {
    val scope = LocalScheduleStyle.current
    val highlighted = selected || today
    val tile = if (selected) {
        Modifier.clip(RoundedCornerShape(12.dp)).background(scope.themeTint(if (scope.dark) 0.2f else 0.1f))
    } else Modifier
    Box(modifier.then(tile)) {
        Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(day.number ?: "–", fontSize = 17.sp, lineHeight = 20.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
                color = if (highlighted) scope.themeText else scope.primary)
            Text(if (today) "今天" else WEEKDAY_LABELS[day.day - 1], fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.sp,
                fontWeight = FontWeight.Medium, maxLines = 1, color = if (highlighted) scope.themeText else scope.secondary)
        }
        day.adjustmentKind?.let { Box(Modifier.align(Alignment.TopEnd).padding(top = 3.dp, end = 3.dp)) { ScheduleAdjustmentMark(it) } }
    }
}
