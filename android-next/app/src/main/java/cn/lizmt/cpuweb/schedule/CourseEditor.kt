package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/** One "when it meets" group being edited: a weekday, any set of periods and the weeks it runs. */
class ArrangementDraft(day: Int, slots: Set<Int>, weeks: List<Int>) {
    var day by mutableIntStateOf(day)
    var slots by mutableStateOf(slots)
    var weeks by mutableStateOf(weeks)

    fun toArrangement() = CourseArrangement(day, slots, weeks)

    fun toggleSlot(slot: Int) {
        slots = if (slot in slots) slots - slot else slots + slot
    }

    fun toggleWeek(week: Int) {
        weeks = if (week in weeks) weeks - week else (weeks + week).sorted()
    }
}

/**
 * Personal course edits. The Web bundle owns the rule engine and the edit
 * endpoints (including CSRF and the concurrent-edit baseline); this model only
 * collects the form and mirrors the replies, exactly like the Web editor.
 *
 * As on iOS, a course takes several meeting times and periods that are not
 * consecutive; they are saved as one existing-format edit item per run of
 * periods, so the other clients read the result unchanged.
 */
class CourseEditorModel(
    private val edit: suspend (JSONObject) -> String?,
    private val scope: CoroutineScope,
    /** Called after a save with the semester and the display priorities the server now holds. */
    private val onSaved: (String, Map<String, Int>?) -> Unit,
) {
    var visible by mutableStateOf(false)
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf("")
        private set
    var name by mutableStateOf("")
    var location by mutableStateOf("")
    var teacher by mutableStateOf("")
    var note by mutableStateOf("")
    /** The first group is the block being edited; more can be added. */
    val arrangements = mutableStateListOf<ArrangementDraft>()
    /** Show this course in front of the ones it overlaps. */
    var preferred by mutableStateOf(false)
    var options by mutableStateOf(listOf<Int>())
        private set
    var hidden by mutableStateOf(listOf<HiddenCourse>())
        private set

    /** The edit session issued by the Web editor; saving is only possible once it exists. */
    var session by mutableStateOf("")
        private set
    var original by mutableStateOf<CourseBlock?>(null)
        private set
    private var semester = ""
    private var defaultWeek = 1
    private var cells: List<ScheduleCell> = emptyList()
    private var period: (Int) -> SchedulePeriod = { BUNDLED_PERIODS[(it - 1).coerceIn(0, BUNDLED_PERIODS.lastIndex)] }

    data class HiddenCourse(val key: String, val label: String)

    fun open(store: ScheduleStore, block: CourseBlock?) {
        val current = store.result ?: return
        reset()
        original = block
        semester = store.selectedSemester
        cells = current.cells
        period = store::periodTime
        name = block?.course?.name.orEmpty()
        location = block?.course?.location.orEmpty()
        teacher = block?.course?.teacher.orEmpty()
        note = block?.course?.editableNote.orEmpty()
        options = store.weekOptions().mapNotNull { it.value.toIntOrNull() }.filter { it in 1..64 }
        defaultWeek = store.selectedWeek.toIntOrNull() ?: options.firstOrNull() ?: 1
        val weeks = when {
            block == null -> listOf(defaultWeek)
            block.course.weekList.isNotEmpty() -> block.course.weekList
            else -> options
        }
        val start = block?.startSlot ?: 1
        arrangements += ArrangementDraft(block?.day ?: store.selectedDay, (start..(block?.endSlot ?: 2)).toSet(), weeks)
        preferred = block != null && SchedulePriority.value(block.course.name, store.displayPriorities) > 0
        visible = true
        submit("open")
    }

    fun prefill(selectedDay: Int, slot: Int) {
        val first = arrangements.firstOrNull() ?: return
        first.day = selectedDay
        first.slots = (slot..(slot + 1).coerceAtMost(SLOT_COUNT)).toSet()
    }

    /** A further meeting time, starting from the last one's weekday and weeks. */
    fun addArrangement() {
        val last = arrangements.lastOrNull()
        arrangements += ArrangementDraft(last?.day ?: 1, emptySet(), last?.weeks ?: listOf(defaultWeek))
    }

    fun cancel() {
        reset()
    }

    private fun reset() {
        visible = false
        busy = false
        error = ""
        session = ""
        original = null
        cells = emptyList()
        hidden = emptyList()
        arrangements.clear()
        preferred = false
    }

    fun slotSummary(draft: ArrangementDraft): String = CourseArrangement.summary(draft.slots, period)

    /**
     * Courses already on the timetable that this group would overlap, other
     * than the block being edited. A hint only: overlapping courses can still
     * be saved.
     */
    fun conflictNames(draft: ArrangementDraft): List<String> {
        val editing = original
        return draft.toArrangement().conflicts(cells) { cell, course ->
            if (editing == null) return@conflicts false
            if (editing.course.customId != null && course.customId == editing.course.customId) return@conflicts true
            val start = course.startSlot ?: (cell.bigSlot * 2 - 1)
            val end = maxOf(start, course.endSlot ?: (cell.bigSlot * 2))
            cell.day == editing.day && course.name == editing.course.name && start <= editing.endSlot && editing.startSlot <= end
        }
    }

    /** Every course some arrangement of this one sits on top of. A priority is per course name, so it cannot rank a course against itself. */
    val overlappingNames: List<String>
        get() {
            val own = name.trim()
            return arrangements.flatMap { conflictNames(it) }.distinct().filter { it != own }
        }

    fun submit(action: String, key: String = "") {
        if (busy) return
        if (action == "save") {
            if (name.isBlank()) {
                error = "请填写课程名称"
                return
            }
            arrangements.forEachIndexed { index, draft ->
                val title = if (arrangements.size > 1) "上课时间 ${index + 1}：" else ""
                if (draft.slots.isEmpty()) {
                    error = title + "请选择至少一节"
                    return
                }
                if (draft.weeks.isEmpty()) {
                    error = title + "请选择至少一个周次"
                    return
                }
            }
        }
        busy = true
        error = ""
        val payload = JSONObject().apply {
            put("action", action)
            put("semester", semester)
            put("session", session)
            put("key", key)
            original?.let { put("original", it.toJson()) }
            put("cells", JSONArray().apply { cells.forEach { put(it.toJson()) } })
            put("form", JSONObject().apply {
                put("name", name)
                put("teacher", teacher)
                put("location", location)
                put("note", note)
                put("arrangements", JSONArray().apply {
                    arrangements.forEach { draft ->
                        put(JSONObject().put("day", draft.day).put("slots", JSONArray(draft.slots.sorted())).put("weekList", JSONArray(draft.weeks)))
                    }
                })
                if (action == "save") put("preferred", preferred)
            })
        }
        val target = semester
        scope.launch {
            val raw = edit(payload)
            busy = false
            val reply = raw?.let { runCatching { JSONObject(it) }.getOrNull() }
            if (reply == null) {
                error = "课程操作失败，请重试"
                return@launch
            }
            val replyError = reply.optString("error").ifEmpty { reply.optString("__error") }
            if (replyError.isNotEmpty()) {
                error = replyError
                return@launch
            }
            val priorities = reply.optJSONObject("priority")?.let { json ->
                json.keys().asSequence().associateWith { json.optInt(it, 0) }.filter { it.value > 0 }
            }
            if (reply.optBoolean("saved", false)) {
                reset()
                onSaved(target, priorities)
                return@launch
            }
            session = reply.optString("session")
            // The server's answer wins over the copy kept on the device.
            if (priorities != null && original != null) preferred = SchedulePriority.value(name, priorities) > 0
            hidden = runCatching {
                val array = reply.optJSONArray("hidden") ?: JSONArray()
                (0 until array.length()).mapNotNull { index ->
                    array.optJSONObject(index)?.let { HiddenCourse(it.optString("key"), it.optString("label")) }
                }
            }.getOrDefault(emptyList())
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun CourseEditorSheet(model: CourseEditorModel, onDismiss: () -> Unit) {
    var confirmingDelete by remember { mutableStateOf(false) }
    if (confirmingDelete) {
        AlertDialog(
            onDismissRequest = { confirmingDelete = false },
            title = { Text(if (model.original?.course?.customId != null) "删除个人课程" else "隐藏课程") },
            text = {
                Text(
                    if (model.original?.course?.customId != null) "这门个人添加的课程会从课表中删除。"
                    else "这只修改你的个人课表，不会改变学校教务记录。",
                )
            },
            confirmButton = {
                TextButton(onClick = { confirmingDelete = false; model.submit("delete") }) { Text("确认") }
            },
            dismissButton = { TextButton(onClick = { confirmingDelete = false }) { Text("取消") } },
        )
    }
    androidx.compose.material3.ModalBottomSheet(
        onDismissRequest = onDismiss,
        // A drag or scrim tap cannot close the sheet mid-save; Back still can.
        sheetState = rememberModalBottomSheetState(
            skipPartiallyExpanded = true,
            confirmValueChange = { it != androidx.compose.material3.SheetValue.Hidden || !model.busy },
        ),
    ) {
        Column(Modifier.fillMaxWidth().imePadding().padding(start = 16.dp, end = 16.dp, bottom = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(if (model.original != null) "编辑课程" else "添加课程",
                    style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                if (model.busy) CircularProgressIndicator(Modifier.width(20.dp).height(20.dp), strokeWidth = 2.dp)
            }
            if (model.error.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                Text(model.error, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
            }
            if (model.busy && model.session.isEmpty()) {
                Spacer(Modifier.height(12.dp))
                Text("正在读取个人课程修改", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(12.dp))
            // Only the form scrolls; the save action keeps its own space even
            // with many teaching weeks, larger text or an open keyboard.
            Column(
                modifier = Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = model.name, onValueChange = { model.name = it },
                    label = { Text("课程名称（必填）") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    enabled = !model.busy, modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(value = model.location, onValueChange = { model.location = it },
                    label = { Text("上课地点") }, singleLine = true, enabled = !model.busy, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = model.teacher, onValueChange = { model.teacher = it },
                    label = { Text("授课教师") }, singleLine = true, enabled = !model.busy, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = model.note, onValueChange = { model.note = it },
                    label = { Text("备注（选填）") }, singleLine = true, enabled = !model.busy, modifier = Modifier.fillMaxWidth())

                model.arrangements.forEachIndexed { index, draft ->
                    ArrangementCard(model, draft, index)
                }
                OutlinedButton(onClick = { model.addArrangement() }, enabled = !model.busy && model.arrangements.size < 12,
                    modifier = Modifier.fillMaxWidth()) { Text("添加上课时间") }

                val overlapping = model.overlappingNames
                if (overlapping.isNotEmpty() || model.preferred) {
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh)
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("优先显示这门课", fontSize = 15.sp)
                            Text(
                                if (overlapping.isEmpty()) "和别的课重叠时，重叠的节次只显示这门课。"
                                else "和${overlapping.joinToString("") { "「$it」" }}重叠的节次只显示这门课，其他课程仍保留在课表里。",
                                fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Spacer(Modifier.width(10.dp))
                        Switch(checked = model.preferred, onCheckedChange = { model.preferred = it }, enabled = !model.busy)
                    }
                }

                if (model.original != null) {
                    Button(
                        onClick = { confirmingDelete = true },
                        enabled = !model.busy,
                        colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer,
                            contentColor = MaterialTheme.colorScheme.onErrorContainer,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(if (model.original?.course?.customId != null) "删除个人课程" else "隐藏这门课程") }
                    if (!model.original?.course?.sourceKey.isNullOrEmpty()) {
                        TextButton(onClick = { model.submit("restore") }, enabled = !model.busy) { Text("恢复教务原始安排") }
                    }
                } else if (model.hidden.isNotEmpty()) {
                    Text("已隐藏课程", style = MaterialTheme.typography.titleSmall)
                    model.hidden.forEach { item ->
                        TextButton(onClick = { model.submit("restoreHidden", item.key) }, enabled = !model.busy) {
                            Text("恢复 · ${item.label}")
                        }
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            Button(
                onClick = { model.submit("save") },
                enabled = !model.busy && model.session.isNotEmpty(),
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) { Text(if (model.busy) "处理中" else "保存课程") }
        }
    }
}

/** One "when it meets" group: weekday, any set of periods and the weeks. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ArrangementCard(model: CourseEditorModel, draft: ArrangementDraft, index: Int) {
    var dayMenu by remember { mutableStateOf(false) }
    val conflicts = model.conflictNames(draft)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (model.arrangements.size > 1) "上课时间 ${index + 1}" else "上课时间", style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.weight(1f))
            if (index > 0) {
                TextButton(onClick = { model.arrangements.remove(draft) }, enabled = !model.busy) {
                    Text("移除", color = MaterialTheme.colorScheme.error)
                }
            }
        }
        SelectField(
            label = "星期", value = WEEKDAY_LABELS[draft.day - 1], expanded = dayMenu,
            options = WEEKDAY_LABELS, onExpanded = { dayMenu = it },
            onSelect = { draft.day = it + 1 }, modifier = Modifier.fillMaxWidth(), enabled = !model.busy,
        )
        Text("节次", style = MaterialTheme.typography.titleSmall)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp),
            maxItemsInEachRow = 6, modifier = Modifier.fillMaxWidth(),
        ) {
            (1..SLOT_COUNT).forEach { slot ->
                EditorChip(slot.toString(), slot in draft.slots, "第${slot}节", !model.busy, Modifier.weight(1f)) { draft.toggleSlot(slot) }
            }
        }
        Text(model.slotSummary(draft), fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("教学周", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Text("已选 ${draft.weeks.size} 周", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        // Shortcuts for the common patterns; the chips below still toggle one week at a time.
        Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            listOf(
                "全部" to model.options,
                "单周" to model.options.filter { it % 2 == 1 },
                "双周" to model.options.filter { it % 2 == 0 },
                "清空" to emptyList(),
            ).forEach { (label, weeks) ->
                TextButton(onClick = { draft.weeks = weeks }, enabled = !model.busy,
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp)) { Text(label) }
            }
        }
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp),
            maxItemsInEachRow = 6, modifier = Modifier.fillMaxWidth(),
        ) {
            model.options.forEach { week ->
                EditorChip(week.toString(), week in draft.weeks, "第${week}周", !model.busy, Modifier.weight(1f)) { draft.toggleWeek(week) }
            }
        }
        if (conflicts.isNotEmpty()) {
            Text("与${conflicts.joinToString("") { "「$it」" }}时间重叠", fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.tertiary)
        }
    }
}

@Composable
private fun EditorChip(label: String, selected: Boolean, description: String, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(10.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh)
            .clickable(enabled = enabled, onClick = onClick)
            .semantics { contentDescription = description; this.selected = selected },
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 13.sp, color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SelectField(
    label: String,
    value: String,
    expanded: Boolean,
    options: List<String>,
    onExpanded: (Boolean) -> Unit,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Box(modifier) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp))
                .clickable(enabled = enabled) { onExpanded(true) }.padding(horizontal = 10.dp, vertical = 8.dp)
                .semantics { contentDescription = label },
        ) {
            Text(label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, fontSize = 14.sp, maxLines = 1)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { onExpanded(false) }) {
            options.forEachIndexed { index, option ->
                DropdownMenuItem(text = { Text(option) }, onClick = {
                    onExpanded(false)
                    onSelect(index)
                })
            }
        }
    }
}
