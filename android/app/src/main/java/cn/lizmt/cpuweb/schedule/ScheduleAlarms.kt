package cn.lizmt.cpuweb.schedule

import android.content.Context
import android.content.Intent
import android.provider.AlarmClock
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Calendar
import kotlinx.coroutines.launch

/**
 * 上课闹钟 (NapTable's 作息响铃): an alarm before the first class of a
 * morning, and one before the first class after the noon break (iOS
 * `NativeRoutineAlarms`). Days off, make-up days and single meetings moved or
 * cancelled are already in the dated meetings it reads.
 */
object RoutineAlarmRules {
    data class Planned(val kind: String, val date: String, val minute: Int, val title: String) {
        val clock: String get() = OverlayTiming.clock(minute)
    }

    val MORNING_LEADS = listOf(30, 45, 60, 90)
    val NAP_LEADS = listOf(10, 15, 20, 30)
    /** A class beginning before this (minutes) is a morning class. */
    private const val MORNING_ENDS = 12 * 60

    /** The alarms the timetable calls for, from now to [days] days ahead; a null lead leaves that kind out. */
    fun plan(meetings: List<ScheduleMeeting>, today: String, nowMinute: Int, morning: Int?, nap: Int?, days: Int = 7): List<Planned> {
        val byDate = meetings.groupBy { it.date }
        val result = mutableListOf<Planned>()
        var date = today
        repeat(days) {
            val list = byDate[date].orEmpty().filter { it.startMinutes != null && it.endMinutes != null }.sortedBy { it.startMinutes }
            fun append(kind: String, minute: Int, title: String) {
                if (minute < 0 || (date == today && minute <= nowMinute)) return
                result += Planned(kind, date, minute, title)
            }
            val first = list.firstOrNull()
            if (morning != null && first != null && first.startMinutes!! < MORNING_ENDS) {
                append("morning", first.startMinutes!! - morning, "早课：${first.start}「${first.course.name}」")
            }
            val afternoon = list.firstOrNull { it.startMinutes!! >= MORNING_ENDS }
            // Only after a break: a class running into the afternoon is not one.
            if (nap != null && afternoon != null &&
                list.none { it.startMinutes!! < MORNING_ENDS && it.endMinutes!! > afternoon.startMinutes!! - 30 }) {
                append("nap", afternoon.startMinutes!! - nap, "午休结束：${afternoon.start}「${afternoon.course.name}」")
            }
            date = ScheduleCommonFree.shift(date, 1)
        }
        return result
    }

    /**
     * The system alarms for a plan: one per weekday and kind, repeating weekly
     * at the time the coming week asks for. Calendar weekday numbers (Sunday 1).
     */
    fun weekly(plan: List<Planned>): List<Triple<Int, Planned, Int>> = plan.mapNotNull { item ->
        val calendar = OccurrenceRules.calendar(item.date) ?: return@mapNotNull null
        Triple(calendar.get(Calendar.DAY_OF_WEEK), item, item.minute)
    }.distinctBy { it.first to it.second.kind }
}

/** Whether each alarm is on and how early it rings; kept on this device. */
class RoutineAlarmSettings(context: Context) {
    private val prefs = context.getSharedPreferences("routine_alarms", Context.MODE_PRIVATE)
    var morningOn by mutableStateOf(prefs.getBoolean("morning", true))
        private set
    var morningLead by mutableIntStateOf(prefs.getInt("morningLead", 60))
        private set
    var napOn by mutableStateOf(prefs.getBoolean("nap", true))
        private set
    var napLead by mutableIntStateOf(prefs.getInt("napLead", 15))
        private set

    fun update(morningOn: Boolean = this.morningOn, morningLead: Int = this.morningLead, napOn: Boolean = this.napOn, napLead: Int = this.napLead) {
        this.morningOn = morningOn
        this.morningLead = morningLead
        this.napOn = napOn
        this.napLead = napLead
        prefs.edit().putBoolean("morning", morningOn).putInt("morningLead", morningLead).putBoolean("nap", napOn).putInt("napLead", napLead).apply()
    }
}

/**
 * Sets the plan in the system clock app, which rings reliably on every phone
 * here (an alarm of this app's own would be stopped by the vendor's battery
 * rules): one alarm per weekday and kind, repeating weekly, without opening
 * the clock. Clock apps reuse an alarm of the same time and label, so setting
 * it again does not pile them up. False when no clock app takes it.
 */
suspend fun setSystemAlarms(context: Context, plan: List<RoutineAlarmRules.Planned>): Boolean {
    var sent = false
    RoutineAlarmRules.weekly(plan).forEachIndexed { index, (weekday, item, minute) ->
        // The clock app takes one request at a time: a burst of them keeps only one.
        if (index > 0) kotlinx.coroutines.delay(900)
        val intent = Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, minute / 60)
            .putExtra(AlarmClock.EXTRA_MINUTES, minute % 60)
            .putExtra(AlarmClock.EXTRA_MESSAGE, (if (item.kind == "morning") "早课" else "午休结束") + " · " + item.title.substringAfter('：'))
            .putExtra(AlarmClock.EXTRA_DAYS, arrayListOf(weekday))
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            .putExtra(AlarmClock.EXTRA_VIBRATE, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (runCatching { context.startActivity(intent) }.isSuccess) sent = true
    }
    return sent
}

/** 上课闹钟: the two alarms, how early they ring, and the coming week's plan. */
@Composable
internal fun RoutineAlarmSheet(activity: MainActivity, onDismiss: () -> Unit) {
    val settings = activity.alarms
    val store = activity.schedule
    val snapshot = store.completeSnapshot()
    val meetings = androidx.compose.runtime.remember(snapshot) { snapshot?.let(ScheduleMeetings::make).orEmpty() }
    val plan = RoutineAlarmRules.plan(
        meetings, ScheduleStore.todayKey(), ScheduleStyleTime.minutesNow(),
        settings.morningLead.takeIf { settings.morningOn }, settings.napLead.takeIf { settings.napOn },
    )
    val meta = MaterialTheme.colorScheme.onSurfaceVariant
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var setting by androidx.compose.runtime.remember { mutableStateOf(false) }
    ScheduleSheetContainer(onDismiss) {
        SheetTitle("上课闹钟")
        Text("早上第一节课和午休后的第一节课前，用手机自带的时钟响铃。", fontSize = 13.sp, lineHeight = 18.sp, color = meta)
        SettingsSection("早课")
        SettingsSwitchRow("早上第一节课前", settings.morningOn) { settings.update(morningOn = it) }
        if (settings.morningOn) {
            Text("提前", fontSize = 13.sp, color = meta, modifier = Modifier.padding(bottom = 6.dp))
            SettingsSegmented(RoutineAlarmRules.MORNING_LEADS.map { it.toString() to leadText(it) }, settings.morningLead.toString()) {
                settings.update(morningLead = it.toInt())
            }
        }
        SettingsSection("午休")
        SettingsSwitchRow("午休后第一节课前", settings.napOn, detail = "上午的课一直上到下午时不响") { settings.update(napOn = it) }
        if (settings.napOn) {
            Text("提前", fontSize = 13.sp, color = meta, modifier = Modifier.padding(bottom = 6.dp))
            SettingsSegmented(RoutineAlarmRules.NAP_LEADS.map { it.toString() to leadText(it) }, settings.napLead.toString()) {
                settings.update(napLead = it.toInt())
            }
        }
        SettingsSection("接下来 7 天")
        when {
            snapshot == null -> Text("整学期课表还没有加载完，请刷新课表后再试。", fontSize = 14.sp, color = meta)
            plan.isEmpty() -> Text("这几天没有需要提醒的课。", fontSize = 14.sp, color = meta)
            else -> Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f))
                .padding(horizontal = 14.dp, vertical = 6.dp)) {
                plan.forEach { item ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(item.clock, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.width(64.dp))
                        Column(Modifier.weight(1f)) {
                            Text(item.title, fontSize = 14.sp, maxLines = 1)
                            Text(OccurrenceRules.dateText(item.date), fontSize = 12.sp, color = meta)
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                setting = true
                scope.launch {
                    val sent = setSystemAlarms(activity, plan)
                    setting = false
                    activity.toast(if (sent) "已交给系统时钟：${RoutineAlarmRules.weekly(plan).size} 个闹钟" else "没有找到可以设闹钟的时钟 App")
                }
            },
            enabled = plan.isNotEmpty() && !setting, modifier = Modifier.fillMaxWidth(),
        ) { Text(if (setting) "正在设置…" else "设到系统时钟") }
        OutlinedButton(
            onClick = {
                runCatching { activity.startActivity(Intent(AlarmClock.ACTION_SHOW_ALARMS)) }.onFailure { activity.toast("没有找到时钟 App") }
            },
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        ) { Text("打开时钟查看或删除") }
        Text(
            "每个星期几按接下来这一周的课各设一个每周重复的闹钟；单双周、放假或调课让时间变了，回来再点一次就行。",
            fontSize = 12.sp, lineHeight = 17.sp, color = meta, modifier = Modifier.padding(top = 10.dp),
        )
    }
}

private fun leadText(minutes: Int) = when {
    minutes % 60 == 0 -> "${minutes / 60} 小时"
    minutes > 60 -> "${minutes / 60}.5 小时"
    else -> "$minutes 分"
}
