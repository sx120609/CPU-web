package cn.lizmt.cpuweb.schedule

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import cn.lizmt.cpuweb.schedule.agenda.AgendaKind
import cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

/**
 * What the 日程 widget lists (iOS `AgendaWidget`): overdue to-dos, the
 * coming two weeks' items and to-dos without a date. Free of Android types
 * so it runs in a unit test.
 */
object AgendaWidgetRules {
    data class Entry(
        val id: String,
        val title: String,
        /** "yyyy-MM-dd" of this occurrence; empty for a to-do without a date. */
        val date: String,
        /** "逾期 · 11月9日", "今天 14:00", "明天", "11月14日 周六 全天" or "待办". */
        val meta: String,
        val done: Boolean,
        val overdue: Boolean,
    )

    /** A tick made on the home screen, kept until the app saves it through the site. */
    data class Toggle(val id: String, val date: String, val done: Boolean)

    fun entries(items: List<AgendaItem>, today: LocalDate, toggles: List<Toggle> = emptyList(), days: Int = 14): List<Entry> {
        fun done(item: AgendaItem, day: String): Boolean =
            toggles.lastOrNull { it.id == item.id && (it.date == day || item.repeat == AgendaRepeat.None) }?.done ?: item.isDoneOn(day)
        val overdue = items.filter { it.kind == AgendaKind.Todo && it.repeat == AgendaRepeat.None && it.dated }
            .mapNotNull { item -> AgendaItem.parseDate(item.date)?.takeIf { it.isBefore(today) }?.let { item to it } }
            .filter { (item, day) -> !done(item, day.toString()) }
            .sortedBy { it.second }
            .map { (item, day) -> Entry(item.id, item.title, day.toString(), "逾期 · ${day.monthValue}月${day.dayOfMonth}日", false, overdue = true) }
        val upcoming = (0 until days).flatMap { offset ->
            val day = today.plusDays(offset.toLong())
            items.filter { it.occursOn(day) }.sortedWith(compareBy({ it.timed }, { it.start })).map { item ->
                val label = when (offset) {
                    0 -> "今天"
                    1 -> "明天"
                    else -> OccurrenceRules.dateText(day.toString())
                }
                Entry(item.id, item.title, day.toString(), label + if (item.timed) " ${item.start}" else if (offset > 1) " 全天" else "",
                    done(item, day.toString()), overdue = false)
            }
        }
        val undated = items.filter { !it.dated && it.kind == AgendaKind.Todo }.map { Entry(it.id, it.title, "", "待办", done(it, ""), false) }
        // What is still to do first; what was ticked off today stays, struck through, until tomorrow.
        return overdue + upcoming.filter { !it.done || it.date == today.toString() } + undated.filter { !it.done }
    }

    fun encode(toggles: List<Toggle>): String = JSONArray(toggles.map { JSONObject().put("id", it.id).put("date", it.date).put("done", it.done) }).toString()

    fun decode(raw: String?): List<Toggle> = runCatching {
        val array = JSONArray(raw ?: return emptyList())
        (0 until array.length()).mapNotNull { array.optJSONObject(it) }.map { Toggle(it.optString("id"), it.optString("date"), it.optBoolean("done")) }
            .filter { it.id.isNotEmpty() }
    }.getOrDefault(emptyList())
}

/**
 * The 日程 widget: ticks items off right on the home screen. A tick is drawn
 * at once and kept on this device; the app saves it through the site the next
 * time it is open and signed in ([syncPending]).
 */
class AgendaWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { render(context, manager, it) }
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_TOGGLE) {
            val id = intent.getStringExtra(EXTRA_ID).orEmpty()
            if (id.isNotEmpty()) {
                val pending = pending(context).filterNot { it.id == id && it.date == intent.getStringExtra(EXTRA_DATE).orEmpty() } +
                    AgendaWidgetRules.Toggle(id, intent.getStringExtra(EXTRA_DATE).orEmpty(), intent.getBooleanExtra(EXTRA_DONE, true))
                savePending(context, pending)
                updateAll(context)
            }
            return
        }
        super.onReceive(context, intent)
    }

    companion object {
        const val ACTION_TOGGLE = "cn.lizmt.cpuweb.AGENDA_WIDGET_TOGGLE"
        private const val EXTRA_ID = "id"
        private const val EXTRA_DATE = "date"
        private const val EXTRA_DONE = "done"
        private const val PREFS = "agenda_widget"
        private const val KEY_PENDING = "pending"
        private val ROWS = listOf(
            Triple(R.id.agenda_row_0, R.id.agenda_check_0, R.id.agenda_title_0) to R.id.agenda_meta_0,
            Triple(R.id.agenda_row_1, R.id.agenda_check_1, R.id.agenda_title_1) to R.id.agenda_meta_1,
            Triple(R.id.agenda_row_2, R.id.agenda_check_2, R.id.agenda_title_2) to R.id.agenda_meta_2,
            Triple(R.id.agenda_row_3, R.id.agenda_check_3, R.id.agenda_title_3) to R.id.agenda_meta_3,
            Triple(R.id.agenda_row_4, R.id.agenda_check_4, R.id.agenda_title_4) to R.id.agenda_meta_4,
            Triple(R.id.agenda_row_5, R.id.agenda_check_5, R.id.agenda_title_5) to R.id.agenda_meta_5,
        )

        fun pending(context: Context): List<AgendaWidgetRules.Toggle> =
            AgendaWidgetRules.decode(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_PENDING, null))

        private fun savePending(context: Context, toggles: List<AgendaWidgetRules.Toggle>) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_PENDING, AgendaWidgetRules.encode(toggles)).apply()
        }

        /** Redraws every 日程 widget from the app's copy of the list. */
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context) ?: return
            val ids = runCatching { manager.getAppWidgetIds(ComponentName(context, AgendaWidgetProvider::class.java)) }.getOrNull() ?: return
            ids.forEach { render(context, manager, it) }
        }

        /**
         * Saves the ticks made on the home screen through the site, once the app
         * can (signed in, the list loaded), then forgets them.
         */
        fun syncPending(context: Context, remote: AgendaRemote) {
            val toggles = pending(context)
            if (toggles.isEmpty() || !remote.available) return
            toggles.forEach { toggle ->
                val item = remote.items.firstOrNull { it.id == toggle.id } ?: return@forEach
                val day = AgendaItem.parseDate(toggle.date) ?: AgendaItem.parseDate(item.date) ?: LocalDate.now()
                val occurrence = cn.lizmt.cpuweb.schedule.agenda.AgendaOccurrence(item, day)
                if (occurrence.done != toggle.done) remote.toggle(occurrence)
            }
            savePending(context, emptyList())
        }

        private fun render(context: Context, manager: AppWidgetManager, id: Int) {
            val views = RemoteViews(context.packageName, R.layout.widget_agenda)
            val (_, items) = AgendaRemote.readCache(context)
            val entries = AgendaWidgetRules.entries(items, LocalDate.now(), pending(context))
            val open = PendingIntent.getActivity(
                context, 4100, Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW)
                    .putExtra(ScheduleShortcuts.EXTRA, ScheduleShortcuts.AGENDA).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.agenda_header, open)
            // 文字大小跟 App 里的小组件设置。这里是系统排的文字，量不了放不放得下，「自适应」按标准大小。
            val scale = when (ScheduleWidgetDisplay.load(context).textSize) {
                ScheduleWidgetDisplay.SMALL -> 0.9f
                ScheduleWidgetDisplay.LARGE -> 1.12f
                else -> 1f
            }
            fun size(view: Int, dp: Float) = views.setTextViewTextSize(view, android.util.TypedValue.COMPLEX_UNIT_DIP, dp * scale)
            size(R.id.agenda_heading, 15f)
            size(R.id.agenda_count, 12f)
            size(R.id.agenda_empty, 13f)
            val left = entries.count { !it.done }
            views.setTextViewText(R.id.agenda_count, if (left == 0) "" else "$left 项")
            views.setViewVisibility(R.id.agenda_empty, if (entries.isEmpty()) View.VISIBLE else View.GONE)
            views.setOnClickPendingIntent(R.id.agenda_empty, open)
            ROWS.forEachIndexed { index, (ids, meta) ->
                val (row, check, title) = ids
                val entry = entries.getOrNull(index)
                if (entry == null) {
                    views.setViewVisibility(row, View.GONE)
                    return@forEachIndexed
                }
                views.setViewVisibility(row, View.VISIBLE)
                views.setTextViewText(title, entry.title)
                views.setTextViewText(meta, entry.meta)
                size(title, 14f)
                size(meta, 12f)
                views.setInt(title, "setPaintFlags", if (entry.done) android.graphics.Paint.STRIKE_THRU_TEXT_FLAG or android.graphics.Paint.ANTI_ALIAS_FLAG
                    else android.graphics.Paint.ANTI_ALIAS_FLAG)
                views.setImageViewResource(check, if (entry.done) R.drawable.ic_agenda_checked else R.drawable.ic_agenda_unchecked)
                views.setTextColor(meta, if (entry.overdue) 0xFFE5484D.toInt() else context.getColor(R.color.widget_secondary_text))
                val toggle = Intent(context, AgendaWidgetProvider::class.java).setAction(ACTION_TOGGLE)
                    .putExtra(EXTRA_ID, entry.id).putExtra(EXTRA_DATE, entry.date).putExtra(EXTRA_DONE, !entry.done)
                views.setOnClickPendingIntent(check, PendingIntent.getBroadcast(
                    context, (entry.id + entry.date).hashCode(), toggle,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ))
                views.setOnClickPendingIntent(title, open)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) views.setBoolean(R.id.agenda_root, "setClipToOutline", true)
            manager.updateAppWidget(id, views)
        }
    }
}
