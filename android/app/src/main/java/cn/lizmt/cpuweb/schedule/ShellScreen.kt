package cn.lizmt.cpuweb.schedule

import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
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
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.foundation.layout.offset
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
import androidx.compose.material.icons.rounded.BrightnessAuto
import androidx.compose.material.icons.rounded.DarkMode
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.LightMode
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Tune
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
import androidx.compose.ui.graphics.Brush
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
    val showDashboard = selected.kind == DestinationKind.Dashboard && !webCovering
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
                brandTitle = atRoot && rootTitle == "药大拾间",
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
                covered = showSchedule || showDashboard || showSettings || gated || activity.imagePreview != null ||
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
            NativeLayer(visible = showDashboard) { DashboardScreen(activity) }
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
        enter = fadeIn(tween(look.duration(220))) + slideInVertically(tween(look.duration(220))) { it / 60 },
        exit = fadeOut(tween(look.duration(160))),
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
    custom: Customization,
    title: String,
    brandTitle: Boolean,
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
            Modifier.fillMaxWidth().height(look.space(56.dp).coerceAtLeast(48.dp)).padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (back) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "返回")
                }
            } else if (options.logo) {
                Row(
                    Modifier.clip(RoundedCornerShape(look.radius(12.dp))).clickable(onClick = onHome).padding(6.dp)
                        .semantics { contentDescription = "药大拾间，回到启动页" },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Image(
                        painterResource(R.drawable.app_logo),
                        contentDescription = null,
                        modifier = Modifier.size(30.dp).clip(RoundedCornerShape(look.radius(8.dp))),
                    )
                }
            } else {
                Spacer(Modifier.width(10.dp))
            }
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = if (brandTitle) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(start = 4.dp, end = 4.dp),
            )
            if (options.refresh) IconButton(onClick = onRefresh) { Icon(Icons.Rounded.Refresh, contentDescription = "刷新页面") }
            if (options.messages) {
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
            }
            if (options.quickEntry) IconButton(onClick = onMore) { Icon(Icons.Rounded.GridView, contentDescription = "快捷入口") }
        }
    }
}

/**
 * The user's tab bar in one of four looks. Every style reserves its own height,
 * so the timetable and pages never sit behind it. Long press opens the editor.
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
    val dark = LocalScheduleColors.current.dark
    val scheme = MaterialTheme.colorScheme
    val active = scheme.primary
    val idle = if (dark) Color(0xFFADADB3) else Color(0xFF63636B)
    val style = custom.tabBarStyle
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
    val selectedIndex = tabs.indexOfFirst { it.id == selectedId }
    val barHeight = look.space(if (style == TabBarStyle.Docked) 62.dp else 54.dp).coerceAtLeast(46.dp)

    val outer = Modifier.fillMaxWidth().background(if (style == TabBarStyle.Docked) scheme.surface else backdrop)
        .then(if (applyInsets) Modifier.windowInsetsPadding(WindowInsets.navigationBars.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal)) else Modifier)
    Box(
        when (style) {
            TabBarStyle.Docked -> outer
            TabBarStyle.Minimal -> outer.padding(horizontal = 12.dp, vertical = 2.dp)
            else -> outer.padding(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 6.dp)
        },
        contentAlignment = Alignment.Center,
    ) {
        if (style == TabBarStyle.Docked) {
            Box(Modifier.align(Alignment.TopCenter).fillMaxWidth().height(0.5.dp).background(scheme.outlineVariant))
        }
        val shape = RoundedCornerShape(look.radius(27.dp))
        val container = when (style) {
            TabBarStyle.Floating -> Modifier.widthIn(max = 540.dp).fillMaxWidth().height(barHeight)
                .shadow(5.dp, shape, ambientColor = Color(0x10000000), spotColor = Color(0x14000000))
                .clip(shape).background(if (dark) Color(0xFF242428) else Color(0xFFFCFCFD))
                .border(0.5.dp, if (dark) Color(0xFF414146) else Color(0xFFE7E7EB), shape).padding(4.dp)
            TabBarStyle.Glass -> Modifier.widthIn(max = 540.dp).fillMaxWidth().height(barHeight).clip(shape)
                .background(Brush.verticalGradient(listOf(
                    mix(scheme.surface, active, if (dark) 0.16f else 0.08f).copy(alpha = 0.82f),
                    mix(scheme.surface, active, if (dark) 0.26f else 0.14f).copy(alpha = 0.9f),
                )))
                .border(0.75.dp, active.copy(alpha = if (dark) 0.35f else 0.22f), shape).padding(4.dp)
            TabBarStyle.Docked -> Modifier.widthIn(max = 640.dp).fillMaxWidth().height(barHeight).padding(horizontal = 4.dp, vertical = 6.dp)
            TabBarStyle.Minimal -> Modifier.widthIn(max = 540.dp).fillMaxWidth().height(barHeight)
        }
        BoxWithConstraints(container) {
            val itemWidth = maxWidth / tabs.size.coerceAtLeast(1)
            val position by animateDpAsState(
                targetValue = itemWidth * selectedIndex.coerceAtLeast(0),
                animationSpec = if (look.reduceMotion) tween(0) else spring(dampingRatio = 0.92f, stiffness = 550f),
                label = "tabSelection",
            )
            if (selectedIndex >= 0 && (style == TabBarStyle.Floating || style == TabBarStyle.Glass)) {
                val pill = when {
                    style == TabBarStyle.Glass -> active.copy(alpha = if (dark) 0.28f else 0.16f)
                    dark -> Color(0xFF3B3B40)
                    else -> Color(0xFFEEEEF1)
                }
                Box(Modifier.offset(x = position).width(itemWidth).fillMaxHeight()
                    .clip(RoundedCornerShape(look.radius(23.dp))).background(pill))
            }
            Row(Modifier.fillMaxSize().selectableGroup()) {
                tabs.forEach { tab ->
                    val chosen = tab.id == selectedId
                    val tint by animateColorAsState(if (chosen) active else idle, tween(look.duration(160)), label = "tabTint")
                    val showLabel = when (custom.tabLabels) {
                        TabLabelMode.Always -> true
                        TabLabelMode.Selected -> chosen
                        TabLabelMode.Never -> false
                    }
                    Column(
                        Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(look.radius(23.dp)))
                            .combinedClickable(onClick = { select(tab.id) }, onLongClick = customize)
                            .semantics {
                                role = Role.Tab
                                this.selected = chosen
                                contentDescription = tab.title
                            },
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        TabIcon(tab, custom.icons.containsKey(tab.id), chosen, style, tint, active,
                            badge = if (tab.id == badgeId) unread else 0)
                        if (showLabel) {
                            Spacer(Modifier.height(2.dp))
                            Text(tab.title, fontSize = 10.sp, lineHeight = 12.sp, letterSpacing = 0.sp,
                                color = tint, maxLines = 1, overflow = TextOverflow.Clip, fontWeight = FontWeight.Medium)
                        }
                        if (style == TabBarStyle.Minimal && chosen && !showLabel) {
                            Spacer(Modifier.height(3.dp))
                            Box(Modifier.size(4.dp).clip(CircleShape).background(active))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TabIcon(tab: Destination, customIcon: Boolean, chosen: Boolean, style: TabBarStyle, tint: Color, active: Color, badge: Int) {
    val look = LocalCpuLook.current
    val icon = @Composable {
        Icon(destinationPainter(tab, customIcon), contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
    }
    val framed = @Composable {
        if (style == TabBarStyle.Docked) {
            Box(
                Modifier.clip(RoundedCornerShape(look.radius(16.dp)))
                    .background(if (chosen) active.copy(alpha = 0.14f) else Color.Transparent)
                    .padding(horizontal = 16.dp, vertical = 3.dp),
                contentAlignment = Alignment.Center,
            ) { icon() }
        } else {
            icon()
        }
    }
    if (badge > 0) {
        BadgedBox(badge = { Badge { Text(if (badge > 99) "99+" else badge.toString()) } }) { framed() }
    } else {
        framed()
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun QuickEntrySheet(activity: MainActivity, onDismiss: () -> Unit, onOpen: (Destination) -> Unit, onEdit: () -> Unit) {
    val web = activity.web
    val custom = activity.customization.value
    val look = LocalCpuLook.current
    val entries = custom.quickEntries.mapNotNull(custom::destination)
        .filter { it.id != DestinationCatalog.ADMIN || web.authState.canAccessAdmin }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).padding(bottom = 24.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("快捷入口", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                if (activity.updates.channel.isBeta) {
                    Spacer(Modifier.width(8.dp))
                    NextBadge()
                }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onEdit) { Text("编辑") }
            }
            Spacer(Modifier.height(8.dp))
            LazyVerticalGrid(
                columns = GridCells.Fixed(4),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                userScrollEnabled = false,
                modifier = Modifier.fillMaxWidth().heightIn(max = 520.dp),
            ) {
                items(entries, key = { it.id }) { entry ->
                    Column(
                        Modifier.clip(RoundedCornerShape(look.radius(12.dp)))
                            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(look.radius(12.dp)))
                            .clickable { onOpen(entry) }
                            .heightIn(min = 64.dp).padding(vertical = 10.dp, horizontal = 4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Icon(iconVector(entry.icon), contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.height(4.dp))
                        Text(entry.title, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            Spacer(Modifier.height(18.dp))
            Text("外观", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(8.dp))
            AppearancePicker(activity.appearance)
            Spacer(Modifier.height(16.dp))
            QuickRow(Icons.Rounded.Tune, "拾间设置", "导航、主题、工作台和更新，都按你的来") {
                onDismiss()
                activity.openSettings("")
            }
            if (web.authState.authenticated) {
                Spacer(Modifier.height(10.dp))
                QuickRow(Icons.Rounded.Person, "个人中心", "管理账号与资料") {
                    onDismiss()
                    activity.shell.openWeb("/profile")
                }
            }
        }
    }
}

@Composable
private fun QuickRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, detail: String, onClick: () -> Unit) {
    val look = LocalCpuLook.current
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(look.radius(14.dp))).background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .clickable(onClick = onClick).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
        Spacer(Modifier.size(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** The mark of the 药大拾间 NEXT test channel. */
@Composable
fun NextBadge(modifier: Modifier = Modifier) {
    Text(
        "NEXT",
        modifier = modifier.clip(RoundedCornerShape(6.dp))
            .background(Brush.horizontalGradient(listOf(MaterialTheme.colorScheme.primary, mix(MaterialTheme.colorScheme.primary, Color(0xFF7A4CC2), 0.4f))))
            .padding(horizontal = 6.dp, vertical = 1.dp),
        color = MaterialTheme.colorScheme.onPrimary,
        fontSize = 10.sp,
        fontWeight = FontWeight.Black,
        letterSpacing = 1.sp,
    )
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
