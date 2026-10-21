package cn.lizmt.cpuweb.schedule

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import cn.lizmt.cpuweb.schedule.agenda.AgendaCodec
import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import cn.lizmt.cpuweb.schedule.agenda.AgendaOccurrence
import cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDate

/**
 * The user's 日程 in the official app. The items live on the site
 * (`/api/next-sync`, the same records as the Web page and 药大拾间 NEXT) and
 * come through the page's bridge `CPUTimeNativeAgenda`, so this app needs no
 * sign-in of its own; editing happens on the Web page at `/agenda`.
 *
 * A copy is kept in `files/agenda-cache.json` for the timetable while the page
 * loads and for the reminders, which fire with the app closed.
 */
class AgendaRemote(
    private val context: Context,
    private val scope: CoroutineScope,
    /** One bridge request; the reply is the bridge's JSON, or null when the page could not answer. */
    private val request: suspend (JSONObject) -> String?,
) {
    var items by mutableStateOf(readCache(context).second)
        private set
    /** The site answers for a signed-in account; false before the first answer and when signed out. */
    var available by mutableStateOf(false)
        private set
    private var account = readCache(context).first
    private var loading: Job? = null
    private var lastLoaded = 0L
    /** Debug fixture: sample items stay put, nothing is read or cleared. */
    private var frozen = false

    /** Debug builds only: shows [sample] without a site session (`--ez debugAgenda true`). */
    internal fun debugSeed(sample: List<AgendaItem>) {
        frozen = true
        available = true
        items = sample.mapNotNull(AgendaCodec::normalize)
    }

    /** Everything on [day]: all-day and untimed first, then by time (NEXT `AgendaStore.on`). */
    fun on(day: LocalDate): List<AgendaOccurrence> = items.filter { it.occursOn(day) }
        .map { AgendaOccurrence(it, day) }
        .sortedWith(compareBy({ it.item.timed }, { it.item.start }, { it.item.createdAt }))

    /** Reads the items again; without [force] at most every 20 seconds. */
    fun refresh(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (frozen) return
        if (loading?.isActive == true || (!force && now - lastLoaded < 20_000)) return
        lastLoaded = now
        loading = scope.launch { accept(request(JSONObject().put("action", "list"))) }
    }

    /** Ticks an occurrence off (or back on): shown at once, then saved through the page. */
    fun toggle(occurrence: AgendaOccurrence) {
        val item = occurrence.item
        val day = occurrence.day.toString()
        val done = !occurrence.done
        items = items.map {
            if (it.id != item.id) it
            else if (it.repeat == AgendaRepeat.None) it.copy(done = done)
            else it.copy(doneDates = if (done) it.doneDates + day else it.doneDates - day)
        }
        if (frozen) return
        scope.launch {
            accept(request(JSONObject().put("action", "toggle").put("id", item.id).put("date", day).put("done", done)))
        }
    }

    /** Forgets the copy (signed out or another account). */
    fun clear() {
        if (frozen) return
        items = emptyList()
        available = false
        account = ""
        writeCache(context, "", emptyList())
        AgendaReminders.sync(context, emptyList())
    }

    private fun accept(raw: String?) {
        val reply = raw?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return
        // An older site without the bridge: keep what is shown.
        if (reply.optBoolean("missing", false)) return
        if (!reply.optBoolean("authenticated", false)) {
            clear()
            return
        }
        val array = reply.optJSONArray("items") ?: JSONArray()
        val next = (0 until array.length()).mapNotNull { index -> array.optJSONObject(index)?.let(AgendaCodec::fromJson) }
            .take(AgendaCodec.MAX_ITEMS)
        account = reply.optString("account")
        available = true
        items = next
        writeCache(context, account, next)
        AgendaReminders.sync(context, next)
    }

    companion object {
        private const val FILE = "agenda-cache.json"

        /** The account and items last read, for the timetable at start and for the reminder receivers. */
        fun readCache(context: Context): Pair<String, List<AgendaItem>> {
            val raw = runCatching { File(context.filesDir, FILE).takeIf { it.exists() }?.readText() }.getOrNull() ?: return "" to emptyList()
            val json = runCatching { JSONObject(raw) }.getOrNull() ?: return "" to emptyList()
            return json.optString("account") to AgendaCodec.decode(raw)
        }

        private fun writeCache(context: Context, account: String, items: List<AgendaItem>) {
            runCatching {
                val body = JSONObject(AgendaCodec.encode(items)).put("account", account).toString()
                val file = File(context.filesDir, FILE)
                val temp = File(context.filesDir, "$FILE.tmp")
                temp.writeText(body)
                if (!temp.renameTo(file)) {
                    file.writeText(body)
                    temp.delete()
                }
            }
        }
    }
}
