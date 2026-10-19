package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import cn.lizmt.cpuweb.schedule.agenda.AgendaRemind
import cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat
import cn.lizmt.cpuweb.schedule.custom.AssistantControls
import cn.lizmt.cpuweb.schedule.custom.DashboardCards
import cn.lizmt.cpuweb.schedule.custom.LAYOUT_PRESETS
import org.json.JSONObject
import java.time.LocalDate
import kotlin.math.roundToInt

/** Questions to start from, for what the user lets 拾间AI see. */
private fun starters(session: AssistantSession): List<String> = buildList {
    if (session.personal) {
        add("今天还有什么课？")
        add("这周哪天下午比较空？")
    }
    add("明天下午三点提醒我去实验室")
    if (session.academic) add("我的考试都在什么时候？")
    if (session.campus) add("最近有什么通知？")
    add("把课表换成素笺风格")
}

const val ASSISTANT_ACCESS_FOOTER = "拾间不保存这些数据，随时可以关掉。改日程、布局和设置之前，拾间AI 都会先给你确认。"

/** What 拾间AI may see, one switch each; shared by its own sheet and settings. */
@Composable
fun AssistantAccessRows(session: AssistantSession) {
    ToggleRow("课表和日程", checked = session.personal, detail = "未来 7 天的课、你记下的日程、未读消息数") { session.setPersonalMode(it) }
    Hairline()
    ToggleRow("公告与热榜", checked = session.campus, detail = "站内最新公告和论坛热榜的标题") { session.setCampusAccess(it) }
    Hairline()
    ToggleRow("成绩与考试", checked = session.academic, detail = "问到时才从教务读取，只用来回答那个问题") { session.setAcademicAccess(it) }
}

private fun accessSummary(session: AssistantSession): String = listOfNotNull(
    "课表和日程".takeIf { session.personal }, "公告".takeIf { session.campus }, "成绩考试".takeIf { session.academic },
).joinToString(" · ").ifEmpty { "只看你问的问题" }

/**
 * 拾间AI in personal mode: a quiet conversation, proposals the user confirms
 * one by one, and a sheet for what questions may carry.
 */
@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun AssistantScreen(activity: MainActivity, asTab: Boolean) {
    val session = activity.assistant
    val scheme = MaterialTheme.colorScheme
    var input by remember { mutableStateOf("") }
    var showAccess by remember { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }
    val list = rememberLazyListState()
    LaunchedEffect(Unit) { session.refreshQuota() }
    LaunchedEffect(session.messages.size, session.messages.lastOrNull()?.text?.length) {
        if (session.messages.isNotEmpty()) list.scrollToItem(session.messages.size)
    }
    val send = { text: String ->
        if (text.isNotBlank() && !session.sending) {
            activity.askAssistant(text)
            input = ""
        }
    }

    Column(Modifier.fillMaxSize().consumesTouches().background(scheme.background).imePadding()) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (!asTab) {
                IconButton(onClick = { activity.onBackPressedDispatcher.onBackPressed() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "返回") }
            } else {
                Spacer(Modifier.width(12.dp))
            }
            Column(
                Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).clickable { showAccess = true }.padding(horizontal = 4.dp, vertical = 2.dp),
            ) {
                Text("拾间AI", style = MaterialTheme.typography.titleLarge)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("可以看到：${accessSummary(session)}", style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    Icon(Icons.Rounded.KeyboardArrowDown, contentDescription = null, tint = scheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
                }
            }
            IconButton(onClick = { showAccess = true }) { Icon(Icons.Rounded.Tune, contentDescription = "拾间AI 可以看到什么", tint = scheme.onSurfaceVariant) }
            if (session.messages.isNotEmpty()) {
                IconButton(onClick = { confirmClear = true }) { Icon(Icons.Rounded.DeleteOutline, contentDescription = "清空对话", tint = scheme.onSurfaceVariant) }
            }
        }
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            state = list,
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (session.messages.isEmpty()) {
                item("empty") {
                    Column(Modifier.fillMaxWidth().padding(top = 32.dp)) {
                        Text("想问什么都可以", style = MaterialTheme.typography.headlineSmall)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            if (session.personal) "我能看到你接下来几天的课和你记下的日程，可以帮你查、帮你安排、替你记事和设提醒，" +
                                "也能帮你调拾间的布局、设置和课表样式——每一步都会先问过你。"
                            else "点上面的「可以看到」，让我结合你的课表、日程和成绩回答；不打开也可以让我帮你记事、调设置。",
                            style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(20.dp))
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            starters(session).forEach { starter -> ChoicePill(starter, selected = false) { send(starter) } }
                        }
                    }
                }
            }
            items(session.messages, key = { it.id }) { message ->
                if (message.fromUser) UserBubble(message.text) else AnswerBlock(activity, message, last = message == session.messages.last()) { send(it) }
            }
            item("end") { Spacer(Modifier.height(4.dp)) }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            BasicTextField(
                value = input, onValueChange = { input = it.take(500) },
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = scheme.onSurface),
                cursorBrush = SolidColor(scheme.primary),
                maxLines = 5,
                modifier = Modifier.weight(1f).clip(RoundedCornerShape(22.dp)).background(scheme.surfaceContainer)
                    .heightIn(min = 44.dp).padding(horizontal = 16.dp, vertical = 11.dp),
                decorationBox = { field ->
                    Box {
                        if (input.isEmpty()) Text(if (session.personal) "问课表、安排时间，或让我记一件事" else "问点什么", style = MaterialTheme.typography.bodyLarge, color = scheme.onSurfaceVariant)
                        field()
                    }
                },
            )
            Spacer(Modifier.width(8.dp))
            val active = session.sending || input.isNotBlank()
            Box(
                Modifier.size(44.dp).clip(CircleShape).background(if (active) scheme.primary else scheme.surfaceContainerHigh)
                    .clickable(enabled = active) { if (session.sending) session.stop() else send(input) },
                contentAlignment = Alignment.Center,
            ) {
                Icon(if (session.sending) Icons.Rounded.Stop else Icons.Rounded.ArrowUpward, contentDescription = if (session.sending) "停止" else "发送",
                    tint = if (active) scheme.onPrimary else scheme.onSurfaceVariant)
            }
        }
        session.quota?.let {
            Text(it, style = MaterialTheme.typography.labelSmall, color = scheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth().padding(start = 28.dp, bottom = 6.dp))
        }
    }

    if (showAccess) {
        ModalBottomSheet(onDismissRequest = { showAccess = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = scheme.background) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("拾间AI 可以看到", style = MaterialTheme.typography.headlineSmall)
                Panel(footer = ASSISTANT_ACCESS_FOOTER) { AssistantAccessRows(session) }
                Panel("它还能替你做") {
                    ListRow("日程", detail = "记下、修改、完成、删除，设提醒")
                    Hairline()
                    ListRow("课表", detail = "切换日、周、月视图，换风格，设上课提醒")
                    Hairline()
                    ListRow("布局和设置", detail = "布局方案、导航栏、今天页面的内容、主题色、深浅色、文字大小和常用开关")
                    Hairline()
                    ListRow("打开页面", detail = "站内任意页面，比如论坛、教务、搜索")
                }
            }
        }
    }
    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("清空对话？") },
            text = { Text("这台手机上保存的对话会被删除，已经添加的日程不受影响。") },
            confirmButton = { TextButton(onClick = { confirmClear = false; session.clear() }) { Text("清空", color = scheme.error) } },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("取消") } },
        )
    }
}

@Composable
private fun UserBubble(text: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Text(
            text, style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh)
                .padding(horizontal = 14.dp, vertical = 9.dp),
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AnswerBlock(activity: MainActivity, message: AssistantMessage, last: Boolean, onSuggest: (String) -> Unit) {
    val scheme = MaterialTheme.colorScheme
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val text = message.text.replace("**", "").trim()
        when {
            text.isNotEmpty() -> Text(text + if (message.streaming) " ▍" else "", style = MaterialTheme.typography.bodyLarge,
                color = if (message.failed) scheme.error else scheme.onSurface)
            message.streaming -> Text(activity.assistant.status ?: "正在想…", style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant)
        }
        message.proposals.forEach { proposal -> ProposalCard(activity, message.id, proposal) }
        if (message.links.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                message.links.forEach { link ->
                    Row(
                        Modifier.clip(RoundedCornerShape(10.dp)).border(1.dp, scheme.outlineVariant, RoundedCornerShape(10.dp))
                            .clickable { activity.openAssistantLink(link) }.heightIn(min = 34.dp).padding(horizontal = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(link.label, style = MaterialTheme.typography.labelMedium)
                        Spacer(Modifier.width(4.dp))
                        Icon(Icons.AutoMirrored.Rounded.OpenInNew, contentDescription = null, tint = scheme.onSurfaceVariant, modifier = Modifier.size(14.dp))
                    }
                }
            }
        }
        if (last && !message.streaming && message.suggestions.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                message.suggestions.forEach { suggestion -> ChoicePill(suggestion, selected = false) { onSuggest(suggestion) } }
            }
        }
    }
}

@Composable
private fun ProposalCard(activity: MainActivity, messageId: String, proposal: AssistantProposal) {
    val scheme = MaterialTheme.colorScheme
    val (kind, detail) = describeProposal(activity, proposal.action)
    val item = proposal.action.optJSONObject("item")
    Panel {
        Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp)) {
            Text(kind, style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant)
            Spacer(Modifier.height(2.dp))
            if (item != null) {
                // A new item: its title first, then when, where and the reminder.
                Text(item.optString("title"), style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val rest = detail.split(" · ").filter { it != item.optString("title") }.joinToString(" · ")
                if (rest.isNotBlank()) Text(rest, style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant, maxLines = 3)
            } else {
                Text(detail, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium, maxLines = 4, overflow = TextOverflow.Ellipsis)
            }
        }
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            when (proposal.state) {
                ProposalState.Pending -> {
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = { activity.assistant.setProposal(messageId, proposal.id, ProposalState.Dismissed) }) {
                        Text("不用了", color = scheme.onSurfaceVariant)
                    }
                    TextButton(onClick = { activity.applyAssistantProposal(messageId, proposal) }) { Text(confirmLabel(proposal.action), fontWeight = FontWeight.SemiBold) }
                }
                ProposalState.Applied -> {
                    Icon(Icons.Rounded.Check, contentDescription = null, tint = scheme.primary, modifier = Modifier.padding(start = 8.dp).size(18.dp))
                    Text(proposal.note.ifEmpty { "已完成" }, style = MaterialTheme.typography.labelLarge, color = scheme.primary,
                        modifier = Modifier.padding(start = 6.dp).weight(1f))
                    if (activity.canUndoAssistant(proposal.id)) TextButton(onClick = { activity.undoAssistantProposal(messageId, proposal) }) { Text("撤销") }
                }
                ProposalState.Dismissed -> Text("没有执行", style = MaterialTheme.typography.labelLarge, color = scheme.onSurfaceVariant, modifier = Modifier.padding(8.dp))
                ProposalState.Failed -> Text(proposal.note.ifEmpty { "没能完成" }, style = MaterialTheme.typography.labelLarge, color = scheme.error, modifier = Modifier.padding(8.dp))
            }
        }
    }
}

private fun confirmLabel(action: JSONObject): String = when (action.optString("type")) {
    "agenda.create" -> "添加"
    "agenda.update" -> "修改"
    "agenda.complete" -> "完成"
    "agenda.delete" -> "删除"
    "open", "web.open" -> "打开"
    "today.add" -> "添加"
    "today.remove" -> "移除"
    "schedule.view" -> "切换"
    "layout.preset", "tabs.set", "setting.set", "text.size", "schedule.style" -> "应用"
    else -> "确定"
}

/** What a proposal will do, in the user's words: a kind line and the details. */
fun describeProposal(activity: MainActivity, action: JSONObject): Pair<String, String> {
    val today = LocalDate.now()
    fun when_(date: String, start: String, end: String): String = listOfNotNull(
        AgendaItem.parseDate(date)?.let { dayLabel(it, today) },
        start.takeIf { it.isNotEmpty() }?.let { if (end.isNotEmpty()) "$it–$end" else it },
    ).joinToString(" ")
    fun itemLine(item: JSONObject): String = listOf(
        when_(item.optString("date"), item.optString("start"), item.optString("end")),
        item.optString("title"),
        item.optString("location"),
        item.optInt("remind", AgendaRemind.NONE).takeIf { it >= 0 }?.let { "提醒：${AgendaRemind.label(it)}" }.orEmpty(),
        cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat.of(item.optString("repeat")).takeIf { it != AgendaRepeat.None }?.title.orEmpty(),
    ).filter { it.isNotBlank() }.joinToString(" · ")
    val existing = { id: String -> activity.agenda.items.firstOrNull { it.id == id } }
    return when (action.optString("type")) {
        "agenda.create" -> {
            val item = action.optJSONObject("item") ?: JSONObject()
            "添加日程" to itemLine(item)
        }
        "agenda.update" -> "修改「${existing(action.optString("id"))?.title ?: "日程"}」" to itemLine(action.optJSONObject("changes") ?: JSONObject()).ifEmpty { "更新这一项" }
        "agenda.complete" -> "标为完成" to (existing(action.optString("id"))?.title ?: "这一项")
        "agenda.delete" -> "删除" to (existing(action.optString("id"))?.title ?: "这一项")
        "course.remind" -> "上课提醒" to action.optInt("minutes", -1).let { if (it < 0) "关闭上课提醒" else "每节课开始前 $it 分钟提醒" }
        "theme.accent" -> "主题色" to when (val value = action.optString("value")) {
            "brand" -> "换回拾间青"
            "dynamic" -> "跟随壁纸取色"
            else -> "换成 $value"
        }
        "theme.mode" -> "深浅色" to when (action.optString("value")) {
            "dark" -> "切换到深色"
            "light" -> "切换到浅色"
            else -> "跟随系统"
        }
        "open" -> "打开" to when (action.optString("target")) {
            "schedule" -> "课表"
            "agenda" -> "日程" + (AgendaItem.parseDate(action.optString("date"))?.let { " · ${dayLabel(it, today)}" } ?: "")
            "settings" -> "拾间设置"
            else -> "今天"
        }
        "layout.preset" -> "布局方案" to (LAYOUT_PRESETS.firstOrNull { it.id == action.optString("id") }?.let { "换成「${it.title}」：${it.detail}" } ?: "换一个布局")
        "tabs.set" -> {
            val custom = activity.customization.value
            val ids = action.optJSONArray("tabs")?.let { array -> (0 until array.length()).map { array.optString(it) } }.orEmpty()
            val names = ids.mapNotNull { custom.destination(it)?.title }.distinct()
            val launch = custom.destination(action.optString("launch"))?.title
            "导航栏" to (names.joinToString(" · ") + (launch?.let { "\n打开拾间时先显示「$it」" } ?: ""))
        }
        "setting.set" -> "设置" to "${if (action.optBoolean("value")) "打开" else "关闭"}「${AssistantControls.settings[action.optString("key")] ?: "这个开关"}」"
        "text.size" -> "文字大小" to "调到 ${(action.optDouble("scale", 1.0) * 100).roundToInt()}%"
        "today.add" -> {
            val section = action.optString("section")
            val name = action.optString("title").ifBlank { DashboardCards.types[section] ?: "这一项" }
            "今天页面" to when (section) {
                "countdown" -> "添加倒计时「$name」" + (AgendaItem.parseDate(action.optString("date"))?.let { "，到 ${dayLabel(it, today)}" } ?: "")
                "note" -> "添加便签「$name」" + action.optString("text").takeIf { it.isNotBlank() }?.let { "\n${it.take(80)}" }.orEmpty()
                else -> "添加「$name」"
            }
        }
        "today.remove" -> "今天页面" to "移除「${DashboardCards.types[action.optString("section")] ?: "这一项"}」"
        "schedule.view" -> "课表" to listOfNotNull(
            "切换到${when (action.optString("view")) { "day" -> "日"; "month" -> "月"; else -> "周" }}视图",
            AgendaItem.parseDate(action.optString("date"))?.let { "看 ${dayLabel(it, today)}" },
        ).joinToString("，")
        "schedule.style" -> "课表风格" to (ScheduleVisualStyle.entries.firstOrNull { it.id == action.optString("style") }
            ?.let { "换成「${it.title}」：${it.subtitle}" } ?: "换一种风格")
        "web.open" -> {
            val path = action.optString("path")
            val page = activity.customization.value.catalog.firstOrNull {
                it.kind == cn.lizmt.cpuweb.schedule.custom.DestinationKind.Web && it.route == path.substringBefore('?')
            }?.title
            val shown = runCatching { java.net.URLDecoder.decode(path, "UTF-8") }.getOrDefault(path)
            "打开页面" to (page?.let { if ('?' in path) "$it\n$shown" else it } ?: shown)
        }
        else -> "操作" to "这个操作当前版本还不支持"
    }
}
