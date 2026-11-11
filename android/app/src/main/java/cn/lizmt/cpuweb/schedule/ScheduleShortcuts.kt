package cn.lizmt.cpuweb.schedule

import android.content.Context
import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

/**
 * Long-press shortcuts on the launcher icon, the Android counterpart of the
 * iOS Shortcuts actions: 今天的课, 添加日程, 日程与待办 and 找共同空闲. They are
 * dynamic so they name this build's own activity whatever its package.
 */
object ScheduleShortcuts {
    const val EXTRA = "cn.lizmt.cpuweb.SHORTCUT"
    const val TODAY = "today"
    const val NEW_AGENDA = "agendaNew"
    const val AGENDA = "agenda"
    const val FREE = "commonFree"

    /** The shortcuts in launcher order, as (id, short label, long label). */
    val ENTRIES = listOf(
        Triple(TODAY, "今天的课", "打开今天的课表"),
        Triple(NEW_AGENDA, "添加日程", "新建一条日程"),
        Triple(AGENDA, "日程与待办", "查看日程与待办"),
        Triple(FREE, "找共同空闲", "和同学、TA 找共同空闲"),
    )

    fun publish(context: Context) {
        val icons = mapOf(
            TODAY to android.R.drawable.ic_menu_today, NEW_AGENDA to android.R.drawable.ic_menu_add,
            AGENDA to android.R.drawable.ic_menu_agenda, FREE to android.R.drawable.ic_menu_my_calendar,
        )
        val shortcuts = ENTRIES.mapIndexed { rank, (id, short, long) ->
            ShortcutInfoCompat.Builder(context, id)
                .setShortLabel(short).setLongLabel(long).setRank(rank)
                .setIcon(IconCompat.createWithResource(context, icons.getValue(id)))
                .setIntent(Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).putExtra(EXTRA, id)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
                .build()
        }
        runCatching { ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts) }
    }
}
