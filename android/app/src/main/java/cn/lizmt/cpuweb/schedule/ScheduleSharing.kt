package cn.lizmt.cpuweb.schedule

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/** A failed share request; [status] is the HTTP status, 0 when there was none. */
class ShareRequestException(message: String, val status: Int) : Exception(message)

/**
 * Share codes: publishing the signed-in user's own timetable, and keeping the
 * timetables other people shared with them (iOS `NativeScheduleSharingService`).
 *
 * Publishing and revoking go through the site account, so the codes follow the
 * account across devices. What somebody else shared is kept on this device
 * only, under the account that imported it.
 */
class ScheduleSharing(
    private val scope: CoroutineScope,
    private val file: File?,
    /** Runs one `CPUAndroidShares` call in the page; null when the page cannot answer. */
    private val transport: suspend (JSONObject) -> String?,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    var library by mutableStateOf(SharedScheduleLibrary())
        private set
    /** The signed-in user's own share codes, newest first. */
    var mine by mutableStateOf(listOf<ShareMeta>())
        private set

    private var loaded = file == null
    private var pendingAccount = ""
    private var refreshing = false

    init {
        if (file != null) {
            scope.launch {
                val saved = withContext(io) {
                    runCatching {
                        if (file.length() in 1..MAX_BYTES) SharedScheduleLibrary.fromJson(JSONObject(file.readText())) else null
                    }.getOrNull()
                }
                if (saved != null) library = saved
                loaded = true
                if (pendingAccount.isNotEmpty()) adopt(pendingAccount)
            }
        }
    }

    /** The library belongs to one account; another one signing in starts from an empty library. */
    fun adopt(account: String) {
        if (!loaded) {
            pendingAccount = account
            return
        }
        val next = library.adopt(account)
        if (next == library) return
        if (next.schedules.isEmpty() && library.schedules.isNotEmpty()) mine = emptyList()
        commit(next)
    }

    private fun commit(next: SharedScheduleLibrary) {
        if (next == library) return
        library = next
        val target = file ?: return
        scope.launch(io) {
            runCatching {
                target.parentFile?.mkdirs()
                val temporary = File(target.parentFile, target.name + ".tmp")
                temporary.writeText(next.toJson().toString())
                if (!temporary.renameTo(target)) {
                    target.delete()
                    temporary.renameTo(target)
                }
            }
        }
    }

    // region My shares

    /** The share code of `semester`, when one was published. */
    fun share(semester: String): ShareMeta? = mine.firstOrNull { it.semester == semester }

    suspend fun loadMine() {
        val array = request("mine").optJSONArray("shares") ?: return
        mine = (0 until array.length()).mapNotNull { array.optJSONObject(it)?.let(ShareMeta::fromJson) }
    }

    /**
     * Publishes a complete semester. A semester has one code: publishing again
     * updates what that code shows and tells whether anything changed.
     */
    suspend fun publish(snapshot: ScheduleSnapshot?): PublishedShare {
        val data = request("publish", body = SharedSchedule.publishBody(snapshot))
        val meta = ShareMeta.fromJson(data) ?: throw ShareRequestException("课表分享失败", 0)
        mine = listOf(meta) + mine.filter { it.code != meta.code }
        // A server that predates these two fields made a new code every time.
        return PublishedShare(meta, data.optBoolean("created", true), data.optBoolean("changed", true))
    }

    /** Withdraws a code. A code the server no longer has is already gone. */
    suspend fun revoke(code: String) {
        try {
            request("revoke", code)
        } catch (error: ShareRequestException) {
            if (error.status != 404) throw error
        }
        mine = mine.filter { it.code != code }
    }

    // endregion

    // region Shared with me

    /** Downloads a share without keeping it, for the preview card. */
    suspend fun preview(input: String): SharedSchedule {
        val code = SharedSchedule.normalizedCode(input) ?: throw SharedScheduleException("分享码是 8 位字母和数字，请检查后再试")
        // Whose share it is comes from the account's own list, never from the
        // public nickname, which anyone can pick.
        if (mine.isEmpty()) runCatching { loadMine() }
        if (mine.any { it.code == code }) throw SharedScheduleException("这是你自己分享的课表，直接看自己的课表就可以")
        return download(code)
    }

    fun save(schedule: SharedSchedule, remark: String) = commit(library.save(schedule, remark))

    fun rename(code: String, remark: String) = commit(library.rename(code, remark))

    fun remove(code: String) = commit(library.remove(code))

    /**
     * Checks every saved share once: a changed one is downloaded again, a
     * withdrawn one is marked. Anything else, being offline included, leaves
     * the saved copy as it is.
     */
    suspend fun refresh() {
        if (refreshing) return
        refreshing = true
        try {
            for (saved in library.schedules.filter { !it.revoked }) {
                val code = saved.meta.code
                try {
                    val meta = ShareMeta.fromJson(request("meta", code)) ?: continue
                    if (meta.updatedAt == saved.meta.updatedAt) continue
                    commit(library.refresh(download(code)))
                } catch (error: ShareRequestException) {
                    if (error.status != 404) continue
                    // A server that predates the summary route answers 404 for
                    // every code. Only the share itself being gone means revoked.
                    try {
                        commit(library.refresh(download(code)))
                    } catch (missing: ShareRequestException) {
                        if (missing.status == 404) commit(library.markRevoked(code))
                    } catch (_: SharedScheduleException) {
                    }
                } catch (_: SharedScheduleException) {
                }
            }
        } finally {
            refreshing = false
        }
    }

    private suspend fun download(code: String): SharedSchedule = try {
        SharedSchedule.read(request("get", code), clock())
    } catch (error: ShareRequestException) {
        if (error.status == 404) throw ShareRequestException("没有找到这份共享课表，可能已被撤销", 404) else throw error
    }

    // endregion

    private suspend fun request(action: String, code: String = "", body: JSONObject? = null): JSONObject {
        val payload = JSONObject().put("action", action).put("code", code)
        body?.let { payload.put("body", it) }
        val reply = transport(payload)?.let { runCatching { JSONObject(it) }.getOrNull() }
            ?: throw ShareRequestException("网页会话还没有准备好，请稍后重试", 0)
        val error = reply.optString("error").ifEmpty { reply.optString("__error") }
        if (error.isNotEmpty()) throw ShareRequestException(error, reply.optInt("status", 0))
        return reply.optJSONObject("data") ?: JSONObject()
    }

    /** Replaces the state for a debug screenshot run; nothing is written to disk. */
    internal fun installDebugState(library: SharedScheduleLibrary, mine: List<ShareMeta>) {
        loaded = true
        this.library = library
        this.mine = mine
    }

    private companion object {
        const val MAX_BYTES = 16L * 1024 * 1024
    }
}
