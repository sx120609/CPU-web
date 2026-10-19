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
        if (!web.authState.authenticated) return
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
        Text(
            if (widgets.ready) "小组件读取本机保存的课表，放假和调课安排与课表页一致，上下课时自动更新。"
            else "加载本学期课表后，小组件会自动同步，可显示临近课程、今日课表或两日课表。",
            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(14.dp))
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
                "示例课程，同步后显示你的课表", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
        Spacer(Modifier.height(16.dp))
        Text("课程配色", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(8.dp))
        PaletteChoices(widgets.theme) { widgets.selectTheme(it) }
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = { widgets.refresh(activity.schedule, activity.web) },
            modifier = Modifier.fillMaxWidth().heightIn(min = 46.dp),
        ) { Text("刷新小组件") }
        if (widgets.canPin()) {
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = {
                    if (!widgets.pin(selected)) activity.toast("请长按桌面空白处，在小组件中添加“药大课表”")
                },
                modifier = Modifier.fillMaxWidth().heightIn(min = 46.dp),
            ) { Text("添加“${selected.title} ${selected.size}”到桌面") }
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
            Text("编辑桌面小组件", style = MaterialTheme.typography.titleSmall)
            Text("每个小组件可以分别设置显示方式和课程信息。", fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            installed.forEachIndexed { index, (kind, id) ->
                androidx.compose.material3.TextButton(onClick = {
                    activity.startActivity(Intent(activity, ScheduleWidgetConfigureActivity::class.java)
                        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
                }, modifier = Modifier.fillMaxWidth()) {
                    Text("${kind.title} ${kind.size} · ${index + 1}")
                }
            }
            Spacer(Modifier.height(12.dp))
        }
        Text("手动添加", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(4.dp))
        Text("长按桌面空白处，选择“小组件”，找到“药大拾间”后拖到桌面。长按已添加的小组件可编辑设置；也可从这里编辑。课表只保存在本机，退出登录时删除。",
            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun fingerprint(account: String): String {
    val normalized = account.trim()
    if (normalized.isEmpty()) return ""
    val digest = java.security.MessageDigest.getInstance("SHA-256").digest(normalized.toByteArray(Charsets.UTF_8))
    return digest.joinToString("") { "%02x".format(it) }
}
