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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import cn.lizmt.cpuweb.schedule.agenda.AgendaKind
import cn.lizmt.cpuweb.schedule.agenda.AgendaOccurrence
import cn.lizmt.cpuweb.schedule.agenda.AgendaParser
import cn.lizmt.cpuweb.schedule.agenda.AgendaRemind
import cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset

/** What [MainActivity.openAgenda] asks the timetable to show: one item, a new one, or the [list]. */
data class AgendaRequest(val id: String = "", val date: String = "", val start: String = "", val list: Boolean = false)

/** A blank 日程 on [date] (`yyyy-MM-dd`, empty for one without a day) starting at [start]. */
internal fun newAgendaDraft(date: String, start: String = ""): AgendaItem =
    AgendaItem(id = "", kind = AgendaKind.Event, title = "", date = date, start = if (date.isEmpty()) "" else start)

private val AGENDA_WEEKDAYS = listOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")

/** 今天 / 明天 / 昨天 / 10月23日, with the weekday after a date when [weekday]. */
internal fun agendaDayLabel(day: LocalDate, today: LocalDate = LocalDate.now(), weekday: Boolean = false): String {
    val name = when (day) {
        today -> "今天"
        today.plusDays(1) -> "明天"
        today.minusDays(1) -> "昨天"
        else -> "${day.monthValue}月${day.dayOfMonth}日"
    }
    return if (weekday) "$name · ${AGENDA_WEEKDAYS[day.dayOfWeek.value - 1]}" else name
}

/**
 * Adds or edits one 日程 inside the timetable, with the fields of the Web
 * editor. For a new one the first field reads what the user writes
 * (「周五 14:00 组会 @药学楼」) and fills the fields below until one is changed
 * by hand. Saving goes through the page and waits for its answer.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun AgendaEditorSheet(remote: AgendaRemote, draft: AgendaItem, onDismiss: () -> Unit) {
    val isNew = draft.id.isEmpty()
    var text by remember(draft) { mutableStateOf(draft.title) }
    var manual by remember(draft) { mutableStateOf(draft) }
    var touched by remember(draft) { mutableStateOf(!isNew) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var pickingDate by remember { mutableStateOf<String?>(null) }
    var confirmingDelete by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val now = remember { LocalDateTime.now() }
    // What the text says, when it says more than a title: a day, a time, a repeat, a reminder or a place.
    val parsed = remember(text, touched) {
        if (touched || text.isBlank()) null
        else AgendaParser.parse(text, now).takeIf {
            it.date.isNotEmpty() || it.start.isNotEmpty() || it.remind >= 0 || it.repeat != AgendaRepeat.None || it.location.isNotEmpty()
        }?.let { result -> result.copy(date = result.date.ifEmpty { draft.date }) }
    }
    val shown = parsed ?: manual.copy(title = text)
    // A field changed by hand: the text stops steering the form.
    val edit = { change: (AgendaItem) -> AgendaItem ->
        val base = if (!touched) (parsed ?: manual).copy(title = parsed?.title ?: text) else manual
        if (!touched) text = base.title
        manual = change(base)
        touched = true
    }
    val date = AgendaItem.parseDate(shown.date)

    fun save() {
        val item = shown.copy(title = shown.title.ifBlank { text }.trim(), id = draft.id, createdAt = draft.createdAt,
            done = draft.done, doneDates = draft.doneDates, origin = draft.origin)
        if (item.title.isEmpty()) {
            error = "先写个标题"
            return
        }
        busy = true
        error = ""
        scope.launch {
            remote.save(item).onSuccess { onDismiss() }.onFailure { error = it.message.orEmpty() }
            busy = false
        }
    }

    if (confirmingDelete) {
        AlertDialog(
            onDismissRequest = { confirmingDelete = false },
            title = { Text("删除「${draft.title}」？") },
            text = { Text(if (draft.repeat != AgendaRepeat.None) "这是重复的日程，所有日子的都会删除。" else "删除后其他设备上也会删除。") },
            confirmButton = {
                TextButton(onClick = {
                    confirmingDelete = false
                    busy = true
                    error = ""
                    scope.launch {
                        remote.remove(draft.id).onSuccess { onDismiss() }.onFailure { error = it.message.orEmpty() }
                        busy = false
                    }
                }) { Text("删除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmingDelete = false }) { Text("取消") } },
        )
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { it != SheetValue.Hidden || !busy }),
    ) {
        Column(Modifier.fillMaxWidth().imePadding().padding(start = 16.dp, end = 16.dp, bottom = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(if (isNew) "新建日程" else "编辑日程", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f))
                if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            }
            if (error.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                Text(error, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
            }
            Spacer(Modifier.height(12.dp))
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = text,
                    onValueChange = { value ->
                        text = value.take(120)
                        if (touched) manual = manual.copy(title = text)
                    },
                    label = { Text(if (isNew) "要做的事" else "标题") },
                    placeholder = if (isNew) ({ Text("例如「周五 14:00 组会 @药学楼」") }) else null,
                    singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { if (!busy) save() }),
                )
                if (parsed != null) {
                    Text("会记作「${parsed.title}」，日期和时间已从文字里读出，可在下面修改",
                        fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    AgendaField("日期", date?.let { agendaDayLabel(it, weekday = true) } ?: "不设日期", !busy, Modifier.weight(1f)) {
                        pickingDate = "date"
                    }
                    Row(
                        Modifier.weight(1f).heightIn(min = 52.dp).clip(RoundedCornerShape(8.dp))
                            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp)).padding(start = 10.dp, end = 6.dp)
                            .alpha(if (date == null) 0.5f else 1f),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("设定时间", fontSize = 14.sp, modifier = Modifier.weight(1f))
                        Switch(checked = shown.start.isNotEmpty(), enabled = date != null && !busy, onCheckedChange = { timed ->
                            edit { it.copy(start = if (timed) it.start.ifEmpty { "09:00" } else "", end = if (timed) it.end else "") }
                        })
                    }
                }
                if (shown.start.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        TimeField("开始", shown.start, !busy, Modifier.weight(1f)) { value ->
                            edit { it.copy(start = value, end = it.end.takeIf { end -> end > value }.orEmpty()) }
                        }
                        TimeField("结束（选填）", shown.end, !busy, Modifier.weight(1f)) { value ->
                            edit { it.copy(end = value.takeIf { end -> end > it.start }.orEmpty()) }
                        }
                    }
                    if (shown.end.isNotEmpty()) {
                        TextButton(onClick = { edit { it.copy(end = "") } }, enabled = !busy) { Text("不设结束时间") }
                    }
                }
                Text("提醒", style = MaterialTheme.typography.titleSmall)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.fillMaxWidth()) {
                    AgendaRemind.choices.forEach { (value, label) ->
                        AgendaChip(label, shown.remind == value, !busy && (date != null || value == AgendaRemind.NONE)) {
                            edit { it.copy(remind = value) }
                        }
                    }
                }
                if (date != null) {
                    Text("重复", style = MaterialTheme.typography.titleSmall)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.fillMaxWidth()) {
                        AgendaRepeat.entries.forEach { repeat ->
                            AgendaChip(repeat.title, shown.repeat == repeat, !busy) { edit { it.copy(repeat = repeat) } }
                        }
                    }
                    if (shown.repeat != AgendaRepeat.None) {
                        AgendaField("重复到", AgendaItem.parseDate(shown.until)?.let { agendaDayLabel(it, weekday = true) } ?: "一直重复", !busy,
                            Modifier.fillMaxWidth()) { pickingDate = "until" }
                    }
                }
                OutlinedTextField(value = shown.location, onValueChange = { value -> edit { it.copy(location = value.take(40)) } },
                    label = { Text("地点") }, singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = shown.note, onValueChange = { value -> edit { it.copy(note = value.take(1_000)) } },
                    label = { Text("备注") }, minLines = 2, enabled = !busy, modifier = Modifier.fillMaxWidth())
                if (!isNew) {
                    TextButton(onClick = { confirmingDelete = true }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                        Text("删除这条日程", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            Button(onClick = ::save, enabled = !busy && text.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(if (busy) "处理中" else if (isNew) "添加" else "保存")
            }
        }
    }

    pickingDate?.let { which ->
        val current = AgendaItem.parseDate(if (which == "until") shown.until else shown.date)
        val initial = current ?: date ?: LocalDate.now()
        val state = rememberDatePickerState(initialSelectedDateMillis = initial.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
        DatePickerDialog(
            onDismissRequest = { pickingDate = null },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { millis ->
                        val picked = LocalDate.ofEpochDay(Math.floorDiv(millis, 86_400_000L)).toString()
                        edit { if (which == "until") it.copy(until = picked.takeIf { day -> day >= it.date }.orEmpty()) else it.copy(date = picked) }
                    }
                    pickingDate = null
                }) { Text("确定") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = {
                        edit {
                            if (which == "until") it.copy(until = "")
                            else it.copy(date = "", start = "", end = "", remind = AgendaRemind.NONE, repeat = AgendaRepeat.None, until = "")
                        }
                        pickingDate = null
                    }) { Text(if (which == "until") "一直重复" else "不设日期") }
                    TextButton(onClick = { pickingDate = null }) { Text("取消") }
                }
            },
        ) { DatePicker(state = state, title = null, headline = null, showModeToggle = false) }
    }
}

/**
 * 日程与待办, from the timetable's menu: a line to jot one down, the to-dos
 * still open (past their day, or without one), the next seven days and the
 * 微信和 QQ 也提醒 switch. A day's items are on the timetable itself.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AgendaListSheet(remote: AgendaRemote, onEdit: (AgendaItem) -> Unit, onNew: (String) -> Unit, onDismiss: () -> Unit) {
    val today = LocalDate.now()
    val scope = rememberCoroutineScope()
    var quick by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    val preview = remember(quick) { quick.trim().takeIf { it.isNotEmpty() }?.let { AgendaParser.parse(it, LocalDateTime.now()) } }

    fun quickAdd() {
        val item = preview ?: return
        busy = true
        message = ""
        scope.launch {
            remote.save(item).onSuccess { saved ->
                quick = ""
                message = AgendaItem.parseDate(saved.date)?.let { "已添加到${agendaDayLabel(it)}" } ?: "已添加到待办"
            }.onFailure { message = it.message.orEmpty() }
            busy = false
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("日程与待办", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            if (!remote.available) {
                Text("登录后就能记日程，并在课表里看到它们。", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                return@Column
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = quick, onValueChange = { quick = it.take(120) }, singleLine = true, enabled = !busy,
                    placeholder = { Text("一句话记下，例如「明天下午3点 实验报告」", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { if (!busy) quickAdd() }),
                    modifier = Modifier.weight(1f),
                )
                Button(onClick = ::quickAdd, enabled = !busy && preview != null) { Text("添加") }
            }
            val hint = preview?.let { draft ->
                val day = AgendaItem.parseDate(draft.date)
                "会记作「${draft.title}」：" + listOfNotNull(
                    day?.let { agendaDayLabel(it) } ?: "不设日期",
                    draft.start.takeIf { it.isNotEmpty() }?.let { if (draft.end.isNotEmpty()) "$it–${draft.end}" else it },
                    draft.repeat.takeIf { it != AgendaRepeat.None }?.title,
                    "提醒".takeIf { draft.remind >= 0 },
                    draft.location.takeIf { it.isNotEmpty() }?.let { "@$it" },
                ).joinToString(" · ")
            } ?: message
            if (hint.isNotEmpty()) Text(hint, fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)

            AgendaSection("待办") {
                val todos = openTodos(remote.items, today)
                if (todos.isEmpty()) AgendaEmpty("没有待办")
                todos.forEach { item ->
                    val day = AgendaItem.parseDate(item.date)
                    AgendaListRow(
                        time = day?.let { agendaDayLabel(it, today) }.orEmpty(), late = day != null, done = false,
                        title = item.title, detail = if (day != null) "已过日期，还没完成" else "",
                        onToggle = { remote.toggle(AgendaOccurrence(item, day ?: today)) }, onOpen = { onEdit(item) },
                    )
                }
                AgendaAddRow("添加不设日期的待办") { onNew("") }
            }
            AgendaSection("接下来一周") {
                val days = (0L..6L).map { today.plusDays(it) }.map { it to remote.on(it) }.filter { it.second.isNotEmpty() }
                if (days.isEmpty()) AgendaEmpty("接下来一周没有安排")
                days.forEach { (day, entries) ->
                    Text(agendaDayLabel(day, today, weekday = true), fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp, bottom = 2.dp))
                    entries.forEach { occurrence ->
                        val item = occurrence.item
                        AgendaListRow(
                            time = if (!item.timed) "全天" else if (item.end.isNotEmpty()) "${item.start}–${item.end}" else item.start,
                            late = false, done = occurrence.done, title = item.title,
                            detail = listOf(item.location, item.repeat.takeIf { it != AgendaRepeat.None }?.title.orEmpty()).filter { it.isNotBlank() }.joinToString(" · "),
                            onToggle = { remote.toggle(occurrence) }, onOpen = { onEdit(item) },
                        )
                    }
                }
                AgendaAddRow("添加到今天") { onNew(today.toString()) }
            }
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("微信和 QQ 也提醒", fontSize = 15.sp)
                    Text("设了提醒的日程到点时，服务器发一条站内通知，并转到你绑定的微信和 QQ；这台手机也会在通知栏提醒。",
                        fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.width(10.dp))
                Switch(checked = remote.relay, onCheckedChange = remote::updateRelay)
            }
            Text("网页、手机 App 和药大拾间 NEXT 用的是同一份日程，在哪里改都会同步。",
                fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** What is still to do: undated to-dos and dated ones whose day has passed unticked (Web `agendaOpen`). */
internal fun openTodos(items: List<AgendaItem>, today: LocalDate): List<AgendaItem> {
    val candidates = items.filter { it.repeat == AgendaRepeat.None && !it.done }
    val overdue = candidates.filter { !it.timed && AgendaItem.parseDate(it.date)?.isBefore(today) == true }.sortedBy { it.date }
    return overdue + candidates.filter { !it.dated }.sortedBy { it.createdAt }
}

/** Where to add from an empty period: a 日程 at its start, or a course in it. */
@Composable
internal fun AddSlotChoiceDialog(label: String, canAddCourse: Boolean, onAgenda: () -> Unit, onCourse: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(label) },
        text = {
            Column {
                AgendaAddRow("添加日程", onAgenda)
                if (canAddCourse) AgendaAddRow("添加课程", onCourse)
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun AgendaSection(title: String, content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(bottom = 2.dp))
        content()
    }
}

@Composable
private fun AgendaEmpty(text: String) {
    Text(text, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 8.dp))
}

@Composable
private fun AgendaListRow(time: String, late: Boolean, done: Boolean, title: String, detail: String, onToggle: () -> Unit, onOpen: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    Column {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onOpen).heightIn(min = 46.dp).alpha(if (done) 0.55f else 1f),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(time, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
                color = if (late) scheme.error else scheme.onSurface, modifier = Modifier.width(84.dp))
            Box(
                Modifier.size(32.dp).clip(CircleShape).clickable(onClick = onToggle)
                    .semantics { contentDescription = if (done) "标为未完成" else "标为完成" },
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier.size(18.dp).clip(CircleShape)
                        .then(if (done) Modifier.background(scheme.primary) else Modifier.border(1.5.dp, scheme.onSurfaceVariant, CircleShape)),
                    contentAlignment = Alignment.Center,
                ) {
                    if (done) Icon(Icons.Rounded.Check, contentDescription = null, tint = scheme.onPrimary, modifier = Modifier.size(12.dp))
                }
            }
            Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
                Text(title, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    textDecoration = if (done) TextDecoration.LineThrough else null)
                if (detail.isNotEmpty()) Text(detail, fontSize = 12.sp, color = scheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        HorizontalDivider(color = scheme.outlineVariant.copy(alpha = 0.6f))
    }
}

@Composable
private fun AgendaAddRow(label: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick).heightIn(min = 44.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Add, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Text(label, fontSize = 15.sp, color = MaterialTheme.colorScheme.primary)
    }
}

/** A labelled value in the course editor's outlined look; a tap picks it. */
@Composable
private fun AgendaField(label: String, value: String, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier.heightIn(min = 52.dp).clip(RoundedCornerShape(8.dp))
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, onClick = onClick).padding(horizontal = 10.dp, vertical = 8.dp)
            .semantics { contentDescription = "$label，$value" },
    ) {
        Text(label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontSize = 14.sp, maxLines = 1)
    }
}

@Composable
private fun AgendaChip(label: String, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    Box(
        Modifier.heightIn(min = 36.dp).clip(RoundedCornerShape(10.dp))
            .background(if (selected) scheme.primary else scheme.surfaceContainerHigh)
            .clickable(enabled = enabled, onClick = onClick).alpha(if (enabled || selected) 1f else 0.45f)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 13.sp, color = if (selected) scheme.onPrimary else scheme.onSurface)
    }
}
