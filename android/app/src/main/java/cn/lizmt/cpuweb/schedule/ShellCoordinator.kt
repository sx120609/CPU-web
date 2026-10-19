package cn.lizmt.cpuweb.schedule

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Tab selection and the native login gate, ported from the iOS
 * `NativeShellCoordinator`. The Web auth store is the authority for the site
 * session; a surviving cookie only buys a bounded restore window. JWXT expiry
 * is handled by the schedule bridge and never opens the site-login gate.
 */
class ShellCoordinator(
    private val scope: CoroutineScope,
    private val web: WebSession,
    private val schedule: ScheduleStore,
) {
    var selectedTab by mutableStateOf(ShellTab.Schedule)
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

    private var accountKey = ""
    private var pendingGate: Job? = null
    private var scheduleJob: Job? = null

    val hasAuthenticatedSession: Boolean get() = accountKey.isNotEmpty()

    fun connect() {
        web.onNavigate = { path -> handleNavigate(path) }
        web.onRoute = { path -> handleRouteChanged(path) }
        web.onAuthStateChanged = { state -> if (state.ready) handleAuthChanged(state) }
        web.onBridgeReady = {
            // The coordinator restores the education session before the first
            // fetch; letting the store load on its own would race that restore.
            schedule.markBridgeReady(autoLoad = false)
            if (!requiresLogin) requestScheduleLoad(force = false)
        }
        web.onBridgeLost = { message -> schedule.markBridgeUnavailable(message) }
        web.onSchedulePrefetched = { raw -> schedule.acceptPrefetched(raw) }
        schedule.loader = { request -> web.loadSchedule(request) }
        schedule.prioritizer = { semester, week -> web.prioritizeSchedule(semester, week) }
        schedule.priorityLoader = { semester -> web.loadSchedulePriorities(semester) }
        schedule.restoreArchive()
        web.start()
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
        web.start()
    }

    private suspend fun resolveInitialAuth() {
        if (isAuthResolved) return
        val state = web.waitForAuthState(sessionRestoreWindowMs)
        if (isAuthResolved) return
        if (state != null) {
            if (state.authenticated && state.account.isNotEmpty()) {
                applyAuthenticated(navigateToHome = false)
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
                    applyLoginGate(navigateToLogin = !ShellTab.isAuthPath(web.currentPath))
                }
            }
            return
        }
        // An older Web bundle may not report its auth store at all. A surviving
        // cookie keeps the shell usable while the page restores the session.
        if (web.hasSessionCookie() && !ShellTab.isAuthPath(web.currentPath)) {
            applyAuthenticated(false)
        } else {
            clearAccount()
            applyLoginGate(navigateToLogin = !ShellTab.isAuthPath(web.currentPath))
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
                    applyLoginGate(navigateToLogin = !ShellTab.isAuthPath(web.currentPath))
                }
            }
            return
        }
        pendingGate?.cancel()
        pendingGate = null
        val accountChanged = accountKey != normalized
        accountKey = normalized
        if (schedule.handleAuthChanged(normalized)) onAccountChanged?.invoke(normalized)
        // Only a login that follows the gate moves the shell to the home tab.
        applyAuthenticated(navigateToHome = requiresLogin)
        if (accountChanged && selectedTab == ShellTab.Schedule) requestScheduleLoad(force = false)
    }

    fun userSelected(tab: ShellTab) {
        if (requiresLogin || tab == selectedTab) return
        selectedTab = tab
        if (tab == ShellTab.Schedule) {
            requestScheduleLoad(force = false)
            return
        }
        web.navigate(tab.path, replace = true)
    }

    /** Open a Web page from native chrome (quick entry, bell, top-bar login). */
    fun openWeb(path: String, tab: ShellTab = ShellTab.Profile) {
        if (ShellTab.isLoginPath(path)) {
            applyLoginGate(navigateToLogin = true)
            return
        }
        if (requiresLogin) return
        if (ShellTab.isSchedulePath(path)) {
            userSelected(ShellTab.Schedule)
            return
        }
        selectedTab = if (tab == ShellTab.Schedule) ShellTab.Profile else tab
        web.navigate(path, replace = false)
    }

    /** A widget or notification asked for the timetable. */
    fun openSchedule(semester: String?, week: String?) {
        if (requiresLogin) return
        selectedTab = ShellTab.Schedule
        schedule.open(semester, week)
    }

    /** Hardware back from a Web tab. Returns false when the system should handle it. */
    suspend fun handleBack(): Boolean {
        if (requiresLogin) return false
        if (selectedTab == ShellTab.Schedule) return false
        if (web.goBack(selectedTab.path)) return true
        // A root Web tab returns to the default timetable before leaving the app.
        userSelected(ShellTab.Schedule)
        return true
    }

    private fun handleRouteChanged(path: String) {
        if (isAuthResolved && web.authState.ready && !web.authState.authenticated &&
            !hasAuthenticatedSession && !requiresLogin) {
            applyLoginGate(navigateToLogin = false)
            return
        }
        // Route reports describe Web content, not a tab selection: a delayed
        // redirect must never undo the user's tap (same rule as iOS).
        if (!requiresLogin) return
        if (ShellTab.isAuthPath(path)) return
        // The login page sends signed-in visitors home on its own: follow it.
        if (hasAuthenticatedSession) {
            applyAuthenticated(navigateToHome = true)
            return
        }
        applyLoginGate(navigateToLogin = true)
    }

    private fun handleNavigate(path: String) {
        if (requiresLogin) return
        val destination = ShellTab.fromPath(path) ?: return
        if (destination == ShellTab.Schedule) {
            val query = android.net.Uri.parse("https://local$path")
            selectedTab = ShellTab.Schedule
            if (query.getQueryParameter("refresh") == "1") schedule.returnToCurrentWeek()
            else requestScheduleLoad(force = false)
            return
        }
        selectedTab = destination
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
        if (selectedTab != ShellTab.Profile) selectedTab = ShellTab.Profile
        if (navigateToLogin && !ShellTab.isAuthPath(web.currentPath)) web.navigate(LOGIN_GATE_PATH, replace = true)
    }

    private fun applyAuthenticated(navigateToHome: Boolean) {
        requiresLogin = false
        isAuthResolved = true
        web.blocksInternalNavigation = false
        if (!navigateToHome) return
        selectedTab = ShellTab.Home
        web.navigate(ShellTab.Home.path, replace = true)
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
