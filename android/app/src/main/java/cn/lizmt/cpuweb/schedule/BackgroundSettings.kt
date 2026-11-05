package cn.lizmt.cpuweb.schedule

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

/*
 * The same file is in android/ and android-next/: the system switches that keep
 * phones from stopping the app in the background, used by the widget settings
 * (and, in NEXT, by 提醒检查).
 */

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

object BatterySettings {
    /** The system does not hold the app back to save battery (MIUI's 省电策略 and the like are separate). */
    fun unrestricted(context: Context): Boolean =
        (context.getSystemService(Context.POWER_SERVICE) as? PowerManager)
            ?.isIgnoringBatteryOptimizations(context.packageName) ?: true

    /** Asks for "不限制" in one tap where the app may ask, else opens the system list. */
    fun open(context: Context) {
        val details = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
        val canAsk = context.checkSelfPermission(Manifest.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS) ==
            PackageManager.PERMISSION_GRANTED
        val attempts = listOfNotNull(
            if (canAsk) Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")) else null,
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            details,
        )
        for (intent in attempts) {
            if (runCatching { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess) return
        }
    }
}

/**
 * Where each phone maker keeps the switches that stop it from killing apps in
 * the background (自启动, 后台运行, 耗电管理). The pages are not public APIs and
 * move between system versions, so each brand lists several and the app
 * details page is the fallback.
 */
object VendorSettings {
    /** [stepsTemplate] names the app as `{app}`; [steps] fills it in. */
    data class Brand(val name: String, private val stepsTemplate: String, val pages: List<ComponentName>) {
        fun steps(context: Context): String = stepsTemplate.replace("{app}", appLabel(context))
    }

    /** The name under the launcher icon. */
    fun appLabel(context: Context): String = runCatching {
        val pm = context.packageManager
        pm.getActivityInfo(ComponentName(context, MainActivity::class.java), 0).loadLabel(pm).toString()
    }.getOrNull()?.takeIf { it.isNotBlank() } ?: context.applicationInfo.loadLabel(context.packageManager).toString()

    fun current(): Brand? {
        val maker = (Build.MANUFACTURER.orEmpty() + " " + Build.BRAND.orEmpty()).lowercase()
        return when {
            listOf("xiaomi", "redmi", "poco").any { it in maker } -> Brand(
                "小米", "设置 → 应用设置 → 应用管理 → {app}：打开“自启动”，“省电策略”选“无限制”；在最近任务里把{app}往下拉锁住。",
                listOf(
                    ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
                    ComponentName("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"),
                ),
            )
            "honor" in maker -> Brand(
                "荣耀", "设置 → 应用和服务 → 应用启动管理 → {app}：关闭“自动管理”，打开自启动、关联启动、后台活动；在多任务界面下拉锁住{app}。",
                listOf(
                    ComponentName("com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                    ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                ),
            )
            "huawei" in maker -> Brand(
                "华为", "设置 → 应用和服务 → 应用启动管理 → {app}：关闭“自动管理”，打开自启动、关联启动、后台活动；在多任务界面下拉锁住{app}。",
                listOf(
                    ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                    ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity"),
                    ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"),
                ),
            )
            listOf("oppo", "realme", "oneplus").any { it in maker } -> Brand(
                "OPPO / 一加 / realme", "设置 → 应用 → 应用管理 → {app}：打开“允许自动启动”“允许后台运行”，耗电管理里允许后台高耗电。",
                listOf(
                    ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
                    ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
                    ComponentName("com.oplus.safecenter", "com.oplus.safecenter.permission.startup.StartupAppListActivity"),
                    ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
                ),
            )
            listOf("vivo", "iqoo").any { it in maker } -> Brand(
                "vivo / iQOO", "i管家 → 应用管理 → 权限管理 → 自启动，打开{app}；设置 → 电池 → 后台耗电管理里选“允许后台高耗电”。",
                listOf(
                    ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
                    ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
                    ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"),
                ),
            )
            "meizu" in maker -> Brand("魅族", "手机管家 → 权限管理 → 后台管理，把{app}设为允许后台运行。",
                listOf(ComponentName("com.meizu.safe", "com.meizu.safe.permission.SmartBGActivity")))
            "samsung" in maker -> Brand("三星", "设置 → 电池 → 后台使用限制，把{app}加入“永不休眠的应用”。",
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
