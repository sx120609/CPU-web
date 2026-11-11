package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.AddCircle
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.RadioButtonUnchecked
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 当天安排 under the month: the chosen day's classes (each with the same tap
 * and long press as on the grid) and 日程, with 日视图 to open the day.
 */
@Composable
internal fun MonthDayPanel(
    store: ScheduleStore,
    date: String,
    couple: CoupleLayer?,
    canAddAgenda: Boolean,
    onCourse: (PlacedBlock, String) -> Unit,
    onOpenDay: (String) -> Unit,
    onAddAgenda: (String) -> Unit,
) {
    val colors = LocalScheduleColors.current
    val scope = LocalScheduleStyle.current
    val week = store.calendar?.weeks?.firstOrNull { date in it.days }
    val day = week?.days?.indexOf(date)?.plus(1)
    val weekValue = week?.week?.toString()
    val own = if (weekValue != null && day != null) store.placedBlocksForDay(day, weekValue) else emptyList()
    val courses = (couple?.merge(own, date) ?: own).sortedWith(compareBy({ it.startSlot }, { it.lane }))
    val agenda = LocalScheduleAgenda.current
    val entries = agenda?.on(date).orEmpty()
    val adjustment = store.calendar?.adjustments?.firstOrNull { it.date == date }
    val glass = LocalScheduleGlass.current
    val container = if (scope.style == ScheduleVisualStyle.Classic) {
        Modifier.clip(RoundedCornerShape(18.dp)).background(glass ?: colors.surface)
    } else Modifier.scheduleSurface(18.dp, panel = true)
    Column(Modifier.fillMaxWidth().then(container).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(OccurrenceRules.dateText(date), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = colors.text)
            if (week != null) {
                Spacer(Modifier.width(8.dp))
                Text("第 ${week.week} 周", fontSize = 13.sp, color = colors.secondary)
            }
            if (adjustment != null) {
                Spacer(Modifier.width(6.dp))
                ScheduleAdjustmentMark(adjustment.kind)
            }
            Spacer(Modifier.weight(1f))
            if (week != null) {
                Row(
                    Modifier.clip(CircleShape).clickable { onOpenDay(date) }.padding(start = 8.dp, top = 2.dp, bottom = 2.dp)
                        .semantics(mergeDescendants = true) { contentDescription = "打开这一天的日视图" },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("日视图", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = scope.themeText)
                    Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = null, tint = scope.themeText, modifier = Modifier.size(18.dp))
                }
            }
        }
        if (courses.isEmpty() && entries.isEmpty()) {
            Text(
                when {
                    adjustment?.kind == "off" -> "放假，没有课"
                    week == null -> "不在本学期内"
                    else -> "这天没有课"
                },
                fontSize = 14.sp, color = colors.secondary,
            )
        }
        courses.forEach { block ->
            val accent = Color(StyleCourseColor(block.course.name, scope.palette).accent(colors.dark))
            val partner = block.owner == CoupleOwner.Partner
            val start = block.course.customTime?.first ?: (if (partner) couple?.partnerStore ?: store else store).periodTime(block.startSlot).startTime
            val end = block.course.customTime?.second ?: (if (partner) couple?.partnerStore ?: store else store).periodTime(block.endSlot).endTime
            Row(
                Modifier.fillMaxWidth().height(IntrinsicSize.Min).clip(RoundedCornerShape(12.dp))
                    .background(accent.copy(alpha = if (colors.dark) 0.14f else 0.07f))
                    .courseTap(block) { onCourse(block, weekValue ?: store.selectedWeek) }
                    .semantics { contentDescription = (if (partner) "TA 的课，" else "") + (occurrenceTag(block)?.let { "$it，" } ?: "") + courseAccessibility(block.block) }
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.width(46.dp), horizontalAlignment = Alignment.End) {
                    Text(start, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = colors.text)
                    Text(end, fontSize = 12.sp, color = colors.secondary)
                }
                Spacer(Modifier.width(10.dp))
                androidx.compose.foundation.layout.Box(Modifier.width(4.dp).fillMaxHeight().clip(RoundedCornerShape(2.dp)).background(accent))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(block.course.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = colors.text, maxLines = 1,
                            overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
                            textDecoration = if (block.block.cancelled != null) TextDecoration.LineThrough else null)
                        occurrenceTag(block)?.let {
                            Spacer(Modifier.width(6.dp))
                            ScheduleCardTag(it, colors.secondary)
                        }
                        if (partner) {
                            Spacer(Modifier.width(6.dp))
                            Text(couple?.partnerName?.ifEmpty { "TA" } ?: "TA", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = OverlayTeal)
                        }
                    }
                    Text(
                        listOfNotNull(OccurrenceRules.slotsText(block.startSlot, block.endSlot), ScheduleStyleTime.location(block.course.location))
                            .joinToString(" · "),
                        fontSize = 12.sp, color = colors.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        if (agenda != null && canAddAgenda) {
            if (entries.isNotEmpty()) HorizontalDivider()
            entries.forEach { entry ->
                val item = entry.item
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Icon(
                        if (entry.done) Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked,
                        contentDescription = if (entry.done) "${item.title}，已完成" else "完成${item.title}",
                        tint = if (entry.done) scope.themeText else colors.secondary,
                        modifier = Modifier.size(24.dp).clip(CircleShape).clickable { agenda.onToggle(entry) },
                    )
                    Spacer(Modifier.width(10.dp))
                    Row(Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).clickable { agenda.onOpen(item) }.padding(vertical = 4.dp)) {
                        Text(item.title, fontSize = 15.sp, color = if (entry.done) colors.secondary else colors.text, maxLines = 1,
                            overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                            textDecoration = if (entry.done) TextDecoration.LineThrough else null)
                        Text(if (!item.timed) "全天" else item.start, fontSize = 12.sp, color = colors.secondary)
                    }
                }
            }
            Row(
                Modifier.clip(CircleShape).clickable { onAddAgenda(date) }.padding(vertical = 2.dp, horizontal = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Rounded.AddCircle, contentDescription = null, tint = scope.themeText, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("添加日程", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = scope.themeText)
            }
        }
    }
}
