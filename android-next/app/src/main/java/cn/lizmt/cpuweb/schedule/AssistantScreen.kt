package cn.lizmt.cpuweb.schedule

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.AddComment
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import cn.lizmt.cpuweb.schedule.agenda.AgendaKind
import cn.lizmt.cpuweb.schedule.agenda.AgendaRemind
import cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat
import cn.lizmt.cpuweb.schedule.custom.AssistantControls
import cn.lizmt.cpuweb.schedule.custom.DashboardCards
import cn.lizmt.cpuweb.schedule.custom.LAYOUT_PRESETS
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
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

const val ASSISTANT_ACCESS_FOOTER = "拾间不保存这些数据，随时可以关掉。"

/** What 拾间AI may see, one switch each; shared by its own sheet and settings. */
@Composable
fun AssistantAccessRows(session: AssistantSession) {
    ToggleRow("课表和日程", checked = session.personal, detail = "未来 7 天的课、你记下的日程、未读消息数") { session.setPersonalMode(it) }
    Hairline()
    ToggleRow("公告与热榜", checked = session.campus, detail = "站内最新公告和论坛热榜的标题") { session.setCampusAccess(it) }
    Hairline()
    ToggleRow("成绩与考试", checked = session.academic, detail = "问到时才从教务读取，只用来回答那个问题") { session.setAcademicAccess(it) }
}

/** How proposals run: always asked, only changes asked, or everything but deleting runs at once. */
@Composable
fun AssistantApprovalRows(session: AssistantSession) {
    CheckList(ApprovalMode.entries.map { Triple(it, it.title, it.detail as String?) }, session.approval) { session.setApprovalMode(it) }
}

private fun accessSummary(session: AssistantSession): String = listOfNotNull(
    "课表和日程".takeIf { session.personal }, "公告".takeIf { session.campus }, "成绩考试".takeIf { session.academic },
).joinToString(" · ").ifEmpty { "只看你问的问题" }

/** A time in a list: the clock today, 昨天, or the date. */
internal fun shortTime(millis: Long): String {
    val time = Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault())
    val today = LocalDate.now()
    return when (time.toLocalDate()) {
        today -> "%02d:%02d".format(time.hour, time.minute)
        today.minusDays(1) -> "昨天"
        else -> if (time.year == today.year) "${time.monthValue}月${time.dayOfMonth}日" else "${time.year}年${time.monthValue}月${time.dayOfMonth}日"
    }
}

private fun dayGroup(millis: Long): String {
    val day = Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()).toLocalDate()
    val today = LocalDate.now()
    return when {
        day == today -> "今天"
        day == today.minusDays(1) -> "昨天"
        day.isAfter(today.minusDays(7)) -> "这一周"
        else -> "更早"
    }
}

/**
 * 拾间AI: conversations like a messaging app (a list, new chat, rename,
 * delete), answers that can propose actions on this phone, a setting for which
 * of them run without asking, and a record of everything done. The keyboard
 * space is left to the shell, which already shrinks the page above it.
 */
@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun AssistantScreen(activity: MainActivity, asTab: Boolean) {
    val session = activity.assistant
    val scheme = MaterialTheme.colorScheme
    var input by remember { mutableStateOf("") }
    var showAccess by remember { mutableStateOf(false) }
    var showList by remember { mutableStateOf(false) }
    var showLog by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf<AssistantConversation?>(null) }
    var deleting by remember { mutableStateOf<AssistantConversation?>(null) }
    var editing by remember { mutableStateOf<Pair<String, AssistantProposal>?>(null) }
    val list = rememberLazyListState()
    val messages = session.messages
    LaunchedEffect(Unit) { session.refreshQuota() }
    LaunchedEffect(session.currentId, messages.size, messages.lastOrNull()?.text?.length) {
        if (messages.isNotEmpty()) list.scrollToItem(messages.size)
    }
    BackHandler(enabled = showList || showLog) {
        showList = false
        showLog = false
    }
    val send = { text: String ->
        if (text.isNotBlank() && !session.sending) {
            activity.askAssistant(text)
            input = ""
        }
    }

    Box(Modifier.fillMaxSize().consumesTouches().background(scheme.background)) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                if (!asTab) {
                    IconButton(onClick = { activity.onBackPressedDispatcher.onBackPressed() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "返回") }
                }
                IconButton(onClick = { showList = true }) { Icon(Icons.Rounded.History, contentDescription = "全部对话", tint = scheme.onSurfaceVariant) }
                Column(
                    Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).clickable { showAccess = true }.padding(horizontal = 4.dp, vertical = 2.dp),
                ) {
                    Text(session.current?.title ?: "拾间AI", style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("可以看到：${accessSummary(session)}", style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant,
                            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        Icon(Icons.Rounded.KeyboardArrowDown, contentDescription = null, tint = scheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
                    }
                }
                IconButton(onClick = { session.newConversation(); input = "" }, enabled = session.currentId != null) {
                    Icon(Icons.Rounded.AddComment, contentDescription = "新对话", tint = if (session.currentId != null) scheme.onSurface else scheme.onSurfaceVariant.copy(alpha = 0.4f))
                }
                Box {
                    IconButton(onClick = { menuOpen = true }) { Icon(Icons.Rounded.MoreVert, contentDescription = "更多", tint = scheme.onSurfaceVariant) }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(text = { Text("可以看到什么、怎么确认") }, onClick = { menuOpen = false; showAccess = true })
                        DropdownMenuItem(text = { Text("操作记录") }, onClick = { menuOpen = false; showLog = true })
                        session.current?.let { current ->
                            DropdownMenuItem(text = { Text("重命名") }, onClick = { menuOpen = false; renaming = current })
                            DropdownMenuItem(text = { Text("删除这个对话", color = scheme.error) }, onClick = { menuOpen = false; deleting = current })
                        }
                    }
                }
            }
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(),
                state = list,
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                if (messages.isEmpty()) {
                    item("empty") {
                        Column(Modifier.fillMaxWidth().padding(top = 32.dp)) {
                            Text("想问什么都可以", style = MaterialTheme.typography.headlineSmall)
                            Spacer(Modifier.height(6.dp))
                            Text(
                                if (session.personal) "我能看到你接下来几天的课和你记下的日程，可以帮你查、帮你安排、替你记事和设提醒，" +
                                    "也能帮你调拾间的布局、设置和课表样式。所有操作都在这台手机上执行，做过什么都记在“操作记录”里。"
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
                val lastUser = messages.lastOrNull { it.fromUser }?.id
                val lastAnswer = messages.lastOrNull { !it.fromUser }?.id
                items(messages, key = { it.id }) { message ->
                    if (message.fromUser) {
                        UserBubble(activity, message, editable = message.id == lastUser && !session.sending) {
                            session.takeBackLastQuestion()?.let { input = it }
                        }
                    } else {
                        AnswerBlock(activity, message, last = message.id == lastAnswer, onSuggest = { send(it) },
                            onEdit = { proposal -> editing = message.id to proposal })
                    }
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
        if (showList) {
            ConversationList(session, onClose = { showList = false },
                onOpen = { id -> session.open(id); showList = false },
                onNew = { session.newConversation(); input = ""; showList = false },
                onRename = { renaming = it }, onDelete = { deleting = it })
        }
        if (showLog) {
            ActivityLogPage(activity, onClose = { showLog = false }, onOpenConversation = { id -> session.open(id); showLog = false })
        }
    }

    if (showAccess) {
        ModalBottomSheet(onDismissRequest = { showAccess = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = scheme.background) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("拾间AI 可以看到", style = MaterialTheme.typography.headlineSmall)
                Panel(footer = ASSISTANT_ACCESS_FOOTER) { AssistantAccessRows(session) }
                Panel("操作怎么确认", footer = "所有操作都在这台手机上执行，做过什么都记在“操作记录”里，可以撤销。") { AssistantApprovalRows(session) }
                Panel("它能替你做") {
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
    renaming?.let { conversation ->
        var title by remember(conversation.id) { mutableStateOf(conversation.title) }
        AlertDialog(
            onDismissRequest = { renaming = null },
            title = { Text("重命名对话") },
            text = { OutlinedTextField(value = title, onValueChange = { title = it.take(60) }, singleLine = true) },
            confirmButton = { TextButton(onClick = { session.rename(conversation.id, title); renaming = null }, enabled = title.isNotBlank()) { Text("保存") } },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text("取消") } },
        )
    }
    deleting?.let { conversation ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("删除「${conversation.title}」？") },
            text = { Text(if (activity.sync.active) "这个对话会从你所有登录拾间NEXT 的手机上删除。已经添加的日程和改过的设置不受影响。" else "已经添加的日程和改过的设置不受影响。") },
            confirmButton = { TextButton(onClick = { session.delete(conversation.id); deleting = null }) { Text("删除", color = scheme.error) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } },
        )
    }
    editing?.let { (messageId, proposal) ->
        val item = proposal.action.optJSONObject("item") ?: JSONObject()
        val draft = remember(proposal.id) {
            AgendaItem(
                id = "", kind = AgendaKind.Event, title = item.optString("title"), date = item.optString("date"), start = item.optString("start"),
                end = item.optString("end"), location = item.optString("location"), note = item.optString("note"),
                remind = item.optInt("remind", AgendaRemind.NONE), repeat = AgendaRepeat.of(item.optString("repeat")), origin = "assistant",
            )
        }
        AgendaEditorSheet(activity, draft, onSaved = { saved -> activity.applyEditedAgendaProposal(messageId, proposal, saved) }) { editing = null }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun UserBubble(activity: MainActivity, message: AssistantMessage, editable: Boolean, onEdit: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Box {
            Text(
                message.text, style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh)
                    .combinedClickable(onClick = {}, onLongClick = { menu = true }).padding(horizontal = 14.dp, vertical = 9.dp),
            )
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("复制") }, onClick = {
                    menu = false
                    clipboard.setText(AnnotatedString(message.text))
                    activity.toast("已复制")
                })
                if (editable) DropdownMenuItem(text = { Text("改一下再问") }, onClick = { menu = false; onEdit() })
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
private fun AnswerBlock(activity: MainActivity, message: AssistantMessage, last: Boolean, onSuggest: (String) -> Unit, onEdit: (AssistantProposal) -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val clipboard = LocalClipboardManager.current
    var menu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val text = message.text.replace("**", "").trim()
        Box {
            when {
                text.isNotEmpty() -> Text(text + if (message.streaming) " ▍" else "", style = MaterialTheme.typography.bodyLarge,
                    color = if (message.failed) scheme.error else scheme.onSurface,
                    modifier = Modifier.combinedClickable(enabled = !message.streaming, onClick = {}, onLongClick = { menu = true }))
                message.streaming -> Text(activity.assistant.status ?: "正在想…", style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant)
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("复制") }, onClick = {
                    menu = false
                    clipboard.setText(AnnotatedString(text))
                    activity.toast("已复制")
                })
                if (last && !activity.assistant.sending) DropdownMenuItem(text = { Text("重新回答") }, onClick = { menu = false; activity.regenerateAssistant() })
            }
        }
        message.proposals.forEach { proposal -> ProposalCard(activity, message.id, proposal, onEdit) }
        val pending = message.proposals.count { it.state == ProposalState.Pending }
        if (pending >= 2) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = { activity.applyAllAssistantProposals(message) }) { Text("全部确认（$pending 项）", fontWeight = FontWeight.SemiBold) }
            }
        }
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
private fun ProposalCard(activity: MainActivity, messageId: String, proposal: AssistantProposal, onEdit: (AssistantProposal) -> Unit) {
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
                    if (proposal.action.optString("type") == "agenda.create") {
                        TextButton(onClick = { onEdit(proposal) }) { Text("改一改") }
                    }
                    TextButton(onClick = { activity.applyAssistantProposal(messageId, proposal) }) { Text(confirmLabel(proposal.action), fontWeight = FontWeight.SemiBold) }
                }
                ProposalState.Applied -> {
                    Icon(Icons.Rounded.Check, contentDescription = null, tint = scheme.primary, modifier = Modifier.padding(start = 8.dp).size(18.dp))
                    Text((if (proposal.auto) "自动执行 · " else "") + proposal.note.ifEmpty { "已完成" }, style = MaterialTheme.typography.labelLarge, color = scheme.primary,
                        modifier = Modifier.padding(start = 6.dp).weight(1f))
                    if (activity.canUndoAssistant(proposal.id)) TextButton(onClick = { activity.undoAssistant(messageId, proposal.id) }) { Text("撤销") }
                }
                ProposalState.Dismissed -> Text(proposal.note.ifEmpty { "没有执行" }, style = MaterialTheme.typography.labelLarge, color = scheme.onSurfaceVariant, modifier = Modifier.padding(8.dp))
                ProposalState.Failed -> Text(proposal.note.ifEmpty { "没能完成" }, style = MaterialTheme.typography.labelLarge, color = scheme.error, modifier = Modifier.padding(8.dp))
            }
        }
    }
}

/** Every conversation, newest first and grouped by day, with search; long press to rename or delete. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ConversationList(
    session: AssistantSession,
    onClose: () -> Unit,
    onOpen: (String) -> Unit,
    onNew: () -> Unit,
    onRename: (AssistantConversation) -> Unit,
    onDelete: (AssistantConversation) -> Unit,
) {
    val scheme = MaterialTheme.colorScheme
    var query by remember { mutableStateOf("") }
    val shown = session.conversations.filter { conversation ->
        query.isBlank() || conversation.title.contains(query.trim(), ignoreCase = true) ||
            conversation.messages.any { it.text.contains(query.trim(), ignoreCase = true) }
    }
    Column(Modifier.fillMaxSize().consumesTouches().background(scheme.background)) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "返回") }
            Text("对话", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            TextButton(onClick = onNew) { Text("新对话", fontWeight = FontWeight.SemiBold) }
        }
        Row(
            Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(scheme.surfaceContainer)
                .heightIn(min = 40.dp).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Rounded.Search, contentDescription = null, tint = scheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            BasicTextField(
                value = query, onValueChange = { query = it.take(40) }, singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = scheme.onSurface), cursorBrush = SolidColor(scheme.primary),
                modifier = Modifier.weight(1f).padding(vertical = 10.dp),
                decorationBox = { field ->
                    Box { if (query.isEmpty()) Text("搜索对话", style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant); field() }
                },
            )
        }
        if (shown.isEmpty()) {
            Text(if (query.isBlank()) "还没有对话。问拾间AI 一个问题，就会出现在这里。" else "没有找到",
                style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant, modifier = Modifier.padding(24.dp))
            return@Column
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp)) {
            shown.groupBy { dayGroup(it.updatedAt) }.forEach { (group, conversations) ->
                item("group-$group") {
                    Text(group, style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant, modifier = Modifier.padding(start = 4.dp, top = 8.dp, bottom = 6.dp))
                }
                items(conversations, key = { it.id }) { conversation ->
                    var menu by remember { mutableStateOf(false) }
                    val selected = conversation.id == session.currentId
                    Box {
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                                .background(if (selected) scheme.surfaceContainerHigh else scheme.background)
                                .combinedClickable(onClick = { onOpen(conversation.id) }, onLongClick = { menu = true })
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(conversation.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                val preview = conversation.messages.lastOrNull { it.text.isNotBlank() }?.text?.replace("**", "")?.replace('\n', ' ').orEmpty()
                                if (preview.isNotEmpty()) Text(preview, style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            Spacer(Modifier.width(8.dp))
                            Text(shortTime(conversation.updatedAt), style = MaterialTheme.typography.labelSmall, color = scheme.onSurfaceVariant)
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("重命名") }, onClick = { menu = false; onRename(conversation) })
                            DropdownMenuItem(text = { Text("删除", color = scheme.error) }, onClick = { menu = false; onDelete(conversation) })
                        }
                    }
                }
            }
        }
    }
}

/** What 拾间AI did, newest first: when, on which phone, whether it was taken back; tap to see the conversation. */
@Composable
private fun ActivityLogPage(activity: MainActivity, onClose: () -> Unit, onOpenConversation: (String) -> Unit) {
    val log = activity.activityLog
    val scheme = MaterialTheme.colorScheme
    var menu by remember { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().consumesTouches().background(scheme.background)) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "返回") }
            Text("操作记录", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            if (log.entries.isNotEmpty()) {
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, contentDescription = "更多", tint = scheme.onSurfaceVariant) }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text("清空记录", color = scheme.error) }, onClick = { menu = false; confirmClear = true })
                    }
                }
            }
        }
        if (log.entries.isEmpty()) {
            Text("拾间AI 替你做过的事会记在这里：添加的日程、改过的设置、打开过的页面，以及是在哪台手机上做的。",
                style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant, modifier = Modifier.padding(24.dp))
            return@Column
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            log.entries.groupBy { dayGroup(it.at) }.forEach { (group, entries) ->
                item("group-$group") {
                    Text(group, style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant, modifier = Modifier.padding(start = 4.dp, top = 8.dp))
                }
                items(entries, key = { it.id }) { entry ->
                    val (kind, detail) = describeProposal(activity, entry.action)
                    val opens = activity.assistant.conversations.any { it.id == entry.conversationId }
                    Panel {
                        Column(
                            Modifier.fillMaxWidth().then(if (opens) Modifier.clickable { onOpenConversation(entry.conversationId) } else Modifier)
                                .padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 10.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(kind, style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant)
                                    Text(entry.action.optJSONObject("item")?.optString("title")?.takeIf { it.isNotBlank() } ?: detail,
                                        style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                }
                                if (entry.state == "applied" && entry.device == log.device && activity.canUndoAssistant(entry.proposalId)) {
                                    TextButton(onClick = { activity.undoAssistant(entry.messageId, entry.proposalId) }) { Text("撤销") }
                                }
                            }
                            val meta = listOfNotNull(
                                shortTime(entry.at),
                                entry.device.takeIf { it.isNotBlank() && it != log.device }?.let { "在 $it 上" },
                                "自动执行".takeIf { entry.auto },
                                when (entry.state) { "undone" -> "已撤销"; "failed" -> "没能完成"; else -> null },
                            ).joinToString(" · ")
                            Text(meta, style = MaterialTheme.typography.bodySmall,
                                color = if (entry.state == "failed") scheme.error else scheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("清空操作记录？") },
            text = { Text("只删除记录，已经做过的改动不受影响。") },
            confirmButton = { TextButton(onClick = { confirmClear = false; log.clear() }) { Text("清空", color = scheme.error) } },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("取消") } },
        )
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
        AgendaRepeat.of(item.optString("repeat")).takeIf { it != AgendaRepeat.None }?.title.orEmpty(),
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
