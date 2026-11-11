package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.KeyboardDoubleArrowLeft
import androidx.compose.material.icons.rounded.KeyboardDoubleArrowRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.YearMonth

/**
 * The month grid of a date picker, in Chinese whatever the phone's language.
 * Material's DatePicker labels the weekdays with the locale's narrow names,
 * which in Chinese came out as 「星 星 星 …」, and on an English phone the whole
 * picker was English. Weeks start on Monday, like the timetable.
 */
object ChineseMonthGrid {
    val WEEKDAYS = listOf("一", "二", "三", "四", "五", "六", "日")

    /** The month's dates in rows of seven, Monday first; null pads the first and last rows. */
    fun rows(month: YearMonth): List<List<LocalDate?>> {
        val lead = month.atDay(1).dayOfWeek.value - 1
        val cells = List<LocalDate?>(lead) { null } + (1..month.lengthOfMonth()).map { month.atDay(it) }
        return cells.chunked(7).map { row -> row + List(7 - row.size) { null } }
    }

    fun title(month: YearMonth): String = "${month.year}年${month.monthValue}月"
}

/**
 * A date picker dialog: month arrows (and year arrows for dates far back, such
 * as an anniversary), the grid, then the caller's buttons. [selectable] greys
 * out and disables dates that cannot be picked.
 */
@Composable
internal fun ChineseDatePickerDialog(
    initial: LocalDate,
    onDismiss: () -> Unit,
    selectable: (LocalDate) -> Boolean = { true },
    title: String? = null,
    yearArrows: Boolean = false,
    confirmLabel: String = "确定",
    onConfirm: (LocalDate) -> Unit,
    dismissButton: @Composable () -> Unit,
) {
    var picked by remember { mutableStateOf(initial) }
    var month by remember { mutableStateOf(YearMonth.from(initial)) }
    val scheme = MaterialTheme.colorScheme
    val today = LocalDate.now()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = title?.let { { Text(it) } },
        text = {
            Column(Modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    if (yearArrows) IconButton(onClick = { month = month.minusYears(1) }) {
                        Icon(Icons.Rounded.KeyboardDoubleArrowLeft, contentDescription = "上一年")
                    }
                    IconButton(onClick = { month = month.minusMonths(1) }) {
                        Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, contentDescription = "上个月")
                    }
                    Text(ChineseMonthGrid.title(month), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
                        modifier = Modifier.weight(1f))
                    IconButton(onClick = { month = month.plusMonths(1) }) {
                        Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = "下个月")
                    }
                    if (yearArrows) IconButton(onClick = { month = month.plusYears(1) }) {
                        Icon(Icons.Rounded.KeyboardDoubleArrowRight, contentDescription = "下一年")
                    }
                }
                Row(Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 2.dp)) {
                    ChineseMonthGrid.WEEKDAYS.forEach { label ->
                        Text(label, fontSize = 12.sp, color = scheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                    }
                }
                ChineseMonthGrid.rows(month).forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        row.forEach { date ->
                            Box(Modifier.weight(1f).aspectRatio(1f).padding(1.dp), contentAlignment = Alignment.Center) {
                                if (date != null) {
                                    val enabled = selectable(date)
                                    val chosen = date == picked
                                    Box(
                                        Modifier.fillMaxWidth().aspectRatio(1f).clip(CircleShape)
                                            .background(if (chosen) scheme.primary else Color.Transparent)
                                            .border(if (date == today && !chosen) 1.dp else 0.dp,
                                                if (date == today && !chosen) scheme.primary else Color.Transparent, CircleShape)
                                            .clickable(enabled = enabled) { picked = date }
                                            .semantics { contentDescription = "${date.monthValue}月${date.dayOfMonth}日"; selected = chosen },
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Text(date.dayOfMonth.toString(), fontSize = 14.sp,
                                            color = when {
                                                chosen -> scheme.onPrimary
                                                !enabled -> scheme.onSurface.copy(alpha = 0.3f)
                                                else -> scheme.onSurface
                                            })
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = { onConfirm(picked) }, enabled = selectable(picked)) { Text(confirmLabel) }
        },
        dismissButton = dismissButton,
        shape = RoundedCornerShape(24.dp),
    )
}
