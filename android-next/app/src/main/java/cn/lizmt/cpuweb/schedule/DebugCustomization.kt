package cn.lizmt.cpuweb.schedule

import android.content.Intent
import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import cn.lizmt.cpuweb.schedule.agenda.AgendaKind
import cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat
import cn.lizmt.cpuweb.schedule.custom.BackBehavior
import cn.lizmt.cpuweb.schedule.custom.LAYOUT_PRESETS
import cn.lizmt.cpuweb.schedule.custom.TabBarStyle
import cn.lizmt.cpuweb.schedule.custom.TabLabelMode
import cn.lizmt.cpuweb.schedule.custom.UiDensity
import cn.lizmt.cpuweb.schedule.custom.WebTweaks
import cn.lizmt.cpuweb.schedule.update.PatchInfo
import cn.lizmt.cpuweb.schedule.update.ReleaseInfo

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
        if (intent.getBooleanExtra("debugAgenda", false)) seedAgenda(activity)
        if (intent.getBooleanExtra("debugAssistant", false)) seedAssistant(activity)
        intent.getStringExtra("debugUpdate")?.let { kind -> activity.updates.debugShow(sampleState(kind)) }
        intent.getStringExtra("debugSettings")?.let { route -> activity.openSettings(route) }
        // Open the asked-for page, or the launch tab of a layout set above.
        val open = intent.getStringExtra("debugOpen")?.let { activity.customization.value.destination(it) }
            ?: activity.customization.value.launchDestination.takeIf { intent.hasExtra("debugLayout") || intent.hasExtra("debugLaunch") }
        open?.let { destination -> activity.window.decorView.post { activity.shell.open(destination) } }
        if (!intent.getBooleanExtra("debugJustUpdated", false)) activity.updates.dismissJustUpdated()
    }

    /** A week of sample events and to-dos around today, replacing whatever the store held. */
    private fun seedAgenda(activity: MainActivity) {
        val store = activity.agenda
        store.items.forEach { store.remove(it.id) }
        val today = java.time.LocalDate.now()
        val wednesday = today.with(java.time.temporal.TemporalAdjusters.nextOrSame(java.time.DayOfWeek.WEDNESDAY))
        listOf(
            AgendaItem("", AgendaKind.Event, "有机化学实验", today.toString(), "15:00", "16:30", location = "实验楼 B204", remind = 15),
            AgendaItem("", AgendaKind.Todo, "交药理学实验报告", today.toString(), "18:00", remind = 0),
            AgendaItem("", AgendaKind.Todo, "还图书馆的书", today.minusDays(1).toString()),
            AgendaItem("", AgendaKind.Todo, "买实验服"),
            AgendaItem("", AgendaKind.Event, "体检", today.plusDays(1).toString(), location = "校医院"),
            // Over a class of the sample timetable: drawn beside it in the week grid.
            AgendaItem("", AgendaKind.Event, "英语答疑", today.plusDays(1).toString(), "10:00", "10:40", location = "文科楼"),
            AgendaItem("", AgendaKind.Event, "羽毛球", wednesday.toString(), "19:00", "20:30", location = "体育馆", repeat = AgendaRepeat.Weekly),
        ).forEach { store.save(it) }
    }

    /** A short conversation: an item to add, an answer from the exam timetable, and app changes. */
    private fun seedAssistant(activity: MainActivity) {
        val tomorrow = java.time.LocalDate.now().plusDays(1).toString()
        val finals = java.time.LocalDate.now().plusDays(52).toString()
        activity.assistant.debugSeed(listOf(
            AssistantMessage("d1", fromUser = true, text = "明天下午有空吗？帮我约个时间和小组讨论"),
            AssistantMessage(
                "d2", fromUser = false,
                text = "明天下午你 14:00–15:40 有分析化学，16:00 以后就空了。我把小组讨论放在 16:10–17:10，确认后就会添加到日程。",
                proposals = listOf(AssistantProposal("p1", org.json.JSONObject().put("type", "agenda.create").put("item", org.json.JSONObject()
                    .put("kind", "event").put("title", "小组讨论").put("date", tomorrow).put("start", "16:10").put("end", "17:10")
                    .put("location", "图书馆研讨室").put("remind", 15)))),
                suggestions = listOf("再帮我记一下周五交实验报告", "这周还有哪天下午空？"),
            ),
            AssistantMessage("d3", fromUser = true, text = "我这学期的考试都在什么时候？"),
            AssistantMessage(
                "d4", fromUser = false,
                text = "已经排出来的有两门：\n· 药理学：1 月 8 日 9:00–11:00，教学楼 A201，座位 36\n· 分析化学：1 月 10 日 14:00–16:00，教学楼 B305\n其余课程还没有安排，出来以后再问我就好。",
            ),
            AssistantMessage("d5", fromUser = true, text = "课表换成素笺，再在今天页面加个期末倒计时"),
            AssistantMessage(
                "d6", fromUser = false, text = "帮你准备好了两项，确认后就会生效。",
                proposals = listOf(
                    AssistantProposal("p2", org.json.JSONObject().put("type", "schedule.style").put("style", "paper"), ProposalState.Applied, "课表已换成「素笺」"),
                    AssistantProposal("p3", org.json.JSONObject().put("type", "today.add").put("section", "countdown").put("title", "期末考试").put("date", finals)),
                ),
            ),
            AssistantMessage("d7", fromUser = true, text = "帮我发个帖问问周末有没有人一起去图书馆自习"),
            AssistantMessage(
                "d8", fromUser = false, text = "写好了，发在「校园生活」，你看看没问题就发。",
                proposals = listOf(
                    AssistantProposal("p4", org.json.JSONObject().put("type", "forum.post").put("board", "life").put("title", "周末有人一起去图书馆自习吗")
                        .put("content", "这周六周日上午九点到下午五点，打算在图书馆三楼靠窗那片复习药理学，想找两三个同学互相监督。\n不聊天、各学各的，中午可以一起去食堂。有意向的回帖或者私信我～")),
                    AssistantProposal("p5", org.json.JSONObject().put("type", "web.open").put("path", "/forum")),
                ),
            ),
        ))
    }

    private fun sampleState(kind: String): UpdateState {
        val release = ReleaseInfo(
            versionCode = 1002, versionName = "1.0.1", fileName = "CPU-Web-Android-NEXT-V1002.apk",
            size = 14_200_000, sha256 = "0".repeat(64),
            notes = listOf("工作台新增倒计时卡片", "导航栏支持通透玻璃样式", "修复深色模式下网页按钮颜色"),
            downloadUrl = "https://cputime.cn/api/site/downloads/android-next-app",
            patch = PatchInfo(1001, "0".repeat(64), 1_310_000, "0".repeat(64), "https://cputime.cn/api/site/downloads/android-next-patch?from=1001"),
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
