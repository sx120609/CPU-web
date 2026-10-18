package cn.lizmt.cpuweb.schedule

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Code
import androidx.compose.material.icons.rounded.Dashboard
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.SpaceDashboard
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material.icons.rounded.TouchApp
import androidx.compose.material.icons.rounded.ViewDay
import androidx.compose.material.icons.rounded.Widgets
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.lizmt.cpuweb.schedule.custom.ACCENT_PRESETS
import cn.lizmt.cpuweb.schedule.custom.BackBehavior
import cn.lizmt.cpuweb.schedule.custom.Customization
import cn.lizmt.cpuweb.schedule.custom.CustomizationCodec
import cn.lizmt.cpuweb.schedule.custom.CustomizationStore
import cn.lizmt.cpuweb.schedule.custom.LAYOUT_PRESETS
import cn.lizmt.cpuweb.schedule.custom.UiDensity
import cn.lizmt.cpuweb.schedule.custom.WebTweaks

/** Every settings page, by route. */
internal enum class SettingsPage(val route: String, val title: String) {
    Root("", "拾间设置"),
    Layout("layout", "布局方案"),
    Tabs("tabs", "导航栏"),
    Dashboard("dashboard", "工作台"),
    Theme("theme", "外观与主题"),
    Chrome("quick", "顶栏与快捷入口"),
    Web("web", "网页改造"),
    Behavior("behavior", "交互与行为"),
    Shortcuts("shortcuts", "桌面快捷方式"),
    Update("update", "更新与测试通道");

    companion object {
        fun of(route: String) = entries.firstOrNull { it.route == route } ?: Root
    }
}

/**
 * The customization center: a stack of native pages over the shell (or as a
 * tab of its own). Every change applies at once and is saved immediately.
 */
@Composable
fun SettingsScreen(activity: MainActivity, initialRoute: String, asTab: Boolean, onClose: () -> Unit) {
    var stack by rememberSaveable(initialRoute) { mutableStateOf(listOf(SettingsPage.of(initialRoute).route)) }
    val page = SettingsPage.of(stack.last())
    val canPop = stack.size > 1
    BackHandler(enabled = canPop || !asTab) {
        if (canPop) stack = stack.dropLast(1) else onClose()
    }
    val open = { next: SettingsPage -> stack = stack + next.route }
    val look = LocalCpuLook.current
    Column(
        Modifier.fillMaxSize().consumesTouches().background(MaterialTheme.colorScheme.background)
            .then(if (asTab) Modifier else Modifier.statusBarsPadding()),
    ) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (canPop || !asTab) {
                IconButton(onClick = { if (canPop) stack = stack.dropLast(1) else onClose() }) {
                    Icon(if (canPop) Icons.AutoMirrored.Rounded.ArrowBack else Icons.Rounded.Close, contentDescription = if (canPop) "返回" else "关闭")
                }
            } else {
                Spacer(Modifier.width(12.dp))
            }
            Text(page.title, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            if (page == SettingsPage.Root && activity.updates.channel.isBeta) NextBadge(Modifier.padding(end = 14.dp))
        }
        AnimatedContent(
            targetState = page,
            transitionSpec = {
                val forward = targetState.ordinal > initialState.ordinal || initialState == SettingsPage.Root
                val duration = look.duration(220)
                (slideInHorizontally(tween(duration)) { if (forward) it / 5 else -it / 5 } + fadeIn(tween(duration))) togetherWith
                    (slideOutHorizontally(tween(duration)) { if (forward) -it / 5 else it / 5 } + fadeOut(tween(duration)))
            },
            label = "settingsPage",
            modifier = Modifier.weight(1f),
        ) { current ->
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)
                    .then(if (asTab) Modifier else Modifier.windowInsetsPadding(WindowInsets.navigationBars))
                    .padding(bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                when (current) {
                    SettingsPage.Root -> RootPage(activity, open)
                    SettingsPage.Layout -> LayoutPage(activity)
                    SettingsPage.Tabs -> TabsPage(activity)
                    SettingsPage.Dashboard -> DashboardEditorPage(activity)
                    SettingsPage.Theme -> ThemePage(activity)
                    SettingsPage.Chrome -> ChromePage(activity)
                    SettingsPage.Web -> WebPage(activity)
                    SettingsPage.Behavior -> BehaviorPage(activity)
                    SettingsPage.Shortcuts -> ShortcutsPage(activity)
                    SettingsPage.Update -> UpdatePage(activity)
                }
            }
        }
    }
}

// region Shared components

@Composable
internal fun SettingsGroup(title: String? = null, footer: String? = null, content: @Composable ColumnScope.() -> Unit) {
    val look = LocalCpuLook.current
    Column {
        if (title != null) {
            Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(start = 6.dp, bottom = 6.dp))
        }
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(look.radius(16.dp))).background(MaterialTheme.colorScheme.surfaceContainer),
            content = content,
        )
        if (footer != null) {
            Text(footer, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 6.dp, end = 6.dp, top = 6.dp))
        }
    }
}

@Composable
internal fun SettingsRow(
    title: String,
    detail: String? = null,
    icon: ImageVector? = null,
    trailing: @Composable (() -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    Row(
        Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .heightIn(min = 52.dp).padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Box(Modifier.size(30.dp).clip(RoundedCornerShape(9.dp)).background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.width(12.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!detail.isNullOrEmpty()) {
                Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3)
            }
        }
        if (trailing != null) {
            Spacer(Modifier.width(8.dp))
            trailing()
        } else if (onClick != null) {
            Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
internal fun SwitchRow(title: String, detail: String? = null, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    SettingsRow(
        title = title, detail = detail,
        trailing = { Switch(checked = checked, onCheckedChange = if (enabled) onChange else null, enabled = enabled) },
        onClick = if (enabled) ({ onChange(!checked) }) else null,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun <T> ChoiceRow(title: String, options: List<Pair<T, String>>, selected: T, detail: String? = null, onSelect: (T) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp)) {
        Text(title, style = MaterialTheme.typography.bodyMedium)
        if (detail != null) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            options.forEach { (value, label) ->
                FilterChip(selected = value == selected, onClick = { onSelect(value) }, label = { Text(label) },
                    leadingIcon = if (value == selected) ({ Icon(Icons.Rounded.Check, contentDescription = null, modifier = Modifier.size(16.dp)) }) else null)
            }
        }
    }
}

/** A slider that saves when the finger lifts, so dragging stays smooth. */
@Composable
internal fun SliderRow(
    title: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    steps: Int,
    label: (Float) -> String,
    onChange: (Float) -> Unit,
) {
    var draft by remember(value) { mutableFloatStateOf(value) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Text(label(draft), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        }
        Slider(value = draft, onValueChange = { draft = it }, valueRange = range, steps = steps, onValueChangeFinished = { onChange(draft) })
    }
}

@Composable
internal fun Divider() {
    Box(Modifier.fillMaxWidth().padding(start = 14.dp).height(0.5.dp).background(MaterialTheme.colorScheme.outlineVariant))
}

@Composable
internal fun ConfirmDialog(title: String, text: String, confirm: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = { TextButton(onClick = { onDismiss(); onConfirm() }) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

internal fun copyToClipboard(context: Context, label: String, text: String) {
    val manager = context.getSystemService(ClipboardManager::class.java) ?: return
    manager.setPrimaryClip(ClipData.newPlainText(label, text))
}

internal fun readClipboard(context: Context): String =
    context.getSystemService(ClipboardManager::class.java)?.primaryClip?.takeIf { it.itemCount > 0 }
        ?.getItemAt(0)?.coerceToText(context)?.toString().orEmpty()

// endregion

// region Root

@Composable
private fun RootPage(activity: MainActivity, open: (SettingsPage) -> Unit) {
    val custom = activity.customization.value
    val updates = activity.updates
    val look = LocalCpuLook.current
    var confirmReset by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(look.radius(20.dp)))
            .background(Brush.linearGradient(listOf(MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.secondaryContainer)))
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(painterResource(R.drawable.app_logo), contentDescription = null, modifier = Modifier.size(52.dp).clip(RoundedCornerShape(look.radius(14.dp))))
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("药大拾间", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                if (updates.channel.isBeta) {
                    Spacer(Modifier.width(8.dp))
                    NextBadge()
                }
            }
            Text("${updates.installedVersionName} (${updates.installedVersion}) · ${updates.channel.title}",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("导航、工作台、主题和网页，全部按你的方式来", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    updates.betaInvitation?.let { version ->
        SettingsGroup {
            SettingsRow("抢先体验药大拾间 NEXT $version", "测试版先于正式版拿到新功能，随时可以退出", Icons.Rounded.SystemUpdate) { open(SettingsPage.Update) }
        }
    }
    (updates.state as? UpdateState.Ready)?.let { ready ->
        SettingsGroup {
            SettingsRow("新版 ${ready.release.versionName} 已就绪", if (updates.canInstallSilently) "离开拾间后会自动完成安装，也可以现在安装" else "点按安装",
                Icons.Rounded.SystemUpdate) { open(SettingsPage.Update) }
        }
    }
    SettingsGroup("组装你的拾间") {
        SettingsRow(SettingsPage.Layout.title, "一键换布局，或把你的布局分享给朋友", Icons.Rounded.SpaceDashboard) { open(SettingsPage.Layout) }
        Divider()
        SettingsRow(SettingsPage.Tabs.title, custom.tabDestinations.joinToString(" · ") { it.title }, Icons.Rounded.ViewDay) { open(SettingsPage.Tabs) }
        Divider()
        SettingsRow(SettingsPage.Dashboard.title, "${custom.dashboard.cards.size} 张卡片" + if (custom.tabs.contains("dashboard")) "" else "，尚未放进导航栏",
            Icons.Rounded.Dashboard) { open(SettingsPage.Dashboard) }
        Divider()
        SettingsRow(SettingsPage.Chrome.title, "顶栏按钮、投稿按钮、快捷入口的顺序", Icons.Rounded.GridView) { open(SettingsPage.Chrome) }
    }
    SettingsGroup("让它更像你") {
        SettingsRow(SettingsPage.Theme.title, accentName(custom.accent) + if (custom.pureBlack) " · 纯黑" else "", Icons.Rounded.Palette) { open(SettingsPage.Theme) }
        Divider()
        SettingsRow(SettingsPage.Web.title, webSummary(custom), Icons.Rounded.Code) { open(SettingsPage.Web) }
        Divider()
        SettingsRow(SettingsPage.Behavior.title, custom.backAtRoot.title, Icons.Rounded.TouchApp) { open(SettingsPage.Behavior) }
        Divider()
        SettingsRow(SettingsPage.Shortcuts.title, "长按图标弹出的入口，或把页面固定到桌面", Icons.Rounded.Widgets) { open(SettingsPage.Shortcuts) }
    }
    SettingsGroup("版本") {
        SettingsRow(SettingsPage.Update.title, updateSummary(updates), Icons.Rounded.SystemUpdate) { open(SettingsPage.Update) }
    }
    SettingsGroup(footer = "恢复后导航、工作台、主题与网页改造回到出厂状态；课表风格、背景和小组件不受影响。") {
        SettingsRow("恢复全部默认", icon = Icons.Rounded.RestartAlt) { confirmReset = true }
    }
    if (confirmReset) {
        ConfirmDialog("恢复全部默认？", "你的布局、卡片和便签都会被清除。可以先在“布局方案”里复制分享码备份。", "恢复",
            onDismiss = { confirmReset = false }) { activity.customization.reset() }
    }
}

private fun accentName(accent: String): String =
    ACCENT_PRESETS.firstOrNull { it.first == accent }?.second ?: "自定义 $accent"

private fun webSummary(custom: Customization): String {
    val parts = mutableListOf<String>()
    if (custom.webTheme && custom.accent != "brand") parts += "网页跟随主题色"
    if (custom.webTextZoom != 100) parts += "文字 ${custom.webTextZoom}%"
    if (custom.webTweaks.isNotEmpty()) parts += "${custom.webTweaks.size} 项改造"
    if (custom.customCssEnabled && custom.customCss.isNotBlank()) parts += "自定义样式"
    return parts.joinToString(" · ").ifEmpty { "让网页也换上你的风格" }
}

private fun updateSummary(updates: AppUpdater): String = when (val state = updates.state) {
    is UpdateState.Ready -> "新版 ${state.release.versionName} 已就绪"
    is UpdateState.Available -> "发现新版 ${state.release.versionName}"
    is UpdateState.Downloading -> "正在下载 ${state.release.versionName}"
    else -> if (updates.channel.isBeta) "已加入药大拾间 NEXT 测试通道" else "正式版通道"
}

// endregion

// region Layout presets and sharing

@Composable
private fun LayoutPage(activity: MainActivity) {
    val store = activity.customization
    val custom = store.value
    val context = LocalContext.current
    var importText by remember { mutableStateOf("") }
    var importError by remember { mutableStateOf<String?>(null) }
    SettingsGroup("布局方案", footer = "方案只换导航和工作台的排布；主题、便签和你添加的页面会保留。") {
        LAYOUT_PRESETS.forEachIndexed { index, preset ->
            if (index > 0) Divider()
            val applied = CustomizationStore.normalize(preset.apply(custom)) == custom
            SettingsRow(preset.title, preset.detail, trailing = {
                if (applied) Icon(Icons.Rounded.Check, contentDescription = "正在使用", tint = MaterialTheme.colorScheme.primary)
                else OutlinedButton(onClick = { store.update(preset.apply) }) { Text("使用") }
            })
        }
    }
    SettingsGroup("分享与备份", footer = "分享码包含导航、工作台、主题、网页改造和自定义样式，不含便签内容与称呼。") {
        SettingsRow("复制我的分享码", "发给朋友，对方粘贴即可得到同样的拾间", Icons.Rounded.Share) {
            copyToClipboard(context, "药大拾间布局", CustomizationCodec.shareCode(custom))
            activity.toast("分享码已复制")
        }
        Divider()
        SettingsRow("发送给朋友", icon = Icons.Rounded.Share) {
            val text = "我的药大拾间布局，打开拾间 → 设置 → 布局方案 → 粘贴分享码：\n" + CustomizationCodec.shareCode(custom)
            runCatching {
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "分享布局"))
            }
        }
        Divider()
        SettingsRow("再看一遍新功能介绍", icon = Icons.Rounded.SpaceDashboard) {
            store.replayIntro()
            activity.closeSettings()
        }
        Divider()
        Column(Modifier.padding(14.dp)) {
            OutlinedTextField(
                value = importText, onValueChange = { importText = it; importError = null },
                label = { Text("粘贴分享码") }, singleLine = false, maxLines = 4, modifier = Modifier.fillMaxWidth(),
                isError = importError != null, supportingText = importError?.let { { Text(it) } },
            )
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { importText = readClipboard(context); importError = null }) { Text("从剪贴板粘贴") }
                Button(onClick = {
                    if (store.import(importText)) {
                        importText = ""
                        activity.toast("已换上这套布局")
                    } else {
                        importError = "这不是有效的分享码"
                    }
                }, enabled = importText.isNotBlank()) { Text("应用") }
            }
        }
    }
}


// endregion

// region Theme

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ThemePage(activity: MainActivity) {
    val store = activity.customization
    val custom = store.value
    var hexDraft by remember(custom.accent) { mutableStateOf(if (custom.accent.startsWith("#")) custom.accent else "") }
    ThemePreview(activity)
    SettingsGroup("深浅色") {
        Column(Modifier.padding(14.dp)) { AppearancePicker(activity.appearance) }
        Divider()
        SwitchRow("纯黑深色", "深色模式下用纯黑背景，OLED 屏幕更省电", custom.pureBlack) { value -> store.update { it.copy(pureBlack = value) } }
    }
    SettingsGroup("主题色", footer = "所有颜色都会自动调到在浅色和深色下都清楚可读。") {
        FlowRow(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ACCENT_PRESETS.forEach { (value, name) ->
                val dynamicUnavailable = value == "dynamic" && Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                val swatch = when (value) {
                    "brand" -> CpuBrand
                    "dynamic" -> null
                    else -> parseHex(value)
                }
                val selected = custom.accent == value
                Column(
                    Modifier.width(56.dp).clip(RoundedCornerShape(12.dp))
                        .clickable(enabled = !dynamicUnavailable) { store.update { it.copy(accent = value) } }
                        .semantics { role = Role.RadioButton; contentDescription = name },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        Modifier.size(40.dp).clip(CircleShape)
                            .background(swatch?.let { Brush.linearGradient(listOf(it, it)) }
                                ?: Brush.sweepGradient(listOf(Color(0xFFE5533D), Color(0xFFC99A00), Color(0xFF2E7D32), Color(0xFF1E6FD9), Color(0xFF7A4CC2), Color(0xFFE5533D))))
                            .border(if (selected) 3.dp else 0.dp, MaterialTheme.colorScheme.onBackground, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (selected) Icon(Icons.Rounded.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(name, style = MaterialTheme.typography.labelSmall, maxLines = 1,
                        color = if (dynamicUnavailable) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.onSurface)
                }
            }
        }
        Divider()
        HueRow(custom.accent) { hex -> store.update { it.copy(accent = hex) } }
        Divider()
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = hexDraft, onValueChange = { hexDraft = it.take(7) }, label = { Text("色值，如 #C2337A") }, singleLine = true,
                modifier = Modifier.weight(1f), textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
            )
            Spacer(Modifier.width(8.dp))
            Button(onClick = {
                val hex = (if (hexDraft.startsWith("#")) hexDraft else "#$hexDraft").uppercase()
                if (parseHex(hex) != null) store.update { it.copy(accent = hex) } else activity.toast("请输入 6 位十六进制色值")
            }) { Text("应用") }
        }
    }
    SettingsGroup("形状与密度") {
        SliderRow("圆角", custom.corners, 0f..1.6f, 15, label = { cornerLabel(it) }) { value -> store.update { it.copy(corners = value) } }
        Divider()
        ChoiceRow("界面密度", UiDensity.entries.map { it to it.title }, custom.density, detail = "顶栏、导航栏和列表的疏密") { value ->
            store.update { it.copy(density = value) }
        }
        Divider()
        SliderRow("原生界面文字", custom.fontScale, 0.85f..1.3f, 8, label = { "${(it * 100).toInt()}%" }) { value ->
            store.update { it.copy(fontScale = value) }
        }
    }
    SettingsGroup("网页", footer = "开启后，网页的按钮、链接、圆角和纯黑背景也跟着你的设置变。") {
        SwitchRow("网页跟随主题", checked = custom.webTheme) { value -> store.update { it.copy(webTheme = value) } }
        Divider()
        SliderRow("网页文字大小", custom.webTextZoom.toFloat(), 80f..150f, 13, label = { "${it.toInt()}%" }) { value ->
            store.update { it.copy(webTextZoom = (value / 5).toInt() * 5) }
        }
    }
}

private fun cornerLabel(value: Float) = when {
    value < 0.3f -> "方正"
    value < 0.8f -> "利落"
    value < 1.2f -> "适中"
    else -> "圆润"
} + " ${(value * 100).toInt()}%"

/** A hue strip: slide to any colour, saved at a fixed saturation and lightness that read well. */
@Composable
private fun HueRow(accent: String, onPick: (String) -> Unit) {
    val current = parseHex(accent)?.let { hueOf(it) } ?: 170f
    SliderRow("任意颜色", current, 0f..359f, 0, label = { "色相 ${it.toInt()}°" }) { hue -> onPick(hslColor(hue).toHex()) }
    Box(
        Modifier.padding(horizontal = 24.dp).fillMaxWidth().height(8.dp).clip(CircleShape)
            .background(Brush.horizontalGradient((0..6).map { hslColor(it * 60f) })),
    )
    Spacer(Modifier.height(10.dp))
}

private fun hslColor(hue: Float): Color {
    val hsl = floatArrayOf(hue, 0.62f, 0.44f)
    return Color(androidx.core.graphics.ColorUtils.HSLToColor(hsl))
}

private fun hueOf(color: Color): Float {
    val hsl = FloatArray(3)
    androidx.core.graphics.ColorUtils.colorToHSL(
        android.graphics.Color.rgb((color.red * 255).toInt(), (color.green * 255).toInt(), (color.blue * 255).toInt()), hsl,
    )
    return hsl[0]
}

/** A small mock of the shell in the current theme, updating as the user changes things. */
@Composable
private fun ThemePreview(activity: MainActivity) {
    val custom = activity.customization.value
    val look = LocalCpuLook.current
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(look.radius(20.dp))).background(MaterialTheme.colorScheme.background)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(look.radius(20.dp))),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("预览", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(look.radius(14.dp))).background(MaterialTheme.colorScheme.surfaceContainer).padding(12.dp),
            ) {
                Text("下一节 · 药理学", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("10:10–11:50 · 教3-201", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = {}) { Text("查看课表") }
                    OutlinedButton(onClick = {}) { Text("稍后") }
                }
            }
        }
        NativeTabBar(custom, custom.launchTab, unread = 3, backdrop = MaterialTheme.colorScheme.background,
            onSelect = {}, onCustomize = {}, applyInsets = false)
    }
}

// endregion

// region Web

@Composable
private fun WebPage(activity: MainActivity) {
    val store = activity.customization
    val custom = store.value
    var css by remember(custom.customCss) { mutableStateOf(custom.customCss) }
    SettingsGroup("页面改造", footer = "只改变你手机上的显示，不影响别人，也不会改动你的数据。") {
        WebTweaks.all.forEachIndexed { index, tweak ->
            if (index > 0) Divider()
            SwitchRow(tweak.title, tweak.detail, tweak.id in custom.webTweaks) { on ->
                store.update { it.copy(webTweaks = if (on) it.webTweaks + tweak.id else it.webTweaks - tweak.id) }
            }
        }
    }
    SettingsGroup("自定义样式", footer = "高级：写 CSS 改造任何网页元素，例如 .home-entry{display:none}。只粘贴你看得懂的代码。") {
        SwitchRow("启用自定义样式", checked = custom.customCssEnabled) { on -> store.update { it.copy(customCssEnabled = on) } }
        Divider()
        Column(Modifier.padding(14.dp)) {
            OutlinedTextField(
                value = css, onValueChange = { css = it.take(20_000) }, modifier = Modifier.fillMaxWidth().heightIn(min = 140.dp),
                textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 12.sp),
                placeholder = { Text("/* 例如：让帖子标题更大 */\n.topic-title { font-size: 18px !important; }") },
            )
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { store.update { it.copy(customCss = css, customCssEnabled = true) }; activity.toast("样式已应用") },
                    enabled = css != custom.customCss || !custom.customCssEnabled) { Text("保存并应用") }
                OutlinedButton(onClick = { css = ""; store.update { it.copy(customCss = "") } }) { Text("清空") }
            }
        }
    }
}

// endregion

// region Behavior

@Composable
private fun BehaviorPage(activity: MainActivity) {
    val store = activity.customization
    val custom = store.value
    SettingsGroup("返回键") {
        BackBehavior.entries.forEachIndexed { index, behavior ->
            if (index > 0) Divider()
            SettingsRow(behavior.title, behavior.detail,
                trailing = { RadioButton(selected = custom.backAtRoot == behavior, onClick = { store.update { it.copy(backAtRoot = behavior) } }) },
                onClick = { store.update { it.copy(backAtRoot = behavior) } })
        }
    }
    SettingsGroup("手势与反馈") {
        SwitchRow("再点一次当前标签", "网页回到顶层或刷新，课表回到本周，工作台刷新", custom.doubleTapRefresh) { value ->
            store.update { it.copy(doubleTapRefresh = value) }
        }
        Divider()
        SwitchRow("触感反馈", "切换标签、长按时轻微振动", custom.haptics) { value -> store.update { it.copy(haptics = value) } }
        Divider()
        SwitchRow("减弱动态效果", "原生界面的过渡动画一律跳过", custom.reduceMotion) { value -> store.update { it.copy(reduceMotion = value) } }
    }
    SettingsGroup("屏幕") {
        SwitchRow("看课表时保持亮屏", "停留在课表时屏幕不会自动熄灭", custom.keepScreenOn) { value -> store.update { it.copy(keepScreenOn = value) } }
        Divider()
        SwitchRow("隐私模式", "禁止截屏，多任务界面不显示拾间的内容", custom.secureScreen) { value -> store.update { it.copy(secureScreen = value) } }
    }
}

// endregion
