package cn.lizmt.cpuweb.schedule

import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.WifiOff
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import cn.lizmt.cpuweb.schedule.custom.Customization
import cn.lizmt.cpuweb.schedule.custom.Destination
import cn.lizmt.cpuweb.schedule.custom.DestinationCatalog
import cn.lizmt.cpuweb.schedule.custom.DestinationKind
import cn.lizmt.cpuweb.schedule.custom.TabBarStyle
import cn.lizmt.cpuweb.schedule.custom.TabLabelMode
import kotlin.math.roundToInt
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
    val launchIsSchedule = activity.customization.value.launchDestination.kind == DestinationKind.Schedule
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ShellScaffold(activity)
        when {
            !activity.welcomeSeen -> WelcomeScreen { activity.finishWelcome() }
            shell.requiresLogin -> LoginGate(activity)
            !shell.isAuthResolved && (!launchIsSchedule || activity.schedule.result == null) -> LaunchWaiting()
        }
        activity.settingsRoute?.let { route ->
            SettingsScreen(activity, initialRoute = route, asTab = false, onClose = { activity.closeSettings() })
        }
        val settled = activity.welcomeSeen && !shell.requiresLogin && shell.isAuthResolved && activity.settingsRoute == null
        if (settled && !activity.customization.introSeen) {
            NextIntroSheet(activity)
        } else if (settled) {
            activity.updates.justUpdated?.let { JustUpdatedSheet(activity, it) }
        }
        // A new version the user has to act on opens 设置 → 更新 once; one that installs by itself does not.
        LaunchedEffect(activity.updates.state, settled, activity.customization.introSeen) {
            val updates = activity.updates
            if (settled && activity.customization.introSeen && updates.justUpdated == null && updates.wantsAttention()) {
                updates.markPrompted()
                activity.openSettings("update")
            }
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
    val custom = activity.customization.value
    val selected = shell.selected
    val webCovering = web.webOverlayVisible || web.androidUpdateVisible
    val showSchedule = selected.kind == DestinationKind.Schedule && !webCovering
    val showToday = selected.kind == DestinationKind.Dashboard && !webCovering
    val showAgenda = selected.kind == DestinationKind.Agenda && !webCovering
    val showAssistant = selected.kind == DestinationKind.Assistant && !webCovering
    val showSettings = selected.kind == DestinationKind.Settings
    val onWeb = selected.kind == DestinationKind.Web
    val pageNavigation = onWeb && (PageChrome.usesPageNavigation(web.currentPath) || web.header.pageNavigation)
    val imeVisible = WindowInsets.isImeVisible
    var quickEntryOpen by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val gated = shell.requiresLogin || !activity.welcomeSeen
    val path = web.currentPath.ifEmpty { web.header.path }

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        if (onWeb && !pageNavigation && !gated) {
            val atRoot = shell.isTabRoot(path) || (selected.id == DestinationCatalog.WEB && DestinationCatalog.pathOnly(path) == "/home")
            val rootTitle = if (selected.id == DestinationCatalog.HOME && custom.labels[DestinationCatalog.HOME] == null) "药大拾间" else selected.title
            NativeTopBar(
                custom = custom,
                title = if (atRoot) rootTitle else web.header.title,
                back = !atRoot,
                authenticated = web.authState.authenticated || web.header.authenticated,
                unread = web.unreadCount,
                onHome = { shell.userSelected(custom.launchTab) },
                onBack = { shell.headerBack() },
                onRefresh = { web.refresh() },
                onMessages = { shell.openWeb("/messages") },
                onLogin = { shell.openWeb("/login") },
                onMore = {
                    scope.launch { web.refreshAuthCapability() }
                    quickEntryOpen = true
                },
            )
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            NativeWebViewport(activity,
                covered = showSchedule || showToday || showAgenda || showAssistant || showSettings || gated || activity.imagePreview != null ||
                    activity.settingsRoute != null || (onWeb && web.failureMessage != null) ||
                    (!shell.isAuthResolved && activity.schedule.result == null),
                showPost = custom.postButton && onWeb && DestinationCatalog.pathOnly(path).let { it == "/home" || it == "/" } && !imeVisible,
            )
            if (onWeb && !gated) {
                web.failureMessage?.let { message ->
                    ServiceUnavailable(message) { web.retry() }
                }
            }
            NativeLayer(visible = showSchedule) { NativeScheduleScreen(activity) }
            NativeLayer(visible = showToday) { TodayScreen(activity) }
            NativeLayer(visible = showAgenda) { AgendaScreen(activity) }
            NativeLayer(visible = showAssistant) { AssistantScreen(activity, asTab = shell.selectedIsTab) }
            if (showSettings) SettingsScreen(activity, initialRoute = "", asTab = true, onClose = {})
        }
        val showBar = !gated && !imeVisible && !pageNavigation
        if (showBar) {
            NativeTabBar(
                custom = custom,
                selectedId = shell.selectedId,
                unread = web.unreadCount,
                // The strip around the bar continues the surface above it.
                backdrop = if (showSchedule) LocalScheduleColors.current.page else MaterialTheme.colorScheme.background,
                onSelect = { shell.userSelected(it) },
                onCustomize = { activity.openSettings("tabs") },
            )
        } else {
            Spacer(Modifier.windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars).only(WindowInsetsSides.Bottom)))
        }
    }

    if (quickEntryOpen) {
        QuickEntrySheet(
            activity = activity,
            onDismiss = { quickEntryOpen = false },
            onOpen = { destination ->
                quickEntryOpen = false
                shell.open(destination)
            },
            onEdit = {
                quickEntryOpen = false
                activity.openSettings("quick")
            },
        )
    }
}

/** Native surfaces fade in over the shared WebView, like the HarmonyOS shell. */
@Composable
private fun NativeLayer(visible: Boolean, content: @Composable () -> Unit) {
    val look = LocalCpuLook.current
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(tween(look.duration(200))) + slideInVertically(tween(look.duration(200))) { it / 80 },
        exit = fadeOut(tween(look.duration(140))),
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
        onClick = { activity.shell.openWeb("/post") },
        icon = { Icon(Icons.Rounded.Edit, contentDescription = null) },
        text = { Text("投稿") },
        containerColor = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = RoundedCornerShape(LocalCpuLook.current.radius(16.dp)),
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

/** The bar over site pages: the page title, then messages and the quick-entry panel. */
@Composable
private fun NativeTopBar(
    custom: Customization,
    title: String,
    back: Boolean,
    authenticated: Boolean,
    unread: Int,
    onHome: () -> Unit,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onMessages: () -> Unit,
    onLogin: () -> Unit,
    onMore: () -> Unit,
) {
    val look = LocalCpuLook.current
    val options = custom.topBar
    Surface(color = MaterialTheme.colorScheme.background, tonalElevation = 0.dp) {
        Row(
            Modifier.fillMaxWidth().height(look.space(52.dp).coerceAtLeast(46.dp)).padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (back) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "返回") }
            } else if (options.logo) {
                Box(
                    Modifier.padding(start = 6.dp, end = 4.dp).clip(RoundedCornerShape(look.radius(8.dp))).clickable(onClick = onHome)
                        .semantics { contentDescription = "药大拾间，回到启动页" },
                ) {
                    Image(painterResource(R.drawable.app_logo), contentDescription = null, modifier = Modifier.size(28.dp))
                }
            } else {
                Spacer(Modifier.width(12.dp))
            }
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(start = 4.dp, end = 4.dp),
            )
            if (options.refresh) IconButton(onClick = onRefresh) { Icon(Icons.Outlined.Refresh, contentDescription = "刷新页面") }
            if (options.messages) {
                if (authenticated) {
                    IconButton(onClick = onMessages) {
                        BadgedBox(badge = {
                            if (unread > 0) Badge { Text(if (unread > 99) "99+" else unread.toString()) }
                        }) {
                            Icon(Icons.Outlined.Notifications, contentDescription = if (unread > 0) "消息，${unread}条未读" else "消息")
                        }
                    }
                } else {
                    TextButton(onClick = onLogin) { Text("登录") }
                }
            }
            if (options.quickEntry) IconButton(onClick = onMore) { Icon(Icons.Outlined.GridView, contentDescription = "快捷入口") }
        }
    }
}

/**
 * The user's tab bar, floating or docked. The chosen tab shows its filled
 * icon in the accent; the others stay outlined and grey. Every style reserves
 * its own height, so pages never sit behind it. Long press opens the editor.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun NativeTabBar(
    custom: Customization,
    selectedId: String,
    unread: Int,
    backdrop: Color,
    onSelect: (String) -> Unit,
    onCustomize: () -> Unit,
    /** False for the live preview in settings, which sits inside the page. */
    applyInsets: Boolean = true,
) {
    val tabs = custom.tabDestinations
    val look = LocalCpuLook.current
    val haptics = LocalHapticFeedback.current
    val scheme = MaterialTheme.colorScheme
    val active = scheme.primary
    val idle = scheme.onSurfaceVariant
    val docked = custom.tabBarStyle == TabBarStyle.Docked
    val badgeId = when {
        "messages" in custom.tabs -> "messages"
        DestinationCatalog.PROFILE in custom.tabs -> DestinationCatalog.PROFILE
        else -> null
    }
    val select = { id: String ->
        if (look.haptics) haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        onSelect(id)
    }
    val customize = {
        if (look.haptics) haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        onCustomize()
    }
    val barHeight = look.space(if (custom.tabLabels == TabLabelMode.Never) 52.dp else 58.dp).coerceAtLeast(48.dp)
    val insets = if (applyInsets) Modifier.windowInsetsPadding(WindowInsets.navigationBars.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal)) else Modifier
    val shape = RoundedCornerShape(look.radius(22.dp))
    Box(
        if (docked) {
            Modifier.fillMaxWidth().background(scheme.surface).then(insets)
        } else {
            Modifier.fillMaxWidth().background(backdrop).then(insets).padding(start = 14.dp, end = 14.dp, top = 2.dp, bottom = 8.dp)
        },
        contentAlignment = Alignment.Center,
    ) {
        if (docked) Box(Modifier.align(Alignment.TopCenter).fillMaxWidth().height(0.5.dp).background(scheme.outlineVariant))
        Row(
            (if (docked) Modifier.widthIn(max = 640.dp).fillMaxWidth().height(barHeight)
            else Modifier.widthIn(max = 520.dp).fillMaxWidth().height(barHeight)
                .shadow(6.dp, shape, ambientColor = Color(0x14000000), spotColor = Color(0x1A000000))
                .clip(shape).background(scheme.surface).border(0.5.dp, scheme.outlineVariant, shape))
                .padding(horizontal = 4.dp).selectableGroup(),
        ) {
            tabs.forEach { tab ->
                val chosen = tab.id == selectedId
                val tint by animateColorAsState(if (chosen) active else idle, tween(look.duration(150)), label = "tabTint")
                val showLabel = when (custom.tabLabels) {
                    TabLabelMode.Always -> true
                    TabLabelMode.Selected -> chosen
                    TabLabelMode.Never -> false
                }
                Column(
                    Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(look.radius(16.dp)))
                        .combinedClickable(onClick = { select(tab.id) }, onLongClick = customize)
                        .semantics {
                            role = Role.Tab
                            this.selected = chosen
                            contentDescription = tab.title
                        },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    val icon = @Composable {
                        Icon(destinationPainter(tab, custom.icons.containsKey(tab.id), selected = chosen), contentDescription = null, tint = tint,
                            modifier = Modifier.size(23.dp))
                    }
                    val badge = if (tab.id == badgeId) unread else 0
                    if (badge > 0) BadgedBox(badge = { Badge { Text(if (badge > 99) "99+" else badge.toString()) } }) { icon() } else icon()
                    if (showLabel) {
                        Spacer(Modifier.height(3.dp))
                        Text(tab.title, fontSize = 11.sp, lineHeight = 13.sp, letterSpacing = 0.sp, color = tint, maxLines = 1,
                            overflow = TextOverflow.Clip, fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Medium)
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
        Icon(Icons.Rounded.WifiOff, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(32.dp))
        Spacer(Modifier.height(14.dp))
        Text("服务暂时不可用", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(6.dp))
        Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        Spacer(Modifier.height(18.dp))
        Button(onClick = onRetry, shape = RoundedCornerShape(LocalCpuLook.current.radius(12.dp))) { Text("重试") }
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
            modifier = Modifier.size(96.dp).scale(if (appeared) 1f else 0.94f),
        )
        Spacer(Modifier.height(22.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("药大拾间", style = MaterialTheme.typography.headlineLarge)
            Spacer(Modifier.width(8.dp))
            NextBadge()
        }
        Spacer(Modifier.height(8.dp))
        Text("课表、日程和校园服务，加上一位懂你的拾间AI", style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        Spacer(Modifier.weight(1f))
        Button(onClick = onContinue, modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp), shape = RoundedCornerShape(14.dp)) {
            Text("开始使用", style = MaterialTheme.typography.titleMedium)
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun LaunchWaiting() {
    Column(
        Modifier.fillMaxSize().consumesTouches().background(MaterialTheme.colorScheme.background),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(painterResource(R.drawable.app_logo), contentDescription = null, modifier = Modifier.size(72.dp))
        Spacer(Modifier.height(20.dp))
        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun QuickEntrySheet(activity: MainActivity, onDismiss: () -> Unit, onOpen: (Destination) -> Unit, onEdit: () -> Unit) {
    val web = activity.web
    val custom = activity.customization.value
    val entries = custom.quickEntries.mapNotNull(custom::destination)
        .filter { it.id != DestinationCatalog.ADMIN || web.authState.canAccessAdmin }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Panel(action = "编辑", onAction = onEdit, title = "快捷入口") {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(4),
                    userScrollEnabled = false,
                    modifier = Modifier.fillMaxWidth().heightIn(max = 420.dp).padding(vertical = 8.dp),
                ) {
                    items(entries, key = { it.id }) { entry ->
                        Column(
                            Modifier.clip(RoundedCornerShape(12.dp)).clickable { onOpen(entry) }.padding(vertical = 10.dp, horizontal = 2.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Box(Modifier.size(44.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
                                Icon(destinationPainter(entry, custom.icons.containsKey(entry.id)), contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(22.dp))
                            }
                            Spacer(Modifier.height(6.dp))
                            Text(entry.title, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
            Panel("外观") {
                Box(Modifier.padding(12.dp)) { AppearancePicker(activity.appearance) }
            }
            Panel {
                ListRow("拾间设置", chevron = true) {
                    onDismiss()
                    activity.openSettings("")
                }
                if (web.authState.authenticated) {
                    Hairline()
                    ListRow("个人中心", chevron = true) {
                        onDismiss()
                        activity.shell.openWeb("/profile")
                    }
                }
            }
        }
    }
}

@Composable
fun AppearancePicker(appearance: AppearanceSettings) {
    Segmented(listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色"), appearance.mode) { appearance.select(it) }
}
