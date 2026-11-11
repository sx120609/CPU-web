package cn.lizmt.cpuweb.schedule

import android.app.Activity
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.webkit.WebSettings
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import cn.lizmt.cpuweb.schedule.update.ApkDelta
import cn.lizmt.cpuweb.schedule.update.PatchInfo
import cn.lizmt.cpuweb.schedule.update.ReleaseClient
import cn.lizmt.cpuweb.schedule.update.ReleaseInfo
import cn.lizmt.cpuweb.schedule.update.UpdateDownloader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.lang.ref.WeakReference

/** When an update may download without asking. */
enum class DownloadPolicy(val id: String, val title: String) {
    Wifi("wifi", "Wi-Fi 下自动下载；5 MB 以内的增量包用流量也自动下载"),
    Always("always", "任何网络都自动下载"),
    Manual("manual", "只在我点击时下载");

    companion object {
        fun of(id: String?) = entries.firstOrNull { it.id == id } ?: Wifi
    }
}

sealed interface UpdateState {
    data object Idle : UpdateState
    data object Checking : UpdateState
    data class UpToDate(val release: ReleaseInfo) : UpdateState
    data class Available(val release: ReleaseInfo) : UpdateState
    data class Downloading(val release: ReleaseInfo, val viaPatch: Boolean, val downloaded: Long, val total: Long) : UpdateState
    data class Preparing(val release: ReleaseInfo, val step: String) : UpdateState
    /** Verified and waiting: installs on a tap, or by itself once the user has left the app. */
    data class Ready(val release: ReleaseInfo, val viaPatch: Boolean, val savedBytes: Long, val needsConfirmation: Boolean = false) : UpdateState
    data class Installing(val release: ReleaseInfo) : UpdateState
    data class Failed(val message: String, val release: ReleaseInfo?) : UpdateState
}

/**
 * The app's own updater (ported from 药大拾间 NEXT): checks the published release,
 * downloads an incremental patch when one exists for the installed version
 * (falling back to the full APK, which the user can also ask for), verifies the
 * result, and installs it through a `PackageInstaller` session. On Android 12
 * and later, once install permission is granted, the app updates itself without
 * the system install dialog; by default that happens a little after the user
 * leaves the app, so nothing they are doing is interrupted.
 *
 * The Web page's update dialog and [ApkUpdateController] remain for links to an
 * APK and for the required-update campaign; they hand everything else to this.
 */
class AppUpdater private constructor(private val context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val main = Handler(Looper.getMainLooper())
    private val userAgent: String by lazy {
        val base = runCatching { WebSettings.getDefaultUserAgent(context) }.getOrDefault("Mozilla/5.0 (Linux; Android)")
        base + " " + AppConfig.userAgentSuffix(installedVersion, installedVersionName)
    }
    private val client = ReleaseClient(AppConfig.origin) { userAgent }
    private val downloader = UpdateDownloader { userAgent }
    private var job: Job? = null

    /**
     * The user tapped 更新 and is waiting: once the package is ready it installs
     * straight away instead of stopping at 已准备好 for a second tap.
     */
    private var installWhenReady = false

    /** The version an automatic check decided to download by itself (worked out off the main thread). */
    @Volatile private var autoDownloadVersion = 0
    private var pendingConfirmation: Intent? = null
    private var activity = WeakReference<Activity>(null)
    private val backgroundInstall = Runnable { installInBackground {} }
    private val installingInBackground = java.util.concurrent.atomic.AtomicBoolean(false)

    var state by mutableStateOf<UpdateState>(UpdateState.Idle)
        private set
    var autoCheck by mutableStateOf(prefs.getBoolean(KEY_AUTO_CHECK, true))
        private set
    var downloadPolicy by mutableStateOf(DownloadPolicy.of(prefs.getString(KEY_DOWNLOAD, null)))
        private set
    var installOnLeave by mutableStateOf(prefs.getBoolean(KEY_INSTALL_ON_LEAVE, true))
        private set
    var lastCheckedAt by mutableLongStateOf(prefs.getLong(KEY_CHECKED_AT, 0))
        private set
    /** The version the app just updated to, with its notes, until the user has read them. */
    var justUpdated by mutableStateOf(readJustUpdated())
        private set
    var foreground = false
        private set

    val installedVersion: Int get() = packageVersion().first
    val installedVersionName: String get() = packageVersion().second

    /** Android 12+ with install permission: no system dialog for our own update. */
    val canInstallSilently: Boolean
        get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && canRequestInstalls()

    /** The version that ran before this process started, read before it is overwritten. */
    private val previousRunVersion = prefs.getInt(KEY_LAST_RUN_VERSION, 0)

    init {
        restoreReady()
        announceIfUpdated()
        rememberRunVersion()
    }

    // region Settings

    fun changeAutoCheck(value: Boolean) {
        autoCheck = value
        prefs.edit().putBoolean(KEY_AUTO_CHECK, value).apply()
    }

    fun changeDownloadPolicy(value: DownloadPolicy) {
        downloadPolicy = value
        prefs.edit().putString(KEY_DOWNLOAD, value.id).apply()
    }

    fun changeInstallOnLeave(value: Boolean) {
        installOnLeave = value
        prefs.edit().putBoolean(KEY_INSTALL_ON_LEAVE, value).apply()
        if (!value) cancelBackgroundInstall()
    }

    /**
     * Whether the update page should open by itself for the current state: once per version and
     * reason, when the user has something to decide. An update that will install on its own once
     * the user leaves needs no word.
     */
    fun wantsAttention(): Boolean {
        val reason = attentionReason() ?: return false
        return prefs.getString(KEY_PROMPTED, null) != reason
    }

    fun markPrompted() {
        attentionReason()?.let { prefs.edit().putString(KEY_PROMPTED, it).apply() }
    }

    private fun attentionReason(): String? = when (val current = state) {
        // An update about to download by itself is not news yet.
        is UpdateState.Available -> if (autoDownloadVersion == current.release.versionCode) null else "${current.release.versionCode}:available"
        is UpdateState.Ready -> when {
            current.needsConfirmation -> "${current.release.versionCode}:confirm"
            installOnLeave && canInstallSilently -> null
            else -> "${current.release.versionCode}:ready"
        }
        else -> null
    }

    /** Android 12+ without install permission yet: granting it once makes later updates install by themselves. */
    val silentAfterPermission: Boolean
        get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !canRequestInstalls()

    /** Debug builds only: show a sample state for screenshots. */
    internal fun debugShow(sample: UpdateState) {
        if (BuildConfig.DEBUG) state = sample
    }

    /** Debug builds only: `available`, `ready` or `updated` with [notes], and no real check over it. */
    internal fun debugSample(kind: String, notes: List<String>) {
        if (!BuildConfig.DEBUG) return
        lastCheckedAt = System.currentTimeMillis()
        val release = ReleaseInfo(installedVersion + 1, "4.0.21", "CPU-Web-Android-V${installedVersion + 1}.apk",
            12_700_000, "0".repeat(64), notes, "", PatchInfo(installedVersion, "0".repeat(64), 1_400_000, "0".repeat(64), ""))
        when (kind) {
            "available" -> state = UpdateState.Available(release)
            "ready" -> state = UpdateState.Ready(release, viaPatch = true, savedBytes = 11_300_000)
            "updated" -> justUpdated = JustUpdated(release.versionName, notes)
        }
    }

    fun dismissJustUpdated() {
        justUpdated = null
        prefs.edit().remove(KEY_JUST_UPDATED).apply()
    }

    // endregion

    // region Lifecycle

    fun onForeground(current: Activity) {
        activity = WeakReference(current)
        foreground = true
        cancelBackgroundInstall()
        // Returning from the "install unknown apps" settings page continues the install.
        if (prefs.getBoolean(KEY_WAITING_PERMISSION, false) && canRequestInstalls()) {
            prefs.edit().remove(KEY_WAITING_PERMISSION).apply()
            install()
            return
        }
        (state as? UpdateState.Installing)?.let { installing ->
            // The dialog was dismissed or the process came back without a result.
            if (pendingConfirmation == null) state = UpdateState.Ready(installing.release, prefs.getBoolean(KEY_READY_PATCH, false), prefs.getLong(KEY_READY_SAVED, 0))
        }
        // A download the user started finished while they were away: carry on with the install.
        if (installWhenReady && state is UpdateState.Ready) {
            installWhenReady = false
            install()
            return
        }
        if (autoCheck && System.currentTimeMillis() - lastCheckedAt > AUTO_CHECK_INTERVAL_MS && state.canCheck()) check(manual = false)
    }

    fun onBackground(current: Activity) {
        if (activity.get() === current) activity.clear()
        foreground = false
        if (state is UpdateState.Ready && installOnLeave && canInstallSilently) scheduleBackgroundInstall()
    }

    // endregion

    // region Check and download

    private fun UpdateState.canCheck() = this is UpdateState.Idle || this is UpdateState.UpToDate || this is UpdateState.Failed || this is UpdateState.Available

    fun check(manual: Boolean = true) {
        if (!state.canCheck() && job?.isActive == true) return
        job?.cancel()
        job = scope.launch {
            post { state = UpdateState.Checking }
            try {
                val release = client.fetch(installedVersion, context.packageName)
                val now = System.currentTimeMillis()
                prefs.edit().putLong(KEY_CHECKED_AT, now).apply()
                post { lastCheckedAt = now }
                if (release.versionCode <= installedVersion) {
                    clearStaged()
                    post { state = UpdateState.UpToDate(release) }
                    return@launch
                }
                if (stagedFile(release)?.isFile == true) {
                    post { state = UpdateState.Ready(release, prefs.getBoolean(KEY_READY_PATCH, false), prefs.getLong(KEY_READY_SAVED, 0)) }
                    return@launch
                }
                // Decided before the state changes: the update page reads it to stay closed.
                val auto = !manual && shouldDownloadAutomatically(release)
                autoDownloadVersion = if (auto) release.versionCode else 0
                post { state = UpdateState.Available(release) }
                if (auto) download(release)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                Log.w(TAG, "check", error)
                post { state = UpdateState.Failed(if (manual) "检查更新失败：${error.message ?: "网络不可用"}" else "暂时无法检查更新", null) }
            }
        }
    }

    /**
     * The site already knows a newer version (the app's own check runs at most every six hours):
     * check now the way the automatic check does, so the update downloads and installs by itself;
     * the update page opens only when the user has something to do.
     */
    fun checkSoon() {
        if (autoCheck && state.canCheck() && job?.isActive != true) check(manual = false)
    }

    /** [full]: the whole package even when an incremental patch exists. */
    fun startDownload(full: Boolean = false) {
        val release = when (val current = state) {
            is UpdateState.Available -> current.release
            is UpdateState.Failed -> current.release ?: return check(manual = true)
            else -> return
        }
        installWhenReady = true
        job?.cancel()
        job = scope.launch { download(release, usePatch = !full) }
    }

    fun cancel() {
        installWhenReady = false
        job?.cancel()
        state = UpdateState.Idle
    }

    private fun shouldDownloadAutomatically(release: ReleaseInfo): Boolean = when (downloadPolicy) {
        DownloadPolicy.Manual -> false
        DownloadPolicy.Always -> true
        // An incremental patch is a megabyte or two: not worth waiting for Wi-Fi.
        DownloadPolicy.Wifi -> unmetered() || smallPatch(release)
    }

    private fun smallPatch(release: ReleaseInfo): Boolean =
        release.patch?.let { it.size <= SMALL_PATCH_BYTES && baseSha256() == it.fromSha256 } == true

    private suspend fun download(release: ReleaseInfo, usePatch: Boolean = true) {
        try {
            val directory = updatesDirectory()
            directory.listFiles()?.forEach { if (!it.name.startsWith("V${release.versionCode}")) it.delete() }
            val target = File(directory, "V${release.versionCode}.apk")
            var viaPatch = false
            val patch = release.patch?.takeIf { usePatch }
            if (patch != null && baseSha256() == patch.fromSha256) {
                try {
                    val patchFile = File(directory, "V${release.versionCode}-from-${patch.fromVersionCode}.cpupatch")
                    post { state = UpdateState.Downloading(release, true, patchFile.length(), patch.size) }
                    downloader.download(patch.url, patchFile, patch.size) { done, total ->
                        post { state = UpdateState.Downloading(release, true, done, total) }
                    }
                    post { state = UpdateState.Preparing(release, "正在校验增量包") }
                    if (ApkDelta.sha256(patchFile) != patch.sha256) {
                        patchFile.delete()
                        throw IOException("增量包校验失败")
                    }
                    post { state = UpdateState.Preparing(release, "正在合成新版安装包") }
                    val part = File(directory, "V${release.versionCode}.apk.part")
                    ApkDelta.apply(File(context.applicationInfo.sourceDir), patchFile, part)
                    patchFile.delete()
                    verifyAndStage(part, target, release)
                    viaPatch = true
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    // Any patch problem falls back to the full package.
                    Log.w(TAG, "patch", error)
                }
            }
            if (!viaPatch) {
                val part = File(directory, "V${release.versionCode}.apk.download")
                post { state = UpdateState.Downloading(release, false, part.length(), release.size) }
                downloader.download(release.downloadUrl, part, release.size) { done, total ->
                    post { state = UpdateState.Downloading(release, false, done, total) }
                }
                post { state = UpdateState.Preparing(release, "正在校验安装包") }
                verifyAndStage(part, target, release)
            }
            val saved = if (viaPatch && patch != null) release.size - patch.size else 0L
            prefs.edit()
                .putInt(KEY_READY_VERSION, release.versionCode)
                .putString(KEY_READY_RELEASE, releaseJson(release).toString())
                .putBoolean(KEY_READY_PATCH, viaPatch)
                .putLong(KEY_READY_SAVED, saved)
                .apply()
            post {
                state = UpdateState.Ready(release, viaPatch, saved)
                if (installWhenReady && foreground) {
                    installWhenReady = false
                    install()
                } else if (!foreground && installOnLeave && canInstallSilently) scheduleBackgroundInstall()
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            Log.w(TAG, "download", error)
            post {
                installWhenReady = false
                state = UpdateState.Failed(error.message ?: "下载失败，请稍后重试", release)
            }
        }
    }

    private fun verifyAndStage(part: File, target: File, release: ReleaseInfo) {
        if (part.length() != release.size || ApkDelta.sha256(part) != release.sha256) {
            part.delete()
            throw IOException("安装包校验失败，已删除，请重试")
        }
        try {
            ApkUpdateValidator.validate(context, part)
        } catch (error: ApkUpdateValidator.ValidationException) {
            part.delete()
            throw IOException(error.message)
        }
        if (target.exists()) target.delete()
        if (!part.renameTo(target)) throw IOException("无法保存安装包")
    }

    // endregion

    // region Install

    /** A tap on 安装: asks for install permission first when needed. */
    fun install() {
        val current = state
        val release = (current as? UpdateState.Ready)?.release ?: return
        pendingConfirmation?.let { confirm ->
            launchConfirmation(confirm)
            return
        }
        if (!canRequestInstalls()) {
            prefs.edit().putBoolean(KEY_WAITING_PERMISSION, true).apply()
            activity.get()?.let { host ->
                runCatching {
                    host.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
                }
            }
            return
        }
        val file = stagedFile(release) ?: run {
            state = UpdateState.Failed("安装包已失效，请重新下载", release)
            return
        }
        state = UpdateState.Installing(release)
        scope.launch {
            try {
                commitSession(file, silent = canInstallSilently)
            } catch (error: Exception) {
                Log.w(TAG, "install", error)
                post { fallbackInstall(file, release) }
            }
        }
    }

    /** Runs from the alarm a while after the user left: only installs when the app is still in the background. */
    internal fun installInBackground(done: () -> Unit) {
        if (foreground || !canInstallSilently) return done()
        val versionCode = prefs.getInt(KEY_READY_VERSION, 0)
        val file = File(updatesDirectory(), "V$versionCode.apk")
        if (versionCode <= installedVersion || !file.isFile) return done()
        // The timer and the alarm may both fire: one install session is enough.
        if (!installingInBackground.compareAndSet(false, true)) return done()
        cancelBackgroundInstall()
        scope.launch {
            try {
                rememberPendingNotes()
                commitSession(file, silent = true)
            } catch (error: Exception) {
                Log.w(TAG, "background install", error)
                installingInBackground.set(false)
            } finally {
                done()
            }
        }
    }

    private fun commitSession(apk: File, silent: Boolean) {
        rememberPendingNotes()
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) setInstallReason(PackageManager.INSTALL_REASON_USER)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRequireUserAction(
                    if (silent) PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED
                    else PackageInstaller.SessionParams.USER_ACTION_REQUIRED,
                )
            }
        }
        val sessionId = installer.createSession(params)
        try {
            installer.openSession(sessionId).use { session ->
                session.openWrite("base.apk", 0, apk.length()).use { output ->
                    apk.inputStream().use { input -> input.copyTo(output, 64 * 1024) }
                    session.fsync(output)
                }
                val intent = Intent(context, UpdateReceiver::class.java).setAction(ACTION_STATUS).setPackage(context.packageName)
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
                session.commit(PendingIntent.getBroadcast(context, sessionId, intent, flags).intentSender)
            }
        } catch (error: Exception) {
            runCatching { installer.abandonSession(sessionId) }
            throw error
        }
    }

    /** The system installer intent, for devices where a session cannot be created. */
    private fun fallbackInstall(file: File, release: ReleaseInfo) {
        val host = activity.get()
        if (host == null) {
            state = UpdateState.Ready(release, prefs.getBoolean(KEY_READY_PATCH, false), prefs.getLong(KEY_READY_SAVED, 0))
            return
        }
        try {
            host.startActivity(ApkInstallIntent.create(host, file))
        } catch (error: Exception) {
            state = UpdateState.Failed("系统安装器未能打开，可在浏览器下载新版", release)
        }
    }

    internal fun onInstallStatus(status: Int, message: String?, confirmation: Intent?) {
        post {
            val release = (state as? UpdateState.Installing)?.release ?: (state as? UpdateState.Ready)?.release ?: readyRelease()
            when (status) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    installingInBackground.set(false)
                    pendingConfirmation = confirmation
                    prefs.edit().putBoolean(KEY_NEEDS_CONFIRMATION, true).apply()
                    if (release != null) state = UpdateState.Ready(release, prefs.getBoolean(KEY_READY_PATCH, false),
                        prefs.getLong(KEY_READY_SAVED, 0), needsConfirmation = true)
                    if (foreground && confirmation != null) launchConfirmation(confirmation)
                }
                PackageInstaller.STATUS_SUCCESS -> Unit // The new version takes over; see onPackageReplaced.
                else -> {
                    installingInBackground.set(false)
                    pendingConfirmation = null
                    val text = when (status) {
                        PackageInstaller.STATUS_FAILURE_ABORTED -> "已取消安装，可随时继续"
                        PackageInstaller.STATUS_FAILURE_STORAGE -> "存储空间不足，清理后再试"
                        PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "安装包与当前版本冲突"
                        else -> "安装没有完成${message?.let { "：$it" } ?: ""}"
                    }
                    state = if (status == PackageInstaller.STATUS_FAILURE_ABORTED && release != null) {
                        UpdateState.Ready(release, prefs.getBoolean(KEY_READY_PATCH, false), prefs.getLong(KEY_READY_SAVED, 0))
                    } else {
                        UpdateState.Failed(text, release)
                    }
                }
            }
        }
    }

    private fun launchConfirmation(confirmation: Intent) {
        val host = activity.get() ?: return
        pendingConfirmation = null
        (state as? UpdateState.Ready)?.let { state = UpdateState.Installing(it.release) }
        runCatching { host.startActivity(confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    /** The package was replaced; the first start of the new version announces it (see [announceIfUpdated]). */
    internal fun onPackageReplaced() {
        clearStaged()
        announceIfUpdated()
    }

    /**
     * Records "updated to X" once per version, with what changed. Checked on every start, not
     * only on the package-replaced broadcast, which some phones do not deliver to a stopped app.
     * The notes come from the release this app installed itself; after an update from the
     * download page or an older version without this updater they are read from the server.
     */
    private fun announceIfUpdated() {
        val pending = prefs.getString(KEY_PENDING_NOTES, null)
        val info = runCatching { context.packageManager.getPackageInfo(context.packageName, 0) }.getOrNull()
        // The welcome screen's flag: an install that was used before (and not one whose data was cleared).
        val usedBefore = context.getSharedPreferences("native_shell", Context.MODE_PRIVATE).getBoolean("welcome_seen_v4", false)
        val updated = info != null &&
            isUpdateRun(previousRunVersion, installedVersion, info.firstInstallTime, info.lastUpdateTime, usedBefore)
        if (!updated || prefs.getInt(KEY_ANNOUNCED_VERSION, 0) >= installedVersion) {
            if (pending != null) prefs.edit().remove(KEY_PENDING_NOTES).apply()
            return
        }
        val notes = pendingNotesFor(pending, installedVersion)
        val record = JSONObject().put("versionName", installedVersionName).put("versionCode", installedVersion)
            .put("notes", JSONArray(notes))
        prefs.edit().putString(KEY_JUST_UPDATED, record.toString()).putInt(KEY_ANNOUNCED_VERSION, installedVersion)
            .remove(KEY_PENDING_NOTES).apply()
        post { justUpdated = readJustUpdated() }
        if (notes.isEmpty()) scope.launch { fillNotesFromServer() }
    }

    private fun fillNotesFromServer() {
        val release = runCatching { client.fetch(installedVersion, context.packageName) }.getOrNull() ?: return
        val notes = release.notes.filter { it.isNotBlank() }
        if (release.versionCode != installedVersion || notes.isEmpty()) return
        val raw = prefs.getString(KEY_JUST_UPDATED, null) ?: return
        val record = runCatching { JSONObject(raw) }.getOrNull() ?: return
        if (record.optInt("versionCode") != installedVersion) return
        prefs.edit().putString(KEY_JUST_UPDATED, record.put("notes", JSONArray(notes)).toString()).apply()
        post { if (justUpdated != null) justUpdated = readJustUpdated() }
    }

    private fun rememberRunVersion() {
        if (prefs.getInt(KEY_LAST_RUN_VERSION, 0) != installedVersion) prefs.edit().putInt(KEY_LAST_RUN_VERSION, installedVersion).apply()
    }

    // commit(), not apply(): the installer may end this process right after.
    @android.annotation.SuppressLint("ApplySharedPref")
    private fun rememberPendingNotes() {
        val release = readyRelease() ?: return
        val record = JSONObject().put("versionCode", release.versionCode).put("notes", JSONArray(release.notes))
        prefs.edit().putString(KEY_PENDING_NOTES, record.toString()).commit()
    }

    // endregion

    // region Background install alarm

    private fun scheduleBackgroundInstall() {
        main.removeCallbacks(backgroundInstall)
        main.postDelayed(backgroundInstall, BACKGROUND_INSTALL_DELAY_MS)
        // The alarm covers a process the system ended in the meantime.
        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        alarms.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + BACKGROUND_INSTALL_DELAY_MS, applyIntent())
    }

    private fun cancelBackgroundInstall() {
        main.removeCallbacks(backgroundInstall)
        context.getSystemService(AlarmManager::class.java)?.cancel(applyIntent())
    }

    private fun applyIntent(): PendingIntent = PendingIntent.getBroadcast(
        context, 7001,
        Intent(context, UpdateReceiver::class.java).setAction(ACTION_APPLY).setPackage(context.packageName),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    // endregion

    // region Files and state

    private fun updatesDirectory(): File = File(context.cacheDir, "apk-updates/native").apply { mkdirs() }

    private fun stagedFile(release: ReleaseInfo): File? =
        File(updatesDirectory(), "V${release.versionCode}.apk").takeIf { it.isFile && prefs.getInt(KEY_READY_VERSION, 0) == release.versionCode }

    private fun clearStaged() {
        updatesDirectory().listFiles()?.forEach { it.delete() }
        prefs.edit().remove(KEY_READY_VERSION).remove(KEY_READY_RELEASE).remove(KEY_READY_PATCH).remove(KEY_READY_SAVED)
            .remove(KEY_NEEDS_CONFIRMATION).apply()
        pendingConfirmation = null
    }

    private fun restoreReady() {
        val release = readyRelease() ?: return
        if (release.versionCode <= installedVersion || stagedFile(release) == null) {
            clearStaged()
            return
        }
        state = UpdateState.Ready(release, prefs.getBoolean(KEY_READY_PATCH, false), prefs.getLong(KEY_READY_SAVED, 0),
            needsConfirmation = prefs.getBoolean(KEY_NEEDS_CONFIRMATION, false))
    }

    private fun readyRelease(): ReleaseInfo? {
        val raw = prefs.getString(KEY_READY_RELEASE, null) ?: return null
        return runCatching {
            val json = JSONObject(raw)
            ReleaseInfo(
                versionCode = json.getInt("versionCode"),
                versionName = json.getString("versionName"),
                fileName = json.getString("fileName"),
                size = json.getLong("size"),
                sha256 = json.getString("sha256"),
                notes = json.optJSONArray("notes")?.let { array -> (0 until array.length()).map { array.optString(it) } }.orEmpty(),
                downloadUrl = json.getString("downloadUrl"),
                patch = null,
            )
        }.getOrNull()
    }

    private fun releaseJson(release: ReleaseInfo) = JSONObject()
        .put("versionCode", release.versionCode).put("versionName", release.versionName)
        .put("fileName", release.fileName).put("size", release.size).put("sha256", release.sha256)
        .put("notes", JSONArray(release.notes)).put("downloadUrl", release.downloadUrl)

    private fun readJustUpdated(): JustUpdated? {
        val raw = prefs.getString(KEY_JUST_UPDATED, null) ?: return null
        return runCatching {
            val json = JSONObject(raw)
            val notes = json.optJSONArray("notes")
            JustUpdated(json.getString("versionName"), (0 until (notes?.length() ?: 0)).map { notes!!.optString(it) }.filter { it.isNotBlank() })
        }.getOrNull()
    }

    /** SHA-256 of the installed APK, remembered per install. */
    private fun baseSha256(): String {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        val key = "${installedVersion}:${info.lastUpdateTime}"
        prefs.getString(KEY_BASE_SHA, null)?.split('|')?.takeIf { it.size == 2 && it[0] == key }?.let { return it[1] }
        val value = ApkDelta.sha256(File(context.applicationInfo.sourceDir))
        prefs.edit().putString(KEY_BASE_SHA, "$key|$value").apply()
        return value
    }

    private fun packageVersion(): Pair<Int, String> = runCatching {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode.toInt() else @Suppress("DEPRECATION") info.versionCode
        code to (info.versionName ?: BuildConfig.VERSION_NAME)
    }.getOrDefault(BuildConfig.VERSION_CODE to BuildConfig.VERSION_NAME)

    private fun canRequestInstalls(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    private fun unmetered(): Boolean = runCatching {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return false
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }.getOrDefault(false)

    private fun post(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
    }

    // endregion

    data class JustUpdated(val versionName: String, val notes: List<String>)

    companion object {
        /**
         * Whether this start follows an update: a higher version than the one that last ran or,
         * on the first start of a version with this updater, an install that was [usedBefore] and
         * that this build replaced (a fresh install has both times equal).
         */
        internal fun isUpdateRun(
            previousRun: Int, installed: Int, firstInstallTime: Long, lastUpdateTime: Long, usedBefore: Boolean,
        ): Boolean = if (previousRun > 0) installed > previousRun else usedBefore && lastUpdateTime > firstInstallTime

        /** The notes saved before installing, when they belong to [installed]. */
        internal fun pendingNotesFor(raw: String?, installed: Int): List<String> {
            val record = runCatching { JSONObject(raw ?: return emptyList()) }.getOrNull() ?: return emptyList()
            if (record.optInt("versionCode") != installed) return emptyList()
            val notes = record.optJSONArray("notes") ?: return emptyList()
            return (0 until notes.length()).map { notes.optString(it).trim() }.filter { it.isNotEmpty() }
        }

        private const val TAG = "CpuAppUpdater"
        private const val PREFS = "native_update"
        private const val KEY_AUTO_CHECK = "auto_check"
        private const val KEY_DOWNLOAD = "download_policy"
        private const val KEY_INSTALL_ON_LEAVE = "install_on_leave"
        private const val KEY_CHECKED_AT = "checked_at"
        private const val KEY_READY_VERSION = "ready_version"
        private const val KEY_READY_RELEASE = "ready_release"
        private const val KEY_READY_PATCH = "ready_patch"
        private const val KEY_READY_SAVED = "ready_saved"
        private const val KEY_PENDING_NOTES = "pending_notes"
        private const val KEY_JUST_UPDATED = "just_updated"
        private const val KEY_ANNOUNCED_VERSION = "announced_version"
        private const val KEY_BASE_SHA = "base_sha"
        private const val KEY_WAITING_PERMISSION = "waiting_permission"
        private const val KEY_LAST_RUN_VERSION = "last_run_version"
        private const val KEY_PROMPTED = "prompted"
        private const val KEY_NEEDS_CONFIRMATION = "needs_confirmation"
        const val ACTION_STATUS = "cn.lizmt.cpuweb.UPDATE_STATUS"
        const val ACTION_APPLY = "cn.lizmt.cpuweb.UPDATE_APPLY"
        private const val AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L
        private const val SMALL_PATCH_BYTES = 5L * 1024 * 1024
        private const val BACKGROUND_INSTALL_DELAY_MS = 10_000L

        @Volatile private var instance: AppUpdater? = null

        fun get(context: Context): AppUpdater = instance ?: synchronized(this) {
            instance ?: AppUpdater(context.applicationContext).also { instance = it }
        }
    }
}

/** Install results, the delayed background install, and the first run after an update. */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val updater = AppUpdater.get(context)
        when (intent.action) {
            AppUpdater.ACTION_STATUS -> {
                val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
                val confirmation = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
                updater.onInstallStatus(status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE), confirmation)
            }
            AppUpdater.ACTION_APPLY -> {
                val pending = goAsync()
                updater.installInBackground { pending.finish() }
            }
            Intent.ACTION_MY_PACKAGE_REPLACED -> updater.onPackageReplaced()
        }
    }
}
