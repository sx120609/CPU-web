package cn.lizmt.cpuweb.schedule

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import java.time.LocalDate

/** A number that changes each time the app comes back, so what the system settings decide is read again. */
@Composable
internal fun rememberResumeCount(): Int {
    var count by remember { mutableIntStateOf(0) }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) count += 1 }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    return count
}

/** When the next class reminder fires, in the user's words. */
internal fun nextCourseReminderText(context: Context): String {
    val (at, course) = AgendaReminders.nextCourseReminder(context) ?: return "接下来三周没有读到课，打开一次课表后会自动排上"
    return "下一次：${dayLabel(at.toLocalDate(), LocalDate.now(), withWeekday = false)} ${"%02d:%02d".format(at.hour, at.minute)}，${course.name}"
}

/**
 * What can keep a reminder from showing, each with the system page that
 * changes it, and two tests: one now and one through an alarm a minute later.
 */
@Composable
internal fun ReminderCheckPage(activity: MainActivity) {
    val context = LocalContext.current
    val resumed = rememberResumeCount()
    val health = remember(resumed) { AgendaReminders.health(context) }
    val ok = MaterialTheme.colorScheme.onSurfaceVariant
    val bad = MaterialTheme.colorScheme.error
    fun launch(intent: Intent, fallback: Intent? = null) {
        runCatching { context.startActivity(intent) }.onFailure { fallback?.let { runCatching { context.startActivity(it) } } }
    }
    val details = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
    Panel("能不能弹出", footer = "华为、荣耀、小米、OPPO、vivo 等手机会拦下不在前台的应用：请在系统的应用设置里允许拾间NEXT 自启动、后台运行，并把耗电管理设为不限制。") {
        ListRow("通知", value = if (health.notifications) "已允许" else "已关闭", titleColor = if (health.notifications) Color.Unspecified else bad, chevron = true) {
            if (!health.notifications && !AgendaReminders.canNotify(context)) activity.ensureNotificationPermission()
            launch(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName), details)
        }
        Hairline()
        ListRow("横幅和声音", detail = if (health.quiet) "日程或上课提醒被设成了静默，到点不会弹出横幅" else null,
            value = if (health.quiet) "已关闭" else "正常", titleColor = if (health.quiet) bad else Color.Unspecified, chevron = true) {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                    .putExtra(Settings.EXTRA_CHANNEL_ID, AgendaReminders.CHANNEL_COURSE)
            } else details
            launch(intent, details)
        }
        Hairline()
        ListRow("准时闹钟", value = if (health.exact) "允许" else "不允许", titleColor = if (health.exact) Color.Unspecified else bad,
            chevron = !health.exact, enabled = true, onClick = if (health.exact || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) null else ({
                launch(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}")), details)
            }))
        Hairline()
        ListRow("电池优化", detail = if (health.batteryFree) null else "系统可能推迟或拦下提醒",
            value = if (health.batteryFree) "不限制" else "受限制", titleColor = if (health.batteryFree) Color.Unspecified else bad,
            chevron = !health.batteryFree, onClick = if (health.batteryFree) null else ({
                launch(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")),
                    Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }))
        Hairline()
        val brand = remember { VendorSettings.current() }
        ListRow(if (brand != null) "${brand.name}：允许自启动和后台运行" else "自启动和后台运行",
            detail = brand?.steps ?: "打开系统的应用信息页", chevron = true) { VendorSettings.open(context, brand) }
    }
    Panel("手机拦不住的提醒", footer = "微信和 QQ 一般不会被手机厂商拦下。打开后，日程和上课提醒到点时，拾间的服务器也会发一条到你绑定的微信和 QQ。") {
        ReminderRelayRows(activity)
    }
    if (AgendaReminders.courseMinutes(context) >= 0) {
        Panel("上课提醒") {
            ListRow(remember(resumed) { nextCourseReminderText(context) }, titleColor = ok)
        }
    }
    Panel("试一下", footer = "点了“1 分钟后”就锁屏或切到别的应用；收不到，多半是上面某一项或系统的后台限制拦住了。") {
        ListRow("现在发一条测试提醒") {
            activity.ensureNotificationPermission()
            AgendaReminders.test(context)
        }
        Hairline()
        ListRow("1 分钟后发一条") {
            activity.ensureNotificationPermission()
            AgendaReminders.test(context, delayMinutes = 1)
            activity.toast("1 分钟后会收到一条测试提醒")
        }
    }
}

/** What the server can reach: the user's bound WeChat (when the site can send template messages) and QQ. */
data class RelayChannels(val wechat: Boolean, val qq: Boolean)

suspend fun relayChannels(): RelayChannels? = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    runCatching {
        val wechat = SiteHttp.request("/api/wechat/me", "GET").data
        val qq = SiteHttp.request("/api/qqbot/me", "GET").data
        val wechatBinding = wechat?.optJSONObject("binding")
        val qqBinding = qq?.optJSONObject("binding")
        RelayChannels(
            wechat = wechat?.optBoolean("persistentNotificationAvailable") == true && wechatBinding?.optBoolean("enabled") == true && wechatBinding.optBoolean("subscribed"),
            qq = qq?.optBoolean("enabled") == true && qqBinding?.optBoolean("enabled") == true,
        )
    }.getOrNull()
}

/**
 * The server-side reminder switch and where it will arrive, with a way to bind
 * WeChat or QQ on the site's 消息 → 设置 page.
 */
@Composable
internal fun ReminderRelayRows(activity: MainActivity) {
    val sync = activity.sync
    val signedIn = activity.web.authState.authenticated
    val resumed = rememberResumeCount()
    var channels by remember { mutableStateOf<RelayChannels?>(null) }
    androidx.compose.runtime.LaunchedEffect(signedIn, resumed) { if (signedIn) channels = relayChannels() }
    val reach = channels
    val detail = when {
        !signedIn -> "登录后可以用"
        !sync.enabled -> "需要先打开“跨设备同步”"
        reach == null -> "正在查看绑定情况…"
        reach.wechat && reach.qq -> "会发到你绑定的微信和 QQ，也会出现在站内消息里"
        reach.wechat -> "会发到你绑定的微信，也会出现在站内消息里"
        reach.qq -> "会发到你绑定的 QQ，也会出现在站内消息里"
        else -> "还没有绑定微信或 QQ：现在只会出现在站内消息里"
    }
    ToggleRow("微信和 QQ 也提醒", checked = sync.relay && sync.enabled && signedIn, detail = detail, enabled = signedIn && sync.enabled) { sync.switchRelay(it) }
    if (signedIn && reach != null && !(reach.wechat && reach.qq)) {
        Hairline()
        ListRow(if (!reach.wechat && !reach.qq) "绑定微信或 QQ" else if (!reach.wechat) "也绑定微信" else "也绑定 QQ", chevron = true,
            titleColor = MaterialTheme.colorScheme.primary) {
            activity.closeSettings()
            activity.shell.openWeb("/messages?tab=settings")
        }
    }
}
