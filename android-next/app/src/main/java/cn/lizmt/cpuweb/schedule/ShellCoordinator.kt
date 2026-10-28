package cn.lizmt.cpuweb.schedule

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import cn.lizmt.cpuweb.schedule.custom.BackBehavior
import cn.lizmt.cpuweb.schedule.custom.Customization
import cn.lizmt.cpuweb.schedule.custom.Destination
import cn.lizmt.cpuweb.schedule.custom.DestinationCatalog
import cn.lizmt.cpuweb.schedule.custom.DestinationKind
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** What the system back key should do after the shell has looked at it. */
enum class BackOutcome { Handled, Exit }

/**
 * Tab selection and the native login gate, ported from the iOS
 * `NativeShellCoordinator`. The tabs are whatever the user put in the bar
 * ([Customization.tabs]); any site page, the timetable or the dashboard can
 * also be opened from elsewhere and is then shown under the tab that owns it.
 * The Web auth store is the authority for the site session; a surviving cookie
 * only buys a bounded restore window. JWXT expiry is handled by the schedule
 * bridge and never opens the site-login gate.
 */
class ShellCoordinator(
    private val scope: CoroutineScope,
    private val web: WebSession,
    private val schedule: ScheduleStore,
    private val layout: () -> Customization,
) {
    /** The destination on screen: one of the tabs, or a page opened from elsewhere. */
    var selectedId by mutableStateOf(layout().launchTab)
        private set
    /** False until the launch probe decides whether the gate is needed. */
    var isAuthResolved by mutableStateOf(false)
        private set
    /** True while the full-screen native login replaces the shell. */
    var requiresLogin by mutableStateOf(false)
        private set

    var sessionRestoreWindowMs = 4_000L
    var signOutGraceMs = 400L

    /** Called whenever a confirmed account (or sign-out) replaces the previous one. */
    var onAccountChanged: ((String) -> Unit)? = null
    /** The active tab was tapped again: the surface refreshes or returns to its start. */
    var onReselected: ((Destination) -> Unit)? = null
    /** A settings page was asked for from a quick entry, shortcut or the dashboard. */
    var onOpenSettings: ((String) -> Unit)? = null
    /** An https shortcut that leaves the app. */
    var onOpenExternal: ((String) -> Unit)? = null
    /** First back press at a root when the user asked for a second one. */
    var onConfirmExit: (() -> Unit)? = null

    private var accountKey = ""
    private var pendingGate: Job? = null
    private var scheduleJob: Job? = null
    /** The tab to return to when a page opened from elsewhere is closed. */
    private var returnTabId: String? = null
    private var lastRootBack = 0L

    val hasAuthenticatedSession: Boolean get() = accountKey.isNotEmpty()

    val selected: Destination
        get() = layout().destination(selectedId) ?: DestinationCatalog.webFallback

    /** Whether the destination on screen sits in the tab bar (rather than over it). */
    val selectedIsTab: Boolean get() = selectedId in layout().tabs

    fun connect() {
        web.onNavigate = { path -> handleNavigate(path) }
        web.onRoute = { path -> handleRouteChanged(path) }
        web.onAuthStateChanged = { state -> if (state.ready) handleAuthChanged(state) }
        web.onBridgeReady = {
            // The coordinator restores the education session before the first
            // fetch; letting the store load on its own would race that restore.
            schedule.markBridgeReady(autoLoad = false)
            // Widgets and the dashboard read the timetable too, whichever tab is on screen.
            if (!requiresLogin) requestScheduleLoad(force = false)
        }
        web.onBridgeLost = { message -> schedule.markBridgeUnavailable(message) }
        web.onSchedulePrefetched = { raw -> schedule.acceptPrefetched(raw) }
        schedule.loader = { request -> web.loadSchedule(request) }
        schedule.prioritizer = { semester, week -> web.prioritizeSchedule(semester, week) }
        schedule.priorityLoader = { semester -> web.loadSchedulePriorities(semester) }
        schedule.restoreArchive()
        web.start(startPath())
        scope.launch { resolveInitialAuth() }
    }

    /**
     * Debug builds only: the timetable comes from a local fixture and the
     * login gate stays down, while the shared WebView still loads the site so
     * the Web tabs, top bar and navigation can be inspected without an account.
     */
    fun connectDebugFixture() {
        web.onNavigate = { path -> handleNavigate(path) }
        web.onRoute = { }
        isAuthResolved = true
        requiresLogin = false
        schedule.loader = { DebugScheduleFixture.snapshot() }
        schedule.markBridgeReady()
        web.start(startPath())
    }

    /** The shared page opens on the launch tab when that tab is a site page. */
    private fun startPath(): String = layout().launchDestination.takeIf { it.kind == DestinationKind.Web }?.route ?: "/home"

    private suspend fun resolveInitialAuth() {
        if (isAuthResolved) return
        // No session cookie at all (a fresh install, or signed out): there is no session to restore,
        // so the login gate shows at once. The page keeps loading underneath; sending it to the login
        // page now would reload it halfway through its first start and keep the login button waiting.
        if (!web.hasSessionCookie()) {
            clearAccount()
            applyLoginGate(navigateToLogin = false)
            return
        }
        val state = web.waitForAuthState(sessionRestoreWindowMs)
        if (isAuthResolved) return
        if (state != null) {
            if (state.authenticated && state.account.isNotEmpty()) {
                applyAuthenticated(navigateToLaunch = false)
                return
            }
            // Re-probe once before gating: a stale JWXT response must never
            // turn into the full site-login layer.
            val confirmed = web.refreshAuthCapability()
            if (isAuthResolved) return
            when {
                confirmed?.authenticated == true && confirmed.account.isNotEmpty() -> applyAuthenticated(false)
                confirmed == null || !confirmed.ready -> scheduleLoginGate()
                else -> {
                    clearAccount()
                    applyLoginGate(navigateToLogin = !ShellRoutes.isAuthPath(web.currentPath))
                }
            }
            return
        }
        // An older Web bundle may not report its auth store at all. A surviving
        // cookie keeps the shell usable while the page restores the session.
        if (web.hasSessionCookie() && !ShellRoutes.isAuthPath(web.currentPath)) {
            applyAuthenticated(false)
        } else {
            clearAccount()
            applyLoginGate(navigateToLogin = !ShellRoutes.isAuthPath(web.currentPath))
        }
    }

    private fun handleAuthChanged(state: NativeAuthState) {
        val normalized = if (state.authenticated) state.account.trim() else ""
        if (normalized.isEmpty()) {
            if (pendingGate?.isActive == true) return
            // Verify through the live Web store before clearing anything. This
            // absorbs transient empty reports during a WebView restore.
            pendingGate = scope.launch {
                val confirmed = web.refreshAuthCapability()
                if (!isActive) return@launch
                pendingGate = null
                if (confirmed != null && confirmed.authenticated && confirmed.account.isNotBlank()) {
                    handleAuthChanged(confirmed)
                    return@launch
                }
                if (confirmed == null || !confirmed.ready) {
                    scheduleLoginGate()
                } else {
                    clearAccount()
                    applyLoginGate(navigateToLogin = !ShellRoutes.isAuthPath(web.currentPath))
                }
            }
            return
        }
        pendingGate?.cancel()
        pendingGate = null
        val accountChanged = accountKey != normalized
        accountKey = normalized
        if (schedule.handleAuthChanged(normalized)) onAccountChanged?.invoke(normalized)
        // Only a login that follows the gate moves the shell to the launch tab.
        applyAuthenticated(navigateToLaunch = requiresLogin)
        if (accountChanged && usesScheduleData()) requestScheduleLoad(force = false)
    }

    private fun usesScheduleData(): Boolean {
        val custom = layout()
        return selected.kind == DestinationKind.Schedule || selected.kind == DestinationKind.Dashboard || selected.kind == DestinationKind.Agenda ||
            DestinationCatalog.SCHEDULE in custom.tabs || DestinationCatalog.DASHBOARD in custom.tabs || DestinationCatalog.AGENDA in custom.tabs
    }

    // region Selection

    /** A tap in the tab bar. Tapping the active tab again runs its "back to start" action. */
    fun userSelected(id: String) {
        if (requiresLogin) return
        val destination = layout().destination(id) ?: return
        if (id == selectedId) {
            onReselected?.invoke(destination)
            return
        }
        returnTabId = null
        show(destination)
    }

    /** Open any destination from a quick entry, the dashboard or a launcher shortcut. */
    fun open(destination: Destination) {
        when (destination.kind) {
            DestinationKind.Settings -> onOpenSettings?.invoke(destination.route)
            DestinationKind.External -> onOpenExternal?.invoke(destination.route)
            DestinationKind.Web -> openWeb(destination.route)
            DestinationKind.Schedule, DestinationKind.Dashboard, DestinationKind.Agenda, DestinationKind.Assistant -> {
                if (requiresLogin) return
                if (destination.id !in layout().tabs && selectedIsTab) returnTabId = selectedId
                show(destination)
            }
        }
    }

    /**
     * Open a site page from native chrome; it shows under the tab that owns its path.
     * [replace] starts the page's own history there, so Back goes to the page's
     * parent (the dorm page's is the timetable) rather than the last site page.
     */
    fun openWeb(path: String, replace: Boolean = false) {
        if (ShellRoutes.isLoginPath(path)) {
            applyLoginGate(navigateToLogin = true)
            return
        }
        if (requiresLogin) return
        if (ShellRoutes.isSchedulePath(path)) {
            ScheduleDorm.pagePath(path)?.let { page ->
                openDorm(page)
                return
            }
            openSchedule(null, null)
            return
        }
        val owner = ownerOf(path)
        if (owner != selectedId) {
            if (owner !in layout().tabs && selectedIsTab) returnTabId = selectedId
            selectedId = owner
        }
        web.navigate(path, replace = replace)
    }

    /** Opens the dorm page; the activity sets this to hand the page this term's timetable first. */
    var onOpenDorm: ((String) -> Unit)? = null

    private fun openDorm(page: String) {
        onOpenDorm?.invoke(page) ?: openWeb(page, replace = true)
    }

    /** A widget or notification asked for the timetable. */
    fun openSchedule(semester: String?, week: String?) {
        if (requiresLogin) return
        if (DestinationCatalog.SCHEDULE !in layout().tabs && selectedIsTab) returnTabId = selectedId
        selectedId = DestinationCatalog.SCHEDULE
        schedule.open(semester, week)
    }

    private fun show(destination: Destination) {
        selectedId = destination.id
        when (destination.kind) {
            DestinationKind.Schedule -> requestScheduleLoad(force = false)
            DestinationKind.Web -> web.navigate(destination.route, replace = true)
            else -> Unit
        }
    }

    /**
     * The tab a site page belongs to: the deepest Web tab whose route contains
     * it, else the tab of its original section, else the Web tab on screen,
     * else the first Web tab (or a tab-less owner when the bar has none).
     */
    fun ownerOf(path: String): String {
        val custom = layout()
        val webTabs = custom.tabDestinations.filter { it.kind == DestinationKind.Web }
        webTabs.filter { DestinationCatalog.routeContains(it.route, path) }
            .maxByOrNull { DestinationCatalog.pathOnly(it.route).length }
            ?.let { return it.id }
        DestinationCatalog.legacySection(path)?.takeIf { it in custom.tabs }?.let { return it }
        if (selected.kind == DestinationKind.Web) return selectedId
        return webTabs.firstOrNull()?.id ?: DestinationCatalog.WEB
    }

    /** The site route a Web destination returns to; "/home" for the tab-less owner. */
    fun rootPath(destination: Destination = selected): String =
        destination.route.takeIf { destination.kind == DestinationKind.Web && it.isNotEmpty() } ?: "/home"

    /** Whether a site path is the root of a tab, where the top bar shows a title rather than a back arrow. */
    fun isTabRoot(path: String): Boolean = layout().tabDestinations.any {
        it.kind == DestinationKind.Web && DestinationCatalog.pathOnly(it.route) == DestinationCatalog.pathOnly(path)
    }

    /** The layout changed: keep the selection on something that still exists. */
    fun layoutChanged() {
        val custom = layout()
        if (custom.destination(selectedId) == null) show(custom.launchDestination)
        returnTabId = returnTabId?.takeIf { it in custom.tabs }
    }

    // endregion

    // region Back

    /** The native top bar's back arrow: the page's own history, else the tab's root. */
    fun headerBack() {
        val root = rootPath()
        scope.launch {
            if (!web.goBack(root)) web.navigate(root, replace = true)
        }
    }

    /** Hardware back. */
    suspend fun handleBack(now: Long = System.currentTimeMillis()): BackOutcome {
        if (requiresLogin) return BackOutcome.Exit
        val current = selected
        if (current.kind == DestinationKind.Web && web.goBack(rootPath(current))) return BackOutcome.Handled
        val custom = layout()
        // A page opened over the bar goes back to the tab it was opened from.
        if (!selectedIsTab) {
            val target = custom.destination(returnTabId ?: custom.launchTab) ?: custom.launchDestination
            returnTabId = null
            show(target)
            return BackOutcome.Handled
        }
        return when (custom.backAtRoot) {
            BackBehavior.Exit -> BackOutcome.Exit
            BackBehavior.LaunchTab -> if (selectedId != custom.launchTab) {
                show(custom.launchDestination)
                BackOutcome.Handled
            } else {
                BackOutcome.Exit
            }
            BackBehavior.DoubleExit -> if (now - lastRootBack < 2_000) {
                BackOutcome.Exit
            } else {
                lastRootBack = now
                onConfirmExit?.invoke()
                BackOutcome.Handled
            }
        }
    }

    // endregion

    private fun handleRouteChanged(path: String) {
        if (isAuthResolved && web.authState.ready && !web.authState.authenticated &&
            !hasAuthenticatedSession && !requiresLogin) {
            applyLoginGate(navigateToLogin = false)
            return
        }
        // Route reports describe Web content, not a tab selection: a delayed
        // redirect must never undo the user's tap (same rule as iOS).
        if (!requiresLogin) return
        if (ShellRoutes.isAuthPath(path)) return
        // The login page sends signed-in visitors home on its own: follow it.
        if (hasAuthenticatedSession) {
            applyAuthenticated(navigateToLaunch = true)
            return
        }
        applyLoginGate(navigateToLogin = true)
    }

    /** The page asked the shell to show a path (a `/schedule` link, a popup). */
    private fun handleNavigate(path: String) {
        if (requiresLogin) return
        // A dorm invite link opened inside the app keeps its code on the dorm page.
        ScheduleDorm.pagePath(path)?.let { page ->
            openDorm(page)
            return
        }
        if (ShellRoutes.isSchedulePath(path)) {
            val query = android.net.Uri.parse("https://local$path")
            if (DestinationCatalog.SCHEDULE !in layout().tabs && selectedIsTab) returnTabId = selectedId
            selectedId = DestinationCatalog.SCHEDULE
            if (query.getQueryParameter("refresh") == "1") schedule.returnToCurrentWeek()
            else requestScheduleLoad(force = false)
            return
        }
        selectedId = ownerOf(path)
        web.navigate(path, replace = false)
    }

    private fun scheduleLoginGate() {
        if (requiresLogin) {
            pendingGate?.cancel()
            pendingGate = null
            return
        }
        if (pendingGate?.isActive == true) return
        pendingGate = scope.launch {
            delay(signOutGraceMs)
            if (web.hasSessionCookie()) delay(sessionRestoreWindowMs)
            if (!isActive) return@launch
            pendingGate = null
            if (web.hasSessionCookie()) {
                applyAuthenticated(false)
            } else {
                // The cookie is gone: this is a sign-out, so the previous
                // account's timetable and widget must not survive the gate.
                clearAccount()
                applyLoginGate(navigateToLogin = true)
            }
        }
    }

    private fun clearAccount() {
        if (accountKey.isNotEmpty() || schedule.accountScope.isNotEmpty()) {
            schedule.handleAuthChanged("")
            onAccountChanged?.invoke("")
        }
        accountKey = ""
    }

    private fun applyLoginGate(navigateToLogin: Boolean) {
        pendingGate?.cancel()
        pendingGate = null
        requiresLogin = true
        isAuthResolved = true
        web.blocksInternalNavigation = true
        returnTabId = null
        if (navigateToLogin && !ShellRoutes.isAuthPath(web.currentPath)) web.navigate(LOGIN_GATE_PATH, replace = true)
    }

    private fun applyAuthenticated(navigateToLaunch: Boolean) {
        requiresLogin = false
        isAuthResolved = true
        web.blocksInternalNavigation = false
        if (!navigateToLaunch) return
        // As before customization: a fresh sign-in lands on 首页 when it is a tab, else on the launch tab.
        val custom = layout()
        val launch = custom.destination(DestinationCatalog.HOME)?.takeIf { DestinationCatalog.HOME in custom.tabs }
            ?: custom.launchDestination
        selectedId = launch.id
        // The page leaves the login screen even when the launch tab is native.
        web.navigate(rootPath(launch), replace = true)
        if (launch.kind == DestinationKind.Schedule) requestScheduleLoad(force = false)
    }

    fun requestScheduleLoad(force: Boolean) {
        scheduleJob?.cancel()
        scheduleJob = scope.launch {
            if (!web.bridgeReady) {
                schedule.load(force)
                return@launch
            }
            // Login can update account and JWXT state in consecutive messages.
            delay(100)
            if (schedule.result != null && !force) {
                schedule.load(false)
                return@launch
            }
            web.restoreAcademicSession()
            schedule.load(force)
        }
    }

    companion object {
        const val LOGIN_GATE_PATH = "/login?redirect=/home"
    }
}
