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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import cn.lizmt.cpuweb.schedule.agenda.AgendaRemind
import cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat
import org.json.JSONObject
import java.time.LocalDate

private val STARTERS = listOf(
    "今天还有什么课？",
    "这周哪天下午比较空？",
    "明天下午三点提醒我去实验室",
    "我还有哪些待办没做？",
)

/**
 * 拾间AI in personal mode: a quiet conversation, proposals the user confirms
 * one by one, and a switch for whether questions carry the timetable and agenda.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AssistantScreen(activity: MainActivity, asTab: Boolean) {
    val session = activity.assistant
    val scheme = MaterialTheme.colorScheme
    var input by remember { mutableStateOf("") }
    var askConsent by remember { mutableStateOf(false) }
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
            Column(Modifier.weight(1f)) {
                Text("拾间AI", style = MaterialTheme.typography.titleLarge)
                Text(if (session.personal) "已带上你的课表和日程" else "不带个人数据", style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant)
            }
            Switch(
                checked = session.personal,
                onCheckedChange = { on -> if (on && !session.consented) askConsent = true else session.setPersonalMode(on) },
                modifier = Modifier.padding(end = 4.dp),
            )
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
                            if (session.personal) "我能看到你接下来几天的课和你记下的日程，可以帮你查、帮你安排，也能替你记事和设提醒——每一步都会先问过你。"
                            else "打开右上角的开关，我就能结合你的课表和日程回答；不打开也可以让我帮你记事。",
                            style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(20.dp))
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            STARTERS.forEach { starter -> ChoicePill(starter, selected = false) { send(starter) } }
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

    if (askConsent) {
        AlertDialog(
            onDismissRequest = { askConsent = false },
            title = { Text("带上你的课表和日程？") },
            text = {
                Text("打开后，每次提问会把未来 7 天的课程、你在拾间里记下的日程和待办、未读消息数一起发给拾间AI，用来回答和帮你安排。" +
                    "不会发送成绩、考试和消息内容；拾间不保存这些数据，随时可以关掉。")
            },
            confirmButton = { TextButton(onClick = { askConsent = false; session.setPersonalMode(true) }) { Text("打开") } },
            dismissButton = { TextButton(onClick = { askConsent = false }) { Text("先不用") } },
        )
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
            message.streaming -> Text("正在想…", style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant)
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
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
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
    "open" -> "打开"
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
            (if (item.optString("kind") == "todo") "添加待办" else "添加日程") to itemLine(item)
        }
        "agenda.update" -> "修改「${existing(action.optString("id"))?.title ?: "日程"}」" to itemLine(action.optJSONObject("changes") ?: JSONObject()).ifEmpty { "更新这一项" }
        "agenda.complete" -> "完成待办" to (existing(action.optString("id"))?.title ?: "这一项")
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
        else -> "操作" to "这个操作当前版本还不支持"
    }
}
