package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import cn.lizmt.cpuweb.schedule.agenda.AgendaKind
import cn.lizmt.cpuweb.schedule.agenda.AgendaOccurrence
import cn.lizmt.cpuweb.schedule.agenda.AgendaParser
import cn.lizmt.cpuweb.schedule.agenda.AgendaRemind
import cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat
import cn.lizmt.cpuweb.schedule.agenda.AgendaStore
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneOffset
import java.time.temporal.TemporalAdjusters

// region Day entries: courses and the user's own items on one timeline

/** Something on a day's timeline: a class from the timetable or one of the user's own items. */
sealed interface DayEntry {
    val start: String
    val end: String

    data class Course(val course: DashCourse) : DayEntry {
        override val start: String get() = course.start
        override val end: String get() = course.end
    }

    data class Plan(val occurrence: AgendaOccurrence) : DayEntry {
        override val start: String get() = occurrence.item.start
        override val end: String get() = occurrence.item.end
    }
}

/** A day's classes and items: all-day and untimed items first, then everything by time. */
fun dayEntries(day: LocalDate, courses: Map<String, DashDay>, agenda: AgendaStore): List<DayEntry> {
    val plans = agenda.on(day).map { DayEntry.Plan(it) }
    val untimed = plans.filter { it.start.isEmpty() }
    val timed = plans.filter { it.start.isNotEmpty() } + courses[day.toString()]?.courses.orEmpty().map { DayEntry.Course(it) }
    return untimed + timed.sortedBy { it.start }
}

private val WEEKDAY_NAMES = listOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")

fun weekdayName(day: LocalDate): String = WEEKDAY_NAMES[day.dayOfWeek.value - 1]

/** 今天 / 明天 / 后天 / 10月23日 周五, as headers and details say a day. */
fun dayLabel(day: LocalDate, today: LocalDate, withWeekday: Boolean = true): String = when (day) {
    today -> "今天"
    today.plusDays(1) -> "明天"
    today.plusDays(2) -> "后天"
    today.minusDays(1) -> "昨天"
    else -> "${day.monthValue}月${day.dayOfMonth}日" + if (withWeekday) " ${weekdayName(day)}" else ""
}

fun durationText(minutes: Long): String = when {
    minutes >= 60 * 24 -> "${minutes / (60 * 24)} 天"
    minutes >= 60 -> if (minutes % 60 == 0L) "${minutes / 60} 小时" else "${minutes / 60} 小时 ${minutes % 60} 分"
    else -> "$minutes 分钟"
}

/**
 * One timeline row: the time on the left, a thin bar (or a to-do's check),
 * then the title and its details. Finished entries fade.
 */
@Composable
fun DayEntryRow(entry: DayEntry, day: LocalDate, now: LocalDateTime, onToggle: (AgendaOccurrence) -> Unit, onOpen: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val nowMinutes = now.hour * 60 + now.minute
    val startMinutes = AgendaItem.parseTime(entry.start)?.let { it.hour * 60 + it.minute }
    val endMinutes = AgendaItem.parseTime(entry.end)?.let { it.hour * 60 + it.minute } ?: startMinutes?.plus(if (entry is DayEntry.Course) 45 else 0)
    val isToday = day == now.toLocalDate()
    val running = isToday && startMinutes != null && endMinutes != null && nowMinutes in startMinutes until endMinutes
    val done = (entry as? DayEntry.Plan)?.occurrence?.done == true
    val past = done || day.isBefore(now.toLocalDate()) || (isToday && endMinutes != null && nowMinutes >= endMinutes && entry is DayEntry.Course)
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).heightIn(min = 56.dp).padding(start = 16.dp, end = 12.dp, top = 8.dp, bottom = 8.dp)
            .alpha(if (past) 0.5f else 1f),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.width(48.dp)) {
            if (entry.start.isEmpty()) {
                Text(if ((entry as? DayEntry.Plan)?.occurrence?.item?.kind == AgendaKind.Todo) "待办" else "全天",
                    style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant)
            } else {
                Text(entry.start, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold,
                    color = if (running) scheme.primary else scheme.onSurface)
                if (entry.end.isNotEmpty()) Text(entry.end, style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant)
            }
        }
        when (entry) {
            is DayEntry.Course -> Box(Modifier.padding(horizontal = 10.dp).width(3.dp).height(34.dp).clip(CircleShape)
                .background(if (running) scheme.primary else scheme.outlineVariant))
            is DayEntry.Plan -> if (entry.occurrence.item.kind == AgendaKind.Todo) {
                TodoCheck(done, Modifier.padding(end = 0.dp)) { onToggle(entry.occurrence) }
            } else {
                Box(Modifier.padding(horizontal = 10.dp).width(3.dp).height(34.dp).clip(CircleShape).background(scheme.primary.copy(alpha = if (running) 1f else 0.55f)))
            }
        }
        Column(Modifier.weight(1f)) {
            val title = when (entry) {
                is DayEntry.Course -> entry.course.name
                is DayEntry.Plan -> entry.occurrence.item.title
            }
            Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis,
                fontWeight = if (running) FontWeight.SemiBold else FontWeight.Normal,
                textDecoration = if (done) TextDecoration.LineThrough else null)
            val details = when (entry) {
                is DayEntry.Course -> listOf(entry.course.location, entry.course.teacher)
                is DayEntry.Plan -> listOf(entry.occurrence.item.location, entry.occurrence.item.note.lineSequence().firstOrNull().orEmpty())
            }.filter { it.isNotBlank() }
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (entry is DayEntry.Plan && entry.occurrence.item.repeat != AgendaRepeat.None) {
                    Icon(Icons.Rounded.Repeat, contentDescription = entry.occurrence.item.repeat.title, tint = scheme.onSurfaceVariant, modifier = Modifier.size(12.dp))
                    Spacer(Modifier.width(3.dp))
                }
                if (details.isNotEmpty()) {
                    Text(details.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                } else if (running && endMinutes != null) {
                    Text("还剩 ${durationText((endMinutes - nowMinutes).toLong())}", style = MaterialTheme.typography.bodySmall, color = scheme.primary)
                }
            }
        }
    }
}

/** The tap target at the end of a list that starts a new item. */
@Composable
fun AddRow(label: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 48.dp).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Add, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Text(label, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary)
    }
}

// endregion

// region Editor

/** A blank item for [day]: an event when a day is given, else an undated to-do. */
fun newAgendaDraft(day: LocalDate?, kind: AgendaKind = if (day != null) AgendaKind.Event else AgendaKind.Todo): AgendaItem =
    AgendaItem(id = "", kind = kind, title = "", date = day?.toString().orEmpty())

/**
 * Adds or edits an item. For a new one the first line reads what the user
 * writes (「周五 14:00 组会 @药学楼」) and fills the fields below until they
 * change one themselves.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgendaEditorSheet(activity: MainActivity, draft: AgendaItem, onDismiss: () -> Unit) {
    val isNew = draft.id.isEmpty()
    var text by remember(draft) { mutableStateOf(draft.title) }
    var manual by remember(draft) { mutableStateOf(draft) }
    var touched by remember(draft) { mutableStateOf(!isNew) }
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
    var pickingDate by remember { mutableStateOf(false) }
    var pickingTime by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (isNew) runCatching { focus.requestFocus() } }
    val scheme = MaterialTheme.colorScheme
    val today = LocalDate.now()

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = scheme.background) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 24.dp).imePadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (isNew) "新建" else "编辑", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                Segmented(listOf(AgendaKind.Event to "日程", AgendaKind.Todo to "待办"), shown.kind, Modifier.width(150.dp)) { kind ->
                    edit { it.copy(kind = kind, date = if (kind == AgendaKind.Event && it.date.isEmpty()) today.toString() else it.date) }
                }
            }
            Panel {
                BasicTextField(
                    value = text,
                    onValueChange = { value ->
                        text = value.take(120)
                        if (touched) manual = manual.copy(title = text)
                    },
                    textStyle = MaterialTheme.typography.titleMedium.copy(color = scheme.onSurface),
                    cursorBrush = SolidColor(scheme.primary),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus).padding(16.dp),
                    decorationBox = { field ->
                        Box {
                            if (text.isEmpty()) Text(if (isNew) "写下要做的事，例如「周五 14:00 组会 @药学楼」" else "标题",
                                style = MaterialTheme.typography.titleMedium, color = scheme.onSurfaceVariant)
                            field()
                        }
                    },
                )
                if (parsed != null) {
                    Hairline()
                    Text("会记作「${parsed.title}」，日期和时间已从文字里读出，可在下面修改",
                        style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                }
            }
            val date = AgendaItem.parseDate(shown.date)
            Panel {
                ListRow("日期", value = date?.let { dayLabel(it, today) } ?: "不设日期", chevron = true, onClick = { pickingDate = true })
                Hairline()
                if (shown.kind == AgendaKind.Event) {
                    ToggleRow("全天", checked = shown.start.isEmpty(), enabled = date != null) { allDay ->
                        edit { it.copy(start = if (allDay) "" else it.start.ifEmpty { "09:00" }, end = if (allDay) "" else it.end) }
                    }
                } else {
                    ToggleRow("设定时间", checked = shown.start.isNotEmpty(), enabled = date != null) { timed ->
                        edit { it.copy(start = if (timed) it.start.ifEmpty { "18:00" } else "") }
                    }
                }
                if (shown.start.isNotEmpty()) {
                    Hairline()
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(if (shown.kind == AgendaKind.Todo) "截止" else "时间", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                        ChoicePill(shown.start, selected = true) { pickingTime = "start" }
                        if (shown.kind == AgendaKind.Event) {
                            Text("至", color = scheme.onSurfaceVariant)
                            ChoicePill(shown.end.ifEmpty { "结束" }, selected = shown.end.isNotEmpty()) { pickingTime = "end" }
                        }
                    }
                }
            }
            Panel("提醒") {
                PillChoices(AgendaRemind.choices.filter { date != null || it.first == AgendaRemind.NONE }, shown.remind, Modifier.padding(12.dp)) { value ->
                    edit { it.copy(remind = value) }
                }
            }
            if (date != null) {
                Panel("重复") {
                    PillChoices(AgendaRepeat.entries.map { it to it.title }, shown.repeat, Modifier.padding(12.dp)) { value -> edit { it.copy(repeat = value) } }
                }
            }
            Panel {
                PlainField(shown.location, "地点") { value -> edit { it.copy(location = value.take(40)) } }
                Hairline()
                PlainField(shown.note, "备注", singleLine = false) { value -> edit { it.copy(note = value.take(1_000)) } }
            }
            Button(
                onClick = {
                    val item = (if (touched) manual.copy(title = manual.title.ifBlank { text }) else (parsed ?: manual).copy(title = parsed?.title ?: text))
                        .copy(id = draft.id, createdAt = draft.createdAt, done = draft.done, doneDates = draft.doneDates, origin = draft.origin)
                    if (activity.saveAgenda(item) != null) onDismiss() else activity.toast("先写个标题；日程还需要日期")
                },
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(LocalCpuLook.current.radius(12.dp)),
                enabled = text.isNotBlank(),
            ) { Text(if (isNew) "添加" else "保存") }
            if (!isNew) {
                TextButton(onClick = { confirmDelete = true }, modifier = Modifier.fillMaxWidth()) { Text("删除", color = scheme.error) }
            }
        }
    }

    if (pickingDate) {
        val initial = AgendaItem.parseDate(shown.date) ?: today
        val state = rememberDatePickerState(initialSelectedDateMillis = initial.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
        DatePickerDialog(
            onDismissRequest = { pickingDate = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { millis ->
                        val picked = LocalDate.ofEpochDay(Math.floorDiv(millis, 86_400_000L))
                        edit { it.copy(date = picked.toString()) }
                    }
                    pickingDate = false
                }) { Text("确定") }
            },
            dismissButton = {
                Row {
                    if (shown.kind == AgendaKind.Todo) TextButton(onClick = {
                        edit { it.copy(date = "", start = "", remind = AgendaRemind.NONE, repeat = AgendaRepeat.None) }
                        pickingDate = false
                    }) { Text("不设日期") }
                    TextButton(onClick = { pickingDate = false }) { Text("取消") }
                }
            },
        ) { DatePicker(state = state, title = null, headline = null, showModeToggle = false) }
    }
    pickingTime?.let { which ->
        val initial = AgendaItem.parseTime(if (which == "start") shown.start else shown.end.ifEmpty { shown.start })
            ?.let { if (which == "end" && shown.end.isEmpty()) it.plusHours(1) else it } ?: LocalTime.of(9, 0)
        val state = rememberTimePickerState(initialHour = initial.hour, initialMinute = initial.minute, is24Hour = true)
        AlertDialog(
            onDismissRequest = { pickingTime = null },
            confirmButton = {
                TextButton(onClick = {
                    val value = "%02d:%02d".format(state.hour, state.minute)
                    edit { if (which == "start") it.copy(start = value, end = it.end.takeIf { e -> e > value }.orEmpty()) else it.copy(end = value) }
                    pickingTime = null
                }) { Text("确定") }
            },
            dismissButton = {
                Row {
                    if (which == "end" && shown.end.isNotEmpty()) TextButton(onClick = { edit { it.copy(end = "") }; pickingTime = null }) { Text("不设结束") }
                    TextButton(onClick = { pickingTime = null }) { Text("取消") }
                }
            },
            text = { TimePicker(state = state) },
        )
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("删除「${draft.title}」？") },
            text = { if (draft.repeat != AgendaRepeat.None) Text("这是重复的${draft.kind.title}，所有日子的都会删除。") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    activity.removeAgenda(draft.id)
                    onDismiss()
                }) { Text("删除", color = scheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("取消") } },
        )
    }
}

/** A borderless text field on a panel row. */
@Composable
fun PlainField(value: String, placeholder: String, singleLine: Boolean = true, onChange: (String) -> Unit) {
    val scheme = MaterialTheme.colorScheme
    BasicTextField(
        value = value, onValueChange = onChange, singleLine = singleLine,
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = scheme.onSurface),
        cursorBrush = SolidColor(scheme.primary),
        modifier = Modifier.fillMaxWidth().heightIn(min = if (singleLine) 48.dp else 88.dp).padding(horizontal = 16.dp, vertical = 13.dp),
        decorationBox = { field ->
            Box {
                if (value.isEmpty()) Text(placeholder, style = MaterialTheme.typography.bodyLarge, color = scheme.onSurfaceVariant)
                field()
            }
        },
    )
}

// endregion

// region Agenda page

/** 日程: a week strip, the chosen day's classes and items, and the open to-dos. */
@Composable
fun AgendaScreen(activity: MainActivity) {
    val agenda = activity.agenda
    val context = LocalContext.current
    val today = LocalDate.now()
    var selected by remember { mutableStateOf(activity.agendaFocus ?: today) }
    LaunchedEffect(activity.agendaFocus) { activity.agendaFocus?.let { selected = it; activity.agendaFocus = null } }
    var editing by remember { mutableStateOf<AgendaItem?>(null) }
    val schedule = activity.schedule
    val record = remember(schedule.dataRevision, schedule.result) { schedule.widgetLocalRecord() ?: ScheduleWidgetLocalDays.read(context) }
    val courses = remember(record) { DashboardSchedule.days(record) }
    var now by remember { mutableStateOf(LocalDateTime.now()) }
    LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(30_000); now = LocalDateTime.now() } }
    val monday = selected.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    var drag by remember { mutableIntStateOf(0) }

    LazyColumn(
        Modifier.fillMaxSize().consumesTouches().background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item("title") {
            LargeTitle("${selected.monthValue}月", subtitle = if (selected.year != today.year) "${selected.year} 年" else null) {
                if (selected != today) TextButton(onClick = { selected = today }) { Text("今天") }
                IconButton(onClick = { editing = newAgendaDraft(selected) }) { Icon(Icons.Rounded.Add, contentDescription = "新建日程") }
            }
        }
        item("week") {
            Row(
                Modifier.fillMaxWidth().pointerInput(Unit) {
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            if (drag < -60) selected = selected.plusWeeks(1) else if (drag > 60) selected = selected.minusWeeks(1)
                            drag = 0
                        },
                        onHorizontalDrag = { change, amount -> change.consume(); drag += amount.toInt() },
                    )
                },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { selected = selected.minusWeeks(1) }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, contentDescription = "上一周", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                (0..6).forEach { offset ->
                    val day = monday.plusDays(offset.toLong())
                    val busy = courses[day.toString()]?.courses?.isNotEmpty() == true || agenda.on(day).isNotEmpty()
                    WeekDayCell(day, selected = day == selected, isToday = day == today, busy = busy, modifier = Modifier.weight(1f)) { selected = day }
                }
                IconButton(onClick = { selected = selected.plusWeeks(1) }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = "下一周", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item("day") {
            val entries = dayEntries(selected, courses, agenda)
            Panel(dayLabel(selected, today) + if (selected == today || selected == today.plusDays(1)) " · ${weekdayName(selected)}" else "") {
                if (entries.isEmpty()) {
                    Text(if (courses.isEmpty() && selected >= today) "没有安排（课表加载后这里也会显示课程）" else "没有安排",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp))
                }
                entries.forEachIndexed { index, entry ->
                    if (index > 0) Hairline(start = 64.dp)
                    DayEntryRow(entry, selected, now, onToggle = { activity.toggleAgenda(it) }) {
                        when (entry) {
                            is DayEntry.Course -> activity.shell.openSchedule(null, null)
                            is DayEntry.Plan -> editing = entry.occurrence.item
                        }
                    }
                }
                Hairline()
                AddRow("添加到${dayLabel(selected, today, withWeekday = false)}") { editing = newAgendaDraft(selected) }
            }
        }
        item("todos") {
            val todos = agenda.items.filter { it.kind == AgendaKind.Todo && !it.dated && !it.done }
            Panel("没有日期的待办") {
                todos.forEachIndexed { index, item ->
                    if (index > 0) Hairline(start = 56.dp)
                    Row(Modifier.fillMaxWidth().clickable { editing = item }.padding(start = 4.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        TodoCheck(false) { activity.toggleAgenda(AgendaOccurrence(item, today)) }
                        Text(item.title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f).padding(vertical = 14.dp), maxLines = 2)
                    }
                }
                if (todos.isNotEmpty()) Hairline()
                AddRow("添加待办") { editing = newAgendaDraft(null) }
            }
        }
        item("hint") {
            Text("日程和待办只存在这台手机上；需要提醒时会在通知栏提示。",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp))
        }
    }
    editing?.let { draft -> AgendaEditorSheet(activity, draft) { editing = null } }
}

@Composable
private fun WeekDayCell(day: LocalDate, selected: Boolean, isToday: Boolean, busy: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    Column(modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(weekdayName(day).takeLast(1), style = MaterialTheme.typography.labelSmall, color = scheme.onSurfaceVariant)
        Spacer(Modifier.height(4.dp))
        Box(
            Modifier.size(34.dp).clip(CircleShape).background(
                when {
                    selected -> scheme.onSurface
                    else -> androidx.compose.ui.graphics.Color.Transparent
                },
            ),
            contentAlignment = Alignment.Center,
        ) {
            Text(day.dayOfMonth.toString(), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
                color = when {
                    selected -> scheme.surface
                    isToday -> scheme.primary
                    else -> scheme.onSurface
                })
        }
        Spacer(Modifier.height(3.dp))
        Box(Modifier.size(4.dp).clip(CircleShape).background(if (busy) scheme.onSurfaceVariant.copy(alpha = 0.6f) else androidx.compose.ui.graphics.Color.Transparent))
    }
}

// endregion
