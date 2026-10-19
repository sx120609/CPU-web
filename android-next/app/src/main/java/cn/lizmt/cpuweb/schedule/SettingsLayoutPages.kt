package cn.lizmt.cpuweb.schedule

import android.app.DatePickerDialog
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.KeyboardArrowUp
import androidx.compose.material.icons.rounded.PushPin
import androidx.compose.material.icons.rounded.RocketLaunch
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.lizmt.cpuweb.schedule.custom.CustomPage
import cn.lizmt.cpuweb.schedule.custom.Customization
import cn.lizmt.cpuweb.schedule.custom.CustomizationCodec
import cn.lizmt.cpuweb.schedule.custom.DashboardCard
import cn.lizmt.cpuweb.schedule.custom.DashboardCards
import cn.lizmt.cpuweb.schedule.custom.Destination
import cn.lizmt.cpuweb.schedule.custom.DestinationCatalog
import cn.lizmt.cpuweb.schedule.custom.DestinationKind
import cn.lizmt.cpuweb.schedule.custom.MAX_TABS
import cn.lizmt.cpuweb.schedule.custom.MIN_TABS
import cn.lizmt.cpuweb.schedule.custom.SELECTABLE_ICONS
import cn.lizmt.cpuweb.schedule.custom.TabBarStyle
import cn.lizmt.cpuweb.schedule.custom.TabLabelMode
import java.util.Calendar

private fun <T> List<T>.moved(index: Int, delta: Int): List<T> {
    val target = index + delta
    if (index !in indices || target !in indices) return this
    return toMutableList().apply { add(target, removeAt(index)) }
}

private fun randomId(length: Int = 8): String {
    val alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    return (1..length).map { alphabet.random() }.joinToString("")
}

private fun kindLabel(destination: Destination): String = when (destination.kind) {
    DestinationKind.Schedule, DestinationKind.Dashboard, DestinationKind.Settings -> "原生"
    DestinationKind.External -> "外部链接"
    DestinationKind.Web -> destination.route
}

/** One destination in an ordered list, with move and remove buttons and an optional extra action. */
@Composable
private fun OrderedRow(
    destination: Destination,
    customIcon: Boolean,
    canUp: Boolean,
    canDown: Boolean,
    canRemove: Boolean,
    onUp: () -> Unit,
    onDown: () -> Unit,
    onRemove: () -> Unit,
    extra: @Composable (() -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    Row(
        Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .heightIn(min = 56.dp).padding(start = 14.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(destinationPainter(destination, customIcon), contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(destination.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(kindLabel(destination), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        extra?.invoke()
        val tint = MaterialTheme.colorScheme.onSurfaceVariant
        IconButton(onClick = onUp, enabled = canUp) { Icon(Icons.Rounded.KeyboardArrowUp, contentDescription = "上移", tint = tint.copy(alpha = if (canUp) 1f else 0.3f)) }
        IconButton(onClick = onDown, enabled = canDown) { Icon(Icons.Rounded.KeyboardArrowDown, contentDescription = "下移", tint = tint.copy(alpha = if (canDown) 1f else 0.3f)) }
        IconButton(onClick = onRemove, enabled = canRemove) { Icon(Icons.Outlined.Delete, contentDescription = "移除", tint = tint.copy(alpha = if (canRemove) 1f else 0.3f)) }
    }
}

/** Catalog entries not yet in a list, each with an add button. */
@Composable
private fun CandidateList(candidates: List<Destination>, custom: Customization, enabled: Boolean, onAdd: (Destination) -> Unit) {
    if (candidates.isEmpty()) {
        Text("都已添加", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(14.dp))
        return
    }
    candidates.forEachIndexed { index, destination ->
        if (index > 0) Divider()
        Row(
            Modifier.fillMaxWidth().clickable(enabled = enabled) { onAdd(destination) }.heightIn(min = 52.dp).padding(start = 14.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(destinationPainter(destination, custom.icons.containsKey(destination.id)), contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(destination.title, style = MaterialTheme.typography.bodyMedium)
                Text(kindLabel(destination), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
            IconButton(onClick = { onAdd(destination) }, enabled = enabled) { Icon(Icons.Rounded.Add, contentDescription = "添加 ${destination.title}") }
        }
    }
}

// region Tabs

@Composable
internal fun TabsPage(activity: MainActivity) {
    val store = activity.customization
    val custom = store.value
    var editing by remember { mutableStateOf<Destination?>(null) }
    var pageEditing by remember { mutableStateOf<CustomPage?>(null) }
    var addingPage by remember { mutableStateOf(false) }
    val look = LocalCpuLook.current
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(look.radius(20.dp))).border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(look.radius(20.dp)))) {
        NativeTabBar(custom, activity.shell.selectedId, unread = activity.web.unreadCount, backdrop = MaterialTheme.colorScheme.background,
            onSelect = {}, onCustomize = {}, applyInsets = false)
    }
    SettingsGroup("导航栏 ${custom.tabs.size}/$MAX_TABS", footer = "点按改名换图标；星标是打开拾间时的第一页。在导航栏上长按随时回到这里。") {
        custom.tabs.forEachIndexed { index, id ->
            val destination = custom.destination(id) ?: return@forEachIndexed
            if (index > 0) Divider()
            OrderedRow(
                destination, custom.icons.containsKey(id),
                canUp = index > 0, canDown = index < custom.tabs.lastIndex, canRemove = custom.tabs.size > MIN_TABS,
                onUp = { store.update { it.copy(tabs = it.tabs.moved(index, -1)) } },
                onDown = { store.update { it.copy(tabs = it.tabs.moved(index, 1)) } },
                onRemove = { store.update { it.copy(tabs = it.tabs - id) } },
                extra = {
                    IconButton(onClick = { store.update { it.copy(launchTab = id) } }) {
                        Icon(if (custom.launchTab == id) Icons.Rounded.Star else Icons.Rounded.StarOutline,
                            contentDescription = if (custom.launchTab == id) "启动页" else "设为启动页",
                            tint = if (custom.launchTab == id) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                onClick = { editing = destination },
            )
        }
    }
    SettingsGroup("样式") {
        ChoiceRow("外观", TabBarStyle.entries.map { it to it.title }, custom.tabBarStyle) { value -> store.update { it.copy(tabBarStyle = value) } }
        Divider()
        ChoiceRow("文字", TabLabelMode.entries.map { it to it.title }, custom.tabLabels) { value -> store.update { it.copy(tabLabels = value) } }
    }
    val full = custom.tabs.size >= MAX_TABS
    SettingsGroup("可以添加", footer = if (full) "导航栏已满 $MAX_TABS 个，先移除一个再添加。" else null) {
        CandidateList(custom.catalog.filter { it.tabEligible && it.id !in custom.tabs }, custom, enabled = !full) { destination ->
            store.update { it.copy(tabs = it.tabs + destination.id) }
        }
    }
    SettingsGroup("我的页面", footer = "把站内任意页面做成标签或快捷入口，比如某个板块、某个小工具；外部链接只能放进快捷入口。") {
        custom.customPages.forEachIndexed { index, page ->
            if (index > 0) Divider()
            SettingsRow(page.title, page.route, iconVector(page.icon), onClick = { pageEditing = page })
        }
        if (custom.customPages.isNotEmpty()) Divider()
        SettingsRow("添加页面", icon = Icons.Rounded.Add) { addingPage = true }
    }
    editing?.let { destination ->
        DestinationEditDialog(destination, custom, onDismiss = { editing = null }) { label, icon ->
            store.update {
                it.copy(
                    labels = if (label == null) it.labels - destination.id else it.labels + (destination.id to label),
                    icons = if (icon == null) it.icons - destination.id else it.icons + (destination.id to icon),
                )
            }
        }
    }
    if (addingPage || pageEditing != null) {
        CustomPageDialog(pageEditing, onDismiss = { addingPage = false; pageEditing = null }, onDelete = { page ->
            store.update { current -> current.copy(customPages = current.customPages.filterNot { it.id == page.id }) }
        }) { page ->
            store.update { current ->
                val pages = if (current.customPages.any { it.id == page.id }) current.customPages.map { if (it.id == page.id) page else it }
                else current.customPages + page
                current.copy(customPages = pages)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DestinationEditDialog(destination: Destination, custom: Customization, onDismiss: () -> Unit, onSave: (String?, String?) -> Unit) {
    val original = DestinationCatalog.resolve(destination.id, custom.customPages) ?: destination
    var label by remember { mutableStateOf(custom.labels[destination.id] ?: original.title) }
    var icon by remember { mutableStateOf(custom.icons[destination.id]) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("“${original.title}”的名称和图标") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(value = label, onValueChange = { label = it.take(8) }, label = { Text("名称（最多 8 个字）") }, singleLine = true)
                Spacer(Modifier.height(12.dp))
                Text("图标", style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.height(6.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SELECTABLE_ICONS.forEach { key ->
                        val chosen = (icon ?: original.icon) == key
                        Box(
                            Modifier.size(40.dp).clip(RoundedCornerShape(10.dp))
                                .background(if (chosen) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh)
                                .clickable { icon = key },
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(iconVector(key), contentDescription = key,
                                tint = if (chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val trimmed = label.trim()
                onSave(trimmed.takeIf { it.isNotEmpty() && it != original.title }, icon.takeIf { it != original.icon })
                onDismiss()
            }) { Text("保存") }
        },
        dismissButton = {
            Row {
                TextButton(onClick = { onSave(null, null); onDismiss() }) { Text("恢复默认") }
                TextButton(onClick = onDismiss) { Text("取消") }
            }
        },
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CustomPageDialog(existing: CustomPage?, onDismiss: () -> Unit, onDelete: (CustomPage) -> Unit, onSave: (CustomPage) -> Unit) {
    var title by remember { mutableStateOf(existing?.title.orEmpty()) }
    var route by remember { mutableStateOf(existing?.route?.let { if (it.startsWith("/")) AppConfig.origin + it else it }.orEmpty()) }
    var icon by remember { mutableStateOf(existing?.icon ?: "bookmark") }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (existing == null) "添加页面" else "编辑页面") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(value = title, onValueChange = { title = it.take(12) }, label = { Text("名称") }, singleLine = true)
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = route, onValueChange = { route = it; error = null }, label = { Text("站内地址或链接") },
                    placeholder = { Text("${AppConfig.origin}/forum/b/market") }, singleLine = true,
                    isError = error != null, supportingText = { Text(error ?: "在拾间里打开页面，点右上角分享可复制地址") },
                )
                Spacer(Modifier.height(8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SELECTABLE_ICONS.forEach { key ->
                        Box(
                            Modifier.size(36.dp).clip(RoundedCornerShape(9.dp))
                                .background(if (icon == key) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh)
                                .clickable { icon = key },
                            contentAlignment = Alignment.Center,
                        ) { Icon(iconVector(key), contentDescription = key, modifier = Modifier.size(20.dp)) }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val normalized = CustomizationCodec.normalizeRoute(route, AppConfig.origin, allowExternal = true)
                when {
                    title.isBlank() -> error = "请填写名称"
                    normalized == null -> error = "请填写站内地址（以 / 开头）或 https 链接"
                    else -> {
                        onSave(CustomPage(existing?.id ?: "custom:${randomId()}", title.trim(), normalized, icon))
                        onDismiss()
                    }
                }
            }) { Text("保存") }
        },
        dismissButton = {
            Row {
                if (existing != null) TextButton(onClick = { onDelete(existing); onDismiss() }) { Text("删除") }
                TextButton(onClick = onDismiss) { Text("取消") }
            }
        },
    )
}

// endregion

// region Top bar and quick entries

@Composable
internal fun ChromePage(activity: MainActivity) {
    val store = activity.customization
    val custom = store.value
    SettingsGroup("顶栏") {
        SwitchRow("拾间图标", "根页面左上角的图标，点按回到启动页", custom.topBar.logo) { value -> store.update { it.copy(topBar = it.topBar.copy(logo = value)) } }
        Divider()
        SwitchRow("刷新按钮", checked = custom.topBar.refresh) { value -> store.update { it.copy(topBar = it.topBar.copy(refresh = value)) } }
        Divider()
        SwitchRow("消息按钮", "带未读角标；未登录时显示“登录”", custom.topBar.messages) { value -> store.update { it.copy(topBar = it.topBar.copy(messages = value)) } }
        Divider()
        SwitchRow("快捷入口按钮", "关掉后可在工作台或导航栏里放入口", custom.topBar.quickEntry) { value -> store.update { it.copy(topBar = it.topBar.copy(quickEntry = value)) } }
        Divider()
        SwitchRow("首页投稿按钮", "首页右下角的“投稿”", custom.postButton) { value -> store.update { it.copy(postButton = value) } }
    }
    SettingsGroup("快捷入口 ${custom.quickEntries.size}", footer = "“管理后台”只对有权限的账号显示。") {
        custom.quickEntries.forEachIndexed { index, id ->
            val destination = custom.destination(id) ?: return@forEachIndexed
            if (index > 0) Divider()
            OrderedRow(destination, custom.icons.containsKey(id),
                canUp = index > 0, canDown = index < custom.quickEntries.lastIndex, canRemove = true,
                onUp = { store.update { it.copy(quickEntries = it.quickEntries.moved(index, -1)) } },
                onDown = { store.update { it.copy(quickEntries = it.quickEntries.moved(index, 1)) } },
                onRemove = { store.update { it.copy(quickEntries = it.quickEntries - id) } })
        }
    }
    SettingsGroup("可以添加") {
        CandidateList(custom.catalog.filter { it.id !in custom.quickEntries }, custom, enabled = true) { destination ->
            store.update { it.copy(quickEntries = it.quickEntries + destination.id) }
        }
    }
}

// endregion

// region Dashboard

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun DashboardEditorPage(activity: MainActivity) {
    val store = activity.customization
    val custom = store.value
    val layout = custom.dashboard
    var editing by remember { mutableStateOf<DashboardCard?>(null) }
    if (DestinationCatalog.DASHBOARD !in custom.tabs || custom.launchTab != DestinationCatalog.DASHBOARD) {
        SettingsGroup {
            if (DestinationCatalog.DASHBOARD !in custom.tabs) {
                SettingsRow("放进导航栏", if (custom.tabs.size >= MAX_TABS) "导航栏已满，会替换最后一个标签" else "工作台会出现在导航栏最前面",
                    Icons.Rounded.Add) {
                    store.update {
                        val tabs = if (it.tabs.size >= MAX_TABS) it.tabs.dropLast(1) else it.tabs
                        it.copy(tabs = listOf(DestinationCatalog.DASHBOARD) + tabs)
                    }
                }
                Divider()
            }
            SettingsRow("设为启动页", "打开拾间先看工作台", Icons.Rounded.RocketLaunch) {
                store.update {
                    val tabs = when {
                        DestinationCatalog.DASHBOARD in it.tabs -> it.tabs
                        it.tabs.size >= MAX_TABS -> listOf(DestinationCatalog.DASHBOARD) + it.tabs.dropLast(1)
                        else -> listOf(DestinationCatalog.DASHBOARD) + it.tabs
                    }
                    it.copy(tabs = tabs, launchTab = DestinationCatalog.DASHBOARD)
                }
            }
        }
    }
    SettingsGroup("标题") {
        Column(Modifier.padding(14.dp)) {
            OutlinedTextField(value = layout.title, onValueChange = { value -> store.update { it.copy(dashboard = it.dashboard.copy(title = value)) } },
                label = { Text("工作台名称") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(value = layout.greetingName, onValueChange = { value -> store.update { it.copy(dashboard = it.dashboard.copy(greetingName = value)) } },
                label = { Text("怎么称呼你（可不填）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        }
    }
    SettingsGroup("卡片 ${layout.cards.size}", footer = "点按倒计时、便签和快捷入口卡片可以编辑内容。") {
        layout.cards.forEachIndexed { index, card ->
            if (index > 0) Divider()
            Row(
                Modifier.fillMaxWidth().clickable(enabled = card.type in DashboardCards.repeatable) { editing = card }
                    .heightIn(min = 56.dp).padding(start = 14.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(card.title.ifEmpty { DashboardCards.types[card.type].orEmpty() }, style = MaterialTheme.typography.bodyMedium)
                    Text(cardSummary(card), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
                if (card.type in DashboardCards.repeatable) IconButton(onClick = { editing = card }) { Icon(Icons.Rounded.Edit, contentDescription = "编辑") }
                IconButton(onClick = { store.update { it.copy(dashboard = it.dashboard.copy(cards = it.dashboard.cards.moved(index, -1))) } }, enabled = index > 0) {
                    Icon(Icons.Rounded.KeyboardArrowUp, contentDescription = "上移")
                }
                IconButton(onClick = { store.update { it.copy(dashboard = it.dashboard.copy(cards = it.dashboard.cards.moved(index, 1))) } },
                    enabled = index < layout.cards.lastIndex) { Icon(Icons.Rounded.KeyboardArrowDown, contentDescription = "下移") }
                IconButton(onClick = { store.update { it.copy(dashboard = it.dashboard.copy(cards = it.dashboard.cards.filterNot { c -> c.id == card.id })) } }) {
                    Icon(Icons.Outlined.Delete, contentDescription = "移除", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
    SettingsGroup("添加卡片") {
        FlowRow(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            DashboardCards.types.forEach { (type, name) ->
                val present = layout.cards.any { it.type == type }
                val allowed = type in DashboardCards.repeatable || !present
                AssistChip(
                    onClick = {
                        val card = newCard(type)
                        if (card.type in DashboardCards.repeatable) editing = card
                        else store.update { it.copy(dashboard = it.dashboard.copy(cards = it.dashboard.cards + card)) }
                    },
                    enabled = allowed,
                    label = { Text(name) },
                    leadingIcon = { Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(16.dp)) },
                )
            }
        }
    }
    editing?.let { card ->
        CardEditDialog(card, custom, onDismiss = { editing = null }) { saved ->
            store.update { current ->
                val cards = current.dashboard.cards
                val next = if (cards.any { it.id == saved.id }) cards.map { if (it.id == saved.id) saved else it } else cards + saved
                current.copy(dashboard = current.dashboard.copy(cards = next))
            }
        }
    }
}

private fun newCard(type: String): DashboardCard {
    val id = if (type in DashboardCards.repeatable) "$type-${randomId(6)}" else type
    return when (type) {
        "countdown" -> {
            val date = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, 30) }
            DashboardCard(id, type, title = "期末考试", date = "%04d-%02d-%02d".format(date.get(Calendar.YEAR), date.get(Calendar.MONTH) + 1, date.get(Calendar.DAY_OF_MONTH)))
        }
        "note" -> DashboardCard(id, type, title = "便签")
        "shortcuts" -> DashboardCard(id, type, title = "常用", items = listOf("forum", "ai", "announcements", "market"))
        else -> DashboardCard(id, type)
    }
}

private fun cardSummary(card: DashboardCard): String = when (card.type) {
    "countdown" -> card.date
    "note" -> card.text.lineSequence().firstOrNull()?.ifEmpty { "空白便签" } ?: "空白便签"
    "shortcuts" -> "${card.items.size} 个入口"
    else -> DashboardCards.types[card.type].orEmpty()
}

@Composable
private fun CardEditDialog(card: DashboardCard, custom: Customization, onDismiss: () -> Unit, onSave: (DashboardCard) -> Unit) {
    var title by remember { mutableStateOf(card.title) }
    var text by remember { mutableStateOf(card.text) }
    var date by remember { mutableStateOf(card.date) }
    var items by remember { mutableStateOf(card.items) }
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(DashboardCards.types[card.type].orEmpty()) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(value = title, onValueChange = { title = it.take(16) }, label = { Text("标题") }, singleLine = true)
                Spacer(Modifier.height(8.dp))
                when (card.type) {
                    "note" -> OutlinedTextField(value = text, onValueChange = { text = it.take(2_000) }, label = { Text("内容") },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp))
                    "countdown" -> OutlinedButton(onClick = {
                        val parts = date.split('-').mapNotNull { it.toIntOrNull() }
                        val now = Calendar.getInstance()
                        DatePickerDialog(context, { _, year, month, day -> date = "%04d-%02d-%02d".format(year, month + 1, day) },
                            parts.getOrNull(0) ?: now.get(Calendar.YEAR), (parts.getOrNull(1) ?: (now.get(Calendar.MONTH) + 1)) - 1,
                            parts.getOrNull(2) ?: now.get(Calendar.DAY_OF_MONTH)).show()
                    }) { Text("日期：$date") }
                    "shortcuts" -> {
                        Text("选择入口（最多 12 个）", style = MaterialTheme.typography.labelLarge)
                        custom.catalog.forEach { destination ->
                            val checked = destination.id in items
                            Row(Modifier.fillMaxWidth().clickable {
                                items = if (checked) items - destination.id else if (items.size < 12) items + destination.id else items
                            }, verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(checked = checked, onCheckedChange = null)
                                Spacer(Modifier.width(6.dp))
                                Text(destination.title)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(card.copy(title = title.trim(), text = text, date = date, items = items)); onDismiss() }) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

// endregion

// region Launcher shortcuts

@Composable
internal fun ShortcutsPage(activity: MainActivity) {
    val store = activity.customization
    val custom = store.value
    val context = LocalContext.current
    SettingsGroup("长按图标的入口 ${custom.launcherShortcuts.size}/4", footer = "在桌面长按拾间图标就能直达这些页面。") {
        if (custom.launcherShortcuts.isEmpty()) {
            Text("还没有入口", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(14.dp))
        }
        custom.launcherShortcuts.forEachIndexed { index, id ->
            val destination = custom.destination(id) ?: return@forEachIndexed
            if (index > 0) Divider()
            OrderedRow(destination, custom.icons.containsKey(id),
                canUp = index > 0, canDown = index < custom.launcherShortcuts.lastIndex, canRemove = true,
                onUp = { store.update { it.copy(launcherShortcuts = it.launcherShortcuts.moved(index, -1)) } },
                onDown = { store.update { it.copy(launcherShortcuts = it.launcherShortcuts.moved(index, 1)) } },
                onRemove = { store.update { it.copy(launcherShortcuts = it.launcherShortcuts - id) } })
        }
    }
    val full = custom.launcherShortcuts.size >= 4
    SettingsGroup("固定到桌面", footer = "点图钉把页面变成桌面上的一个图标；点加号放进长按菜单。") {
        custom.catalog.filter { it.kind != DestinationKind.External }.forEachIndexed { index, destination ->
            if (index > 0) Divider()
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(start = 14.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(destinationPainter(destination, custom.icons.containsKey(destination.id)), contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(12.dp))
                Text(destination.title, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                IconButton(onClick = {
                    if (!LauncherShortcuts.pin(context, destination, custom)) activity.toast("当前桌面不支持固定快捷方式")
                }) { Icon(Icons.Rounded.PushPin, contentDescription = "固定 ${destination.title} 到桌面") }
                IconButton(onClick = { store.update { it.copy(launcherShortcuts = it.launcherShortcuts + destination.id) } },
                    enabled = !full && destination.id !in custom.launcherShortcuts) {
                    Icon(Icons.Rounded.Add, contentDescription = "放进长按菜单")
                }
            }
        }
    }
}

// endregion
