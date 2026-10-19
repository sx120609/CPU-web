package cn.lizmt.cpuweb.schedule.agenda

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.File
import java.time.LocalDate

/**
 * The user's own events and to-dos, kept on this phone like a system reminders
 * app. One instance per process, so the screens and the reminder receivers see
 * the same list; every change is written at once and reschedules reminders.
 */
class AgendaStore private constructor(private val file: File, private val onChanged: (List<AgendaItem>) -> Unit) {
    var items by mutableStateOf(AgendaCodec.decode(read()))
        private set
    /** Removed items and when, kept for a while so other devices drop them too. */
    private var deleted: Map<String, Long> = AgendaCodec.decodeDeleted(read())
    /** Told the id of every item changed here (not by sync), so it can be uploaded. */
    var onLocalChange: ((String) -> Unit)? = null

    /** Saves a new or edited item; returns it as stored, or null when it cannot be shown. */
    fun save(item: AgendaItem, now: Long = System.currentTimeMillis()): AgendaItem? {
        val existing = items.firstOrNull { it.id == item.id }
        val prepared = AgendaCodec.normalize(
            item.copy(
                id = item.id.ifEmpty { AgendaCodec.newId() },
                createdAt = existing?.createdAt ?: now,
                updatedAt = now,
            ),
        ) ?: return null
        deleted = deleted - prepared.id
        commit(if (existing == null) items + prepared else items.map { if (it.id == prepared.id) prepared else it })
        onLocalChange?.invoke(prepared.id)
        return prepared
    }

    fun remove(id: String, now: Long = System.currentTimeMillis()): AgendaItem? {
        val removed = items.firstOrNull { it.id == id } ?: return null
        deleted = deleted + (id to now)
        commit(items.filterNot { it.id == id })
        onLocalChange?.invoke(id)
        return removed
    }

    /** Puts back an item removed a moment ago (undo); it counts as edited now, so it wins over the removal elsewhere. */
    fun restore(item: AgendaItem, now: Long = System.currentTimeMillis()) {
        if (items.any { it.id == item.id }) return
        deleted = deleted - item.id
        commit(items + item.copy(updatedAt = now))
        onLocalChange?.invoke(item.id)
    }

    /** When [id] was removed here, or null. */
    fun deletedAt(id: String): Long? = deleted[id]

    fun deletedIds(): Set<String> = deleted.keys

    /**
     * Takes another device's version of an item ([item] null: its removal)
     * when it is newer than what this phone has. Returns whether the list changed.
     */
    fun applyRemote(id: String, item: AgendaItem?, updatedAt: Long): Boolean {
        val local = items.firstOrNull { it.id == id }
        val localAt = local?.updatedAt ?: deleted[id] ?: 0L
        if (updatedAt <= localAt) return false
        if (item == null) {
            deleted = deleted + (id to updatedAt)
            if (local != null) commit(items.filterNot { it.id == id }) else persist()
            return local != null
        }
        val incoming = AgendaCodec.normalize(item.copy(id = id, updatedAt = updatedAt)) ?: return false
        deleted = deleted - id
        commit(if (local == null) items + incoming else items.map { if (it.id == id) incoming else it })
        return true
    }

    /** Forgets everything (another account takes over this phone). */
    fun clearAll() {
        deleted = emptyMap()
        commit(emptyList())
    }

    /** Ticks an item off, or one day of a repeating one. */
    fun setDone(id: String, day: String, done: Boolean) {
        val item = items.firstOrNull { it.id == id } ?: return
        val next = if (item.repeat == AgendaRepeat.None) item.copy(done = done)
        else item.copy(doneDates = if (done) item.doneDates + day else item.doneDates - day)
        commit(items.map { if (it.id == id) next.copy(updatedAt = System.currentTimeMillis()) else it })
        onLocalChange?.invoke(id)
    }

    /** Re-reads the file after another component wrote it. */
    fun reload() {
        val raw = read()
        items = AgendaCodec.decode(raw)
        deleted = AgendaCodec.decodeDeleted(raw)
    }

    /** Everything on [day]: all-day and untimed first, then by time. */
    fun on(day: LocalDate): List<AgendaOccurrence> = items.filter { it.occursOn(day) }
        .map { AgendaOccurrence(it, day) }
        .sortedWith(compareBy({ it.item.timed }, { it.item.start }, { it.item.createdAt }))

    /**
     * What is still to do: past days' untimed items left unticked (a timed one
     * simply happened), then items without a day in the order they were added.
     */
    fun open(today: LocalDate): List<AgendaItem> {
        val candidates = items.filter { it.repeat == AgendaRepeat.None && !it.done }
        val overdue = candidates.filter { overdue(it, today) }.sortedBy { it.date }
        return overdue + candidates.filter { !it.dated }.sortedBy { it.createdAt }
    }

    fun overdue(item: AgendaItem, today: LocalDate): Boolean =
        !item.done && item.repeat == AgendaRepeat.None && !item.timed &&
            AgendaItem.parseDate(item.date)?.isBefore(today) == true

    private fun commit(next: List<AgendaItem>) {
        items = next.takeLast(AgendaCodec.MAX_ITEMS)
        persist()
        onChanged(items)
    }

    private fun persist() {
        val horizon = System.currentTimeMillis() - TOMBSTONE_LIFETIME_MS
        deleted = deleted.filterValues { it > horizon }
        write(AgendaCodec.encode(items, deleted))
    }

    private fun read(): String? = runCatching { if (file.exists()) file.readText() else null }.getOrNull()

    private fun write(body: String) {
        runCatching {
            val temp = File(file.parentFile, file.name + ".tmp")
            temp.writeText(body)
            if (!temp.renameTo(file)) {
                file.writeText(body)
                temp.delete()
            }
        }
    }

    companion object {
        private const val FILE = "agenda.json"
        /** As long as the server remembers removals. */
        private const val TOMBSTONE_LIFETIME_MS = 180L * 24 * 60 * 60 * 1000
        @Volatile private var instance: AgendaStore? = null

        fun get(context: Context): AgendaStore = instance ?: synchronized(this) {
            instance ?: AgendaStore(File(context.applicationContext.filesDir, FILE)) { items ->
                cn.lizmt.cpuweb.schedule.AgendaReminders.sync(context.applicationContext, items)
            }.also { instance = it }
        }

        /** A store on any file, for tests. */
        internal fun forTest(file: File, onChanged: (List<AgendaItem>) -> Unit = {}) = AgendaStore(file, onChanged)
    }
}
