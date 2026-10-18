package cn.lizmt.cpuweb.schedule

import android.content.Intent
import cn.lizmt.cpuweb.schedule.custom.BackBehavior
import cn.lizmt.cpuweb.schedule.custom.LAYOUT_PRESETS
import cn.lizmt.cpuweb.schedule.custom.TabBarStyle
import cn.lizmt.cpuweb.schedule.custom.TabLabelMode
import cn.lizmt.cpuweb.schedule.custom.UiDensity
import cn.lizmt.cpuweb.schedule.custom.WebTweaks
import cn.lizmt.cpuweb.schedule.update.PatchInfo
import cn.lizmt.cpuweb.schedule.update.ReleaseInfo
import cn.lizmt.cpuweb.schedule.update.UpdateChannel

/**
 * Debug builds with `debugMockSchedule` only: put the customization, settings
 * and updater into a given state for emulator screenshots (see android/README.md).
 */
object DebugCustomization {
    fun configure(activity: MainActivity, intent: Intent) {
        if (!BuildConfig.DEBUG) return
        val store = activity.customization
        if (intent.getBooleanExtra("debugResetCustom", false)) store.reset()
        // Existing timetable screenshot runs never see the one-time introduction.
        if (intent.getBooleanExtra("debugIntro", false)) store.replayIntro() else store.markIntroSeen()
        intent.getStringExtra("debugLayout")?.let { id -> LAYOUT_PRESETS.firstOrNull { it.id == id }?.let { store.update(it.apply) } }
        // A device shell drops "#…" as a comment, so a bare six-digit colour is accepted too.
        intent.getStringExtra("debugAccent")?.let { accent ->
            store.update { it.copy(accent = if (Regex("^[0-9A-Fa-f]{6}$").matches(accent)) "#$accent" else accent) }
        }
        if (intent.hasExtra("debugBlack")) store.update { it.copy(pureBlack = intent.getBooleanExtra("debugBlack", false)) }
        intent.getStringExtra("debugTabStyle")?.let { style -> store.update { it.copy(tabBarStyle = TabBarStyle.of(style)) } }
        intent.getStringExtra("debugLabels")?.let { mode -> store.update { it.copy(tabLabels = TabLabelMode.of(mode)) } }
        intent.getStringExtra("debugDensity")?.let { density -> store.update { it.copy(density = UiDensity.of(density)) } }
        intent.getStringExtra("debugBack")?.let { back -> store.update { it.copy(backAtRoot = BackBehavior.of(back)) } }
        intent.getStringExtra("debugTabs")?.let { tabs -> store.update { it.copy(tabs = tabs.split(',').map(String::trim)) } }
        intent.getStringExtra("debugLaunch")?.let { id -> store.update { it.copy(launchTab = id) } }
        if (intent.hasExtra("debugCorners")) store.update { it.copy(corners = intent.getFloatExtra("debugCorners", 1f)) }
        intent.getStringExtra("debugTweaks")?.let { tweaks ->
            store.update { it.copy(webTweaks = tweaks.split(',').map(String::trim).filter { id -> id in WebTweaks.ids }.toSet()) }
        }
        intent.getStringExtra("debugGreeting")?.let { name -> store.update { it.copy(dashboard = it.dashboard.copy(greetingName = name)) } }
        if (intent.getBooleanExtra("debugNext", false)) activity.updates.debugChannel(UpdateChannel.Beta)
        intent.getStringExtra("debugUpdate")?.let { kind -> activity.updates.debugShow(sampleState(kind)) }
        intent.getStringExtra("debugSettings")?.let { route -> activity.openSettings(route) }
        // Open the asked-for page, or the launch tab of a layout set above.
        val open = intent.getStringExtra("debugOpen")?.let { activity.customization.value.destination(it) }
            ?: activity.customization.value.launchDestination.takeIf { intent.hasExtra("debugLayout") || intent.hasExtra("debugLaunch") }
        open?.let { destination -> activity.window.decorView.post { activity.shell.open(destination) } }
        if (!intent.getBooleanExtra("debugJustUpdated", false)) activity.updates.dismissJustUpdated()
    }

    private fun sampleState(kind: String): UpdateState {
        val release = ReleaseInfo(
            channel = UpdateChannel.Beta, versionCode = 61, versionName = "4.1.1", fileName = "CPU-Web-Android-V61.apk",
            size = 14_200_000, sha256 = "0".repeat(64),
            notes = listOf("工作台新增倒计时卡片", "导航栏支持通透玻璃样式", "修复深色模式下网页按钮颜色"),
            downloadUrl = "https://cputime.cn/api/site/downloads/android-app?channel=beta",
            patch = PatchInfo(60, "0".repeat(64), 1_310_000, "0".repeat(64), "https://cputime.cn/api/site/downloads/android-patch?channel=beta&from=60"),
            betaVersionName = null,
        )
        return when (kind) {
            "available" -> UpdateState.Available(release)
            "downloading" -> UpdateState.Downloading(release, true, 820_000, 1_310_000)
            "ready" -> UpdateState.Ready(release, viaPatch = true, savedBytes = release.size - 1_310_000)
            "failed" -> UpdateState.Failed("下载失败，请稍后重试", release)
            else -> UpdateState.UpToDate(release)
        }
    }
}
