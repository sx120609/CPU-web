package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import cn.lizmt.cpuweb.schedule.agenda.AgendaKind
import cn.lizmt.cpuweb.schedule.agenda.AgendaOccurrence
import cn.lizmt.cpuweb.schedule.agenda.AgendaStore
import cn.lizmt.cpuweb.schedule.custom.DashboardCard
import cn.lizmt.cpuweb.schedule.custom.DashboardCards
import cn.lizmt.cpuweb.schedule.custom.DestinationCatalog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit

// region Data

/** A course on one dated day, as the widgets' local timetable records it. */
data class DashCourse(val name: String, val location: String, val teacher: String, val start: String, val end: String)

data class DashDay(val date: String, val label: String, val week: Int?, val courses: List<DashCourse>)

data class FeedItem(val id: String, val title: String, val meta: String)

/** Announcements and the hot list, read through the signed-in page so forum visibility matches the site. */
class DashboardFeeds(private val web: WebSession, private val scope: CoroutineScope) {
    var announcements by mutableStateOf<List<FeedItem>>(emptyList())
        private set
    var hot by mutableStateOf<List<FeedItem>>(emptyList())
        private set
    var loading by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set
    private var loadedAt = 0L

    fun refresh(force: Boolean = false) {
        if (loading || (!force && System.currentTimeMillis() - loadedAt < 10 * 60_000)) return
        loading = true
        scope.launch {
            val raw = web.call(FETCH_SCRIPT, timeoutMs = 20_000)
            val payload = raw?.let { runCatching { JSONObject(it) }.getOrNull() }
            if (payload != null && !payload.has("__error")) {
                announcements = items(payload, "announce")
                hot = items(payload, "hot")
                loadedAt = System.currentTimeMillis()
                failed = false
            } else {
                failed = true
            }
            loading = false
        }
    }

    private fun items(payload: JSONObject, key: String): List<FeedItem> {
        val array = payload.optJSONArray(key) ?: return emptyList()
        return (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val id = item.optString("id").takeIf { it.matches(Regex("^\\d{1,12}$")) } ?: return@mapNotNull null
            val title = item.optString("title").trim().takeIf { it.isNotEmpty() } ?: return@mapNotNull null
            FeedItem(id, title, item.optString("board"))
        }
    }

    companion object {
        private const val FETCH_SCRIPT =
            "var get=async function(p){var r=await fetch(p,{credentials:'same-origin',headers:{'Accept':'application/json','X-CPU-Client':'android-app'}});" +
                "if(!r.ok)return null;var j=await r.json();return j&&j.code===0?j.data:null;};" +
                "var s=await get('/api/home/summary');var h=await get('/api/home/hot-ranking');" +
                "var pick=function(t){return {id:String(t&&t.id||''),title:String(t&&t.title||''),board:String(t&&t.board&&t.board.name||'')};};" +
                "return {announce:((s&&s.announce)||[]).slice(0,5).map(pick),hot:(Array.isArray(h)?h:[]).slice(0,6).map(pick)};"
    }
}

object DashboardSchedule {
    fun days(record: JSONObject?): Map<String, DashDay> {
        val days = record?.optJSONArray("days") ?: return emptyMap()
        val result = LinkedHashMap<String, DashDay>()
        for (index in 0 until days.length()) {
            val day = days.optJSONObject(index) ?: continue
            val date = day.optString("date")
            if (date.length != 10) continue
            val courses = day.optJSONArray("courses")
            val list = (0 until (courses?.length() ?: 0)).mapNotNull { position ->
                val course = courses!!.optJSONObject(position) ?: return@mapNotNull null
                DashCourse(
                    name = course.optString("name"),
                    location = course.optString("location").takeIf { it != "null" }.orEmpty(),
                    teacher = course.optString("teacher").takeIf { it != "null" }.orEmpty(),
                    start = course.optString("startTime"),
                    end = course.optString("endTime"),
                )
            }.filter { it.name.isNotBlank() }.sortedBy { it.start }
            result[date] = DashDay(date, day.optString("label"), day.opt("week")?.toString()?.toIntOrNull(), list)
        }
        return result
    }

    fun minutes(time: String): Int? = AgendaItem.parseTime(time)?.let { it.hour * 60 + it.minute }
}

/** What comes next today or tomorrow: a class or a timed event, and whether it is under way. */
data class NextUp(val title: String, val place: String, val start: LocalDateTime, val end: LocalDateTime?, val running: Boolean, val isCourse: Boolean)

fun nextUp(now: LocalDateTime, courses: Map<String, DashDay>, agenda: AgendaStore): NextUp? {
    for (offset in 0L..1L) {
        val day = now.toLocalDate().plusDays(offset)
        for (entry in dayEntries(day, courses, agenda)) {
            if (entry is DayEntry.Plan && entry.occurrence.done) continue
            val startTime = AgendaItem.parseTime(entry.start) ?: continue
            val start = LocalDateTime.of(day, startTime)
            val end = AgendaItem.parseTime(entry.end)?.let { LocalDateTime.of(day, it) }
            val title: String
            val place: String
            when (entry) {
                is DayEntry.Course -> { title = entry.course.name; place = entry.course.location }
                is DayEntry.Plan -> { title = entry.occurrence.item.title; place = entry.occurrence.item.location }
            }
            if (end != null && !now.isBefore(start) && now.isBefore(end)) return NextUp(title, place, start, end, true, entry is DayEntry.Course)
            if (now.isBefore(start)) return NextUp(title, place, start, end, false, entry is DayEntry.Course)
        }
    }
    return null
}

// endregion

/**
 * 今天: the day at a glance. Classes and the user's own items share one
 * timeline; what comes next sits on top; to-dos, tomorrow and the site's
 * feeds follow as plain lists. Sections and their order are the user's.
 */
@Composable
fun TodayScreen(activity: MainActivity) {
    val custom = activity.customization.value
    val cards = custom.dashboard.cards
    val agenda = activity.agenda
    val schedule = activity.schedule
    val feeds = activity.dashboardFeeds
    val context = LocalContext.current
    var now by remember { mutableStateOf(LocalDateTime.now().truncatedTo(ChronoUnit.MINUTES)) }
    LaunchedEffect(Unit) {
        feeds.refresh()
        while (true) {
            delay(20_000)
            now = LocalDateTime.now().truncatedTo(ChronoUnit.MINUTES)
        }
    }
    val today = now.toLocalDate()
    val record = remember(schedule.dataRevision, schedule.result, today) {
        schedule.widgetLocalRecord() ?: ScheduleWidgetLocalDays.read(context)
    }
    val courses = remember(record) { DashboardSchedule.days(record) }
    var editing by remember { mutableStateOf<AgendaItem?>(null) }
    var editingNote by remember { mutableStateOf<DashboardCard?>(null) }

    LazyColumn(
        Modifier.fillMaxSize().consumesTouches().background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item(key = "header") {
            val calendar = ChineseCalendarInfo.info(today.toString())
            val lunar = calendar?.let { it.festivals.firstOrNull() ?: (it.lunar.monthLabel() + it.lunar.dayLabel()) }
            val week = courses[today.toString()]?.week
            LargeTitle(
                "${today.monthValue}月${today.dayOfMonth}日 ${weekdayName(today)}",
                subtitle = listOfNotNull(week?.let { "第 $it 周" }, lunar).joinToString(" · ").ifEmpty { null },
            ) {
                IconButton(onClick = { activity.shell.open(custom.destination(DestinationCatalog.AGENDA) ?: return@IconButton) }) {
                    Icon(Icons.Outlined.Event, contentDescription = "日程")
                }
                IconButton(onClick = { editing = newAgendaDraft(today) }) { Icon(Icons.Rounded.Add, contentDescription = "新建日程") }
            }
        }
        item(key = "ask") { AskBar { activity.openAssistant() } }
        items(cards, key = { it.id }) { card ->
            when (card.type) {
                "next" -> NextPanel(nextUp(now, courses, agenda), now) { activity.shell.openSchedule(null, null) }
                "today" -> DayPanel(activity, today, now, courses, onEdit = { editing = it }, onAdd = { editing = newAgendaDraft(today) })
                "todo" -> TodoPanel(activity, today, onEdit = { editing = it }, onAdd = { editing = newAgendaDraft(null) })
                "upcoming" -> TomorrowPanel(activity, today, now, courses)
                "messages" -> MessagesPanel(activity)
                "shortcuts" -> ShortcutsPanel(activity, card)
                "announcements" -> FeedPanel("公告", feeds.announcements, feeds, numbered = false,
                    onMore = { activity.shell.openWeb("/announcements") }) { activity.shell.openWeb("/forum/topic/${it.id}") }
                "hot" -> FeedPanel("热榜", feeds.hot, feeds, numbered = true,
                    onMore = { activity.shell.openWeb("/forum/hot") }) { activity.shell.openWeb("/forum/topic/${it.id}") }
                "countdown" -> CountdownPanel(card, today)
                "note" -> NotePanel(card) { editingNote = card }
            }
        }
        item(key = "edit") {
            TextButton(onClick = { activity.openSettings("dashboard") }, modifier = Modifier.fillMaxWidth()) {
                Text("编辑今天", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    editing?.let { draft -> AgendaEditorSheet(activity, draft) { editing = null } }
    editingNote?.let { card ->
        var text by remember(card.id) { mutableStateOf(card.text) }
        AlertDialog(
            onDismissRequest = { editingNote = null },
            title = { Text(card.title.ifEmpty { "便签" }) },
            text = { OutlinedTextField(value = text, onValueChange = { text = it.take(2_000) }, modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp)) },
            confirmButton = {
                TextButton(onClick = {
                    activity.customization.update { current ->
                        current.copy(dashboard = current.dashboard.copy(cards = current.dashboard.cards.map { if (it.id == card.id) it.copy(text = text) else it }))
                    }
                    editingNote = null
                }) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { editingNote = null }) { Text("取消") } },
        )
    }
}

/** The way into 拾间AI: looks like a field, opens the assistant. */
@Composable
private fun AskBar(onOpen: () -> Unit) {
    val look = LocalCpuLook.current
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(look.radius(14.dp))).background(MaterialTheme.colorScheme.surfaceContainer)
            .clickable(onClick = onOpen).heightIn(min = 46.dp).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Text("问拾间AI，或让它帮你记一件事", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun NextPanel(next: NextUp?, now: LocalDateTime, onOpen: () -> Unit) {
    Panel {
        Column(Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(16.dp)) {
            if (next == null) {
                Text("今天和明天都没有安排了", style = MaterialTheme.typography.bodyLarge)
                Text("课表加载后，这里会显示下一节课", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                return@Column
            }
            val scheme = MaterialTheme.colorScheme
            val label = when {
                next.running -> "${if (next.isCourse) "正在上课" else "正在进行"} · 还剩 ${durationText(Duration.between(now, next.end).toMinutes().coerceAtLeast(1))}"
                next.start.toLocalDate() != now.toLocalDate() -> "明天 ${"%02d:%02d".format(next.start.hour, next.start.minute)}"
                else -> "${if (next.isCourse) "下一节" else "下一项"} · ${durationText(Duration.between(now, next.start).toMinutes().coerceAtLeast(1))}后"
            }
            Text(label, style = MaterialTheme.typography.labelMedium, color = if (next.running) scheme.primary else scheme.onSurfaceVariant)
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Text(next.title, style = MaterialTheme.typography.headlineSmall, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(12.dp))
                Text(
                    "%02d:%02d".format(next.start.hour, next.start.minute) + (next.end?.let { "–%02d:%02d".format(it.hour, it.minute) } ?: ""),
                    style = MaterialTheme.typography.titleSmall, color = scheme.onSurfaceVariant,
                )
            }
            if (next.place.isNotBlank()) Text(next.place, style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant)
            if (next.running && next.end != null) {
                val total = Duration.between(next.start, next.end).toMinutes().coerceAtLeast(1)
                val elapsed = Duration.between(next.start, now).toMinutes().coerceIn(0, total)
                Spacer(Modifier.height(12.dp))
                LinearProgressIndicator(
                    progress = { elapsed.toFloat() / total },
                    modifier = Modifier.fillMaxWidth().height(3.dp).clip(CircleShape),
                    color = scheme.primary, trackColor = scheme.surfaceContainerHigh, strokeCap = StrokeCap.Round, gapSize = 0.dp,
                    drawStopIndicator = {},
                )
            }
        }
    }
}

@Composable
private fun DayPanel(activity: MainActivity, today: LocalDate, now: LocalDateTime, courses: Map<String, DashDay>, onEdit: (AgendaItem) -> Unit, onAdd: () -> Unit) {
    val entries = dayEntries(today, courses, activity.agenda)
    Panel("今天", action = "日程", onAction = { activity.openAgenda(today) }) {
        if (entries.isEmpty()) {
            Text(if (courses.isEmpty()) "没有安排。课表加载后，今天的课也会出现在这里。" else "今天没有课，也没有日程",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
        }
        entries.forEachIndexed { index, entry ->
            if (index > 0) Hairline(start = 64.dp)
            DayEntryRow(entry, today, now, onToggle = { activity.toggleAgenda(it) }) {
                when (entry) {
                    is DayEntry.Course -> activity.shell.openSchedule(null, null)
                    is DayEntry.Plan -> onEdit(entry.occurrence.item)
                }
            }
        }
        Hairline()
        AddRow("添加日程", onAdd)
    }
}

@Composable
private fun TodoPanel(activity: MainActivity, today: LocalDate, onEdit: (AgendaItem) -> Unit, onAdd: () -> Unit) {
    val todos = activity.agenda.open(today)
    if (todos.isEmpty()) return
    Panel("未完成") {
        todos.take(8).forEachIndexed { index, item ->
            if (index > 0) Hairline(start = 56.dp)
            Row(Modifier.fillMaxWidth().clickable { onEdit(item) }.padding(start = 4.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                TodoCheck(false) { activity.toggleAgenda(AgendaOccurrence(item, AgendaItem.parseDate(item.date) ?: today)) }
                Column(Modifier.weight(1f).padding(vertical = 10.dp)) {
                    Text(item.title, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    AgendaItem.parseDate(item.date)?.let { day ->
                        Text("已过期 · ${dayLabel(day, today)}" + if (item.start.isNotEmpty()) " ${item.start}" else "",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
        if (todos.size > 8) {
            Hairline()
            ListRow("还有 ${todos.size - 8} 项", chevron = true) { activity.openAgenda(today) }
        }
        Hairline()
        AddRow("添加没有日期的日程", onAdd)
    }
}

@Composable
private fun TomorrowPanel(activity: MainActivity, today: LocalDate, now: LocalDateTime, courses: Map<String, DashDay>) {
    val tomorrow = today.plusDays(1)
    val entries = dayEntries(tomorrow, courses, activity.agenda)
    Panel("明天 · ${weekdayName(tomorrow)}", action = "全部", onAction = { activity.openAgenda(tomorrow) }) {
        if (entries.isEmpty()) {
            Text(if (courses.containsKey(tomorrow.toString())) "没有课，也没有日程" else "没有安排",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
        }
        entries.take(4).forEachIndexed { index, entry ->
            if (index > 0) Hairline(start = 64.dp)
            DayEntryRow(entry, tomorrow, now, onToggle = { activity.toggleAgenda(it) }) { activity.openAgenda(tomorrow) }
        }
        if (entries.size > 4) {
            Hairline()
            ListRow("还有 ${entries.size - 4} 项", chevron = true) { activity.openAgenda(tomorrow) }
        }
    }
}

@Composable
private fun MessagesPanel(activity: MainActivity) {
    val web = activity.web
    if (!web.authState.authenticated) return
    Panel {
        ListRow(
            "消息",
            leading = { Icon(Icons.Outlined.Notifications, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp)) },
            value = when {
                web.unreadCount == 0 -> "没有未读"
                web.directUnreadCount > 0 -> "${web.unreadCount} 条未读 · 私信 ${web.directUnreadCount}"
                else -> "${web.unreadCount} 条未读"
            },
            chevron = true,
        ) { activity.shell.openWeb("/messages") }
    }
}

@Composable
private fun ShortcutsPanel(activity: MainActivity, card: DashboardCard) {
    val custom = activity.customization.value
    val destinations = card.items.mapNotNull(custom::destination)
    if (destinations.isEmpty()) return
    Panel(card.title.ifEmpty { "常用" }) {
        LazyRow(contentPadding = PaddingValues(horizontal = 8.dp, vertical = 10.dp)) {
            items(destinations, key = { it.id }) { destination ->
                Column(
                    Modifier.width(72.dp).clip(RoundedCornerShape(12.dp)).clickable { activity.shell.open(destination) }.padding(vertical = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(Modifier.size(44.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
                        Icon(destinationPainter(destination, custom.icons.containsKey(destination.id)), contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(22.dp))
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(destination.title, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                }
            }
        }
    }
}

@Composable
private fun FeedPanel(title: String, items: List<FeedItem>, feeds: DashboardFeeds, numbered: Boolean, onMore: () -> Unit, onOpen: (FeedItem) -> Unit) {
    Panel(title, action = "全部", onAction = onMore) {
        if (items.isEmpty()) {
            Text(
                when {
                    feeds.loading -> "正在加载…"
                    feeds.failed -> "暂时没能加载"
                    else -> "暂无内容"
                },
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp),
            )
            return@Panel
        }
        items.take(if (numbered) 5 else 3).forEachIndexed { index, item ->
            if (index > 0) Hairline(start = if (numbered) 44.dp else 16.dp)
            Row(Modifier.fillMaxWidth().clickable { onOpen(item) }.heightIn(min = 46.dp).padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically) {
                if (numbered) {
                    Text("${index + 1}", modifier = Modifier.width(28.dp), style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(item.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (item.meta.isNotBlank() && !numbered) {
                    Spacer(Modifier.width(8.dp))
                    Text(item.meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
            }
        }
    }
}

@Composable
private fun CountdownPanel(card: DashboardCard, today: LocalDate) {
    val target = AgendaItem.parseDate(card.date) ?: return
    val days = ChronoUnit.DAYS.between(today, target)
    Panel {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(card.title.ifEmpty { DashboardCards.types["countdown"].orEmpty() }, style = MaterialTheme.typography.bodyLarge)
                Text("${target.monthValue}月${target.dayOfMonth}日 ${weekdayName(target)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(
                when {
                    days > 0 -> "$days"
                    days == 0L -> "今天"
                    else -> "${-days}"
                },
                style = MaterialTheme.typography.headlineMedium,
            )
            if (days != 0L) {
                Spacer(Modifier.width(4.dp))
                Text(if (days > 0) "天后" else "天前", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun NotePanel(card: DashboardCard, onEdit: () -> Unit) {
    Panel(card.title.ifEmpty { "便签" }) {
        Text(card.text.ifBlank { "点按写点什么" }, style = MaterialTheme.typography.bodyMedium,
            color = if (card.text.isBlank()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.fillMaxWidth().clickable(onClick = onEdit).padding(16.dp))
    }
}
