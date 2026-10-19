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
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.RemoveCircleOutline
import androidx.compose.material3.AlertDialog
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

private fun <T> List<T>.moved(from: Int, to: Int): List<T> {
    if (from !in indices || to !in indices) return this
    return toMutableList().apply { add(to, removeAt(from)) }
}

private fun randomId(length: Int = 8): String {
    val alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    return (1..length).map { alphabet.random() }.joinToString("")
}

@Composable
private fun DestinationIcon(destination: Destination, custom: Customization) {
    Icon(destinationPainter(destination, custom.icons.containsKey(destination.id)), contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
}

/** Catalog entries not yet in a list, each added with a tap. */
@Composable
private fun CandidateRows(candidates: List<Destination>, custom: Customization, enabled: Boolean, onAdd: (Destination) -> Unit) {
    if (candidates.isEmpty()) {
        Text("都已添加", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
        return
    }
    candidates.forEachIndexed { index, destination ->
        if (index > 0) Hairline(start = 50.dp)
        ListRow(destination.title, leading = { DestinationIcon(destination, custom) }, enabled = enabled,
            trailing = { Icon(Icons.Rounded.Add, contentDescription = "添加 ${destination.title}", tint = if (enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline) },
            onClick = { onAdd(destination) })
    }
}

/** The remove button some reorderable rows carry before their handle. */
@Composable
private fun RemoveButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled) {
        Icon(Icons.Rounded.RemoveCircleOutline, contentDescription = "移除 $label",
            tint = if (enabled) MaterialTheme.colorScheme.error.copy(alpha = 0.8f) else MaterialTheme.colorScheme.outline)
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
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(look.radius(20.dp))).background(MaterialTheme.colorScheme.background)
        .border(0.5.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(look.radius(20.dp))).padding(top = 8.dp)) {
        NativeTabBar(custom, activity.shell.selectedId, unread = activity.web.unreadCount, backdrop = MaterialTheme.colorScheme.background,
            onSelect = {}, onCustomize = {}, applyInsets = false)
    }
    Panel("导航栏 · ${custom.tabs.size}/$MAX_TABS", footer = "按住右侧把手拖动排序，点按改名、换图标或设为启动页。在导航栏上长按也能回到这里。") {
        ReorderableRows(custom.tabs, key = { it }, onMove = { from, to -> store.update { it.copy(tabs = it.tabs.moved(from, to)) } }) { id, handle, _ ->
            val destination = custom.destination(id)
            if (destination != null) {
                ListRow(destination.title, leading = { DestinationIcon(destination, custom) },
                    value = if (custom.launchTab == id) "启动页" else null,
                    trailing = { DragHandle(handle) }, onClick = { editing = destination })
            }
        }
    }
    Panel("样式") {
        LabeledControl("外观") {
            Segmented(TabBarStyle.entries.map { it to it.title }, custom.tabBarStyle) { value -> store.update { it.copy(tabBarStyle = value) } }
        }
        Hairline()
        LabeledControl("文字") {
            Segmented(TabLabelMode.entries.map { it to it.title }, custom.tabLabels) { value -> store.update { it.copy(tabLabels = value) } }
        }
    }
    val full = custom.tabs.size >= MAX_TABS
    Panel("可以添加", footer = if (full) "导航栏已满 $MAX_TABS 个，先移除一个再添加。" else null) {
        CandidateRows(custom.catalog.filter { it.tabEligible && it.id !in custom.tabs }, custom, enabled = !full) { destination ->
            store.update { it.copy(tabs = it.tabs + destination.id) }
        }
    }
    Panel("我的页面", footer = "把站内任意页面做成标签或快捷入口，比如某个板块或小工具。") {
        custom.customPages.forEachIndexed { index, page ->
            if (index > 0) Hairline()
            ListRow(page.title, leading = { Icon(iconVector(page.icon), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                chevron = true, onClick = { pageEditing = page })
        }
        if (custom.customPages.isNotEmpty()) Hairline()
        AddRow("添加页面") { addingPage = true }
    }
    editing?.let { destination ->
        DestinationEditDialog(destination, custom, inTabs = destination.id in custom.tabs, onDismiss = { editing = null },
            onRemove = if (destination.id in custom.tabs && custom.tabs.size > MIN_TABS) ({ store.update { it.copy(tabs = it.tabs - destination.id) } }) else null,
            onLaunch = { store.update { it.copy(launchTab = destination.id) } },
        ) { label, icon ->
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
private fun DestinationEditDialog(
    destination: Destination,
    custom: Customization,
    inTabs: Boolean,
    onDismiss: () -> Unit,
    onRemove: (() -> Unit)?,
    onLaunch: () -> Unit,
    onSave: (String?, String?) -> Unit,
) {
    val original = DestinationCatalog.resolve(destination.id, custom.customPages) ?: destination
    var label by remember { mutableStateOf(custom.labels[destination.id] ?: original.title) }
    var icon by remember { mutableStateOf(custom.icons[destination.id]) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(original.title) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(value = label, onValueChange = { label = it.take(8) }, label = { Text("名称（最多 8 个字）") }, singleLine = true)
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
                                tint = if (chosen) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (inTabs && custom.launchTab != destination.id) {
                    OutlinedButton(onClick = { onLaunch(); onDismiss() }, modifier = Modifier.fillMaxWidth()) { Text("打开拾间时先显示这里") }
                }
                if (onRemove != null) {
                    TextButton(onClick = { onRemove(); onDismiss() }, modifier = Modifier.fillMaxWidth()) {
                        Text("从导航栏移除", color = MaterialTheme.colorScheme.error)
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
                    value = route, onValueChange = { route = it; error = null }, label = { Text("页面地址") },
                    placeholder = { Text("${AppConfig.origin}/forum/b/market") }, singleLine = true,
                    isError = error != null, supportingText = { Text(error ?: "在拾间里打开页面，点右上角分享可以复制地址") },
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
                if (existing != null) TextButton(onClick = { onDelete(existing); onDismiss() }) { Text("删除", color = MaterialTheme.colorScheme.error) }
                TextButton(onClick = onDismiss) { Text("取消") }
            }
        },
    )
}

// endregion

// region Quick entries

@Composable
internal fun QuickPage(activity: MainActivity) {
    val store = activity.customization
    val custom = store.value
    Panel("快捷入口 · ${custom.quickEntries.size}", footer = "网页右上角的方格按钮打开它们。“管理后台”只对有权限的账号显示。") {
        if (custom.quickEntries.isEmpty()) {
            Text("还没有入口", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
        }
        ReorderableRows(custom.quickEntries, key = { it }, onMove = { from, to -> store.update { it.copy(quickEntries = it.quickEntries.moved(from, to)) } }) { id, handle, _ ->
            val destination = custom.destination(id)
            if (destination != null) {
                ListRow(destination.title, leading = { DestinationIcon(destination, custom) }, trailing = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RemoveButton(destination.title) { store.update { it.copy(quickEntries = it.quickEntries - id) } }
                        DragHandle(handle)
                    }
                })
            }
        }
    }
    Panel("可以添加") {
        CandidateRows(custom.catalog.filter { it.id !in custom.quickEntries }, custom, enabled = true) { destination ->
            store.update { it.copy(quickEntries = it.quickEntries + destination.id) }
        }
    }
}

// endregion

// region 今天

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun DashboardEditorPage(activity: MainActivity) {
    val store = activity.customization
    val custom = store.value
    val cards = custom.dashboard.cards
    var editing by remember { mutableStateOf<DashboardCard?>(null) }
    if (DestinationCatalog.DASHBOARD !in custom.tabs || custom.launchTab != DestinationCatalog.DASHBOARD) {
        Panel {
            ListRow("打开拾间时先看今天", detail = if (DestinationCatalog.DASHBOARD !in custom.tabs) "会把今天放进导航栏最前面" else null,
                titleColor = MaterialTheme.colorScheme.primary) {
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
    Panel("显示的部分", footer = "按住把手拖动排序。点倒计时、便签和常用入口可以改内容。") {
        if (cards.isEmpty()) {
            Text("今天现在是空的，从下面添加", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
        }
        ReorderableRows(cards, key = { it.id }, onMove = { from, to ->
            store.update { it.copy(dashboard = it.dashboard.copy(cards = it.dashboard.cards.moved(from, to))) }
        }) { card, handle, _ ->
            val editable = card.type in DashboardCards.repeatable
            ListRow(
                card.title.ifEmpty { DashboardCards.types[card.type].orEmpty() },
                detail = if (editable) cardSummary(card) else null,
                trailing = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RemoveButton(card.title.ifEmpty { DashboardCards.types[card.type].orEmpty() }) {
                            store.update { it.copy(dashboard = it.dashboard.copy(cards = it.dashboard.cards.filterNot { c -> c.id == card.id })) }
                        }
                        DragHandle(handle)
                    }
                },
                onClick = if (editable) ({ editing = card }) else null,
            )
        }
    }
    val addable = DashboardCards.types.filter { (type, _) -> type in DashboardCards.repeatable || cards.none { it.type == type } }
    Panel("可以添加") {
        addable.entries.forEachIndexed { index, (type, name) ->
            if (index > 0) Hairline()
            ListRow(name, trailing = { Icon(Icons.Rounded.Add, contentDescription = "添加$name", tint = MaterialTheme.colorScheme.primary) }) {
                val card = newCard(type)
                if (card.type in DashboardCards.repeatable) editing = card
                else store.update { it.copy(dashboard = it.dashboard.copy(cards = it.dashboard.cards + card)) }
            }
        }
    }
    editing?.let { card ->
        CardEditDialog(card, custom, onDismiss = { editing = null }) { saved ->
            store.update { current ->
                val list = current.dashboard.cards
                val next = if (list.any { it.id == saved.id }) list.map { if (it.id == saved.id) saved else it } else list + saved
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
        "shortcuts" -> DashboardCard(id, type, title = "常用", items = listOf("forum", "announcements", "market", "tools"))
        else -> DashboardCard(id, type)
    }
}

private fun cardSummary(card: DashboardCard): String = when (card.type) {
    "countdown" -> card.date
    "note" -> card.text.lineSequence().firstOrNull()?.ifEmpty { "空白便签" } ?: "空白便签"
    "shortcuts" -> "${card.items.size} 个入口"
    else -> ""
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
    Panel("长按图标弹出 · ${custom.launcherShortcuts.size}/4", footer = "在桌面长按拾间图标就能直达这些页面。") {
        if (custom.launcherShortcuts.isEmpty()) {
            Text("还没有入口", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
        }
        ReorderableRows(custom.launcherShortcuts, key = { it }, onMove = { from, to ->
            store.update { it.copy(launcherShortcuts = it.launcherShortcuts.moved(from, to)) }
        }) { id, handle, _ ->
            val destination = custom.destination(id)
            if (destination != null) {
                ListRow(destination.title, leading = { DestinationIcon(destination, custom) }, trailing = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RemoveButton(destination.title) { store.update { it.copy(launcherShortcuts = it.launcherShortcuts - id) } }
                        DragHandle(handle)
                    }
                })
            }
        }
    }
    val full = custom.launcherShortcuts.size >= 4
    Panel("其他页面", footer = "图钉：把页面变成桌面上的一个图标；加号：放进长按菜单。") {
        custom.catalog.filter { it.kind != DestinationKind.External && it.id !in custom.launcherShortcuts }.forEachIndexed { index, destination ->
            if (index > 0) Hairline(start = 50.dp)
            ListRow(destination.title, leading = { DestinationIcon(destination, custom) }, trailing = {
                Row {
                    IconButton(onClick = { if (!LauncherShortcuts.pin(context, destination, custom)) activity.toast("当前桌面不支持固定快捷方式") }) {
                        Icon(Icons.Outlined.PushPin, contentDescription = "固定 ${destination.title} 到桌面", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    IconButton(onClick = { store.update { it.copy(launcherShortcuts = it.launcherShortcuts + destination.id) } }, enabled = !full) {
                        Icon(Icons.Rounded.Add, contentDescription = "放进长按菜单", tint = if (full) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.primary)
                    }
                }
            })
        }
    }
}

// endregion
