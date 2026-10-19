package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.lizmt.cpuweb.schedule.custom.DashboardCard
import cn.lizmt.cpuweb.schedule.custom.DashboardCards
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.Calendar
import java.util.concurrent.TimeUnit

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

    fun minutes(time: String): Int? {
        val parts = time.split(':')
        if (parts.size != 2) return null
        val hour = parts[0].toIntOrNull() ?: return null
        val minute = parts[1].toIntOrNull() ?: return null
        return hour * 60 + minute
    }

    data class NextClass(val course: DashCourse, val running: Boolean, val minutes: Int, val tomorrow: Boolean)

    /** The course running now or the next one today, else tomorrow's first; with minutes until it changes state. */
    fun next(days: Map<String, DashDay>, today: String, tomorrow: String, nowMinutes: Int): NextClass? {
        days[today]?.courses?.forEach { course ->
            val start = minutes(course.start) ?: return@forEach
            val end = minutes(course.end) ?: return@forEach
            if (nowMinutes in start until end) return NextClass(course, true, end - nowMinutes, false)
            if (nowMinutes < start) return NextClass(course, false, start - nowMinutes, false)
        }
        val first = days[tomorrow]?.courses?.firstOrNull() ?: return null
        val start = minutes(first.start) ?: return null
        return NextClass(first, false, 24 * 60 - nowMinutes + start, true)
    }
}

@Composable
fun DashboardScreen(activity: MainActivity) {
    val custom = activity.customization.value
    val layout = custom.dashboard
    val schedule = activity.schedule
    val feeds = activity.dashboardFeeds
    val context = LocalContext.current
    var now by remember { mutableStateOf(Calendar.getInstance()) }
    LaunchedEffect(Unit) {
        feeds.refresh()
        while (true) {
            delay(30_000)
            now = Calendar.getInstance()
        }
    }
    val today = ScheduleStore.todayKey()
    val record = remember(schedule.dataRevision, schedule.result, today) {
        schedule.widgetLocalRecord() ?: ScheduleWidgetLocalDays.read(context)
    }
    val days = remember(record) { DashboardSchedule.days(record) }
    val look = LocalCpuLook.current
    var editingNote by remember { mutableStateOf<DashboardCard?>(null) }

    LazyColumn(
        Modifier.fillMaxSize().consumesTouches().background(MaterialTheme.colorScheme.background),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(look.space(12.dp)),
    ) {
        item(key = "header") {
            Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(layout.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                IconButton(onClick = {
                    feeds.refresh(force = true)
                    activity.shell.requestScheduleLoad(force = false)
                }) { Icon(Icons.Rounded.Refresh, contentDescription = "刷新工作台") }
                IconButton(onClick = { activity.openSettings("dashboard") }) { Icon(Icons.Rounded.Edit, contentDescription = "编辑工作台") }
            }
        }
        items(layout.cards, key = { it.id }) { card ->
            when (card.type) {
                "greeting" -> GreetingCard(layout.greetingName, now, days[today])
                "next" -> NextClassCard(days, now) { activity.shell.openSchedule(null, null) }
                "today" -> TodayCard(days[today], now) { activity.shell.openSchedule(null, null) }
                "upcoming" -> UpcomingCard(days)
                "messages" -> MessagesCard(activity)
                "shortcuts" -> ShortcutsCard(activity, card)
                "announcements" -> FeedCard("校园公告", feeds.announcements, feeds, numbered = false,
                    onMore = { activity.shell.openWeb("/announcements") }) { activity.shell.openWeb("/forum/topic/${it.id}") }
                "hot" -> FeedCard("论坛热榜", feeds.hot, feeds, numbered = true,
                    onMore = { activity.shell.openWeb("/forum/hot") }) { activity.shell.openWeb("/forum/topic/${it.id}") }
                "countdown" -> CountdownCard(card)
                "note" -> NoteCard(card) { editingNote = card }
            }
        }
        item(key = "footer") {
            Text(
                "点右上角的笔可以增删、排序卡片",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
    editingNote?.let { card ->
        var text by remember(card.id) { mutableStateOf(card.text) }
        AlertDialog(
            onDismissRequest = { editingNote = null },
            title = { Text(card.title.ifEmpty { "便签" }) },
            text = {
                OutlinedTextField(value = text, onValueChange = { text = it.take(2_000) }, modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp))
            },
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

@Composable
private fun DashCard(
    title: String? = null,
    action: String? = null,
    onAction: (() -> Unit)? = null,
    onClick: (() -> Unit)? = null,
    background: Brush? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val look = LocalCpuLook.current
    val shape = RoundedCornerShape(look.radius(18.dp))
    Column(
        Modifier.fillMaxWidth().clip(shape)
            .then(if (background != null) Modifier.background(background) else Modifier.background(MaterialTheme.colorScheme.surfaceContainer))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(look.space(16.dp)),
    ) {
        if (title != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                if (action != null && onAction != null) {
                    Text(action, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onAction).padding(horizontal = 6.dp, vertical = 2.dp))
                }
            }
            Spacer(Modifier.height(10.dp))
        }
        content()
    }
}

private fun greeting(hour: Int) = when (hour) {
    in 5..10 -> "早上好"
    in 11..13 -> "中午好"
    in 14..17 -> "下午好"
    in 18..22 -> "晚上好"
    else -> "夜深了"
}

@Composable
private fun GreetingCard(name: String, now: Calendar, today: DashDay?) {
    val scheme = MaterialTheme.colorScheme
    val dark = LocalScheduleColors.current.dark
    val weekday = listOf("周日", "周一", "周二", "周三", "周四", "周五", "周六")[now.get(Calendar.DAY_OF_WEEK) - 1]
    // Light: white on the accent. Dark: the accent is lifted for contrast, so the card uses its deep container instead.
    val (start, end, text) = if (dark) {
        Triple(scheme.primaryContainer, mix(scheme.primaryContainer, Color(0xFF2A1B4A), 0.45f), scheme.onPrimaryContainer)
    } else {
        Triple(scheme.primary, mix(scheme.primary, Color(0xFF5B3BA0), 0.45f), Color.White)
    }
    DashCard(background = Brush.linearGradient(listOf(start, end))) {
        Text(greeting(now.get(Calendar.HOUR_OF_DAY)) + if (name.isNotBlank()) "，$name" else "",
            color = text, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        val parts = mutableListOf("${now.get(Calendar.MONTH) + 1}月${now.get(Calendar.DAY_OF_MONTH)}日 $weekday")
        today?.week?.let { parts += "第 $it 周" }
        today?.let { parts += if (it.courses.isEmpty()) "今天没有课" else "今天 ${it.courses.size} 节课" }
        Text(parts.joinToString(" · "), color = text.copy(alpha = 0.88f), style = MaterialTheme.typography.bodyMedium)
    }
}

private fun durationLabel(minutes: Int): String = when {
    minutes >= 60 * 24 -> "${minutes / (60 * 24)} 天"
    minutes >= 60 -> "${minutes / 60} 小时 ${minutes % 60} 分钟"
    else -> "$minutes 分钟"
}

@Composable
private fun NextClassCard(days: Map<String, DashDay>, now: Calendar, onOpen: () -> Unit) {
    val nowMinutes = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
    val next = DashboardSchedule.next(days, ScheduleStore.todayKey(), ScheduleStore.todayKey(1), nowMinutes)
    DashCard(title = "下一节课", action = "课表", onAction = onOpen, onClick = onOpen) {
        if (next == null) {
            Text(if (days.isEmpty()) "课表加载后这里会显示下一节课" else "今明两天没有课了", style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@DashCard
        }
        val (course, running, minutes, tomorrow) = next
        Text(when {
            running -> "正在上课 · 还剩 ${durationLabel(minutes)}"
            tomorrow -> "今天的课已结束 · 明天 ${course.start} 第一节"
            else -> "还有 ${durationLabel(minutes)} 上课"
        },
            style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(4.dp))
        Text(course.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(listOf("${course.start}–${course.end}", course.location, course.teacher).filter { it.isNotBlank() }.joinToString(" · "),
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun TodayCard(day: DashDay?, now: Calendar, onOpen: () -> Unit) {
    val nowMinutes = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
    DashCard(title = "今日课程", action = "全部", onAction = onOpen) {
        val courses = day?.courses.orEmpty()
        if (courses.isEmpty()) {
            Text(if (day == null) "课表加载后这里会显示今天的课" else "今天没有课，好好休息", style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@DashCard
        }
        courses.forEachIndexed { index, course ->
            val start = DashboardSchedule.minutes(course.start) ?: 0
            val end = DashboardSchedule.minutes(course.end) ?: 0
            val past = nowMinutes >= end
            val running = nowMinutes in start until end
            if (index > 0) Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth().alpha(if (past) 0.45f else 1f).heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(4.dp).height(36.dp).clip(CircleShape)
                    .background(if (running) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.width(52.dp)) {
                    Text(course.start, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                    Text(course.end, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Column(Modifier.weight(1f)) {
                    Text(course.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        fontWeight = if (running) FontWeight.SemiBold else FontWeight.Normal)
                    if (course.location.isNotBlank()) {
                        Text(course.location, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                    }
                }
            }
        }
    }
}

@Composable
private fun UpcomingCard(days: Map<String, DashDay>) {
    DashCard(title = "接下来两天") {
        listOf(1 to "明天", 2 to "后天").forEachIndexed { index, (offset, name) ->
            val day = days[ScheduleStore.todayKey(offset)]
            if (index > 0) Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("$name ${day?.label.orEmpty()}", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.width(92.dp))
                val courses = day?.courses.orEmpty()
                Text(
                    when {
                        day == null -> "暂无课表"
                        courses.isEmpty() -> "没有课"
                        else -> "${courses.size} 节 · ${courses.first().start} 起 · ${courses.first().name}"
                    },
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun MessagesCard(activity: MainActivity) {
    val web = activity.web
    val signedIn = web.authState.authenticated
    DashCard(title = "消息", onClick = { activity.shell.openWeb(if (signedIn) "/messages" else "/login") }) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(if (signedIn) web.unreadCount.toString() else "—", fontSize = 34.sp, fontWeight = FontWeight.Bold,
                color = if (web.unreadCount > 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.width(8.dp))
            Text(
                when {
                    !signedIn -> "登录后查看消息"
                    web.unreadCount == 0 -> "没有未读消息"
                    web.directUnreadCount > 0 -> "条未读，其中 ${web.directUnreadCount} 条私信"
                    else -> "条未读"
                },
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 6.dp),
            )
        }
    }
}

@Composable
private fun ShortcutsCard(activity: MainActivity, card: DashboardCard) {
    val custom = activity.customization.value
    val destinations = card.items.mapNotNull(custom::destination)
    val look = LocalCpuLook.current
    DashCard(title = card.title.ifEmpty { "快捷入口" }) {
        if (destinations.isEmpty()) {
            Text("在设置里为这张卡片选几个入口", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@DashCard
        }
        destinations.chunked(4).forEachIndexed { rowIndex, row ->
            if (rowIndex > 0) Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth()) {
                row.forEach { destination ->
                    Column(
                        Modifier.weight(1f).clip(RoundedCornerShape(look.radius(12.dp))).clickable { activity.shell.open(destination) }.padding(vertical = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Box(Modifier.size(44.dp).clip(RoundedCornerShape(look.radius(14.dp))).background(MaterialTheme.colorScheme.primaryContainer),
                            contentAlignment = Alignment.Center) {
                            Icon(destinationPainter(destination, custom.icons.containsKey(destination.id)), contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
                        }
                        Spacer(Modifier.height(4.dp))
                        Text(destination.title, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun FeedCard(title: String, items: List<FeedItem>, feeds: DashboardFeeds, numbered: Boolean, onMore: () -> Unit, onOpen: (FeedItem) -> Unit) {
    DashCard(title = title, action = "更多", onAction = onMore) {
        if (items.isEmpty()) {
            Text(
                when {
                    feeds.loading -> "正在加载…"
                    feeds.failed -> "暂时没能加载，点右上角刷新"
                    else -> "暂无内容"
                },
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            return@DashCard
        }
        items.forEachIndexed { index, item ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { onOpen(item) }.padding(vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (numbered) {
                    Text("${index + 1}", modifier = Modifier.width(24.dp), fontWeight = FontWeight.Bold,
                        color = if (index == 0) Color(0xFFC77C00) else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(item.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (item.meta.isNotBlank() && !numbered) {
                    Spacer(Modifier.width(8.dp))
                    Text(item.meta, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
            }
        }
    }
}

@Composable
private fun CountdownCard(card: DashboardCard) {
    val parts = card.date.split('-').mapNotNull { it.toIntOrNull() }
    val target = Calendar.getInstance().apply {
        set(parts.getOrElse(0) { 2000 }, parts.getOrElse(1) { 1 } - 1, parts.getOrElse(2) { 1 }, 0, 0, 0)
        set(Calendar.MILLISECOND, 0)
    }
    val today = Calendar.getInstance().apply {
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }
    val days = TimeUnit.MILLISECONDS.toDays(target.timeInMillis - today.timeInMillis + TimeUnit.HOURS.toMillis(12))
    DashCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(card.title.ifEmpty { DashboardCards.types["countdown"].orEmpty() }, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Text(card.date, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    when {
                        days > 0 -> days.toString()
                        days == 0L -> "今天"
                        else -> (-days).toString()
                    },
                    fontSize = 32.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary,
                )
                Text(when {
                    days > 0 -> "天后"
                    days == 0L -> "就是今天"
                    else -> "天前"
                }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun NoteCard(card: DashboardCard, onEdit: () -> Unit) {
    DashCard(title = card.title.ifEmpty { "便签" }, action = "编辑", onAction = onEdit, onClick = onEdit) {
        Text(card.text.ifBlank { "点按写点什么" }, style = MaterialTheme.typography.bodyMedium,
            color = if (card.text.isBlank()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
    }
}

