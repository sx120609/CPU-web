package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Undo
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.EditCalendar
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/**
 * The long press on a course card, set by the timetable on the user's own
 * grid (none on somebody else's): it opens [CourseMenuSheet] for the piece pressed.
 */
internal val LocalCourseMenu = staticCompositionLocalOf<((PlacedBlock) -> Unit)?> { null }

/**
 * A course card's tap and long press. It does not fade a cancelled meeting:
 * put [cancelledFade] ahead of the card's background so the whole card fades.
 */
@OptIn(ExperimentalFoundationApi::class)
internal fun Modifier.courseTap(block: PlacedBlock, onClick: () -> Unit): Modifier = composed {
    val menu = LocalCourseMenu.current
    val haptic = LocalHapticFeedback.current
    combinedClickable(
        onClick = onClick,
        onLongClickLabel = if (menu != null) "更多操作" else null,
        onLongClick = menu?.let { open ->
            {
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                open(block)
            }
        },
    )
}

/**
 * A cancelled meeting is drawn faded in its old place (see
 * [OccurrenceRules.cancelledBlocks]). Goes before the card's background, or
 * only the text fades and the card keeps its full colour.
 */
internal fun Modifier.cancelledFade(block: PlacedBlock): Modifier =
    if (block.block.cancelled != null) alpha(0.45f) else this

/** The small label of a course card for a changed meeting: 已停课, or 调 for a moved one. */
internal fun occurrenceTag(block: PlacedBlock): String? = when {
    block.block.cancelled != null -> "已停课"
    block.course.isMovedOccurrence -> "调"
    else -> null
}

/** One entry of the long-press menu. */
internal class CourseMenuAction(
    val title: String,
    val icon: ImageVector,
    val destructive: Boolean = false,
    val perform: () -> Unit,
)

/**
 * The long-press menu: the course as a larger card (when, where, who, which
 * weeks and what changed about this meeting), then its actions in groups.
 */
@Composable
internal fun CourseMenuSheet(
    store: ScheduleStore,
    block: PlacedBlock,
    palette: String,
    /** "小鹿的课" for the partner's course or a shared timetable laid on top. */
    ownerTitle: String?,
    sections: List<List<CourseMenuAction>>,
    onDismiss: () -> Unit,
) {
    ScheduleSheetContainer(onDismiss) {
        CoursePreviewCard(store, block, palette, ownerTitle)
        Spacer(Modifier.height(14.dp))
        val groups = sections.filter { it.isNotEmpty() }
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f))) {
            groups.forEachIndexed { index, group ->
                if (index > 0) HorizontalDivider(thickness = 6.dp, color = MaterialTheme.colorScheme.surface.copy(alpha = 0.6f))
                group.forEachIndexed { row, action ->
                    if (row > 0) HorizontalDivider(Modifier.padding(start = 48.dp))
                    val tint = if (action.destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 50.dp).clickable {
                            onDismiss()
                            action.perform()
                        }.padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(action.icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(14.dp))
                        Text(action.title, fontSize = 16.sp, color = tint)
                    }
                }
            }
        }
    }
}

/** The larger card of a course in the long-press menu. */
@Composable
internal fun CoursePreviewCard(store: ScheduleStore, block: PlacedBlock, palette: String, ownerTitle: String?) {
    val colors = LocalScheduleColors.current
    val course = block.course
    val accent = Color(StyleCourseColor(course.name, palette).accent(colors.dark))
    val meta = MaterialTheme.colorScheme.onSurfaceVariant
    val whole = block.block
    val start = whole.course.customTime?.first ?: store.periodTime(whole.startSlot).startTime
    val end = whole.course.customTime?.second ?: store.periodTime(whole.endSlot).endTime
    val whenText = listOfNotNull(
        whole.date.takeIf { it.length == 10 }?.let(OccurrenceRules::dateText) ?: WEEKDAY_LABELS.getOrNull(whole.day - 1),
        OccurrenceRules.slotsText(whole.startSlot, whole.endSlot), "$start–$end",
    ).joinToString(" · ")
    val rows = listOfNotNull(
        Icons.Outlined.Schedule to whenText,
        ScheduleStyleTime.location(course.location)?.let { Icons.Outlined.Place to it },
        course.teacher?.trim()?.takeIf { it.isNotEmpty() }?.let { Icons.Outlined.Person to it },
        course.weeks.trim().takeIf { it.isNotEmpty() && !course.isMovedOccurrence }?.let { Icons.Outlined.CalendarMonth to it },
    )
    val status: Pair<String, Color>? = when {
        whole.cancelled != null -> "这次停课" to meta
        course.occurrenceFrom != null -> "调课 · 原定 ${OccurrenceRules.dateText(course.occurrenceFrom)}" to Color(0xFFE08A1E)
        ownerTitle != null -> ownerTitle to Color(0xFF1E9C94)
        else -> null
    }
    Row(
        Modifier.fillMaxWidth().height(IntrinsicSize.Min).clip(RoundedCornerShape(16.dp))
            .background(accent.copy(alpha = if (colors.dark) 0.18f else 0.09f)).padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.width(4.dp).fillMaxHeight().clip(CircleShape).background(accent))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(course.name, fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.Bold, maxLines = 3, overflow = TextOverflow.Ellipsis)
            status?.let { (text, color) ->
                Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = color,
                    modifier = Modifier.clip(CircleShape).background(color.copy(alpha = 0.14f)).padding(horizontal = 8.dp, vertical = 2.dp))
            }
            rows.forEach { (icon, text) ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(15.dp))
                    Text(text, fontSize = 14.sp, color = meta)
                }
            }
        }
    }
}

/** What 调整这一次 works on. */
data class OccurrenceEditorContext(
    val course: ScheduleCourse,
    /** The course's edit keys; every row of a merged course moves together. */
    val keys: List<String>,
    /** "yyyy-MM-dd", the meeting as planned. */
    val date: String,
    /** Periods it is drawn on now (moved or not). */
    val startSlot: Int,
    val endSlot: Int,
    /** The change already saved, when it was moved before. */
    val existing: OccurrenceChange?,
    /** Its planned periods, before any change. */
    val original: Pair<Int, Int>?,
)

/**
 * 调整这一次: another date, other periods or another room for one meeting.
 * The rest of the semester is untouched; 恢复原安排 takes the change away.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun OccurrenceEditorSheet(
    context: OccurrenceEditorContext,
    calendar: ScheduleCalendar?,
    periods: List<SchedulePeriod>,
    palette: String,
    /** The other courses' names on a date in the given periods, for the clash line. */
    clashes: (date: String, start: Int, end: Int) -> List<String>,
    /** Saves the change; null on success, else why not. */
    save: suspend ((String) -> OccurrenceChange) -> String?,
    restore: (suspend () -> String?)?,
    onDismiss: () -> Unit,
) {
    val colors = LocalScheduleColors.current
    val accent = Color(StyleCourseColor(context.course.name, palette).accent(colors.dark))
    val original = context.original ?: (context.startSlot to context.endSlot)
    var target by remember { mutableStateOf(context.existing?.toDate ?: context.date) }
    var start by remember { mutableStateOf(context.startSlot) }
    var end by remember { mutableStateOf(context.endSlot) }
    var extending by remember { mutableStateOf(false) }
    var location by remember { mutableStateOf(context.existing?.location ?: context.course.location.orEmpty()) }
    var note by remember { mutableStateOf(context.existing?.note.orEmpty()) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val problem = OccurrenceRules.dateProblem(calendar, target)
    val overlaps = clashes(target, start, end)
    val changed = target != context.date || (start to end) != original ||
        location.trim() != context.course.location.orEmpty().trim() || note.isNotBlank()

    fun run(work: suspend () -> String?) {
        saving = true
        error = null
        scope.launch {
            val failure = work()
            saving = false
            if (failure == null) onDismiss() else error = failure
        }
    }

    ScheduleSheetContainer(onDismiss = { if (!saving) onDismiss() }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onDismiss, enabled = !saving) { Text("取消") }
            Text("调整这一次", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            TextButton(
                onClick = {
                    val date = context.date
                    run {
                        save { key ->
                            OccurrenceRules.build(key, date, target, start, end, original, location, context.course.location, note)
                        }
                    }
                },
                enabled = !saving && changed && problem == null,
            ) { Text(if (saving) "保存中" else "保存", fontWeight = FontWeight.SemiBold) }
        }
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(width = 4.dp, height = 26.dp).clip(RoundedCornerShape(2.dp)).background(accent))
            Spacer(Modifier.width(10.dp))
            Text(context.course.name, fontSize = 22.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.height(8.dp))
        Text(
            "原定 ${OccurrenceRules.dateText(context.date)} · ${OccurrenceRules.slotsText(original.first, original.second)}" +
                (context.course.location?.trim()?.takeIf { it.isNotEmpty() }?.let { " · ${ScheduleStyleTime.classroomOnly(it)}" } ?: ""),
            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 10.dp, vertical = 5.dp),
        )

        SettingsSection("改到")
        SettingsNavRow("日期", OccurrenceRules.dateText(target)) { picking = true }
        problem?.let { WarningLine(it) }

        Row(verticalAlignment = Alignment.CenterVertically) {
            SettingsSection("节次")
            Spacer(Modifier.weight(1f))
            Text("${periods.firstOrNull { it.number == start }?.startTime.orEmpty()}–${periods.firstOrNull { it.number == end }?.endTime.orEmpty()}",
                fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 16.dp))
        }
        SlotPickerGrid(periods, start, end, original, accent) { number ->
            if (extending && number >= start) {
                end = number
                extending = false
            } else {
                start = number
                end = number
                extending = true
            }
        }
        Text(if (extending) "再点一下结束的节次；只上一节就点同一个。" else "先点开始的节次，再点结束的节次。",
            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
        if (overlaps.isNotEmpty()) WarningLine("和「${overlaps.joinToString("」「")}」时间重叠，仍然可以保存")

        SettingsSection("教室")
        OutlinedTextField(location, { location = it.take(60) }, placeholder = { Text("上课地点") }, singleLine = true,
            enabled = !saving, modifier = Modifier.fillMaxWidth())
        SettingsSection("备注")
        OutlinedTextField(note, { note = it.take(80) }, placeholder = { Text("例如：改为线上，腾讯会议号见群") }, maxLines = 3,
            enabled = !saving, modifier = Modifier.fillMaxWidth())
        Text("只改这一次，其他周照常上课。", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))

        if (restore != null) {
            Spacer(Modifier.height(16.dp))
            OutlinedButton(onClick = { run { restore() } }, enabled = !saving, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.AutoMirrored.Rounded.Undo, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("恢复原安排", color = MaterialTheme.colorScheme.error)
            }
        }
        error?.let {
            Spacer(Modifier.height(10.dp))
            Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.error)
        }
    }

    if (picking) {
        val days = calendar?.weeks?.flatMap { it.days }?.filter { it.length == 10 }.orEmpty().toSet()
        val state = rememberDatePickerState(
            initialSelectedDateMillis = OccurrenceRules.utcMillis(target),
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean =
                    days.isEmpty() || OccurrenceRules.fromUtcMillis(utcTimeMillis) in days
            },
        )
        DatePickerDialog(
            onDismissRequest = { picking = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { target = OccurrenceRules.fromUtcMillis(it) }
                    picking = false
                }) { Text("确定") }
            },
            dismissButton = { TextButton(onClick = { picking = false }) { Text("取消") } },
        ) { DatePicker(state = state, title = null, headline = null, showModeToggle = false) }
    }
}

@Composable
private fun WarningLine(text: String) {
    Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Rounded.Warning, contentDescription = null, tint = Color(0xFFE08A1E), modifier = Modifier.size(15.dp))
        Spacer(Modifier.width(5.dp))
        Text(text, fontSize = 12.sp, lineHeight = 16.sp, color = Color(0xFFE08A1E))
    }
}

/** The periods four to a row: the picked run filled, the planned one outlined with a dash. */
@Composable
private fun SlotPickerGrid(periods: List<SchedulePeriod>, start: Int, end: Int, original: Pair<Int, Int>, accent: Color, onPick: (Int) -> Unit) {
    val surface = MaterialTheme.colorScheme.surfaceVariant
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        periods.chunked(4).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { period ->
                    val selected = period.number in start..end
                    val planned = period.number in original.first..original.second
                    Column(
                        Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp))
                            .background(if (selected) accent else surface)
                            .then(if (planned && !selected) Modifier.drawBehind {
                                drawRoundRect(accent.copy(alpha = 0.6f), cornerRadius = CornerRadius(12.dp.toPx()),
                                    style = Stroke(1.2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))))
                            } else Modifier)
                            .clickable { onPick(period.number) }
                            .semantics {
                                contentDescription = "第 ${period.number} 节，${period.startTime}"
                                this.selected = selected
                            }
                            .padding(vertical = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text("${period.number}", fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                            color = if (selected) Color.White else MaterialTheme.colorScheme.onSurface)
                        Text(period.startTime, fontSize = 10.sp,
                            color = (if (selected) Color.White else MaterialTheme.colorScheme.onSurface).copy(alpha = 0.75f))
                    }
                }
                repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

/** A cancelled meeting tapped: put it back? */
@Composable
internal fun CancelledMeetingDialog(block: PlacedBlock, onRestore: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("「${block.course.name}」这次停课") },
        text = { Text("${OccurrenceRules.dateText(block.block.cancelled?.date ?: block.block.date)} 的这节课已停课；恢复后按原来的时间上课。") },
        confirmButton = { TextButton(onClick = { onDismiss(); onRestore() }) { Text("恢复原安排") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

/** Icons of the long-press menu, in one place so the groups read alike. */
internal object CourseMenuIcons {
    val details = Icons.Outlined.Info
    val edit = Icons.Rounded.Edit
    val once = Icons.Outlined.EditCalendar
    val cancel = Icons.Rounded.Block
    val restore = Icons.AutoMirrored.Rounded.Undo
    val agenda = Icons.Rounded.Add
}
