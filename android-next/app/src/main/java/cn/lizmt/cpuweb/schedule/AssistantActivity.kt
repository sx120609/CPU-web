package cn.lizmt.cpuweb.schedule

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** One thing 拾间AI did after the user confirmed it (or the confirmation setting let it run). */
data class ActivityEntry(
    val id: String,
    val at: Long,
    val updatedAt: Long,
    val conversationId: String,
    val messageId: String,
    val proposalId: String,
    val action: JSONObject,
    val note: String,
    val device: String,
    /** "applied", "undone" or "failed". */
    val state: String,
    val auto: Boolean = false,
)

object ActivityCodec {
    private val ID = Regex("^[A-Za-z0-9_-]{6,40}$")

    fun toJson(entry: ActivityEntry): JSONObject = JSONObject()
        .put("at", entry.at).put("conversationId", entry.conversationId).put("messageId", entry.messageId)
        .put("proposalId", entry.proposalId).put("action", entry.action).put("note", entry.note.take(200))
        .put("device", entry.device.take(40)).put("state", entry.state).put("auto", entry.auto)

    fun fromJson(id: String, updatedAt: Long, json: JSONObject, auto: Boolean = false): ActivityEntry? {
        if (!ID.matches(id)) return null
        val action = json.optJSONObject("action") ?: return null
        return ActivityEntry(
            id = id, at = json.optLong("at", updatedAt), updatedAt = updatedAt,
            conversationId = json.optString("conversationId"), messageId = json.optString("messageId"), proposalId = json.optString("proposalId"),
            action = action, note = json.optString("note"), device = json.optString("device"),
            state = json.optString("state").takeIf { it == "undone" || it == "failed" } ?: "applied",
            auto = auto || json.optBoolean("auto"),
        )
    }
}

/**
 * The record of what 拾间AI did, newest first, on this phone and (through
 * sync) the user's other phones: each confirmed or automatic action, when, on
 * which device, and whether it was taken back.
 */
class AssistantActivityLog(context: Context) {
    private val file = File(context.filesDir, "assistant-activity.json")
    val device: String = android.os.Build.MODEL.orEmpty().take(40)

    var entries by mutableStateOf<List<ActivityEntry>>(emptyList())
        private set
    private var deleted: Map<String, Long> = emptyMap()
    var onLocalChange: ((String) -> Unit)? = null

    init {
        load()
    }

    fun record(conversationId: String, messageId: String, proposal: AssistantProposal, note: String, failed: Boolean, auto: Boolean) {
        val now = System.currentTimeMillis()
        val entry = ActivityEntry(
            id = AssistantCodec.newId("a"), at = now, updatedAt = now, conversationId = conversationId, messageId = messageId,
            proposalId = proposal.id, action = proposal.action, note = note, device = device, state = if (failed) "failed" else "applied", auto = auto,
        )
        entries = (listOf(entry) + entries).take(MAX_ENTRIES)
        save()
        onLocalChange?.invoke(entry.id)
    }

    fun markUndone(proposalId: String) {
        val entry = entries.firstOrNull { it.proposalId == proposalId && it.state == "applied" } ?: return
        val next = entry.copy(state = "undone", updatedAt = System.currentTimeMillis())
        entries = entries.map { if (it.id == entry.id) next else it }
        save()
        onLocalChange?.invoke(entry.id)
    }

    /** Empties the record here and on the user's other phones. */
    fun clear() {
        val now = System.currentTimeMillis()
        deleted = deleted + entries.associate { it.id to now }
        val ids = entries.map { it.id }
        entries = emptyList()
        save()
        ids.forEach { onLocalChange?.invoke(it) }
    }

    fun deletedAt(id: String): Long? = deleted[id]

    fun deletedIds(): Set<String> = deleted.keys

    fun applyRemote(id: String, entry: ActivityEntry?, updatedAt: Long): Boolean {
        val local = entries.firstOrNull { it.id == id }
        val localAt = local?.updatedAt ?: deleted[id] ?: 0L
        if (updatedAt <= localAt) return false
        if (entry == null) {
            deleted = deleted + (id to updatedAt)
            entries = entries.filterNot { it.id == id }
        } else {
            deleted = deleted - id
            entries = (entries.filterNot { it.id == id } + entry.copy(updatedAt = updatedAt)).sortedByDescending { it.at }.take(MAX_ENTRIES)
        }
        save()
        return true
    }

    fun clearAll() {
        entries = emptyList()
        deleted = emptyMap()
        save()
    }

    private fun load() {
        val json = runCatching { JSONObject(file.readText()) }.getOrNull() ?: return
        val array = json.optJSONArray("entries") ?: JSONArray()
        entries = (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            ActivityCodec.fromJson(item.optString("id"), item.optLong("updatedAt"), item)
        }.sortedByDescending { it.at }
        deleted = json.optJSONObject("deleted")?.let { d -> d.keys().asSequence().associateWith { d.optLong(it) }.filterValues { it > 0 } }.orEmpty()
    }

    private fun save() {
        val horizon = System.currentTimeMillis() - 180L * 24 * 60 * 60 * 1000
        deleted = deleted.filterValues { it > horizon }
        val body = JSONObject()
            .put("entries", JSONArray(entries.map { ActivityCodec.toJson(it).put("id", it.id).put("updatedAt", it.updatedAt) }))
            .put("deleted", JSONObject().apply { deleted.forEach { (id, at) -> put(id, at) } })
        runCatching { file.writeText(body.toString()) }
    }

    companion object {
        const val MAX_ENTRIES = 300
    }
}
