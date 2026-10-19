package cn.lizmt.cpuweb.schedule

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/** One reminder the server sends at [at] (epoch milliseconds). */
data class RelayReminder(val key: String, val at: Long, val title: String, val text: String, val link: String)

/**
 * The reminders this phone has coming, for the server to send through the
 * site's notifications (and so the user's bound WeChat and QQ). Built from the
 * same rules as the phone's own alarms: each item's reminder before each open
 * occurrence, and the class reminder before each class, for the next 30 days.
 */
object ReminderPlan {
    const val DAYS = 30L
    private const val MAX = 400

    fun build(items: List<AgendaItem>, days: Map<String, DashDay>, courseMinutes: Int, now: LocalDateTime, zone: ZoneId = ZoneId.systemDefault()): List<RelayReminder> {
        val result = mutableListOf<RelayReminder>()
        val until = now.plusDays(DAYS)
        for (item in items) {
            if (item.remind < 0 || !item.dated) continue
            var day = maxOf(AgendaItem.parseDate(item.date) ?: continue, now.toLocalDate())
            while (!day.isAfter(until.toLocalDate())) {
                if (item.occursOn(day) && !item.isDoneOn(day.toString())) {
                    val at = item.reminderAt(day)
                    if (at != null && at.isAfter(now) && at.isBefore(until)) {
                        val text = listOfNotNull(
                            dayText(day, now.toLocalDate()),
                            item.start.takeIf { it.isNotEmpty() }?.let { if (item.end.isNotEmpty()) "$it–${item.end}" else it },
                            item.location.takeIf { it.isNotBlank() },
                        ).joinToString(" · ")
                        result += RelayReminder("agenda:${item.id}:$day", at.atZone(zone).toInstant().toEpochMilli(), "日程提醒 · ${item.title}".take(60), text.take(120), "/")
                    }
                }
                if (item.repeat == cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat.None) break
                day = day.plusDays(1)
            }
        }
        if (courseMinutes >= 0) {
            var day = now.toLocalDate()
            while (!day.isAfter(until.toLocalDate())) {
                days[day.toString()]?.courses?.forEach { course ->
                    val start = AgendaItem.parseTime(course.start) ?: return@forEach
                    val at = LocalDateTime.of(day, start).minusMinutes(courseMinutes.toLong())
                    if (!at.isAfter(now)) return@forEach
                    val text = listOfNotNull("${course.start}–${course.end}", course.location.takeIf { it.isNotBlank() }).joinToString(" · ")
                    result += RelayReminder("course:$day:${course.start}:${course.name.hashCode().toUInt().toString(36)}", at.atZone(zone).toInstant().toEpochMilli(),
                        "上课提醒 · ${course.name}".take(60), text.take(120), "/schedule")
                }
                day = day.plusDays(1)
            }
        }
        return result.sortedBy { it.at }.take(MAX)
    }

    fun toJson(plan: List<RelayReminder>): JSONObject = JSONObject().put("items", JSONArray(plan.map {
        JSONObject().put("key", it.key.take(80)).put("at", it.at).put("title", it.title).put("text", it.text).put("link", it.link)
    }))

    private fun dayText(day: LocalDate, today: LocalDate): String? = when (day) {
        today -> null
        today.plusDays(1) -> "明天"
        else -> "${day.monthValue}月${day.dayOfMonth}日"
    }
}

/**
 * Where each phone maker keeps the switches that stop it from killing apps in
 * the background (自启动, 后台运行, 耗电管理). The pages are not public APIs and
 * move between system versions, so each brand lists several and the app
 * details page is the fallback.
 */
object VendorSettings {
    data class Brand(val name: String, val steps: String, val pages: List<ComponentName>)

    fun current(): Brand? {
        val maker = (Build.MANUFACTURER.orEmpty() + " " + Build.BRAND.orEmpty()).lowercase()
        return when {
            listOf("xiaomi", "redmi", "poco").any { it in maker } -> Brand(
                "小米", "设置 → 应用设置 → 应用管理 → 拾间 NEXT：打开“自启动”，“省电策略”选“无限制”；在最近任务里把拾间 NEXT 往下拉锁住。",
                listOf(
                    ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
                    ComponentName("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"),
                ),
            )
            "honor" in maker -> Brand(
                "荣耀", "设置 → 应用和服务 → 应用启动管理 → 拾间 NEXT：关闭“自动管理”，打开自启动、关联启动、后台活动；在多任务界面下拉锁住拾间 NEXT。",
                listOf(
                    ComponentName("com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                    ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                ),
            )
            "huawei" in maker -> Brand(
                "华为", "设置 → 应用和服务 → 应用启动管理 → 拾间 NEXT：关闭“自动管理”，打开自启动、关联启动、后台活动；在多任务界面下拉锁住拾间 NEXT。",
                listOf(
                    ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                    ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity"),
                    ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"),
                ),
            )
            listOf("oppo", "realme", "oneplus").any { it in maker } -> Brand(
                "OPPO / 一加 / realme", "设置 → 应用 → 应用管理 → 拾间 NEXT：打开“允许自动启动”“允许后台运行”，耗电管理里允许后台高耗电。",
                listOf(
                    ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
                    ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
                    ComponentName("com.oplus.safecenter", "com.oplus.safecenter.permission.startup.StartupAppListActivity"),
                    ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
                ),
            )
            listOf("vivo", "iqoo").any { it in maker } -> Brand(
                "vivo / iQOO", "i管家 → 应用管理 → 权限管理 → 自启动，打开拾间 NEXT；设置 → 电池 → 后台耗电管理里选“允许后台高耗电”。",
                listOf(
                    ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
                    ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
                    ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"),
                ),
            )
            "meizu" in maker -> Brand("魅族", "手机管家 → 权限管理 → 后台管理，把拾间 NEXT 设为允许后台运行。",
                listOf(ComponentName("com.meizu.safe", "com.meizu.safe.permission.SmartBGActivity")))
            "samsung" in maker -> Brand("三星", "设置 → 电池 → 后台使用限制，把拾间 NEXT 加入“永不休眠的应用”。",
                listOf(ComponentName("com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity")))
            else -> null
        }
    }

    /** Opens the first of the brand's pages that this phone has, else the app's details page. */
    fun open(context: Context, brand: Brand?) {
        for (page in brand?.pages.orEmpty()) {
            val intent = Intent().setComponent(page).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (runCatching { context.startActivity(intent) }.isSuccess) return
        }
        runCatching {
            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
