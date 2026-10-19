package cn.lizmt.cpuweb.schedule

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
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
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.lizmt.cpuweb.schedule.custom.ACCENT_PRESETS
import cn.lizmt.cpuweb.schedule.custom.BackBehavior
import cn.lizmt.cpuweb.schedule.custom.Customization
import cn.lizmt.cpuweb.schedule.custom.CustomizationCodec
import cn.lizmt.cpuweb.schedule.custom.CustomizationStore
import cn.lizmt.cpuweb.schedule.custom.LAYOUT_PRESETS
import cn.lizmt.cpuweb.schedule.custom.TabBarStyle
import cn.lizmt.cpuweb.schedule.custom.TabLabelMode
import cn.lizmt.cpuweb.schedule.custom.UiDensity
import cn.lizmt.cpuweb.schedule.custom.WebTweaks

/** Every settings page, by route. */
internal enum class SettingsPage(val route: String, val title: String) {
    Root("", "拾间设置"),
    Tabs("tabs", "导航栏"),
    Dashboard("dashboard", "今天"),
    Theme("theme", "主题色"),
    Quick("quick", "快捷入口"),
    Shortcuts("shortcuts", "桌面快捷方式"),
    Web("web", "网页改造"),
    Layout("layout", "布局方案"),
    More("more", "更多设置"),
    Reminders("reminders", "提醒检查"),
    Update("update", "更新");

    companion object {
        fun of(route: String) = entries.firstOrNull { it.route == route } ?: if (route == "behavior") More else Root
    }
}

/**
 * The settings: a stack of native pages over the shell (or as a tab of its
 * own). Every change applies at once and is saved immediately.
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
        Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (canPop || !asTab) {
                IconButton(onClick = { if (canPop) stack = stack.dropLast(1) else onClose() }) {
                    Icon(if (canPop) Icons.AutoMirrored.Rounded.ArrowBack else Icons.Rounded.Close, contentDescription = if (canPop) "返回" else "关闭")
                }
            } else {
                Spacer(Modifier.width(12.dp))
            }
            Text(page.title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        }
        AnimatedContent(
            targetState = page,
            transitionSpec = {
                val forward = targetState.ordinal > initialState.ordinal || initialState == SettingsPage.Root
                val duration = look.duration(200)
                (slideInHorizontally(tween(duration)) { if (forward) it / 6 else -it / 6 } + fadeIn(tween(duration))) togetherWith
                    (slideOutHorizontally(tween(duration)) { if (forward) -it / 6 else it / 6 } + fadeOut(tween(duration)))
            },
            label = "settingsPage",
            modifier = Modifier.weight(1f),
        ) { current ->
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)
                    .then(if (asTab) Modifier else Modifier.windowInsetsPadding(WindowInsets.navigationBars))
                    .padding(top = 4.dp, bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                when (current) {
                    SettingsPage.Root -> RootPage(activity, open)
                    SettingsPage.Tabs -> TabsPage(activity)
                    SettingsPage.Dashboard -> DashboardEditorPage(activity)
                    SettingsPage.Theme -> ThemePage(activity)
                    SettingsPage.Quick -> QuickPage(activity)
                    SettingsPage.Shortcuts -> ShortcutsPage(activity)
                    SettingsPage.Web -> WebPage(activity)
                    SettingsPage.Layout -> LayoutPage(activity)
                    SettingsPage.More -> MorePage(activity, open)
                    SettingsPage.Reminders -> ReminderCheckPage(activity)
                    SettingsPage.Update -> UpdatePage(activity)
                }
            }
        }
    }
}

// region Shared pieces

/** A label above a control (segmented choices, pills) inside a panel. */
@Composable
internal fun LabeledControl(label: String, detail: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        if (detail != null) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(10.dp))
        content()
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
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            Text(label(draft), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Slider(value = draft, onValueChange = { draft = it }, valueRange = range, steps = steps, onValueChangeFinished = { onChange(draft) })
    }
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

private fun accentColor(accent: String): Color? = when (accent) {
    "brand" -> CpuBrand
    "dynamic" -> null
    else -> parseHex(accent)
}

private fun accentName(accent: String): String =
    ACCENT_PRESETS.firstOrNull { it.first == accent }?.second ?: "自定义 $accent"

@Composable
private fun Swatch(accent: String, size: Int = 18) {
    val color = accentColor(accent)
    Box(
        Modifier.size(size.dp).clip(CircleShape).background(
            color?.let { Brush.linearGradient(listOf(it, it)) }
                ?: Brush.sweepGradient(listOf(Color(0xFFE5533D), Color(0xFFC99A00), Color(0xFF2E7D32), Color(0xFF1E6FD9), Color(0xFF7A4CC2), Color(0xFFE5533D))),
        ),
    )
}

// endregion

// region Root

@Composable
private fun RootPage(activity: MainActivity, open: (SettingsPage) -> Unit) {
    val custom = activity.customization.value
    val updates = activity.updates
    val context = LocalContext.current
    var courseMinutes by remember { mutableIntStateOf(AgendaReminders.courseMinutes(context)) }
    val resumed = rememberResumeCount()
    val reminderHealth = remember(resumed, courseMinutes) { AgendaReminders.health(context) }
    (updates.state as? UpdateState.Ready)?.let { ready ->
        Panel {
            ListRow("新版 ${ready.release.versionName} 已准备好",
                detail = if (updates.canInstallSilently) "离开拾间一会儿后会自动装好" else "点按安装", chevron = true) { open(SettingsPage.Update) }
        }
    }
    Panel {
        ListRow("导航栏", value = custom.tabDestinations.joinToString(" · ") { it.title }, chevron = true) { open(SettingsPage.Tabs) }
        Hairline()
        ListRow("今天", value = "${custom.dashboard.cards.size} 个部分", chevron = true) { open(SettingsPage.Dashboard) }
        Hairline()
        ListRow("主题色", value = accentName(custom.accent), trailing = { Swatch(custom.accent) }, chevron = true) { open(SettingsPage.Theme) }
    }
    Panel("外观") {
        Box(Modifier.padding(12.dp)) { AppearancePicker(activity.appearance) }
        Hairline()
        ToggleRow("纯黑深色", checked = custom.pureBlack) { value -> activity.customization.update { it.copy(pureBlack = value) } }
    }
    Panel("提醒", footer = "日程的提醒在添加时设定。") {
        LabeledControl("上课提醒", detail = "按你的课表，在每节课开始前提醒") {
            PillChoices(AgendaReminders.COURSE_CHOICES, courseMinutes) { minutes ->
                courseMinutes = minutes
                AgendaReminders.setCourseMinutes(context, minutes)
                if (minutes >= 0) activity.ensureNotificationPermission()
            }
        }
        if (courseMinutes >= 0) {
            Text(remember(resumed, courseMinutes) { nextCourseReminderText(context) }, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp))
        }
        Hairline()
        ListRow(
            "提醒没响？",
            detail = if (reminderHealth.problems > 0) "有 ${reminderHealth.problems} 项设置可能拦下提醒" else "检查通知、闹钟和后台限制，发一条测试提醒",
            titleColor = if (reminderHealth.problems > 0) MaterialTheme.colorScheme.error else androidx.compose.ui.graphics.Color.Unspecified,
            chevron = true,
        ) { open(SettingsPage.Reminders) }
    }
    Panel("拾间AI 可以看到", footer = ASSISTANT_ACCESS_FOOTER) {
        AssistantAccessRows(activity.assistant)
    }
    Panel("拾间AI 的操作怎么确认") {
        AssistantApprovalRows(activity.assistant)
    }
    SyncPanel(activity)
    Panel {
        ListRow("更新", value = updateSummary(updates), chevron = true) { open(SettingsPage.Update) }
        Hairline()
        ListRow("更多设置", chevron = true) { open(SettingsPage.More) }
    }
    Text("药大拾间 NEXT ${updates.installedVersionName} · 独立测试版，可与正式版同时安装",
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
}

private fun updateSummary(updates: AppUpdater): String = when (val state = updates.state) {
    is UpdateState.Ready -> "新版 ${state.release.versionName} 已就绪"
    is UpdateState.Available -> "发现新版 ${state.release.versionName}"
    is UpdateState.Downloading -> "正在下载"
    else -> updates.installedVersionName
}

// endregion

// region More

@Composable
private fun MorePage(activity: MainActivity, open: (SettingsPage) -> Unit) {
    val store = activity.customization
    val custom = store.value
    var confirmReset by remember { mutableStateOf(false) }
    Panel("布局") {
        ListRow("布局方案与分享", chevron = true) { open(SettingsPage.Layout) }
        Hairline()
        ListRow("快捷入口", value = "${custom.quickEntries.size} 个", chevron = true) { open(SettingsPage.Quick) }
        Hairline()
        ListRow("桌面快捷方式", value = "${custom.launcherShortcuts.size} 个", chevron = true) { open(SettingsPage.Shortcuts) }
    }
    Panel("导航栏与顶栏") {
        LabeledControl("导航栏样式") {
            Segmented(TabBarStyle.entries.map { it to it.title }, custom.tabBarStyle) { value -> store.update { it.copy(tabBarStyle = value) } }
        }
        Hairline()
        LabeledControl("导航栏文字") {
            Segmented(TabLabelMode.entries.map { it to it.title }, custom.tabLabels) { value -> store.update { it.copy(tabLabels = value) } }
        }
        Hairline()
        ToggleRow("顶栏显示拾间图标", checked = custom.topBar.logo) { value -> store.update { it.copy(topBar = it.topBar.copy(logo = value)) } }
        Hairline()
        ToggleRow("顶栏刷新按钮", checked = custom.topBar.refresh) { value -> store.update { it.copy(topBar = it.topBar.copy(refresh = value)) } }
        Hairline()
        ToggleRow("顶栏消息按钮", checked = custom.topBar.messages) { value -> store.update { it.copy(topBar = it.topBar.copy(messages = value)) } }
        Hairline()
        ToggleRow("顶栏快捷入口按钮", checked = custom.topBar.quickEntry) { value -> store.update { it.copy(topBar = it.topBar.copy(quickEntry = value)) } }
        Hairline()
        ToggleRow("首页投稿按钮", checked = custom.postButton) { value -> store.update { it.copy(postButton = value) } }
    }
    Panel("界面") {
        SliderRow("圆角", custom.corners, 0f..1.6f, 15, label = { "${(it * 100).toInt()}%" }) { value -> store.update { it.copy(corners = value) } }
        Hairline()
        LabeledControl("疏密") {
            Segmented(UiDensity.entries.map { it to it.title }, custom.density) { value -> store.update { it.copy(density = value) } }
        }
        Hairline()
        SliderRow("文字大小", custom.fontScale, 0.85f..1.3f, 8, label = { "${(it * 100).toInt()}%" }) { value -> store.update { it.copy(fontScale = value) } }
    }
    Panel("网页") {
        ToggleRow("网页跟着换主题色", checked = custom.webTheme) { value -> store.update { it.copy(webTheme = value) } }
        Hairline()
        SliderRow("网页文字大小", custom.webTextZoom.toFloat(), 80f..150f, 13, label = { "${it.toInt()}%" }) { value ->
            store.update { it.copy(webTextZoom = (value / 5).toInt() * 5) }
        }
        Hairline()
        ListRow("网页改造", value = (custom.webTweaks.size + if (custom.customCssEnabled && custom.customCss.isNotBlank()) 1 else 0)
            .let { if (it == 0) "未开启" else "$it 项" }, chevron = true) { open(SettingsPage.Web) }
    }
    Panel("在启动页按返回") {
        CheckList(BackBehavior.entries.map { Triple(it, it.title, it.detail) }, custom.backAtRoot) { value -> store.update { it.copy(backAtRoot = value) } }
    }
    Panel("交互") {
        ToggleRow("再点一次当前标签", detail = "网页回到顶层或刷新，课表回到本周", checked = custom.doubleTapRefresh) { value -> store.update { it.copy(doubleTapRefresh = value) } }
        Hairline()
        ToggleRow("触感反馈", checked = custom.haptics) { value -> store.update { it.copy(haptics = value) } }
        Hairline()
        ToggleRow("减弱动态效果", checked = custom.reduceMotion) { value -> store.update { it.copy(reduceMotion = value) } }
        Hairline()
        ToggleRow("看课表时保持亮屏", checked = custom.keepScreenOn) { value -> store.update { it.copy(keepScreenOn = value) } }
        Hairline()
        ToggleRow("隐私模式", detail = "禁止截屏，多任务界面不显示内容", checked = custom.secureScreen) { value -> store.update { it.copy(secureScreen = value) } }
    }
    Panel {
        ListRow("恢复全部默认", titleColor = MaterialTheme.colorScheme.error) { confirmReset = true }
    }
    if (confirmReset) {
        ConfirmDialog("恢复全部默认？", "导航、今天、主题和网页改造回到出厂状态。日程、待办、课表风格和小组件不受影响。", "恢复",
            onDismiss = { confirmReset = false }) { activity.customization.reset() }
    }
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
    val applied = LAYOUT_PRESETS.firstOrNull { CustomizationStore.normalize(it.apply(custom)) == custom }?.id
    Panel("布局方案", footer = "方案只换导航栏；今天的内容、主题和你添加的页面会保留。") {
        CheckList(LAYOUT_PRESETS.map { Triple(it.id as String?, it.title, it.detail) }, applied) { id ->
            LAYOUT_PRESETS.firstOrNull { it.id == id }?.let { preset ->
                store.update(preset.apply)
                activity.toast("已换成「${preset.title}」")
            }
        }
    }
    Panel("分享与备份", footer = "分享码包含导航、今天的布局、主题和网页改造，不含便签内容。") {
        ListRow("复制我的分享码") {
            copyToClipboard(context, "药大拾间布局", CustomizationCodec.shareCode(custom))
            activity.toast("分享码已复制")
        }
        Hairline()
        ListRow("发送给朋友") {
            val text = "我的药大拾间 NEXT 布局，打开拾间 → 设置 → 更多设置 → 布局方案与分享 → 粘贴：\n" + CustomizationCodec.shareCode(custom)
            runCatching {
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "分享布局"))
            }
        }
        Hairline()
        Column(Modifier.padding(16.dp)) {
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
    Panel {
        ListRow("再看一遍新功能介绍") {
            store.replayIntro()
            activity.closeSettings()
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
    var customizing by remember { mutableStateOf(false) }
    ThemePreview(activity)
    Panel("主题色", footer = "颜色都会自动调到在浅色和深色下都清楚可读。") {
        FlowRow(Modifier.padding(horizontal = 8.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ACCENT_PRESETS.forEach { (value, name) ->
                val dynamicUnavailable = value == "dynamic" && Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                val selected = custom.accent == value
                Column(
                    Modifier.width(60.dp).clip(RoundedCornerShape(12.dp))
                        .clickable(enabled = !dynamicUnavailable) { store.update { it.copy(accent = value) } }
                        .padding(vertical = 6.dp)
                        .semantics { role = Role.RadioButton; contentDescription = name },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        Modifier.size(36.dp).clip(CircleShape)
                            .border(if (selected) 2.dp else 0.dp, MaterialTheme.colorScheme.onSurface, CircleShape).padding(if (selected) 4.dp else 0.dp),
                        contentAlignment = Alignment.Center,
                    ) { Swatch(value, size = if (selected) 28 else 36) }
                    Spacer(Modifier.height(4.dp))
                    Text(name, style = MaterialTheme.typography.labelSmall, maxLines = 1,
                        color = if (dynamicUnavailable) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.onSurface)
                }
            }
        }
        Hairline()
        ListRow("自定义颜色", value = custom.accent.takeIf { it.startsWith("#") && ACCENT_PRESETS.none { p -> p.first == it } }, chevron = true) {
            customizing = true
        }
    }
    if (customizing) CustomAccentDialog(custom.accent, onDismiss = { customizing = false }) { hex -> store.update { it.copy(accent = hex) } }
}

/** Any colour: a hue strip at a saturation and lightness that read well, or a hex value. */
@Composable
private fun CustomAccentDialog(accent: String, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    var hue by remember { mutableFloatStateOf(parseHex(accent)?.let { hueOf(it) } ?: 170f) }
    var hex by remember { mutableStateOf(accent.takeIf { it.startsWith("#") } ?: hslColor(hue).toHex()) }
    val color = parseHex(hex)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("自定义颜色") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.fillMaxWidth().height(44.dp).clip(RoundedCornerShape(12.dp)).background(color ?: MaterialTheme.colorScheme.surfaceContainerHigh))
                Box(Modifier.fillMaxWidth().height(8.dp).clip(CircleShape).background(Brush.horizontalGradient((0..6).map { hslColor(it * 60f) })))
                Slider(value = hue, onValueChange = { hue = it; hex = hslColor(it).toHex() }, valueRange = 0f..359f)
                OutlinedTextField(
                    value = hex, onValueChange = { hex = it.take(7).uppercase() }, label = { Text("色值，如 #C2337A") }, singleLine = true,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace), isError = color == null,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { if (color != null) { onPick(hex); onDismiss() } }, enabled = color != null) { Text("使用") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

private fun hslColor(hue: Float): Color = Color(androidx.core.graphics.ColorUtils.HSLToColor(floatArrayOf(hue, 0.62f, 0.44f)))

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
    val scheme = MaterialTheme.colorScheme
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(look.radius(20.dp))).background(scheme.background)
            .border(0.5.dp, scheme.outlineVariant, RoundedCornerShape(look.radius(20.dp))),
    ) {
        Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 14.dp, bottom = 4.dp)) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(look.radius(14.dp))).background(scheme.surfaceContainer).padding(14.dp)) {
                Text("下一节 · 25 分钟后", style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant)
                Text("药理学", style = MaterialTheme.typography.titleLarge)
                Text("10:10–11:50 · 药学楼 302", style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant)
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TodoCheck(true) {}
                    Text("交实验报告", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    Text("提醒", style = MaterialTheme.typography.labelMedium, color = scheme.primary)
                }
            }
        }
        NativeTabBar(custom, custom.launchTab, unread = 3, backdrop = scheme.background, onSelect = {}, onCustomize = {}, applyInsets = false)
    }
}

// endregion

// region Web

@Composable
private fun WebPage(activity: MainActivity) {
    val store = activity.customization
    val custom = store.value
    var css by remember(custom.customCss) { mutableStateOf(custom.customCss) }
    Panel("页面改造", footer = "只改变你手机上的显示，不影响别人，也不会改动你的数据。") {
        WebTweaks.all.forEachIndexed { index, tweak ->
            if (index > 0) Hairline()
            ToggleRow(tweak.title, checked = tweak.id in custom.webTweaks) { on ->
                store.update { it.copy(webTweaks = if (on) it.webTweaks + tweak.id else it.webTweaks - tweak.id) }
            }
        }
    }
    Panel("自定义样式", footer = "写 CSS 改造网页元素，例如 .home-entry{display:none}。只粘贴你看得懂的代码。") {
        ToggleRow("启用自定义样式", checked = custom.customCssEnabled) { on -> store.update { it.copy(customCssEnabled = on) } }
        Hairline()
        Column(Modifier.padding(16.dp)) {
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
