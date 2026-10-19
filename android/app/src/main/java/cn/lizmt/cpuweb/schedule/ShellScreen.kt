package cn.lizmt.cpuweb.schedule

import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Home
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.shadow
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.animation.animateColorAsState
import androidx.compose.ui.input.pointer.pointerInput
import android.content.Context
import android.view.View
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.MenuBook
import androidx.compose.material.icons.rounded.AdminPanelSettings
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.BrightnessAuto
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.DarkMode
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.LightMode
import androidx.compose.material.icons.rounded.Mail
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.ShoppingBag
import androidx.compose.material.icons.rounded.WifiOff
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.graphics.toArgb
import kotlin.math.roundToInt
import androidx.core.view.WindowCompat
import kotlinx.coroutines.launch

/** Appearance preference shared by the native shell and the Web page. */
class AppearanceSettings(context: Context) {
    private val prefs = context.getSharedPreferences("native_appearance", Context.MODE_PRIVATE)
    var mode by mutableStateOf(prefs.getString("mode", "system") ?: "system")
        private set
    lateinit var onUserChange: (String) -> Unit

    fun select(value: String) {
        val next = if (value == "dark" || value == "light") value else "system"
        mode = next
        prefs.edit().putString("mode", next).apply()
        if (::onUserChange.isInitialized) onUserChange(next)
    }

    /** The Web top bar is hidden, but the page may still restore its own saved choice. */
    fun adoptWebMode(value: String) {
        val next = if (value == "dark" || value == "light") value else "system"
        if (next == mode) return
        mode = next
        prefs.edit().putString("mode", next).apply()
    }
}

@Composable
fun AppRoot(activity: MainActivity) {
    val shell = activity.shell
    val web = activity.web
    val dark = resolveDark(activity.appearance.mode, androidx.compose.foundation.isSystemInDarkTheme())
    val view = LocalView.current
    SideEffect {
        val controller = WindowCompat.getInsetsController(activity.window, view)
        val lightBars = !dark && activity.imagePreview == null
        controller.isAppearanceLightStatusBars = lightBars
        controller.isAppearanceLightNavigationBars = lightBars
    }
    LaunchedEffect(Unit) {
        activity.appearance.onUserChange = { mode -> web.setAppearanceMode(mode) }
    }
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ShellScaffold(activity)
        when {
            !activity.welcomeSeen -> WelcomeScreen { activity.finishWelcome() }
            shell.requiresLogin -> LoginGate(activity)
            !shell.isAuthResolved && activity.schedule.result == null -> LaunchWaiting()
        }
        activity.imagePreview?.let { request ->
            ImagePreviewScreen(request, onSave = { image -> saveImage(activity, image) }) { activity.imagePreview = null }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ShellScaffold(activity: MainActivity) {
    val shell = activity.shell
    val web = activity.web
    val tab = shell.selectedTab
    val onSchedule = tab == ShellTab.Schedule
    val showNativeSchedule = onSchedule && !web.webOverlayVisible && !web.androidUpdateVisible
    val pageNavigation = PageChrome.usesPageNavigation(web.currentPath) || web.header.pageNavigation
    val imeVisible = WindowInsets.isImeVisible
    var quickEntryOpen by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val gated = shell.requiresLogin || !activity.welcomeSeen

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        if (!onSchedule && !pageNavigation && !gated) {
            NativeTopBar(
                header = web.header,
                authenticated = web.authState.authenticated || web.header.authenticated,
                unread = web.unreadCount,
                onHome = { shell.userSelected(ShellTab.Home) },
                onBack = { web.headerAction("back", tab.path) },
                onRefresh = { web.refresh() },
                onMessages = { shell.openWeb("/messages", ShellTab.Profile) },
                onLogin = { shell.openWeb("/login") },
                onMore = {
                    scope.launch { web.refreshAuthCapability() }
                    quickEntryOpen = true
                },
            )
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            NativeWebViewport(activity,
                covered = showNativeSchedule || gated || activity.imagePreview != null || web.failureMessage != null ||
                    (!shell.isAuthResolved && activity.schedule.result == null),
                showPost = tab == ShellTab.Home && web.currentPath.substringBefore('?').let { it == "/home" || it == "/" } && !imeVisible,
            )
            if (!onSchedule && !gated) {
                web.failureMessage?.let { message ->
                    ServiceUnavailable(message) { web.retry() }
                }
            }
            ScheduleLayer(visible = showNativeSchedule) { NativeScheduleScreen(activity) }
        }
        val showBar = !gated && !imeVisible && !(pageNavigation && !onSchedule)
        if (showBar) {
            NativeTabBar(
                selected = tab,
                // The strip around the bar continues the surface above it.
                backdrop = if (onSchedule) LocalScheduleColors.current.page else MaterialTheme.colorScheme.background,
                onSelect = { shell.userSelected(it) },
            )
        } else {
            Spacer(Modifier.windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars).only(WindowInsetsSides.Bottom)))
        }
    }

    if (quickEntryOpen) {
        QuickEntrySheet(
            activity = activity,
            onDismiss = { quickEntryOpen = false },
            onOpen = { path, destination ->
                quickEntryOpen = false
                when {
                    destination == ShellTab.Schedule -> shell.userSelected(ShellTab.Schedule)
                    path != null -> shell.openWeb(path, destination ?: ShellTab.Home)
                }
            },
        )
    }
}

/** The native timetable fades in over the shared WebView, like the HarmonyOS shell. */
@Composable
private fun ScheduleLayer(visible: Boolean, content: @Composable () -> Unit) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(tween(220)) + slideInVertically(tween(220)) { it / 60 },
        exit = fadeOut(tween(160)),
    ) {
        content()
    }
}

/** Only reports layout; the page is a native sibling and receives no Compose pointer events. */
@Composable
private fun NativeWebViewport(activity: MainActivity, covered: Boolean, showPost: Boolean) {
    val layer = activity.nativeWebLayer
    val web = activity.web
    val page = web.webView
    val color = MaterialTheme.colorScheme.background.toArgb()
    val loading = web.isLoading && !web.contentReady
    SideEffect {
        layer.bind(page)
        layer.setBackgroundColor(color)
        layer.showPage(!covered, loading, showPost)
    }
    Box(Modifier.fillMaxSize().onGloballyPositioned { coordinates ->
        val origin = coordinates.positionInRoot()
        layer.place(origin.x.roundToInt(), origin.y.roundToInt(), coordinates.size.width, coordinates.size.height)
        layer.showPage(!covered, loading, showPost)
    })
}

@Composable
fun NativePostAction(activity: MainActivity) {
    ExtendedFloatingActionButton(
        onClick = { activity.shell.openWeb("/post", ShellTab.Home) },
        icon = { Icon(Icons.Rounded.Edit, contentDescription = null) },
        text = { Text("投稿") },
        containerColor = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.primary,
        elevation = androidx.compose.material3.FloatingActionButtonDefaults.elevation(
            defaultElevation = 0.dp,
            pressedElevation = 0.dp,
            focusedElevation = 0.dp,
            hoveredElevation = 0.dp,
        ),
    )
}

/**
 * Native surfaces drawn over the shared WebView swallow every touch, so taps on
 * their padding or text never reach the hidden page underneath.
 */
fun Modifier.consumesTouches(): Modifier = pointerInput(Unit) {
    awaitPointerEventScope {
        while (true) awaitPointerEvent()
    }
}

@Composable
private fun NativeTopBar(
    header: WebHeaderState,
    authenticated: Boolean,
    unread: Int,
    onHome: () -> Unit,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onMessages: () -> Unit,
    onLogin: () -> Unit,
    onMore: () -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.background, tonalElevation = 0.dp) {
        Row(
            Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (header.back) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "返回")
                }
            } else {
                Row(
                    Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = onHome).padding(horizontal = 6.dp, vertical = 6.dp)
                        .semantics { contentDescription = "药大拾间，返回首页" },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Image(
                        painterResource(R.drawable.app_logo),
                        contentDescription = null,
                        modifier = Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)),
                    )
                }
            }
            Text(
                text = header.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = if (!header.back && header.title == "药大拾间") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(start = 4.dp, end = 4.dp),
            )
            IconButton(onClick = onRefresh) { Icon(Icons.Rounded.Refresh, contentDescription = "刷新页面") }
            if (authenticated) {
                IconButton(onClick = onMessages) {
                    BadgedBox(badge = {
                        if (unread > 0) Badge { Text(if (unread > 99) "99+" else unread.toString()) }
                    }) {
                        Icon(Icons.Rounded.Notifications, contentDescription = if (unread > 0) "消息，${unread}条未读" else "消息")
                    }
                }
            } else {
                TextButton(onClick = onLogin) { Text("登录") }
            }
            IconButton(onClick = onMore) { Icon(Icons.Rounded.GridView, contentDescription = "更多") }
        }
    }
}

/** Same five symbols as iOS ShellTab; all share a quiet, rounded outline weight. */
private fun ShellTab.tabIcon(): Int = when (this) {
    ShellTab.Home -> R.drawable.tab_home
    ShellTab.Academic -> R.drawable.tab_academic
    ShellTab.Schedule -> R.drawable.tab_schedule
    ShellTab.Services -> R.drawable.tab_services
    ShellTab.Profile -> R.drawable.tab_profile
}

/** Compact iOS-style floating tabs, reserving space so the timetable never sits behind them. */
@Composable
private fun NativeTabBar(selected: ShellTab, backdrop: Color, onSelect: (ShellTab) -> Unit) {
    val dark = LocalScheduleColors.current.dark
    val container = if (dark) Color(0xFF242428) else Color(0xFFFCFCFD)
    val outline = if (dark) Color(0xFF414146) else Color(0xFFE7E7EB)
    val pill = if (dark) Color(0xFF3B3B40) else Color(0xFFEEEEF1)
    val active = if (dark) Color(0xFF80D6C8) else CpuBrand
    val idle = if (dark) Color(0xFFADADB3) else Color(0xFF63636B)
    val shape = RoundedCornerShape(27.dp)
    Box(
        Modifier.fillMaxWidth().background(backdrop)
            .windowInsetsPadding(WindowInsets.navigationBars.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
            .padding(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        androidx.compose.foundation.layout.BoxWithConstraints(
            Modifier.widthIn(max = 540.dp).fillMaxWidth().height(54.dp)
                .shadow(5.dp, shape, ambientColor = Color(0x10000000), spotColor = Color(0x14000000))
                .clip(shape).background(container).border(0.5.dp, outline, shape).padding(4.dp),
        ) {
            val itemWidth = maxWidth / ShellTab.entries.size
            val position by androidx.compose.animation.core.animateDpAsState(
                targetValue = itemWidth * ShellTab.entries.indexOf(selected),
                animationSpec = androidx.compose.animation.core.spring(dampingRatio = 0.92f, stiffness = 550f),
                label = "tabSelection",
            )
            Box(Modifier.offset(x = position).width(itemWidth).fillMaxHeight()
                .clip(RoundedCornerShape(23.dp)).background(pill))
            Row(Modifier.fillMaxSize().selectableGroup()) {
                ShellTab.entries.forEach { tab ->
                    val chosen = tab == selected
                    val tint by animateColorAsState(if (chosen) active else idle, tween(160), label = "tabTint")
                    Column(
                        Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(23.dp))
                            .selectable(selected = chosen, role = Role.Tab, onClick = { onSelect(tab) }),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Icon(painterResource(tab.tabIcon()), contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
                        Spacer(Modifier.height(2.dp))
                        Text(tab.label, fontSize = 10.sp, lineHeight = 12.sp, letterSpacing = 0.sp,
                            color = tint, maxLines = 1, fontWeight = FontWeight.Medium)
                    }
                }
            }
        }
    }
}

@Composable
private fun ServiceUnavailable(message: String, onRetry: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Rounded.WifiOff, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(34.dp))
        Spacer(Modifier.height(14.dp))
        Text("服务暂时不可用", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        Spacer(Modifier.height(16.dp))
        Button(onClick = onRetry) { Text("重试") }
    }
}

@Composable
private fun WelcomeScreen(onContinue: () -> Unit) {
    var appeared by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { appeared = true }
    Column(
        Modifier.fillMaxSize().consumesTouches().background(MaterialTheme.colorScheme.background).statusBarsPadding()
            .windowInsetsPadding(WindowInsets.navigationBars).padding(horizontal = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))
        Image(
            painterResource(R.drawable.app_logo), contentDescription = null,
            modifier = Modifier.size(112.dp).scale(if (appeared) 1f else 0.9f).clip(RoundedCornerShape(28.dp)),
        )
        Spacer(Modifier.height(24.dp))
        Text("药大拾间", fontSize = 32.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(9.dp))
        Text("你的校园信息助手", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(6.dp))
        Text(
            "登录后即可同步课表、成绩和校园服务", style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.weight(1f))
        Button(onClick = onContinue, modifier = Modifier.heightIn(min = 48.dp), shape = RoundedCornerShape(14.dp)) {
            Text("开始使用", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 12.dp))
        }
        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun LaunchWaiting() {
    Column(
        Modifier.fillMaxSize().consumesTouches().background(MaterialTheme.colorScheme.background),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(
            painterResource(R.drawable.app_logo), contentDescription = null,
            modifier = Modifier.size(84.dp).clip(RoundedCornerShape(20.dp)),
        )
        Spacer(Modifier.height(18.dp))
        Text("药大拾间", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(5.dp))
        Text("校园服务正在准备", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(16.dp))
        CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
    }
}

private data class QuickEntry(val icon: ImageVector, val title: String, val path: String?, val tab: ShellTab?)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun QuickEntrySheet(activity: MainActivity, onDismiss: () -> Unit, onOpen: (String?, ShellTab?) -> Unit) {
    val web = activity.web
    val entries = buildList {
        add(QuickEntry(Icons.Rounded.Edit, "发帖", "/post", ShellTab.Home))
        add(QuickEntry(Icons.Rounded.Mail, "消息", "/messages", ShellTab.Profile))
        if (web.authState.canAccessAdmin) add(QuickEntry(Icons.Rounded.AdminPanelSettings, "管理后台", "/admin", ShellTab.Profile))
        add(QuickEntry(Icons.Rounded.Download, "客户端下载", "/download", ShellTab.Services))
        add(QuickEntry(Icons.Rounded.Refresh, "检查更新", "/download?checkUpdate=${System.currentTimeMillis()}", ShellTab.Services))
        add(QuickEntry(Icons.Rounded.Forum, "校园论坛", "/forum", ShellTab.Home))
        add(QuickEntry(Icons.Rounded.Campaign, "校园公告", "/announcements", ShellTab.Home))
        add(QuickEntry(Icons.Rounded.School, "教务数据", "/jwxt", ShellTab.Academic))
        add(QuickEntry(Icons.Rounded.CalendarMonth, "课表", null, ShellTab.Schedule))
        add(QuickEntry(Icons.Rounded.GridView, "校园服务", "/services", ShellTab.Services))
        add(QuickEntry(Icons.Rounded.ShoppingBag, "二手交流", "/market", ShellTab.Home))
        add(QuickEntry(Icons.Rounded.AutoAwesome, "拾间AI", "/search", ShellTab.Home))
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).padding(bottom = 24.dp)) {
            Text("快捷入口", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            LazyVerticalGrid(
                columns = GridCells.Fixed(4),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                userScrollEnabled = false,
                modifier = Modifier.fillMaxWidth().heightIn(max = 400.dp),
            ) {
                items(entries) { entry ->
                    Column(
                        Modifier.clip(RoundedCornerShape(12.dp))
                            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp))
                            .clickable { onOpen(entry.path, entry.tab) }
                            .heightIn(min = 64.dp).padding(vertical = 10.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Icon(entry.icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.height(4.dp))
                        Text(entry.title, style = MaterialTheme.typography.labelMedium, maxLines = 1)
                    }
                }
            }
            Spacer(Modifier.height(18.dp))
            Text("外观", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(8.dp))
            AppearancePicker(activity.appearance)
            if (web.authState.authenticated) {
                Spacer(Modifier.height(16.dp))
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh)
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Rounded.Person, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(30.dp))
                    Spacer(Modifier.size(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("个人中心", style = MaterialTheme.typography.titleSmall)
                        Text("管理账号与资料", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Button(onClick = { onOpen("/profile", ShellTab.Profile) }) { Text("进入") }
                }
            }
        }
    }
}

@Composable
fun AppearancePicker(appearance: AppearanceSettings) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf(
            Triple("跟随系统", Icons.Rounded.BrightnessAuto, "system"),
            Triple("浅色", Icons.Rounded.LightMode, "light"),
            Triple("深色", Icons.Rounded.DarkMode, "dark"),
        ).forEach { (label, icon, mode) ->
            val selected = appearance.mode == mode
            Row(
                Modifier.weight(1f).clip(CircleShape)
                    .background(if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh)
                    .clickable { appearance.select(mode) }.heightIn(min = 38.dp).padding(horizontal = 8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp),
                    tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.size(4.dp))
                Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 1,
                    color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
