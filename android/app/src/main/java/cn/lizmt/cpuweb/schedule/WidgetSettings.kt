package cn.lizmt.cpuweb.schedule

import androidx.compose.ui.draw.shadow
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import androidx.compose.ui.res.painterResource
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

/** One of the five home-screen widgets, matching the iOS and HarmonyOS families. */
enum class WidgetKind(
    val title: String,
    val size: String,
    val mode: ScheduleWidgetProvider.WidgetMode,
    val provider: Class<*>,
    val ratio: Float,
    /** The picker preview, shown until the app has written a local timetable. */
    val sample: Int,
) {
    UpcomingSmall("临近课程", "2×2", ScheduleWidgetProvider.WidgetMode.COMPACT, ScheduleWidgetProvider::class.java,
        1f, R.drawable.widget_schedule_upcoming_compact_preview),
    UpcomingWide("临近课程", "4×2", ScheduleWidgetProvider.WidgetMode.WIDE, ScheduleWidgetProviderWide::class.java,
        364f / 170f, R.drawable.widget_schedule_upcoming_wide_preview),
    TodayWide("今日课表", "4×2", ScheduleWidgetProvider.WidgetMode.TODAY_WIDE, ScheduleWidgetProviderTodayWide::class.java,
        364f / 170f, R.drawable.widget_schedule_today_wide_preview),
    TodayLarge("今日课表", "4×4", ScheduleWidgetProvider.WidgetMode.TODAY_LARGE, ScheduleWidgetProviderTodayLarge::class.java,
        364f / 382f, R.drawable.widget_schedule_today_large_preview),
    TwoDay("两日课表", "4×4", ScheduleWidgetProvider.WidgetMode.LARGE, ScheduleWidgetProviderLarge::class.java,
        364f / 382f, R.drawable.widget_schedule_two_day_preview),
}

/**
 * Widget data for the native shell. Like iOS, widgets read the timetable the
 * app writes locally (docs/schedule-widget-rules.md §7); the Web timetable page
 * that writes it in the old shell never runs here, so every native load writes
 * the record instead. Account changes remove it together with any legacy
 * server subscription.
 */
class WidgetSettings(private val activity: MainActivity) {
    private val context: Context get() = activity.applicationContext
    /** A local timetable or a legacy subscription exists, so widgets show classes. */
    var ready by mutableStateOf(hasData())
        private set
    var theme by mutableStateOf(ScheduleWidgetPrefs.theme(activity))
        private set
    var message by mutableStateOf("")
        private set
    /** Bumped after every write so previews re-render. */
    var revision by mutableStateOf(0)
        private set
    private var accountFingerprint = ScheduleWidgetPrefs.accountFingerprint(activity)
    private var lastDark = isNight()

    private fun hasData(): Boolean =
        ScheduleWidgetLocalDays.read(context) != null || ScheduleWidgetPrefs.endpoint(context).isNotEmpty()

    /** Write the current term from the native store; unchanged records are not rewritten. */
    fun syncLocalDays(store: ScheduleStore, web: WebSession) {
        // The debug fixture has no session: its sample timetable still feeds the widgets.
        if (!web.authState.authenticated && !activity.debugFixture) return
        val record = store.widgetLocalRecord() ?: return
        val owner = fingerprint(web.authState.account)
        activity.lifecycleScope.launch {
            val saved = withContext(Dispatchers.IO) { ScheduleWidgetLocalDays.save(context, record.toString()) }
            if (owner.isNotEmpty() && owner != accountFingerprint) {
                ScheduleWidgetPrefs.saveAccountFingerprint(context, owner)
                accountFingerprint = owner
            }
            ready = hasData()
            if (saved) revision += 1
        }
    }

    /** Rewrite and redraw on request, e.g. after the user changed something elsewhere. */
    fun refresh(store: ScheduleStore, web: WebSession) {
        syncLocalDays(store, web)
        ScheduleWidgetProvider.updateAll(context)
        revision += 1
        message = if (store.widgetLocalRecord() != null) "已按当前课表刷新桌面小组件" else "请先加载本学期课表"
    }

    /** 小组件风格: "" follows the timetable. */
    var styleChoice by mutableStateOf(ScheduleWidgetPrefs.styleChoice(context))
        private set
    var hasPhoto by mutableStateOf(ScheduleWidgetPrefs.photoFile(context).exists())
        private set
    var veil by mutableStateOf(ScheduleWidgetPrefs.veil(context))
        private set

    fun selectStyle(value: String) {
        styleChoice = value
        ScheduleWidgetPrefs.saveStyle(context, value)
        redraw()
    }

    /** A photo for the widgets, scaled down to 900 px. */
    fun setPhoto(bitmap: android.graphics.Bitmap?) {
        if (bitmap == null) WidgetPhoto.clear(context) else WidgetPhoto.save(context, bitmap)
        hasPhoto = ScheduleWidgetPrefs.photoFile(context).exists()
        redraw()
    }

    fun updateVeil(value: Float) {
        veil = value
        ScheduleWidgetPrefs.saveVeil(context, value)
    }

    fun redraw() {
        ScheduleWidgetProvider.updateAll(context)
        revision += 1
    }

    fun pinAgenda(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        val manager = activity.getSystemService(AppWidgetManager::class.java) ?: return false
        if (!manager.isRequestPinAppWidgetSupported) return false
        return manager.requestPinAppWidget(ComponentName(activity, AgendaWidgetProvider::class.java), null, null)
    }

    fun selectTheme(value: String) {
        theme = normalizedScheduleTheme(value)
        if (ScheduleWidgetPrefs.saveTheme(context, theme)) ScheduleWidgetProvider.updateAll(context)
        revision += 1
    }

    /**
     * The confirmed account changed (empty means signed out). Data recorded for
     * the same account survives cold starts that could not restore the
     * timetable archive; data from before 4.0 recorded no owner and is adopted
     * by the first account that signs in.
     */
    fun handleAccountChanged(account: String) {
        val owner = fingerprint(account)
        if (owner.isNotEmpty() && (accountFingerprint == owner || accountFingerprint.isEmpty())) {
            if (accountFingerprint.isEmpty() && ready) {
                ScheduleWidgetPrefs.saveAccountFingerprint(context, owner)
                accountFingerprint = owner
            }
            return
        }
        ScheduleWidgetLocalDays.clear(context)
        ScheduleWidgetPrefs.clearAccount(context)
        accountFingerprint = ""
        ready = false
        message = ""
        ScheduleWidgetProvider.updateAll(context)
        revision += 1
    }

    /**
     * Android 12+ widgets carry a light and a dark bitmap and switch by
     * themselves; older systems are redrawn when the night mode changes.
     */
    fun refreshForNightMode() {
        val dark = isNight()
        if (dark == lastDark) return
        lastDark = dark
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) ScheduleWidgetProvider.updateAll(context)
    }

    private fun isNight(): Boolean =
        (context.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
            android.content.res.Configuration.UI_MODE_NIGHT_YES

    fun canPin(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        activity.getSystemService(AppWidgetManager::class.java)?.isRequestPinAppWidgetSupported == true

    fun pin(kind: WidgetKind): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        val manager = activity.getSystemService(AppWidgetManager::class.java) ?: return false
        if (!manager.isRequestPinAppWidgetSupported) return false
        val callback = PendingIntent.getBroadcast(
            activity, kind.ordinal + 1001,
            Intent(activity, ScheduleWidgetProvider::class.java).setAction(ScheduleWidgetProvider.ACTION_WIDGET_PINNED),
            PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE,
        )
        return manager.requestPinAppWidget(ComponentName(activity, kind.provider), null, callback)
    }

    /** The widget as it would draw now from the local timetable, or null before the first write. */
    fun preview(kind: WidgetKind, dark: Boolean): Bitmap? =
        runCatching { ScheduleWidgetProvider.preview(context, kind.mode, dark) }.getOrNull()
}

@Composable
fun WidgetSettingsSheet(activity: MainActivity, onDismiss: () -> Unit) {
    val widgets = activity.widgets
    val colors = LocalScheduleColors.current
    var selected by remember { mutableStateOf(WidgetKind.UpcomingSmall) }
    LaunchedEffect(Unit) { widgets.syncLocalDays(activity.schedule, activity.web) }
    ScheduleSheetContainer(onDismiss) {
        SheetTitle("桌面课表小组件")
        if (!widgets.ready) {
            Text("加载本学期课表后，小组件会自动同步。", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(14.dp))
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            WidgetKind.entries.forEach { kind ->
                val chosen = kind == selected
                Text(
                    "${kind.title} ${kind.size}", fontSize = 12.sp,
                    color = if (chosen) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = if (chosen) FontWeight.Bold else FontWeight.Normal,
                    modifier = Modifier.clip(RoundedCornerShape(16.dp))
                        .background(if (chosen) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh)
                        .clickable { selected = kind }.padding(horizontal = 12.dp, vertical = 8.dp)
                        .semantics { this.selected = chosen },
                )
            }
        }
        Spacer(Modifier.height(14.dp))
        val own = remember(selected, widgets.theme, widgets.revision, colors.dark) { widgets.preview(selected, colors.dark) }
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            // The widget layout paints the card behind the bitmap (res/drawable/widget_background).
            val card = if (colors.dark) androidx.compose.ui.graphics.Color(0xFF0E1420) else androidx.compose.ui.graphics.Color(0xFFF8FBFF)
            val modifier = Modifier.width(if (selected.ratio > 1.2f) 320.dp else 180.dp).aspectRatio(selected.ratio)
                .shadow(6.dp, RoundedCornerShape(22.dp)).clip(RoundedCornerShape(22.dp))
                .background(if (own != null) card else androidx.compose.ui.graphics.Color.Transparent)
                .semantics { contentDescription = "${selected.title}小组件预览" }
            if (own != null) Image(own.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Fit, modifier = modifier)
            else Image(painterResource(selected.sample), contentDescription = null, contentScale = ContentScale.Fit, modifier = modifier)
        }
        if (own == null) {
            Spacer(Modifier.height(6.dp))
            Text(
                "示例课程", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
        SettingsSection("风格")
        // Classic, grid and minimal draw alike on a widget: they are one choice here.
        SettingsSegmented(
            listOf("" to "跟随课表", "classic" to "经典", "table" to "表格", "paper" to "素笺", "board" to "站牌"),
            widgets.styleChoice,
        ) { widgets.selectStyle(it) }
        SettingsSection("配色")
        PaletteChoices(widgets.theme) { widgets.selectTheme(it) }
        SettingsSection("小组件背景")
        SettingsValueRow(if (widgets.hasPhoto) "已设置" else "未设置") {
            if (widgets.hasPhoto) androidx.compose.material3.TextButton(onClick = { widgets.setPhoto(null) }) { Text("清除") }
            androidx.compose.material3.TextButton(onClick = { activity.pickWidgetBackground() }) { Text(if (widgets.hasPhoto) "更换" else "从相册选择") }
        }
        if (widgets.hasPhoto) {
            SettingsValueRow("文字底色") { Text("${(widgets.veil * 100).toInt()}%", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            androidx.compose.material3.Slider(
                value = widgets.veil, onValueChange = { widgets.updateVeil(it) }, onValueChangeFinished = { widgets.redraw() },
                valueRange = 0.2f..0.9f, modifier = Modifier.semantics { contentDescription = "小组件背景上文字底色的浓度" },
            )
        }
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = { widgets.refresh(activity.schedule, activity.web) },
            modifier = Modifier.fillMaxWidth().heightIn(min = 46.dp),
        ) { Text("刷新小组件") }
        if (widgets.canPin()) {
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = {
                    if (!widgets.pin(selected)) activity.toast("请长按桌面空白处，在小组件里找到“药大拾间”的课表")
                },
                modifier = Modifier.fillMaxWidth().heightIn(min = 46.dp),
            ) { Text("添加“${selected.title} ${selected.size}”到桌面") }
        }
        if (widgets.canPin()) {
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = { if (!widgets.pinAgenda()) activity.toast("请长按桌面空白处，在小组件里找到“日程与待办”") },
                modifier = Modifier.fillMaxWidth().heightIn(min = 46.dp),
            ) { Text("添加“日程与待办”小组件到桌面") }
        }
        if (widgets.message.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            Text(widgets.message, fontSize = 13.sp, color = MaterialTheme.colorScheme.primary)
        }
        Spacer(Modifier.height(16.dp))
        val manager = AppWidgetManager.getInstance(activity)
        val installed = WidgetKind.entries.flatMap { kind ->
            manager.getAppWidgetIds(ComponentName(activity, kind.provider)).map { kind to it }
        }
        if (installed.isNotEmpty()) {
            SettingsSection("桌面上的小组件")
            installed.forEachIndexed { index, (kind, id) ->
                SettingsNavRow("${kind.title} ${kind.size}" + if (installed.size > 1) " · ${index + 1}" else "", value = "编辑") {
                    activity.startActivity(Intent(activity, ScheduleWidgetConfigureActivity::class.java)
                        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
                }
            }
        }
        WidgetReliabilitySection(activity)
        Spacer(Modifier.height(14.dp))
        Text("也可以长按桌面空白处，在“小组件”里找到“药大拾间”拖到桌面。",
            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * Phones from Huawei, Honor, Xiaomi, OPPO, vivo and others stop apps in the
 * background, which clears the alarms the widget redraws on, so it can stay on
 * yesterday. The two switches that prevent it, each opening its system page.
 */
@Composable
private fun WidgetReliabilitySection(activity: MainActivity) {
    val resumed = rememberResumeCount()
    val batteryFree = remember(resumed) { BatterySettings.unrestricted(activity) }
    val brand = remember { VendorSettings.current() }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    SettingsSection("保持小组件准时")
    Text("部分手机会停掉后台应用，小组件可能停在前一天。", fontSize = 12.sp, color = muted)
    Spacer(Modifier.height(4.dp))
    ReliabilityRow(
        "电池优化",
        if (batteryFree) "已设为不限制" else "受限制：系统可能推迟或停掉小组件的刷新",
        if (batteryFree) "不限制" else "去设置",
        attention = !batteryFree,
    ) { BatterySettings.open(activity) }
    ReliabilityRow(
        if (brand != null) "${brand.name}：允许自启动和后台运行" else "允许自启动和后台运行",
        brand?.steps(activity) ?: "在系统的应用信息页里允许自启动、后台运行，并把耗电管理设为不限制。",
        "去设置",
        attention = false,
    ) { VendorSettings.open(activity, brand) }
}

@Composable
private fun ReliabilityRow(title: String, detail: String, action: String, attention: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick)
            .padding(vertical = 10.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 14.sp, color = if (attention) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.height(2.dp))
            Text(detail, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.width(12.dp))
        Text(action, fontSize = 13.sp, color = MaterialTheme.colorScheme.primary)
    }
}

private fun fingerprint(account: String): String {
    val normalized = account.trim()
    if (normalized.isEmpty()) return ""
    val digest = java.security.MessageDigest.getInstance("SHA-256").digest(normalized.toByteArray(Charsets.UTF_8))
    return digest.joinToString("") { "%02x".format(it) }
}
