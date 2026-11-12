package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.material3.ButtonDefaults
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material.icons.outlined.EditCalendar
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Warning
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/**
 * A course card's tap: it opens the course's quick look, which holds every
 * action on the course (there is no long press). It does not fade a cancelled
 * meeting: put [cancelledFade] ahead of the card's background so the whole card fades.
 */
@Suppress("UNUSED_PARAMETER")
internal fun Modifier.courseTap(block: PlacedBlock, onClick: () -> Unit): Modifier = clickable(onClick = onClick)

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

/** One action of a course, shown at the foot of its quick look. */
internal class CourseMenuAction(
    val title: String,
    val icon: ImageVector,
    val destructive: Boolean = false,
    /** Asked before it runs (这次停课): the title and the explanation of the dialog. */
    val confirm: Pair<String, String>? = null,
    val perform: () -> Unit,
)

/**
 * The actions of the quick look: the first as a filled button, the rest
 * outlined in rows of two, a destructive one in the error colour and asked
 * about first. [onDone] closes the quick look before an action runs, so
 * the action can open its own sheet.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CourseQuickLookActions(actions: List<CourseMenuAction>, onDone: () -> Unit) {
    if (actions.isEmpty()) return
    var asking by remember { mutableStateOf<CourseMenuAction?>(null) }
    fun run(action: CourseMenuAction) {
        if (action.confirm != null) asking = action else {
            onDone()
            action.perform()
        }
    }
    val error = MaterialTheme.colorScheme.error
    val first = actions.first()
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(
            onClick = { run(first) }, modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp),
            colors = if (first.destructive) ButtonDefaults.buttonColors(containerColor = error) else ButtonDefaults.buttonColors(),
        ) {
            Icon(first.icon, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(first.title, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        actions.drop(1).chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { action ->
                    val tint = if (action.destructive) error else MaterialTheme.colorScheme.primary
                    OutlinedButton(
                        onClick = { run(action) }, modifier = Modifier.weight(1f).heightIn(min = 44.dp),
                        border = BorderStroke(1.dp, tint.copy(alpha = 0.5f)),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = tint),
                        contentPadding = PaddingValues(horizontal = 8.dp),
                    ) {
                        Icon(action.icon, contentDescription = null, modifier = Modifier.size(17.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(action.title, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
    asking?.let { action ->
        val (title, text) = action.confirm ?: return@let
        CpuAlertDialog(
            onDismissRequest = { asking = null },
            title = { Text(title) },
            text = { Text(text) },
            confirmButton = {
                TextButton(onClick = {
                    asking = null
                    onDone()
                    action.perform()
                }) { Text(action.title, color = if (action.destructive) error else MaterialTheme.colorScheme.primary) }
            },
            dismissButton = { TextButton(onClick = { asking = null }) { Text("取消") } },
        )
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
        ChineseDatePickerDialog(
            initial = java.time.LocalDate.parse(target),
            onDismiss = { picking = false },
            selectable = { days.isEmpty() || it.toString() in days },
            onConfirm = { day ->
                target = day.toString()
                picking = false
            },
            dismissButton = { TextButton(onClick = { picking = false }) { Text("取消") } },
        )
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

/** Icons of the course actions, in one place so they read alike. */
internal object CourseMenuIcons {
    val details = Icons.Outlined.Info
    val edit = Icons.Rounded.Edit
    val once = Icons.Outlined.EditCalendar
    val cancel = Icons.Rounded.Block
    val restore = Icons.AutoMirrored.Rounded.Undo
    val agenda = Icons.Rounded.Add
}
