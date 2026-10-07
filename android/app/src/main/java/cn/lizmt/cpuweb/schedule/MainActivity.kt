package cn.lizmt.cpuweb.schedule

import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import androidx.compose.runtime.snapshotFlow
import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.compose.ui.platform.ComposeView
import androidx.core.view.doOnPreDraw
import android.widget.FrameLayout
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

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
        private set
    private lateinit var clientStats: ClientStats
    private var reportsClientStats = false
    private lateinit var legacyBridge: CpuAndroidBridge
    lateinit var nativeWebLayer: NativeWebLayer
        private set

    var imagePreview by mutableStateOf<ImagePreviewRequest?>(null)
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
        shell = ShellCoordinator(lifecycleScope, web, schedule)
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
                    delay(400)
                    widgets.syncLocalDays(schedule, web)
                }
        }
        if (debugFixture) {
            welcomeSeen = true
            shell.connectDebugFixture()
            DebugScheduleFixture.configure(this, intent)
        } else {
            shell.connect()
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (imagePreview != null) {
                    imagePreview = null
                    return
                }
                lifecycleScope.launch {
                    if (!shell.handleBack()) {
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
            setContent { CpuTheme(appearance.mode) { NativePostAction(this@MainActivity) } }
        })
        chrome.setContent {
            CpuTheme(appearance.mode) {
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

    fun finishWelcome() {
        welcomeSeen = true
        getSharedPreferences(SHELL_PREFS, MODE_PRIVATE).edit().putBoolean(KEY_WELCOME_SEEN, true).apply()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLaunchIntent(intent)
    }

    /** Widgets open the native timetable at the current week (or the week they showed). */
    private fun handleLaunchIntent(intent: Intent?) {
        if (intent?.getBooleanExtra(EXTRA_OPEN_SCHEDULE, false) != true) return
        val semester = intent.getStringExtra(EXTRA_SEMESTER)?.takeIf { Regex("^\\d{4}-\\d{4}-[12]$").matches(it) }
        val week = intent.getStringExtra(EXTRA_WEEK)?.takeIf { it.toIntOrNull() in 1..64 }
        intent.removeExtra(EXTRA_OPEN_SCHEDULE)
        shell.openSchedule(semester, week)
    }

    override fun onResume() {
        super.onResume()
        web.webView.onResume()
        legacyBridge.resumePendingInstall()
        widgets.refreshForNightMode()
        if (reportsClientStats) clientStats.report()
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
        shell.openWeb("/jwxt?reauthorize=1&redirect=/schedule", ShellTab.Academic)
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
        private const val KEY_WELCOME_SEEN = "welcome_seen_v4"
        private const val REQUEST_WRITE_STORAGE = 2002
    }
}
