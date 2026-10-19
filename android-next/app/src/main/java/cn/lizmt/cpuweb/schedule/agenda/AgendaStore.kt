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
        commit(if (existing == null) items + prepared else items.map { if (it.id == prepared.id) prepared else it })
        return prepared
    }

    fun remove(id: String): AgendaItem? {
        val removed = items.firstOrNull { it.id == id } ?: return null
        commit(items.filterNot { it.id == id })
        return removed
    }

    /** Puts back an item removed a moment ago (undo). */
    fun restore(item: AgendaItem) {
        if (items.any { it.id == item.id }) return
        commit(items + item)
    }

    /** Ticks a to-do, or one day of a repeating one. */
    fun setDone(id: String, day: String, done: Boolean) {
        val item = items.firstOrNull { it.id == id } ?: return
        val next = if (item.repeat == AgendaRepeat.None) item.copy(done = done)
        else item.copy(doneDates = if (done) item.doneDates + day else item.doneDates - day)
        commit(items.map { if (it.id == id) next.copy(updatedAt = System.currentTimeMillis()) else it })
    }

    /** Re-reads the file after another component wrote it. */
    fun reload() {
        items = AgendaCodec.decode(read())
    }

    /** Everything on [day]: all-day and untimed first, then by time. */
    fun on(day: LocalDate): List<AgendaOccurrence> = items.filter { it.occursOn(day) }
        .map { AgendaOccurrence(it, day) }
        .sortedWith(compareBy({ it.item.timed }, { it.item.start }, { it.item.kind != AgendaKind.Event }, { it.item.createdAt }))

    /** To-dos still open: overdue dated ones first, then undated ones in the order they were added. */
    fun openTodos(today: LocalDate): List<AgendaItem> {
        val todos = items.filter { it.kind == AgendaKind.Todo && it.repeat == AgendaRepeat.None && !it.done }
        val overdue = todos.filter { it.dated && AgendaItem.parseDate(it.date)?.isBefore(today) == true }.sortedBy { it.date + it.start }
        return overdue + todos.filter { !it.dated }.sortedBy { it.createdAt }
    }

    fun overdue(item: AgendaItem, today: LocalDate): Boolean =
        item.kind == AgendaKind.Todo && !item.done && item.repeat == AgendaRepeat.None &&
            AgendaItem.parseDate(item.date)?.isBefore(today) == true

    private fun commit(next: List<AgendaItem>) {
        items = next.takeLast(AgendaCodec.MAX_ITEMS)
        write(AgendaCodec.encode(items))
        onChanged(items)
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
