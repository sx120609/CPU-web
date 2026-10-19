package cn.lizmt.cpuweb.schedule

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import cn.lizmt.cpuweb.schedule.agenda.AgendaCodec
import cn.lizmt.cpuweb.schedule.agenda.AgendaStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URLEncoder

/**
 * What the server holds of each record, as it last confirmed: the account the
 * data on this phone belongs to, the position in the server's change list, and
 * the version of every record. A record whose version here differs is
 * uploaded, whoever changed it.
 */
class SyncLedger(
    var account: String = "",
    var cursor: String = "",
    private val synced: MutableMap<String, MutableMap<String, Long>> = mutableMapOf(),
) {
    /** The records of [collection] whose version on this phone ([local]: id → version) the server has not confirmed. */
    fun dirty(collection: String, local: Map<String, Long>): List<String> =
        local.filter { (id, at) -> synced[collection]?.get(id) != at }.keys.toList()

    fun confirm(collection: String, id: String, at: Long) {
        synced.getOrPut(collection) { mutableMapOf() }[id] = at
    }

    fun confirmed(collection: String, id: String): Long? = synced[collection]?.get(id)

    fun toJson(): JSONObject = JSONObject().put("account", account).put("cursor", cursor)
        .put("synced", JSONObject().apply {
            synced.forEach { (collection, versions) -> put(collection, JSONObject().apply { versions.forEach { (id, at) -> put(id, at) } }) }
        })

    companion object {
        fun fromJson(json: JSONObject?): SyncLedger {
            json ?: return SyncLedger()
            val synced = mutableMapOf<String, MutableMap<String, Long>>()
            json.optJSONObject("synced")?.let { all ->
                all.keys().forEach { collection ->
                    val versions = all.optJSONObject(collection) ?: return@forEach
                    synced[collection] = versions.keys().asSequence().associateWith { versions.optLong(it) }.toMutableMap()
                }
            }
            return SyncLedger(json.optString("account"), json.optString("cursor"), synced)
        }
    }
}

/**
 * Cross-device sync for 药大拾间 NEXT: the agenda, 拾间AI conversations and
 * the action log go to `/api/next-sync` under the signed-in account and come
 * back on the user's other phones. Each record keeps the newest edit; removals
 * travel as tombstones. Pulls first, then uploads what changed here.
 */
class NextSync(
    context: Context,
    private val scope: CoroutineScope,
    /** The signed-in account, or null when nobody is signed in. */
    private val account: () -> String?,
    private val agenda: AgendaStore,
    private val assistant: AssistantSession,
    private val log: AssistantActivityLog,
    private val transport: (path: String, method: String, body: JSONObject?) -> SiteReply = { path, method, body -> SiteHttp.request(path, method, body) },
) {
    private val prefs = context.getSharedPreferences("next_sync", Context.MODE_PRIVATE)
    // Out of device backups: a restored phone uploads everything again, which the server merges.
    private val file = File(context.noBackupFilesDir, "next-sync.json")
    private var ledger = SyncLedger.fromJson(runCatching { JSONObject(file.readText()) }.getOrNull())
    private val mutex = Mutex()
    private var pending: Job? = null
    private var lastStarted = 0L

    var enabled by mutableStateOf(prefs.getBoolean(KEY_ENABLED, true))
        private set
    var running by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var lastSyncedAt by mutableLongStateOf(prefs.getLong(KEY_LAST, 0L))
        private set
    /** The data on this phone was synced with another account; nothing moves until the user decides. */
    var otherAccount by mutableStateOf(false)
        private set

    val active: Boolean get() = enabled && account() != null && !otherAccount

    fun switch(on: Boolean) {
        enabled = on
        prefs.edit().putBoolean(KEY_ENABLED, on).apply()
        if (on) request() else error = null
    }

    /** Syncs after [delayMs] (later requests replace earlier ones), unless the last run started within [minIntervalMs]. */
    fun request(delayMs: Long = 0, minIntervalMs: Long = 0) {
        if (!enabled) return
        if (minIntervalMs > 0 && System.currentTimeMillis() - lastStarted < minIntervalMs) return
        pending?.cancel()
        pending = scope.launch {
            if (delayMs > 0) delay(delayMs)
            // The run itself is not cancelled by a later request.
            scope.launch { mutex.withLock { run() } }
        }
    }

    /** Removes the server's copy and stops syncing; every phone keeps what it has. */
    fun deleteCloud(onDone: (Boolean) -> Unit) {
        scope.launch {
            val reply = withContext(Dispatchers.IO) { runCatching { transport(PATH, "DELETE", null) }.getOrNull() }
            val ok = reply?.ok == true
            if (ok) mutex.withLock {
                ledger = SyncLedger(account = ledger.account)
                saveLedger()
                switch(false)
            }
            onDone(ok)
        }
    }

    /** Clears this phone's agenda, conversations and log, and takes the signed-in account's from the server. */
    fun adoptCurrentAccount() {
        scope.launch {
            mutex.withLock {
                agenda.clearAll()
                assistant.clearAll()
                log.clearAll()
                ledger = SyncLedger(account = fingerprint(account().orEmpty()))
                saveLedger()
                otherAccount = false
            }
            request()
        }
    }

    /** Syncs now and returns when done (tests; the app uses [request]). */
    internal suspend fun syncNow() = mutex.withLock { run() }

    private suspend fun run() {
        val signedIn = account()
        if (!enabled || signedIn.isNullOrBlank()) return
        val owner = fingerprint(signedIn)
        if (ledger.account.isEmpty()) {
            // The first account to sync takes the data already on this phone.
            ledger.account = owner
            saveLedger()
        } else if (ledger.account != owner) {
            otherAccount = true
            return
        }
        otherAccount = false
        lastStarted = System.currentTimeMillis()
        running = true
        error = null
        try {
            pull()
            push()
            lastSyncedAt = System.currentTimeMillis()
            prefs.edit().putLong(KEY_LAST, lastSyncedAt).apply()
        } catch (failure: Exception) {
            error = failure.message ?: "同步失败，稍后会再试"
        } finally {
            running = false
        }
    }

    private suspend fun pull() {
        for (page in 0 until 50) {
            val reply = call("$PATH?cursor=" + URLEncoder.encode(ledger.cursor, "UTF-8"), "GET", null)
            val data = reply.data ?: error("同步失败：服务器返回格式异常")
            val records = data.optJSONArray("records") ?: JSONArray()
            for (index in 0 until records.length()) records.optJSONObject(index)?.let(::applyRecord)
            ledger.cursor = data.optString("cursor").ifEmpty { ledger.cursor }
            saveLedger()
            if (!data.optBoolean("more")) return
        }
    }

    private suspend fun push() {
        val outgoing = outgoing()
        var batch = mutableListOf<Pair<JSONObject, Long>>()
        var size = 0
        suspend fun send() {
            if (batch.isEmpty()) return
            val sent = batch
            batch = mutableListOf()
            size = 0
            val reply = call(PATH, "POST", JSONObject().put("records", JSONArray(sent.map { it.first })))
            val data = reply.data ?: error("同步失败：服务器返回格式异常")
            val versions = sent.associate { (json, at) -> key(json.optString("collection"), json.optString("id")) to at }
            fun confirmEach(array: JSONArray?) {
                array ?: return
                for (index in 0 until array.length()) {
                    val item = array.optJSONObject(index) ?: continue
                    val collection = item.optString("collection")
                    val id = item.optString("id")
                    versions[key(collection, id)]?.let { ledger.confirm(collection, id, it) }
                }
            }
            confirmEach(data.optJSONArray("applied"))
            // Refused records (too large, over the limit) are not offered again until they change.
            confirmEach(data.optJSONArray("rejected"))
            data.optJSONArray("newer")?.let { newer -> for (index in 0 until newer.length()) newer.optJSONObject(index)?.let(::applyRecord) }
            saveLedger()
        }
        for (record in outgoing) {
            val length = record.first.toString().length
            if (batch.size >= MAX_BATCH || (batch.isNotEmpty() && size + length > MAX_BATCH_CHARS)) send()
            batch += record
            size += length
        }
        send()
    }

    /** What changed here since the server last confirmed it, with the version sent. */
    private fun outgoing(): List<Pair<JSONObject, Long>> {
        val result = mutableListOf<Pair<JSONObject, Long>>()
        fun record(collection: String, id: String, at: Long, data: JSONObject?) {
            val json = JSONObject().put("collection", collection).put("id", id).put("updatedAt", at)
            if (data == null) json.put("deleted", true) else json.put("data", data)
            result += json to at
        }
        val items = agenda.items.associateBy { it.id }
        for (id in ledger.dirty(AGENDA, versions(AGENDA))) {
            val item = items[id]
            if (item != null) record(AGENDA, id, item.updatedAt, AgendaCodec.toJson(item))
            else agenda.deletedAt(id)?.let { record(AGENDA, id, it, null) }
        }
        val conversations = assistant.conversations.associateBy { it.id }
        for (id in ledger.dirty(CONVERSATION, versions(CONVERSATION))) {
            // The conversation being answered goes up once the answer is complete.
            if (assistant.sendingIn == id) continue
            val conversation = conversations[id]
            if (conversation != null) record(CONVERSATION, id, conversation.updatedAt, AssistantCodec.conversationToJson(conversation, AssistantCodec.SYNC_LIMIT))
            else assistant.deletedAt(id)?.let { record(CONVERSATION, id, it, null) }
        }
        val entries = log.entries.associateBy { it.id }
        for (id in ledger.dirty(ACTIVITY, versions(ACTIVITY))) {
            val entry = entries[id]
            if (entry != null) record(ACTIVITY, id, entry.updatedAt, ActivityCodec.toJson(entry))
            else log.deletedAt(id)?.let { record(ACTIVITY, id, it, null) }
        }
        return result
    }

    /** Every record of [collection] on this phone (removed ones too) and its version. */
    private fun versions(collection: String): Map<String, Long> = when (collection) {
        AGENDA -> agenda.items.associate { it.id to it.updatedAt } + agenda.deletedIds().associateWith { agenda.deletedAt(it) ?: 0L }
        CONVERSATION -> assistant.conversations.associate { it.id to it.updatedAt } + assistant.deletedIds().associateWith { assistant.deletedAt(it) ?: 0L }
        ACTIVITY -> log.entries.associate { it.id to it.updatedAt } + log.deletedIds().associateWith { log.deletedAt(it) ?: 0L }
        else -> emptyMap()
    }

    /** Takes one record from the server when it is newer, and notes that the server has it. */
    private fun applyRecord(json: JSONObject) {
        val collection = json.optString("collection")
        val id = json.optString("id")
        val at = json.optLong("updatedAt")
        val deleted = json.optBoolean("deleted")
        val data = json.optJSONObject("data")
        if (!deleted && data == null) return
        when (collection) {
            AGENDA -> {
                val item = if (deleted) null else AgendaCodec.fromJson(data!!) ?: return
                agenda.applyRemote(id, item, at)
            }
            CONVERSATION -> {
                val conversation = if (deleted) null else AssistantCodec.conversationFromJson(id, at, data!!) ?: return
                assistant.applyRemote(id, conversation, at)
            }
            ACTIVITY -> {
                val entry = if (deleted) null else ActivityCodec.fromJson(id, at, data!!) ?: return
                log.applyRemote(id, entry, at)
            }
            else -> return
        }
        if (versions(collection)[id] == at) ledger.confirm(collection, id, at)
    }

    private suspend fun call(path: String, method: String, body: JSONObject?): SiteReply {
        val reply = withContext(Dispatchers.IO) {
            runCatching { transport(path, method, body) }.getOrElse { error("网络不可用，稍后会再试") }
        }
        if (!reply.ok) error(when (reply.status) {
            401 -> "登录已过期，重新登录后会继续同步"
            413 -> "要同步的内容太大"
            429 -> "同步太频繁，稍后会再试"
            else -> reply.message.ifBlank { "同步失败（${reply.status}），稍后会再试" }
        })
        return reply
    }

    private fun saveLedger() {
        runCatching { file.writeText(ledger.toJson().toString()) }
    }

    private fun key(collection: String, id: String) = "$collection:$id"

    companion object {
        private const val PATH = "/api/next-sync"
        const val AGENDA = "agenda"
        const val CONVERSATION = "conversation"
        const val ACTIVITY = "activity"
        private const val KEY_ENABLED = "enabled"
        private const val KEY_LAST = "last_synced"
        private const val MAX_BATCH = 50
        private const val MAX_BATCH_CHARS = 900_000

        fun fingerprint(account: String): String {
            val normalized = account.trim()
            if (normalized.isEmpty()) return ""
            return java.security.MessageDigest.getInstance("SHA-256").digest(normalized.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        }
    }
}
