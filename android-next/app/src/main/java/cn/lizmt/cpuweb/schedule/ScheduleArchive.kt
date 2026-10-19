package cn.lizmt.cpuweb.schedule

import android.content.Context
import android.webkit.CookieManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * The last verified timetable, kept on disk so a cold start paints it before
 * the WebView boots (as the iOS client does). The file lives in the no-backup
 * directory and records a fingerprint of the site session cookie; a restore is
 * refused unless the current cookie matches, so another account's timetable
 * can never flash on screen. Account changes and sign-out delete the file.
 */
class ScheduleArchive(
    private val file: File,
    private val sessionFingerprint: () -> String,
) {
    data class Saved(
        val account: String,
        val semester: String,
        val week: String,
        val day: Int,
        val viewMode: String,
        val snapshots: List<String>,
    )

    /** The latest selection with the generation it was written under. */
    private val pending = AtomicReference<Pair<Saved, Int>?>(null)
    private val writer = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "cpu-schedule-archive").apply { isDaemon = true }
    }
    @Volatile private var generation = 0

    fun read(): Saved? {
        val fingerprint = sessionFingerprint()
        val raw = runCatching { if (file.length() in 1..MAX_BYTES) file.readText() else null }.getOrNull() ?: return null
        val json = runCatching { JSONObject(raw) }.getOrNull()
        if (json == null || json.optInt("version") != 1 || fingerprint.isEmpty() ||
            json.optString("fingerprint") != fingerprint || json.optString("account").isEmpty()) {
            clear()
            return null
        }
        val snapshots = json.optJSONArray("snapshots") ?: JSONArray()
        return Saved(
            account = json.optString("account"),
            semester = json.optString("semester"),
            week = json.optString("week"),
            day = json.optInt("day", 0),
            viewMode = json.optString("viewMode", "week"),
            snapshots = (0 until snapshots.length()).map { snapshots.optString(it) }.filter { it.isNotEmpty() },
        )
    }

    /** Coalesces rapid writes; only the latest selection reaches the disk. */
    fun write(saved: Saved) {
        // Each task only takes a value written under its own generation: a
        // task queued before clear() leaves a newer write to the task queued
        // after the delete, so that write is neither dropped nor deleted.
        val scheduled = generation
        if (pending.getAndSet(saved to scheduled) != null) return
        writer.execute {
            val current = pending.get() ?: return@execute
            if (current.second != scheduled || !pending.compareAndSet(current, null)) return@execute
            if (scheduled != generation) return@execute
            val value = current.first
            val fingerprint = sessionFingerprint()
            if (fingerprint.isEmpty()) return@execute
            val semesterSnapshots = value.snapshots.filter { raw ->
                runCatching { JSONObject(raw).optJSONObject("data")?.optString("currentSemester") }.getOrNull() == value.semester
            }
            val json = JSONObject()
                .put("version", 1)
                .put("account", value.account)
                .put("fingerprint", fingerprint)
                .put("semester", value.semester)
                .put("week", value.week)
                .put("day", value.day)
                .put("viewMode", value.viewMode)
                .put("snapshots", JSONArray(semesterSnapshots.ifEmpty { value.snapshots.takeLast(1) }))
            val text = json.toString()
            if (text.length > MAX_BYTES) return@execute
            runCatching {
                file.parentFile?.mkdirs()
                val temporary = File(file.parentFile, file.name + ".tmp")
                temporary.writeText(text)
                if (!temporary.renameTo(file)) {
                    file.delete()
                    temporary.renameTo(file)
                }
            }
        }
    }

    fun clear() {
        generation += 1
        pending.set(null)
        writer.execute { runCatching { file.delete() } }
    }

    companion object {
        private const val MAX_BYTES = 2L * 1024 * 1024

        fun create(context: Context): ScheduleArchive = ScheduleArchive(
            File(context.noBackupFilesDir, "native-schedule-archive.json"),
        ) { currentSessionFingerprint() }

        /** SHA-256 of the site session cookie value; empty when there is no session. */
        fun currentSessionFingerprint(): String {
            val cookies = runCatching { CookieManager.getInstance().getCookie(AppConfig.origin) }.getOrNull().orEmpty()
            val session = cookies.split(';').map { it.trim() }.firstOrNull {
                it.startsWith("__Host-cpu-session=") || it.startsWith("cpu-session=")
            }?.substringAfter('=').orEmpty()
            if (session.isEmpty()) return ""
            val digest = MessageDigest.getInstance("SHA-256").digest(session.toByteArray())
            return digest.joinToString("") { "%02x".format(it) }
        }
    }
}
