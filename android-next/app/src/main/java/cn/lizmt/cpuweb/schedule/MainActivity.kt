package cn.lizmt.cpuweb.schedule

import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import androidx.compose.runtime.snapshotFlow
import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.compose.ui.platform.ComposeView
import androidx.core.view.doOnPreDraw
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import android.widget.FrameLayout
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import android.view.WindowManager
import cn.lizmt.cpuweb.schedule.agenda.AgendaCodec
import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import cn.lizmt.cpuweb.schedule.agenda.AgendaKind
import cn.lizmt.cpuweb.schedule.agenda.AgendaOccurrence
import cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat
import cn.lizmt.cpuweb.schedule.agenda.AgendaStore
import cn.lizmt.cpuweb.schedule.custom.AssistantControls
import cn.lizmt.cpuweb.schedule.custom.CustomizationStore
import cn.lizmt.cpuweb.schedule.custom.DashboardCards
import cn.lizmt.cpuweb.schedule.custom.DestinationCatalog
import cn.lizmt.cpuweb.schedule.custom.DestinationKind
import cn.lizmt.cpuweb.schedule.custom.LAYOUT_PRESETS
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import kotlin.math.roundToInt

/**
 * The native shell: a Compose tab bar and timetable over one shared WebView,
 * following the iOS `ios_next` client and the HarmonyOS client.
 */
class MainActivity : ComponentActivity(), WebSessionHost {
    lateinit var web: WebSession
        private set
    lateinit var schedule: ScheduleStore
        private set
    lateinit var shell: ShellCoordinator
        private set
    lateinit var appearance: AppearanceSettings
        private set
    lateinit var style: ScheduleStyleSettings
        private set
    lateinit var widgets: WidgetSettings
        private set
    lateinit var sharing: ScheduleSharing
    lateinit var couple: ScheduleCouple
        private set
    lateinit var customization: CustomizationStore
        private set
    lateinit var updates: AppUpdater
        private set
    lateinit var dashboardFeeds: DashboardFeeds
        private set
    lateinit var agenda: AgendaStore
        private set
    lateinit var assistant: AssistantSession
        private set
    lateinit var activityLog: AssistantActivityLog
        private set
    lateinit var sync: NextSync
        private set
    /** The day 日程 shows when it opens next (from 今天, a reminder or 拾间AI). */
    var agendaFocus by mutableStateOf<LocalDate?>(null)
    /** How to take back each proposal 拾间AI made that the user confirmed in this run. */
    private val undoActions = mutableMapOf<String, () -> Unit>()
    /** The settings page shown over the shell, or null. "" is the settings home. */
    var settingsRoute by mutableStateOf<String?>(null)
        private set
    private lateinit var clientStats: ClientStats
    private var reportsClientStats = false
    private lateinit var legacyBridge: CpuAndroidBridge
    lateinit var nativeWebLayer: NativeWebLayer
        private set

    var imagePreview by mutableStateOf<ImagePreviewRequest?>(null)
    private var fullscreenView: View? = null
    private var exitFullscreen: (() -> Unit)? = null
    var welcomeSeen by mutableStateOf(true)
        private set

    private var fileCallback: ValueCallback<Array<Uri>?>? = null
    private var permissionCallback: ((Boolean) -> Unit)? = null

    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        callback.onReceiveValue(if (result.resultCode == RESULT_OK) parseChosenFiles(result.data) else null)
    }

    private var pendingCalendar: String? = null

    private val calendarSaver = registerForActivityResult(ActivityResultContracts.CreateDocument("text/calendar")) { uri ->
        val content = pendingCalendar
        pendingCalendar = null
        if (uri == null || content == null) return@registerForActivityResult
        val saved = runCatching {
            contentResolver.openOutputStream(uri, "wt")?.use { it.write(content.toByteArray()) } != null
        }.getOrDefault(false)
        toast(if (saved) "日历文件已保存" else "日历导出失败")
    }

    private val backgroundPicker = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@registerForActivityResult
        lifecycleScope.launch {
            val result = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { style.importBackground(uri) }
            result.onSuccess(style::showBackground).onFailure { toast(it.message ?: "图片读取失败") }
        }
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) toast("没有通知权限，提醒不会弹出；可以在系统设置里打开")
    }

    private val webPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        val callback = permissionCallback ?: return@registerForActivityResult
        permissionCallback = null
        callback(granted.values.all { it })
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val coldStart = savedInstanceState == null && ClientStats.claimColdStart()
        val preferences = getSharedPreferences(SHELL_PREFS, MODE_PRIVATE)
        welcomeSeen = preferences.getBoolean(KEY_WELCOME_SEEN, false)
        // Someone upgrading while signed in already knows the app: skip the first-run welcome.
        if (!welcomeSeen && ScheduleArchive.currentSessionFingerprint().isNotEmpty()) {
            welcomeSeen = true
            preferences.edit().putBoolean(KEY_WELCOME_SEEN, true).apply()
        }
        appearance = AppearanceSettings(this)
        customization = CustomizationStore(this)
        updates = AppUpdater.get(this)
        style = ScheduleStyleSettings(this)
        widgets = WidgetSettings(this)
        legacyBridge = CpuAndroidBridge(this)
        web = WebSession(this, lifecycleScope, this, legacyBridge)
        web.onAppearanceReported = { mode -> appearance.adoptWebMode(mode) }
        web.nativeAppearanceMode = { appearance.mode }
        val debugFixture = BuildConfig.DEBUG && intent.getBooleanExtra(DebugScheduleFixture.EXTRA, false)
        val priorities = getSharedPreferences(PRIORITY_PREFS, MODE_PRIVATE)
        schedule = ScheduleStore(
            lifecycleScope, ScheduleArchive.create(this),
            savedPriorities = priorities.getString(KEY_PRIORITIES, null),
            savePriorities = { priorities.edit().putString(KEY_PRIORITIES, it).apply() },
        )
        // Shared timetables are other people's data: they stay out of device backups.
        sharing = if (debugFixture) ScheduleSharing(lifecycleScope, null, { DebugScheduleFixture.shares(it) })
        else ScheduleSharing(lifecycleScope, java.io.File(noBackupFilesDir, "shared-schedules.json"), { web.shares(it) })
        couple = if (debugFixture) ScheduleCouple(lifecycleScope, null, { DebugScheduleFixture.couple(it) })
        else ScheduleCouple(lifecycleScope, getSharedPreferences(COUPLE_PREFS, MODE_PRIVATE), { web.couple(it) })
        shell = ShellCoordinator(lifecycleScope, web, schedule) { customization.value }
        dashboardFeeds = DashboardFeeds(web, lifecycleScope)
        agenda = AgendaStore.get(this)
        assistant = AssistantSession(this, lifecycleScope)
        activityLog = AssistantActivityLog(this)
        sync = NextSync(this, lifecycleScope, { web.authState.takeIf { it.authenticated }?.account }, agenda, assistant, activityLog,
            reminderPlan = {
                val days = DashboardSchedule.days(schedule.widgetLocalRecord() ?: ScheduleWidgetLocalDays.read(this))
                ReminderPlan.toJson(ReminderPlan.build(agenda.items, days, AgendaReminders.courseMinutes(this), LocalDateTime.now()))
            })
        // Changes made here go up a few seconds later, so a burst of edits is one upload.
        agenda.onLocalChange = { sync.request(delayMs = 3_000) }
        assistant.onLocalChange = { sync.request(delayMs = 3_000) }
        activityLog.onLocalChange = { sync.request(delayMs = 3_000) }
        assistant.onAnswered = { _, message -> autoApplyAssistant(message) }
        // Alarms are lost on an update and on a force stop: set them again.
        AgendaReminders.sync(this, agenda.items)
        shell.onReselected = { destination -> if (customization.value.doubleTapRefresh) reselect(destination) }
        shell.onOpenSettings = { route -> openSettings(route) }
        shell.onOpenExternal = { url -> openExternal(Uri.parse(url)) }
        shell.onConfirmExit = { toast("再按一次退出拾间") }
        applyCustomization()
        clientStats = ClientStats(this, lifecycleScope) {
            ClientFeatureState(appearance.mode, style.visualStyle.id, style.background != null)
        }
        // The fixture is a development surface, not a real launch of the app.
        reportsClientStats = !debugFixture
        web.onRendererLost = { crashed -> if (reportsClientStats) clientStats.recordRendererLoss(crashed) }
        shell.onAccountChanged = { account ->
            widgets.handleAccountChanged(account)
            if (reportsClientStats) clientStats.report(force = true)
        }
        // Widgets read the timetable the app writes locally: follow every change of
        // the data shown (network, archive, prefetched weeks, edits) and of sign-in.
        lifecycleScope.launch {
            snapshotFlow { listOf(schedule.result, schedule.calendar, schedule.dataRevision, web.authState.authenticated) }
                .collectLatest {
                    // The saved shared timetables belong to the account whose timetable is on screen.
                    if (!debugFixture) sharing.adopt(schedule.accountScope)
                    couple.adopt(schedule.accountScope)
                    delay(400)
                    // The next class may have moved with the timetable; the reminder reads the file just written.
                    widgets.syncLocalDays(schedule, web) { AgendaReminders.syncCourse(this@MainActivity) }
                    // The partner sees the term that is running now, edits included. Wait until
                    // the timetable has settled so one launch uploads once.
                    if (debugFixture || web.authState.authenticated) {
                        couple.refresh()
                        delay(4_000)
                        if (schedule.selectedSemester == schedule.currentSemesterValue()) couple.sync(schedule.completeSnapshot())
                    }
                }
        }
        // Sync starts once the site session is known, and again for another account.
        lifecycleScope.launch {
            snapshotFlow { web.authState.authenticated to web.authState.account }.collectLatest { (signedIn, _) ->
                if (signedIn) sync.request()
            }
        }
        lifecycleScope.launch {
            repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
                while (true) {
                    delay(5 * 60_000L)
                    sync.request()
                }
            }
        }
        // The user's layout reaches the page, the launcher and the window as it changes.
        lifecycleScope.launch {
            snapshotFlow { customization.value }.collectLatest {
                applyCustomization()
                shell.layoutChanged()
                // Launcher shortcuts follow once the user pauses (typing a title changes the value each key).
                delay(800)
                LauncherShortcuts.sync(this@MainActivity, it)
            }
        }
        lifecycleScope.launch {
            snapshotFlow { customization.value.keepScreenOn && shell.selected.kind == DestinationKind.Schedule }.collectLatest { keepOn ->
                if (keepOn) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
        if (debugFixture) {
            welcomeSeen = true
            DebugCustomization.configure(this, intent)
            shell.connectDebugFixture()
            DebugScheduleFixture.configure(this, intent)
        } else {
            shell.connect()
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                exitFullscreen?.let {
                    it()
                    return
                }
                if (imagePreview != null) {
                    imagePreview = null
                    return
                }
                lifecycleScope.launch {
                    if (shell.handleBack() == BackOutcome.Exit) {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })

        val root = FrameLayout(this)
        nativeWebLayer = NativeWebLayer(this)
        val chrome = ComposeView(this)
        root.addView(chrome, FrameLayout.LayoutParams(-1, -1))
        root.addView(nativeWebLayer, FrameLayout.LayoutParams(0, 0))
        setContentView(root)
        nativeWebLayer.setAction(ComposeView(this).apply {
            setContent { CpuTheme(appearance.mode, customization.value) { NativePostAction(this@MainActivity) } }
        })
        chrome.setContent {
            CpuTheme(appearance.mode, customization.value) {
                AppRoot(this)
            }
        }
        if (coldStart && reportsClientStats) {
            chrome.doOnPreDraw {
                // Posted so the first frame's own drawing is part of the launch.
                chrome.post { clientStats.recordLaunch(SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime()) }
            }
        }
        handleLaunchIntent(intent)
    }

    fun openSettings(route: String = "") {
        settingsRoute = route
    }

    fun closeSettings() {
        settingsRoute = null
    }

    // region Agenda and 拾间AI

    fun openAgenda(day: LocalDate? = null) {
        agendaFocus = day ?: LocalDate.now()
        customization.value.destination(DestinationCatalog.AGENDA)?.let(shell::open)
    }

    fun openAssistant() {
        customization.value.destination(DestinationCatalog.ASSISTANT)?.let(shell::open)
    }

    /** Saves an item; one with a reminder asks for the notification permission first time. */
    fun saveAgenda(item: AgendaItem): AgendaItem? {
        val saved = agenda.save(item) ?: return null
        if (saved.remind >= 0) ensureNotificationPermission()
        return saved
    }

    fun removeAgenda(id: String) {
        agenda.remove(id)
        AgendaReminders.dismiss(this, id)
    }

    fun toggleAgenda(occurrence: AgendaOccurrence) {
        agenda.setDone(occurrence.item.id, occurrence.day.toString(), !occurrence.done)
        if (!occurrence.done) AgendaReminders.dismiss(this, occurrence.item.id)
    }

    fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !AgendaReminders.canNotify(this)) {
            runCatching { notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }
        }
    }

    fun askAssistant(text: String) = assistant.send(text, ::personalContext, ::readAgentData)

    /** What 拾间AI asked to read (grades, exams, a site path), through the page's own sign-in and within what the user allows. */
    private suspend fun readAgentData(request: JSONObject): AgentData {
        val payload = if (request.optString("type") == "read") {
            val path = request.optString("path")
            val private = path.startsWith("/messages") || path.startsWith("/direct-messages")
            if (private && !assistant.privateMessages) return AgentData(error = "还没有允许拾间AI查看你的消息和私信")
            if (!private && !assistant.forum) return AgentData(error = "还没有允许拾间AI查看论坛和站内内容")
            JSONObject().put("source", "site").put("path", path)
        } else {
            if (!assistant.academic) return AgentData(error = "还没有允许拾间AI查看成绩与考试")
            JSONObject().put("source", request.optString("source")).put("semester", request.optString("semester"))
        }
        val raw = web.agentData(payload) ?: return AgentData(error = "页面没有响应，请稍后重试")
        val reply = runCatching { JSONObject(raw) }.getOrNull() ?: return AgentData(error = "读取失败，请稍后重试")
        val data = reply.optString("data")
        if (data.isNotEmpty()) return AgentData(data = data)
        return AgentData(error = reply.optString("error").ifBlank { reply.optString("__error") }.ifBlank { "读取失败，请稍后重试" })
    }

    /** Who the user is and the boards they can post in, read once in a while for 拾间AI. */
    private var siteContext: JSONObject? = null
    private var siteContextAt = 0L

    private suspend fun siteContext(): JSONObject? {
        if (!web.authState.authenticated) return null
        if (siteContext == null || System.currentTimeMillis() - siteContextAt > 30 * 60_000L) {
            val raw = web.agentData(JSONObject().put("source", "context"))
            runCatching { JSONObject(JSONObject(raw ?: "{}").optString("data")) }.getOrNull()?.let {
                siteContext = it
                siteContextAt = System.currentTimeMillis()
            }
        }
        return siteContext
    }

    /** The boards 拾间AI may post in, for the editor of a proposed post. */
    val postBoards: List<Pair<String, String>>
        get() = siteContext?.optJSONArray("boards")?.let { array ->
            (0 until array.length()).mapNotNull { array.optJSONObject(it) }.map { it.optString("slug") to it.optString("name") }
        }.orEmpty()

    /**
     * What a question to 拾间AI carries: the time, how the app is set up, what
     * the user lets it see (the campus feeds' titles; grades and exams only
     * as [toolResults] read for this question) and, in personal mode, the
     * next seven days of classes, the user's own items and the unread count.
     */
    suspend fun personalContext(toolResults: JSONArray = JSONArray()): JSONObject {
        val now = LocalDateTime.now()
        val custom = customization.value
        val json = JSONObject()
            .put("now", "%04d-%02d-%02dT%02d:%02d".format(now.year, now.monthValue, now.dayOfMonth, now.hour, now.minute))
            .put("shared", assistant.personal)
            .put("allow", JSONObject().put("academic", assistant.academic && web.authState.authenticated).put("campus", assistant.campus)
                .put("forum", assistant.forum && web.authState.authenticated).put("messages", assistant.privateMessages && web.authState.authenticated))
            .put("app", JSONObject()
                .put("tabs", JSONArray(custom.tabs.filter { ASSISTANT_DESTINATION.matches(it) }.take(6)))
                .put("launch", custom.launchTab.take(40))
                .put("accent", custom.accent.take(20))
                .put("appearance", appearance.mode.takeIf { it == "light" || it == "dark" } ?: "system")
                .put("scheduleStyle", style.visualStyle.id)
                .put("courseRemind", AgendaReminders.courseMinutes(this).coerceIn(-1, 60)))
            .put("toolResults", toolResults)
        if (assistant.campus) {
            // The feeds load with 今天; wait briefly when they have not loaded yet.
            if (dashboardFeeds.announcements.isEmpty() && dashboardFeeds.hot.isEmpty()) {
                dashboardFeeds.refresh()
                kotlinx.coroutines.withTimeoutOrNull(5_000) { while (dashboardFeeds.loading) delay(100) }
            }
            fun titles(items: List<FeedItem>) = JSONArray(items.take(8).map { it.title.take(80) })
            json.put("campus", JSONObject().put("announcements", titles(dashboardFeeds.announcements)).put("hot", titles(dashboardFeeds.hot)))
        }
        siteContext()?.let { site ->
            json.put("site", JSONObject().put("me", site.optJSONObject("me") ?: JSONObject.NULL).put("boards", site.optJSONArray("boards") ?: JSONArray()))
        }
        if (!assistant.personal) return json
        val today = now.toLocalDate()
        val days = DashboardSchedule.days(schedule.widgetLocalRecord() ?: ScheduleWidgetLocalDays.read(this))
        days[today.toString()]?.week?.let { json.put("week", it) }
        val courses = JSONArray()
        for (offset in 0L..6L) {
            val day = today.plusDays(offset)
            days[day.toString()]?.courses?.forEach { course ->
                if (AgendaItem.parseTime(course.start) == null || AgendaItem.parseTime(course.end) == null || courses.length() >= 120) return@forEach
                courses.put(JSONObject().put("date", day.toString()).put("start", course.start).put("end", course.end)
                    .put("name", course.name.take(60)).put("location", course.location.take(60)))
            }
        }
        json.put("courses", courses)
        val horizon = today.plusDays(60)
        val items = agenda.items.filter { item ->
            val date = AgendaItem.parseDate(item.date)
            when {
                date == null -> !item.done
                item.repeat != AgendaRepeat.None -> true
                else -> !date.isBefore(today.minusDays(7)) && !date.isAfter(horizon)
            }
        }.takeLast(150)
        json.put("agenda", JSONArray(items.map { item ->
            JSONObject().put("id", item.id).put("kind", item.kind.id).put("title", item.title.take(60))
                .put("date", item.date).put("start", item.start).put("end", item.end).put("location", item.location.take(40))
                .put("remind", item.remind).put("repeat", item.repeat.id).put("done", item.isDoneOn(today.toString()))
        }))
        if (web.authState.authenticated) json.put("unread", web.unreadCount)
        return json
    }

    fun regenerateAssistant() = assistant.regenerate(::personalContext, ::readAgentData)

    /** Runs one proposal (confirmed, or [auto] under the confirmation setting) and records it in the action log. */
    fun applyAssistantProposal(messageId: String, proposal: AssistantProposal, auto: Boolean = false) {
        val conversationId = assistant.conversationOf(messageId) ?: return
        if (proposal.action.optString("type") in ApprovalMode.SITE) {
            runSiteAction(conversationId, messageId, proposal, auto)
            return
        }
        val result = runCatching { executeAssistantAction(proposal.action) }.getOrNull()
        if (result == null) {
            val note = "没能完成：这一项可能已经被改过或删掉了"
            assistant.setProposal(messageId, proposal.id, ProposalState.Failed, note, auto)
            activityLog.record(conversationId, messageId, proposal, note, failed = true, auto = auto)
            return
        }
        result.second?.let { undoActions[proposal.id] = it }
        assistant.setProposal(messageId, proposal.id, ProposalState.Applied, result.first, auto)
        activityLog.record(conversationId, messageId, proposal, result.first, failed = false, auto = auto)
    }

    /**
     * A post, reply, like, private message, lost-and-found entry or "mark all
     * read", sent through the signed-in page. Posts and replies can be taken
     * back (deleted), likes undone; a sent message cannot.
     */
    private fun runSiteAction(conversationId: String, messageId: String, proposal: AssistantProposal, auto: Boolean) {
        val action = proposal.action
        val type = action.optString("type")
        assistant.setProposal(messageId, proposal.id, ProposalState.Running, when (type) {
            "forum.post", "lostfound.post" -> "正在发布…"
            "forum.reply" -> "正在回复…"
            "dm.send" -> "正在发送…"
            else -> "正在处理…"
        }, auto)
        lifecycleScope.launch {
            val raw = web.agentAct(action)
            val reply = runCatching { JSONObject(raw ?: "") }.getOrNull()
            if (reply == null || !reply.optBoolean("ok")) {
                val note = reply?.optString("error")?.ifBlank { null } ?: if (raw == null) "页面没有响应，请稍后重试" else "没能完成，请稍后重试"
                assistant.setProposal(messageId, proposal.id, ProposalState.Failed, note, auto)
                activityLog.record(conversationId, messageId, proposal, note, failed = true, auto = auto)
                return@launch
            }
            val pending = reply.optString("status") == "pending" || reply.optString("status") == "manual_review"
            val id = reply.optLong("id", 0L)
            val note = when (type) {
                "forum.post" -> if (pending) "已提交，审核通过后显示" else "已发布"
                "forum.reply" -> if (pending) "已提交回复，审核通过后显示" else "已回复"
                "forum.like" -> if (reply.optBoolean("liked")) "已点赞" else "已取消点赞"
                "dm.send" -> "已发送"
                "messages.readAll" -> "已全部标为已读"
                "lostfound.post" -> if (pending) "已提交，审核通过后显示" else "已发布到失物招领"
                else -> "已完成"
            }
            val undo: (() -> Unit)? = when {
                type == "forum.post" && id > 0 -> { { undoSiteAction(JSONObject().put("type", "topic.delete").put("id", id), "帖子已删除") } }
                type == "forum.reply" && id > 0 -> { { undoSiteAction(JSONObject().put("type", "reply.delete").put("id", id), "回复已删除") } }
                type == "forum.like" -> { { undoSiteAction(action, "已撤销点赞") } }
                else -> null
            }
            undo?.let { undoActions[proposal.id] = it }
            assistant.setProposal(messageId, proposal.id, ProposalState.Applied, note, auto, reply.optString("link").takeIf { it.startsWith("/") }.orEmpty())
            activityLog.record(conversationId, messageId, proposal, note, failed = false, auto = auto)
        }
    }

    private fun undoSiteAction(action: JSONObject, done: String) {
        lifecycleScope.launch {
            val reply = runCatching { JSONObject(web.agentAct(action) ?: "") }.getOrNull()
            toast(if (reply?.optBoolean("ok") == true) done else reply?.optString("error")?.ifBlank { null } ?: "撤销失败，请到网页上处理")
        }
    }

    /** The user's edit of a proposed post, reply or message, sent at once. */
    fun applyEditedAssistantProposal(messageId: String, proposal: AssistantProposal, action: JSONObject) {
        assistant.updateProposalAction(messageId, proposal.id, action)
        applyAssistantProposal(messageId, proposal.copy(action = action))
    }

    /** A page or view 拾间AI offered: opened only when tapped, recorded in the log, and still there to tap again. */
    fun openAssistantNavigation(messageId: String, proposal: AssistantProposal) {
        val conversationId = assistant.conversationOf(messageId) ?: return
        val result = runCatching { executeAssistantAction(proposal.action) }.getOrNull()
        activityLog.record(conversationId, messageId, proposal, result?.first ?: "没能打开", failed = result == null, auto = false)
    }

    fun applyAllAssistantProposals(message: AssistantMessage) {
        message.proposals.filter { it.state == ProposalState.Pending && it.action.optString("type") !in ApprovalMode.VIEW_ONLY }
            .forEach { applyAssistantProposal(message.id, it) }
    }

    /** A proposed item the user changed in the editor before adding it. */
    fun applyEditedAgendaProposal(messageId: String, proposal: AssistantProposal, saved: AgendaItem) {
        val conversationId = assistant.conversationOf(messageId) ?: return
        val note = "已按你改的添加到${AgendaItem.parseDate(saved.date)?.let { dayLabel(it, LocalDate.now(), withWeekday = false) } ?: "日程"}"
        undoActions[proposal.id] = { removeAgenda(saved.id) }
        assistant.setProposal(messageId, proposal.id, ProposalState.Applied, note)
        activityLog.record(conversationId, messageId, proposal.copy(action = JSONObject(proposal.action.toString()).put("item", AgendaCodec.toJson(saved))), note, failed = false, auto = false)
    }

    /**
     * Runs what the confirmation setting allows of a finished answer. Pages never
     * open on their own (the user is still reading); they wait as buttons.
     */
    private fun autoApplyAssistant(message: AssistantMessage) {
        val mode = assistant.approval
        message.proposals.filter { it.state == ProposalState.Pending && mode.runsWithoutAsking(it.action.optString("type")) }
            .forEach { applyAssistantProposal(message.id, it, auto = true) }
    }

    fun canUndoAssistant(proposalId: String): Boolean = proposalId in undoActions

    fun undoAssistant(messageId: String, proposalId: String) {
        undoActions.remove(proposalId)?.invoke() ?: return
        assistant.setProposal(messageId, proposalId, ProposalState.Dismissed, "已撤销")
        activityLog.markUndone(proposalId)
    }

    fun openAssistantLink(link: AssistantLink) {
        if (link.url.startsWith("/")) shell.openWeb(link.url)
        else if (AppConfig.isHttpUrl(link.url)) openExternal(Uri.parse(link.url))
    }

    /** Runs one confirmed proposal; returns what to tell the user and how to undo it, or null when it cannot run. */
    private fun executeAssistantAction(action: JSONObject): Pair<String, (() -> Unit)?>? {
        val today = LocalDate.now()
        return when (action.optString("type")) {
            "agenda.create" -> {
                val item = action.optJSONObject("item") ?: return null
                val saved = saveAgenda(AgendaItem(
                    id = "", kind = AgendaKind.of(item.optString("kind")), title = item.optString("title"),
                    date = item.optString("date"), start = item.optString("start"), end = item.optString("end"),
                    location = item.optString("location"), note = item.optString("note"),
                    remind = item.optInt("remind", -1), repeat = AgendaRepeat.of(item.optString("repeat")), origin = "assistant",
                )) ?: return null
                "已添加到${AgendaItem.parseDate(saved.date)?.let { dayLabel(it, today, withWeekday = false) } ?: "日程"}" to { agenda.remove(saved.id); Unit }
            }
            "agenda.update" -> {
                val previous = agenda.items.firstOrNull { it.id == action.optString("id") } ?: return null
                val changes = action.optJSONObject("changes") ?: JSONObject()
                fun text(key: String, current: String) = if (changes.has(key)) changes.optString(key) else current
                val next = previous.copy(
                    kind = if (changes.has("kind")) AgendaKind.of(changes.optString("kind")) else previous.kind,
                    title = text("title", previous.title), date = text("date", previous.date), start = text("start", previous.start),
                    end = text("end", previous.end), location = text("location", previous.location), note = text("note", previous.note),
                    remind = if (changes.has("remind")) changes.optInt("remind", previous.remind) else previous.remind,
                    repeat = if (changes.has("repeat")) AgendaRepeat.of(changes.optString("repeat")) else previous.repeat,
                )
                saveAgenda(next) ?: return null
                "已修改" to { agenda.save(previous); Unit }
            }
            "agenda.complete" -> {
                val item = agenda.items.firstOrNull { it.id == action.optString("id") } ?: return null
                val day = action.optString("date").ifEmpty { item.date.ifEmpty { today.toString() } }
                agenda.setDone(item.id, day, true)
                AgendaReminders.dismiss(this, item.id)
                "已完成" to { agenda.setDone(item.id, day, false) }
            }
            "agenda.delete" -> {
                val removed = agenda.remove(action.optString("id")) ?: return null
                AgendaReminders.dismiss(this, removed.id)
                "已删除" to { agenda.restore(removed) }
            }
            "course.remind" -> {
                val previous = AgendaReminders.courseMinutes(this)
                val minutes = action.optInt("minutes", -1)
                AgendaReminders.setCourseMinutes(this, minutes)
                if (minutes >= 0) ensureNotificationPermission()
                val note = when {
                    minutes < 0 -> "已关闭上课提醒"
                    else -> AgendaReminders.nextCourseReminder(this)?.let { (at, course) ->
                        "已设置，下一次：${dayLabel(at.toLocalDate(), LocalDate.now(), withWeekday = false)} ${"%02d:%02d".format(at.hour, at.minute)}（${course.name}）"
                    } ?: "已设置；还没读到接下来的课，打开一次课表后会排上"
                }
                note to { AgendaReminders.setCourseMinutes(this, previous) }
            }
            "theme.accent" -> {
                val previous = customization.value.accent
                val value = action.optString("value")
                customization.update { it.copy(accent = value) }
                if (customization.value.accent == previous && value != previous) return null
                "已更换主题色" to { customization.update { it.copy(accent = previous) } }
            }
            "theme.mode" -> {
                val previous = appearance.mode
                appearance.select(action.optString("value"))
                "已切换" to { appearance.select(previous) }
            }
            "open" -> {
                when (action.optString("target")) {
                    "schedule" -> shell.openSchedule(null, null)
                    "agenda" -> openAgenda(AgendaItem.parseDate(action.optString("date")))
                    "settings" -> openSettings("")
                    else -> customization.value.destination(DestinationCatalog.DASHBOARD)?.let(shell::open)
                }
                "已打开" to null
            }
            "layout.preset" -> {
                val preset = LAYOUT_PRESETS.firstOrNull { it.id == action.optString("id") } ?: return null
                val previous = customization.value
                customization.update(preset.apply)
                "已换成「${preset.title}」布局" to { customization.update { AssistantControls.withPresetFields(it, previous) } }
            }
            "tabs.set" -> {
                val ids = action.optJSONArray("tabs")?.let { array -> (0 until array.length()).map { array.optString(it) } }.orEmpty()
                val previous = customization.value
                val next = AssistantControls.withTabs(previous, ids, action.optString("launch").ifEmpty { null }) ?: return null
                customization.update { next }
                "已调整导航栏" to {
                    customization.update { it.copy(tabs = previous.tabs, launchTab = previous.launchTab) }
                }
            }
            "setting.set" -> {
                val key = action.optString("key")
                val previous = AssistantControls.setting(customization.value, key) ?: return null
                val on = action.optBoolean("value")
                customization.update { AssistantControls.withSetting(it, key, on) ?: it }
                "已${if (on) "打开" else "关闭"}${AssistantControls.settings[key]}" to {
                    customization.update { AssistantControls.withSetting(it, key, previous) ?: it }
                }
            }
            "text.size" -> {
                val previous = customization.value.fontScale
                customization.update { it.copy(fontScale = action.optDouble("scale", 1.0).toFloat()) }
                "文字大小已调到 ${(customization.value.fontScale * 100).roundToInt()}%" to {
                    customization.update { it.copy(fontScale = previous) }
                }
            }
            "today.add" -> {
                val section = action.optString("section")
                val title = DashboardCards.types[section] ?: return null
                if (section !in DashboardCards.repeatable && customization.value.dashboard.cards.any { it.type == section }) {
                    return "今天页面里已经有「$title」了" to null
                }
                val (next, card) = AssistantControls.withTodayCard(
                    customization.value, section, action.optString("title"), action.optString("date"), action.optString("text"),
                ) { java.util.UUID.randomUUID().toString().filter(Char::isLetterOrDigit).take(6).lowercase() } ?: return null
                customization.update { next }
                "已添加到今天页面" to { customization.update { AssistantControls.withoutTodayCard(it, card.id) } }
            }
            "today.remove" -> {
                val section = action.optString("section")
                val removed = AssistantControls.todayCardsOf(customization.value, section)
                if (removed.isEmpty()) return "今天页面里本来就没有这一项" to null
                customization.update { AssistantControls.withoutTodayCards(it, section) }
                "已从今天页面移除" to { customization.update { AssistantControls.withRestoredTodayCards(it, removed) } }
            }
            "schedule.view" -> {
                val previous = schedule.viewMode
                val view = ScheduleStore.normalizedViewMode(action.optString("view"))
                shell.openSchedule(null, null)
                schedule.selectViewMode(view)
                action.optString("date").takeIf { AgendaItem.parseDate(it) != null }?.let { schedule.selectDate(it) }
                "已切换到${when (view) { "day" -> "日"; "month" -> "月"; else -> "周" }}视图" to { schedule.selectViewMode(previous) }
            }
            "schedule.style" -> {
                val id = action.optString("style")
                val next = ScheduleVisualStyle.entries.firstOrNull { it.id == id } ?: return null
                val previous = style.visualStyle
                style.selectVisualStyle(next)
                "课表已换成「${next.title}」" to { style.selectVisualStyle(previous) }
            }
            "web.open" -> {
                val path = action.optString("path").takeIf { SITE_PATH.matches(it) } ?: return null
                shell.openWeb(path)
                "已打开" to null
            }
            else -> null
        }
    }

    // endregion

    /** The page, the window and the shell follow the user's latest choices. */
    private fun applyCustomization() {
        val custom = customization.value
        web.applyPreferences(WebTheming.documentScript(AppConfig.origin, WebTheming.css(custom, this), custom), custom.webTextZoom)
        if (custom.secureScreen) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    /** The active tab tapped again: back to its start, or a refresh when already there. */
    private fun reselect(destination: cn.lizmt.cpuweb.schedule.custom.Destination) {
        when (destination.kind) {
            DestinationKind.Web -> if (shell.isTabRoot(web.currentPath)) web.refresh() else web.navigate(shell.rootPath(destination), replace = true)
            DestinationKind.Schedule -> schedule.returnToCurrentWeek()
            DestinationKind.Dashboard -> {
                dashboardFeeds.refresh(force = true)
                shell.requestScheduleLoad(force = false)
            }
            DestinationKind.Agenda -> agendaFocus = LocalDate.now()
            else -> Unit
        }
    }

    fun finishWelcome() {
        welcomeSeen = true
        getSharedPreferences(SHELL_PREFS, MODE_PRIVATE).edit().putBoolean(KEY_WELCOME_SEEN, true).apply()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLaunchIntent(intent)
    }

    /** Widgets open the native timetable at the current week (or the week they showed); launcher shortcuts open their page. */
    private fun handleLaunchIntent(intent: Intent?) {
        intent?.getStringExtra(AgendaReminders.EXTRA_OPEN_AGENDA)?.let { id ->
            intent.removeExtra(AgendaReminders.EXTRA_OPEN_AGENDA)
            val day = agenda.items.firstOrNull { it.id == id }?.date?.let(AgendaItem::parseDate)
            lifecycleScope.launch {
                while (!shell.isAuthResolved) kotlinx.coroutines.delay(100)
                openAgenda(day)
            }
            return
        }
        intent?.getStringExtra(LauncherShortcuts.EXTRA_DESTINATION)?.let { id ->
            intent.removeExtra(LauncherShortcuts.EXTRA_DESTINATION)
            customization.value.destination(id)?.let { destination ->
                // A cold start opens the page once the shell knows whether the user is signed in.
                lifecycleScope.launch {
                    while (!shell.isAuthResolved) kotlinx.coroutines.delay(100)
                    shell.open(destination)
                }
            }
            return
        }
        if (intent?.getBooleanExtra(EXTRA_OPEN_SCHEDULE, false) != true) return
        val semester = intent.getStringExtra(EXTRA_SEMESTER)?.takeIf { Regex("^\\d{4}-\\d{4}-[12]$").matches(it) }
        val week = intent.getStringExtra(EXTRA_WEEK)?.takeIf { it.toIntOrNull() in 1..64 }
        intent.removeExtra(EXTRA_OPEN_SCHEDULE)
        shell.openSchedule(semester, week)
    }

    override fun onStart() {
        super.onStart()
        updates.onForeground(this)
    }

    override fun onStop() {
        updates.onBackground(this)
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        web.webView.onResume()
        legacyBridge.resumePendingInstall()
        widgets.refreshForNightMode()
        if (reportsClientStats) clientStats.report()
        sync.request(minIntervalMs = 30_000)
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        widgets.refreshForNightMode()
    }

    fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    /** JWXT authorization lives on the Web 教务 page; it returns to the native timetable when done. */
    fun openAcademicAuthorization() {
        shell.openWeb("/jwxt?reauthorize=1&redirect=/schedule")
    }

    fun pickScheduleBackground() {
        backgroundPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
    }

    fun saveCalendarFile(fileName: String, content: String) {
        pendingCalendar = content
        try {
            calendarSaver.launch(fileName)
        } catch (_: ActivityNotFoundException) {
            pendingCalendar = null
            toast("没有可以保存日历文件的应用")
        }
    }

    override fun onPause() {
        legacyBridge.pauseUpdateTracking()
        android.webkit.CookieManager.getInstance().flush()
        web.webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        (web.webView.parent as? android.view.ViewGroup)?.removeView(web.webView)
        web.destroy()
        super.onDestroy()
    }

    // region WebSessionHost

    override fun openExternal(uri: Uri) {
        if (uri.scheme.equals("intent", ignoreCase = true)) {
            openIntentUri(uri.toString())
            return
        }
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "没有可以打开此链接的应用", Toast.LENGTH_SHORT).show()
        }
    }

    /** `intent://` links from payment pages, limited to browsable activities like Chrome does. */
    private fun openIntentUri(url: String) {
        val intent = runCatching { Intent.parseUri(url, Intent.URI_INTENT_SCHEME) }.getOrNull() ?: return
        intent.addCategory(Intent.CATEGORY_BROWSABLE)
        intent.component = null
        intent.selector = null
        try {
            startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            val fallback = intent.getStringExtra("browser_fallback_url")?.let(Uri::parse)
            if (fallback != null && AppConfig.isHttpUrl(fallback.toString())) openExternal(fallback)
            else Toast.makeText(this, "没有可以打开此链接的应用", Toast.LENGTH_SHORT).show()
        }
    }

    override fun handleApkDownload(url: String): Boolean = legacyBridge.downloadAndInstallApk(url, "")

    override fun chooseFiles(params: WebChromeClient.FileChooserParams, callback: ValueCallback<Array<Uri>?>) {
        fileCallback?.onReceiveValue(null)
        fileCallback = callback
        val accepted = acceptedMimeTypes(params)
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(if (accepted.size == 1) accepted[0] else "*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, accepted)
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            fileChooser.launch(intent)
        } catch (_: ActivityNotFoundException) {
            fileCallback = null
            callback.onReceiveValue(null)
        }
    }

    override fun requestWebPermissions(permissions: Array<String>, onResult: (Boolean) -> Unit) {
        val missing = permissions.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) {
            onResult(true)
            return
        }
        permissionCallback?.invoke(false)
        permissionCallback = onResult
        webPermissions.launch(missing.toTypedArray())
    }

    override fun showFullscreen(view: View, exit: () -> Unit) {
        if (fullscreenView != null) {
            exit()
            return
        }
        fullscreenView = view
        exitFullscreen = exit
        view.setBackgroundColor(android.graphics.Color.BLACK)
        (window.decorView as ViewGroup).addView(view, FrameLayout.LayoutParams(-1, -1))
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    override fun lockFullscreenLandscape() {
        if (fullscreenView != null) requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }

    override fun hideFullscreen() {
        val view = fullscreenView ?: return
        fullscreenView = null
        exitFullscreen = null
        (view.parent as? ViewGroup)?.removeView(view)
        WindowCompat.getInsetsController(window, window.decorView).show(WindowInsetsCompat.Type.systemBars())
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }

    // endregion

    /** Called by the legacy `CPUAndroid.previewImages` bridge and the Web gallery. */
    fun showImagePreview(request: ImagePreviewRequest) {
        runOnUiThread { imagePreview = request }
    }

    /** Android 9 and older need the storage permission to write into Pictures. */
    fun ensureLegacyStoragePermission(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return true
        if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) return true
        requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), REQUEST_WRITE_STORAGE)
        return false
    }

    private fun acceptedMimeTypes(params: WebChromeClient.FileChooserParams): Array<String> {
        val result = mutableListOf<String>()
        params.acceptTypes?.forEach { accept ->
            accept?.split(',')?.forEach { part ->
                var normalized = part.trim().lowercase()
                if (normalized.isEmpty() || normalized.startsWith(".")) return@forEach
                if (!normalized.contains('/') && normalized != "*") return@forEach
                if (normalized == "*") normalized = "*/*"
                if (normalized !in result) result += normalized
            }
        }
        return (result.ifEmpty { listOf("*/*") }).toTypedArray()
    }

    private fun parseChosenFiles(data: Intent?): Array<Uri>? {
        val uris = mutableListOf<Uri>()
        val clip: ClipData? = data?.clipData
        if (clip != null) for (index in 0 until clip.itemCount) clip.getItemAt(index).uri?.let { if (it !in uris) uris += it }
        data?.data?.let { if (it !in uris) uris += it }
        return uris.takeIf { it.isNotEmpty() }?.toTypedArray()
    }

    companion object {
        const val EXTRA_OPEN_SCHEDULE = "cn.lizmt.cpuweb.OPEN_SCHEDULE"
        const val EXTRA_SEMESTER = "cn.lizmt.cpuweb.SCHEDULE_SEMESTER"
        const val EXTRA_WEEK = "cn.lizmt.cpuweb.SCHEDULE_WEEK"
        private const val SHELL_PREFS = "native_shell"
        private const val PRIORITY_PREFS = "native_schedule_priorities"
        private const val KEY_PRIORITIES = "v1"
        private const val COUPLE_PREFS = "native_schedule_couple"
        private const val KEY_WELCOME_SEEN = "welcome_seen_v4"
        private const val REQUEST_WRITE_STORAGE = 2002
        /** The destination ids 拾间AI's endpoint accepts. */
        private val ASSISTANT_DESTINATION = Regex("^(?:[a-z]{2,20}|custom:[a-z0-9]{1,12})$")
        private val SITE_PATH = Regex("^/(?!/)[^\\s\\\\]{0,300}$")
    }
}
