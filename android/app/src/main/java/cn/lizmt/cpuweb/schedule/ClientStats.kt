package cn.lizmt.cpuweb.schedule

import android.app.ActivityManager
import android.app.Application
import android.app.ApplicationExitInfo
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Process
import android.os.SystemClock
import android.webkit.CookieManager
import androidx.webkit.WebViewCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Installs the crash recorder before anything else runs and tags the process
 * with its version, so a later launch can tell which build an exit belongs to.
 * Widget updates start this process too; that is why this is not in the Activity.
 */
class CpuApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        ClientStats.processReadyAt = SystemClock.elapsedRealtime()
        runCatching { CrashRecorder.install(this) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            runCatching {
                getSystemService(ActivityManager::class.java)
                    ?.setProcessStateSummary(ClientStatsLogic.versionSummary(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE.toString()))
            }
        }
    }
}

/** Bookkeeping for the admin client statistics, kept free of Android so it can be unit tested. */
internal object ClientStatsLogic {
    /** Names for `ApplicationExitInfo.getReason()`, indexed by the platform constant. */
    val EXIT_REASONS = arrayOf(
        "unknown", "exitSelf", "signaled", "lowMemory", "crash", "crashNative", "anr", "initFailure", "permissionChange",
        "excessiveResource", "userRequested", "userStopped", "dependencyDied", "other", "freezer", "packageStateChange", "packageUpdated",
    )

    const val MAX_LAUNCH_MS = 60_000L
    private const val COLD_START_WINDOW_MS = 3_000L
    private const val MAX_STACK_CHARS = 60_000
    private const val MAX_TRACE_CHARS = 30_000

    /**
     * Whether the Activity is what started the process. A process woken
     * earlier for a widget update would otherwise count its idle time as
     * launch time. `processReadyAt` is 0 when the Application class did not run.
     */
    fun isColdStart(processReadyAt: Long, activityCreatedAt: Long): Boolean =
        processReadyAt > 0 && activityCreatedAt - processReadyAt in 0..COLD_START_WINDOW_MS

    fun exitReasonName(reason: Int): String = EXIT_REASONS.getOrElse(reason) { "other" }

    /** The server groups by Beijing date, so the client buckets by it as well. */
    fun dateKey(millis: Long): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("Asia/Shanghai") }.format(Date(millis))

    fun isoTime(millis: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).apply { timeZone = TimeZone.getTimeZone("Asia/Shanghai") }.format(Date(millis))

    fun versionSummary(versionName: String, versionCode: String): ByteArray = "$versionName|$versionCode".toByteArray()

    /** Version name and code a process stored with `setProcessStateSummary`; null when it stored none. */
    fun parseVersionSummary(bytes: ByteArray?): Pair<String, String>? {
        val parts = bytes?.takeIf { it.isNotEmpty() }?.toString(Charsets.UTF_8)?.split('|') ?: return null
        if (parts.size != 2 || parts.any { it.isBlank() || it.length > 24 }) return null
        return parts[0] to parts[1]
    }

    private fun bucket(buckets: JSONObject, date: String, version: String, build: String): JSONObject {
        val key = "$date|$version|$build"
        buckets.optJSONObject(key)?.let { return it }
        val created = JSONObject().put("date", date).put("appVersion", version).put("appBuild", build)
        buckets.put(key, created)
        return created
    }

    fun addLaunch(buckets: JSONObject, date: String, version: String, build: String, millis: Long) {
        if (millis !in 1..MAX_LAUNCH_MS) return
        val entry = bucket(buckets, date, version, build)
        entry.put("launchCount", entry.optInt("launchCount") + 1)
        entry.put("launchMsTotal", entry.optLong("launchMsTotal") + millis)
    }

    fun addRendererLoss(buckets: JSONObject, date: String, version: String, build: String, crashed: Boolean) {
        val entry = bucket(buckets, date, version, build)
        val field = if (crashed) "rendererCrashes" else "rendererKills"
        entry.put(field, entry.optInt(field) + 1)
    }

    fun addExit(buckets: JSONObject, date: String, version: String, build: String, reason: String, foreground: Boolean) {
        val entry = bucket(buckets, date, version, build)
        val exits = entry.optJSONObject("exits") ?: JSONObject().also { entry.put("exits", it) }
        val side = if (foreground) "foreground" else "background"
        val counts = exits.optJSONObject(side) ?: JSONObject().also { exits.put(side, it) }
        counts.put(reason, counts.optInt(reason) + 1)
    }

    /**
     * Buckets of days that are over, as `key to report`. A day still in
     * progress is held back: the server keeps one row per day and build, so a
     * bucket must be complete when it is sent.
     */
    fun completedReports(buckets: JSONObject, today: String, limit: Int = 30): List<Pair<String, JSONObject>> =
        buckets.keys().asSequence().toList().sorted().mapNotNull { key ->
            val entry = buckets.optJSONObject(key) ?: return@mapNotNull null
            if (entry.optString("date") >= today) return@mapNotNull null
            val launches = entry.optInt("launchCount")
            val report = JSONObject()
                .put("date", entry.optString("date"))
                .put("appVersion", entry.optString("appVersion"))
                .put("appBuild", entry.optString("appBuild"))
                .put("launchCount", launches)
                .put("launchMsAvg", if (launches > 0) entry.optLong("launchMsTotal").toDouble() / launches else JSONObject.NULL)
                .put("rendererCrashes", entry.optInt("rendererCrashes"))
                .put("rendererKills", entry.optInt("rendererKills"))
                .put("exits", entry.optJSONObject("exits") ?: JSONObject())
            key to report
        }.take(limit)

    /** Buckets too old for the server to want; they are dropped instead of retried forever. */
    fun staleKeys(buckets: JSONObject, oldestDate: String): List<String> =
        buckets.keys().asSequence().filter { key -> (buckets.optJSONObject(key)?.optString("date") ?: "") < oldestDate }.toList()

    fun stackTraceText(error: Throwable): String {
        val writer = StringWriter()
        error.printStackTrace(PrintWriter(writer))
        return writer.toString().take(MAX_STACK_CHARS)
    }

    /**
     * The main thread's section of an ANR dump. The whole dump lists every
     * thread of the process and runs to megabytes; only the main thread says
     * what blocked the app.
     */
    fun mainThreadTrace(dump: String): String {
        val lines = dump.lineSequence().toList()
        val start = lines.indexOfFirst { it.startsWith("\"main\" ") }
        if (start < 0) return ""
        val block = lines.drop(start).takeWhile { it.isNotBlank() }
        return block.joinToString("\n").take(MAX_TRACE_CHARS)
    }

    /** Stable text of a heartbeat body, to tell whether anything reported has changed. */
    fun stateSignature(body: JSONObject): String =
        body.keys().asSequence().toList().sorted().joinToString("&") { "$it=${body.opt(it)}" }

    fun diagnostic(kind: String, version: String, build: String, occurredAt: Long, threadName: String?, message: String?, stackTrace: String): JSONObject =
        JSONObject()
            .put("kind", kind)
            .put("appVersion", version)
            .put("appBuild", build)
            .put("occurredAt", isoTime(occurredAt))
            .put("threadName", threadName?.take(120) ?: JSONObject.NULL)
            .put("message", message?.take(1000) ?: JSONObject.NULL)
            .put("stackTrace", stackTrace)
}

/** Crash and ANR records waiting for upload, one small JSON file each. */
internal object ClientDiagnostics {
    private const val MAX_FILES = 20
    private const val MAX_AGE_MS = 30L * 24 * 60 * 60 * 1000

    fun directory(context: Context): File = File(context.filesDir, "client-diagnostics")

    fun write(directory: File, record: JSONObject, now: Long = System.currentTimeMillis()) {
        directory.mkdirs()
        File(directory, "${record.optString("kind")}-$now-${UUID.randomUUID().toString().take(8)}.json").writeText(record.toString())
    }

    /** Oldest first, after dropping what is too old or beyond the cap. */
    fun pending(directory: File, now: Long = System.currentTimeMillis()): List<File> {
        val files = directory.listFiles { file -> file.isFile && file.name.endsWith(".json") }?.sortedBy { it.lastModified() }.orEmpty()
        val (expired, fresh) = files.partition { now - it.lastModified() > MAX_AGE_MS }
        (expired + fresh.dropLast(MAX_FILES)).forEach { it.delete() }
        return fresh.takeLast(MAX_FILES)
    }
}

/**
 * Writes an uncaught exception to disk and then lets the system handle it as
 * before. The next launch uploads the file.
 */
internal object CrashRecorder {
    fun install(context: Context) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        if (previous is Handler) return
        Thread.setDefaultUncaughtExceptionHandler(Handler(ClientDiagnostics.directory(context.applicationContext), previous))
    }

    private class Handler(
        private val directory: File,
        private val previous: Thread.UncaughtExceptionHandler?,
    ) : Thread.UncaughtExceptionHandler {
        override fun uncaughtException(thread: Thread, error: Throwable) {
            try {
                ClientDiagnostics.write(
                    directory,
                    ClientStatsLogic.diagnostic(
                        "crash", BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE.toString(), System.currentTimeMillis(),
                        thread.name, null, ClientStatsLogic.stackTraceText(error),
                    ),
                )
            } catch (_: Throwable) {
                // Recording must never replace the original failure.
            }
            if (previous != null) previous.uncaughtException(thread, error)
            else {
                Process.killProcess(Process.myPid())
                kotlin.system.exitProcess(10)
            }
        }
    }
}

/** What the shell knows about its own settings when a heartbeat is built. */
data class ClientFeatureState(
    val appearanceMode: String,
    val scheduleStyle: String,
    val customBackground: Boolean,
)

/**
 * Reports the device, system, WebView and client version plus feature state to
 * the admin statistics, then uploads finished daily launch / exit summaries
 * and crash / ANR records (the Android counterpart of iOS
 * `IosClientHeartbeat`). The install id is a random UUID kept in app storage,
 * not the Android ID or an advertising id, and every failure is silent:
 * statistics must never affect the app.
 */
class ClientStats(
    context: Context,
    private val scope: CoroutineScope,
    private val features: () -> ClientFeatureState,
) {
    private val context = context.applicationContext
    private val prefs = this.context.getSharedPreferences("client_stats", Context.MODE_PRIVATE)
    private val lock = Any()
    private var job: Job? = null
    private var queued = false

    private val version = BuildConfig.VERSION_NAME
    private val build = BuildConfig.VERSION_CODE.toString()

    /**
     * Debug builds talking to the production site are developer devices and
     * emulators; they stay out of the statistics. A debug build pointed at a
     * development server still reports, so the flow can be tested end to end.
     */
    private val enabled = !BuildConfig.DEBUG || AppConfig.host != PRODUCTION_HOST

    private val installId: String
        get() = prefs.getString(KEY_INSTALL, null) ?: UUID.randomUUID().toString().also { prefs.edit().putString(KEY_INSTALL, it).apply() }

    /**
     * Call on the main thread when the app comes to the foreground and when
     * the account changes (`force`). Plain foreground calls are throttled.
     */
    fun report(force: Boolean = false) {
        if (!enabled) return
        if (job?.isActive == true) {
            // An account change during a running report must not be lost.
            if (force) queued = true
            return
        }
        val state = runCatching(features).getOrNull() ?: return
        val webView = runCatching { WebViewCompat.getCurrentWebViewPackage(context) }.getOrNull()
        job = scope.launch {
            withContext(Dispatchers.IO) {
                runCatching {
                    val body = heartbeat(state, webView?.versionName, webView?.packageName)
                    // The session is part of the signature but not of the report:
                    // a sign-in or sign-out is sent at once so the install follows the account.
                    val signature = ClientStatsLogic.stateSignature(body) + "&session=" + ScheduleArchive.currentSessionFingerprint().take(16)
                    val now = System.currentTimeMillis()
                    val elapsed = now - prefs.getLong(KEY_LAST_REPORT, 0)
                    val changed = prefs.getString(KEY_LAST_STATE, null) != signature
                    if (changed || elapsed < 0 || elapsed >= if (force) FORCED_INTERVAL_MS else FOREGROUND_INTERVAL_MS) {
                        // A failure is retried on the next foreground or sign-in.
                        if (post("/api/app-clients/android/heartbeat", body) == HTTP_OK) {
                            prefs.edit().putLong(KEY_LAST_REPORT, now).putString(KEY_LAST_STATE, signature).apply()
                        }
                    }
                    collectExits(now)
                    flush(now)
                }
            }
            val again = queued
            queued = false
            job = null
            if (again) report(force = true)
        }
    }

    /** Cold start measured by the Activity: process creation to the first frame. */
    fun recordLaunch(millis: Long) {
        if (!enabled) return
        updateBuckets { ClientStatsLogic.addLaunch(it, ClientStatsLogic.dateKey(System.currentTimeMillis()), version, build, millis) }
    }

    /** The WebView's renderer process died; `crashed` is false when the system reclaimed it. */
    fun recordRendererLoss(crashed: Boolean) {
        if (!enabled) return
        updateBuckets { ClientStatsLogic.addRendererLoss(it, ClientStatsLogic.dateKey(System.currentTimeMillis()), version, build, crashed) }
    }

    private fun updateBuckets(change: (JSONObject) -> Unit) {
        runCatching {
            synchronized(lock) {
                val buckets = runCatching { JSONObject(prefs.getString(KEY_BUCKETS, null) ?: "{}") }.getOrDefault(JSONObject())
                change(buckets)
                prefs.edit().putString(KEY_BUCKETS, buckets.toString()).apply()
            }
        }
    }

    private fun heartbeat(state: ClientFeatureState, webViewVersion: String?, webViewPackage: String?): JSONObject {
        val manager = AppWidgetManager.getInstance(context)
        val widgets = JSONArray()
        for (provider in WIDGET_PROVIDERS) {
            repeat(manager.getAppWidgetIds(ComponentName(context, provider)).size) { widgets.put(JSONObject().put("kind", provider.simpleName)) }
        }
        val installPermission: Any = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.packageManager.canRequestPackageInstalls() else JSONObject.NULL
        return device()
            .put("sdkInt", Build.VERSION.SDK_INT)
            .put("appVersion", version)
            .put("appBuild", build)
            .put("webViewVersion", webViewVersion ?: JSONObject.NULL)
            .put("webViewPackage", webViewPackage ?: JSONObject.NULL)
            .put("widgets", widgets)
            .put("appearanceMode", state.appearanceMode)
            .put("scheduleStyle", state.scheduleStyle)
            .put("customBackground", state.customBackground)
            .put("installPermission", installPermission)
    }

    private fun device(): JSONObject = JSONObject()
        .put("installId", installId)
        .put("deviceBrand", Build.BRAND?.takeIf { it.isNotBlank() } ?: Build.MANUFACTURER ?: "unknown")
        .put("deviceModel", Build.MODEL ?: "unknown")
        .put("systemVersion", Build.VERSION.RELEASE ?: Build.VERSION.SDK_INT.toString())

    /**
     * Why earlier processes of this app ended, from the system's own record
     * (Android 11+). An ANR also carries the thread dump taken when it happened.
     */
    private fun collectExits(now: Long) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        val last = prefs.getLong(KEY_LAST_EXIT, -1)
        if (last < 0) {
            // Exits from before this build cannot be attributed to a version.
            prefs.edit().putLong(KEY_LAST_EXIT, now).apply()
            return
        }
        val manager = context.getSystemService(ActivityManager::class.java) ?: return
        val exits = manager.getHistoricalProcessExitReasons(context.packageName, 0, 16)
            .filter { it.timestamp > last && it.processName == context.packageName }
            .sortedBy { it.timestamp }
        if (exits.isEmpty()) return
        val date = ClientStatsLogic.dateKey(now)
        val directory = ClientDiagnostics.directory(context)
        val versions = exits.map { ClientStatsLogic.parseVersionSummary(it.processStateSummary) ?: (version to build) }
        // The dump is read before the buckets are locked: it can be megabytes.
        exits.forEachIndexed { index, exit ->
            if (exit.reason != ApplicationExitInfo.REASON_ANR) return@forEachIndexed
            val dump = runCatching { exit.traceInputStream?.use { it.readBytes().toString(Charsets.UTF_8) } }.getOrNull().orEmpty()
            val trace = ClientStatsLogic.mainThreadTrace(dump)
            if (trace.isEmpty()) return@forEachIndexed
            val (exitVersion, exitBuild) = versions[index]
            runCatching {
                ClientDiagnostics.write(directory, ClientStatsLogic.diagnostic("anr", exitVersion, exitBuild, exit.timestamp, "main", exit.description, trace))
            }
        }
        updateBuckets { buckets ->
            exits.forEachIndexed { index, exit ->
                val foreground = exit.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE
                ClientStatsLogic.addExit(buckets, date, versions[index].first, versions[index].second, ClientStatsLogic.exitReasonName(exit.reason), foreground)
            }
        }
        prefs.edit().putLong(KEY_LAST_EXIT, exits.last().timestamp).apply()
    }

    private fun flush(now: Long) {
        val today = ClientStatsLogic.dateKey(now)
        val oldest = ClientStatsLogic.dateKey(now - RETENTION_MS)
        val reports: List<Pair<String, JSONObject>>
        synchronized(lock) {
            val buckets = runCatching { JSONObject(prefs.getString(KEY_BUCKETS, null) ?: "{}") }.getOrDefault(JSONObject())
            val stale = ClientStatsLogic.staleKeys(buckets, oldest)
            if (stale.isNotEmpty()) {
                stale.forEach(buckets::remove)
                prefs.edit().putString(KEY_BUCKETS, buckets.toString()).apply()
            }
            reports = ClientStatsLogic.completedReports(buckets, today)
        }
        val files = ClientDiagnostics.pending(ClientDiagnostics.directory(context), now).take(DIAGNOSTICS_PER_UPLOAD)
        val diagnostics = files.mapNotNull { file -> runCatching { JSONObject(file.readText()) }.getOrNull()?.let { file to it } }
        // A file that cannot be parsed will never upload.
        files.filter { file -> diagnostics.none { it.first == file } }.forEach { it.delete() }
        if (reports.isEmpty() && diagnostics.isEmpty()) return
        val body = device()
            .put("reports", JSONArray(reports.map { it.second }))
            .put("diagnostics", JSONArray(diagnostics.map { it.second }))
        // The server has the batch, or says it never will accept it: either way it is done.
        val status = post("/api/app-clients/android/metrics", body)
        if (status != HTTP_OK && status != HttpURLConnection.HTTP_BAD_REQUEST) return
        updateBuckets { buckets -> reports.forEach { buckets.remove(it.first) } }
        diagnostics.forEach { it.first.delete() }
    }

    /**
     * A request with the WebView's site session, so a signed-in heartbeat links
     * the install to its account. Returns 200 only for an accepted request.
     */
    private fun post(path: String, body: JSONObject): Int {
        val url = AppConfig.routeUrl(path) ?: return -1
        val cookies = runCatching { CookieManager.getInstance().getCookie(AppConfig.origin) }.getOrNull().orEmpty()
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 20_000
            connection.instanceFollowRedirects = false
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", AppConfig.userAgentSuffix(BuildConfig.VERSION_CODE, version))
            connection.setRequestProperty("X-CPU-Auth-Mode", "cookie")
            connection.setRequestProperty("X-CPU-Client", "android")
            if (cookies.isNotEmpty()) {
                connection.setRequestProperty("Cookie", cookies)
                csrfToken(cookies)?.let { connection.setRequestProperty("X-CSRF-Token", it) }
            }
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val status = connection.responseCode
            if (status !in 200..299) return status
            val text = connection.inputStream.bufferedReader().use { it.readText() }
            return if (JSONObject(text).optInt("code", -1) == 0) HTTP_OK else -1
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        /** Set by [CpuApplication] once the process is up. */
        @Volatile var processReadyAt = 0L
        private var launchClaimed = false

        /** True for the first Activity of a process that was started to show it. */
        fun claimColdStart(): Boolean {
            if (launchClaimed) return false
            launchClaimed = true
            return ClientStatsLogic.isColdStart(processReadyAt, SystemClock.elapsedRealtime())
        }

        internal fun csrfToken(cookies: String): String? {
            val value = cookies.split(';').map { it.trim() }.firstOrNull {
                it.startsWith("__Host-cpu-csrf=") || it.startsWith("cpu-csrf=")
            }?.substringAfter('=')?.takeIf { it.isNotEmpty() } ?: return null
            return runCatching { Uri.decode(value) }.getOrDefault(value)
        }

        private const val PRODUCTION_HOST = "cputime.cn"
        private const val HTTP_OK = 200
        private const val KEY_INSTALL = "install_id"
        private const val KEY_LAST_REPORT = "last_report"
        private const val KEY_LAST_STATE = "last_state"
        private const val KEY_LAST_EXIT = "last_exit"
        private const val KEY_BUCKETS = "buckets"
        /** Foreground returns within this window are not reported again unless something reported has changed. */
        private const val FOREGROUND_INTERVAL_MS = 30 * 60 * 1000L
        /** Sign-ins are always reported so the install links to the account, but never more than once a minute. */
        private const val FORCED_INTERVAL_MS = 60 * 1000L
        private const val RETENTION_MS = 60L * 24 * 60 * 60 * 1000
        private const val DIAGNOSTICS_PER_UPLOAD = 10

        private val WIDGET_PROVIDERS = listOf(
            ScheduleWidgetProvider::class.java,
            ScheduleWidgetProviderWide::class.java,
            ScheduleWidgetProviderTodayWide::class.java,
            ScheduleWidgetProviderTodayLarge::class.java,
            ScheduleWidgetProviderLarge::class.java,
        )
    }
}
