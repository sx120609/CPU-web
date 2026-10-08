package cn.lizmt.cpuweb.schedule

import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale

/**
 * Debug-only timetable, the counterpart of iOS `CPU_DEBUG_MOCK_SCHEDULE`.
 * Start a debug build with `--ez debugMockSchedule true` to inspect the
 * native grid, overlaps and long room names without a school session.
 *
 * Further extras put the fixture in a given state for a screenshot (see the
 * README): `debugStyle`, `debugView`, `debugDay`, `debugNow`,
 * `debugPriority`, `debugSheet`, `debugPublished` and `debugShared`.
 */
object DebugScheduleFixture {
    const val EXTRA = "debugMockSchedule"
    private const val SEMESTER = "2026-2027-1"
    private const val FRIEND_CODE = "FRKEND23"
    private const val OWN_CODE = "DEMQ2345"

    /** "Now" pinned by `--es debugNow 10:20`, so a state of the day view can be looked at on demand. */
    var pinnedNow: Int? = null
        private set
    /** The shared timetable to open at launch (`--ez debugShared true`). */
    var openSharedCode: String? = null
        private set
    private var sheet = ""
    private var published = false

    fun initialSheet(): ScheduleSheet? = when (sheet) {
        "visual" -> ScheduleSheet.VisualStyle
        "display" -> ScheduleSheet.Display
        "style" -> ScheduleSheet.Style
        "sharing" -> ScheduleSheet.Sharing
        else -> null
    }

    /** Applies the screenshot extras of a debug launch. Nothing here runs in a release build. */
    fun configure(activity: MainActivity, intent: Intent) {
        intent.getStringExtra("debugStyle")?.let { activity.style.selectVisualStyle(ScheduleVisualStyle.fromId(it)) }
        intent.getStringExtra("debugView")?.let { activity.schedule.selectViewMode(it) }
        intent.getIntExtra("debugDay", 0).takeIf { it in 1..7 }?.let { activity.schedule.selectDay(it) }
        pinnedNow = intent.getStringExtra("debugNow")?.let(ScheduleStyleTime::clockMinutes)
        sheet = intent.getStringExtra("debugSheet").orEmpty()
        // Display settings for a screenshot, e.g. "sundayFirst,offWeek,teacher,rows=140".
        intent.getStringExtra("debugDisplay")?.split(',')?.map { it.trim() }?.let { flags ->
            val style = activity.style
            style.resetDisplay()
            style.updateSundayFirst("sundayFirst" in flags)
            style.updateShowOffWeek("offWeek" in flags)
            style.updateShowTeacher("teacher" in flags)
            style.updateCompactLayout("compact" in flags)
            style.updateShowSlotTime("noTime" !in flags)
            style.updateShowSaturday("noSaturday" !in flags)
            style.updateShowSunday("noSunday" !in flags)
            style.updateShowBackToWeek("noToday" !in flags)
            style.selectTextSize(flags.firstOrNull { it == "small" || it == "large" } ?: "standard")
            flags.firstOrNull { it.startsWith("rows=") }?.removePrefix("rows=")?.toIntOrNull()?.let(style::updateRowHeight)
        }
        // Names in display order: the first one is in front.
        intent.getStringExtra("debugPriority")?.split(',')?.map { SchedulePriority.key(it) }?.filter { it.isNotEmpty() }?.let { names ->
            activity.schedule.setPriorities(SEMESTER, names.mapIndexed { index, name -> name to names.size - index }.toMap())
        }
        published = intent.getBooleanExtra("debugPublished", false)
        val friend = SharedSchedule.read(shareDocument(FRIEND_CODE, "小王"), System.currentTimeMillis()).copy(remark = "室友小王")
        activity.sharing.installDebugState(
            SharedScheduleLibrary(account = "debug", schedules = listOf(friend)),
            if (published) listOf(ShareMeta(OWN_CODE, "我", SEMESTER, friend.courseCount, updatedAt = "2026-10-07T02:00:00.000Z")) else emptyList(),
        )
        openSharedCode = if (intent.getBooleanExtra("debugShared", false)) FRIEND_CODE else null
    }

    private fun shareDocument(code: String, owner: String): JSONObject {
        val snapshot = JSONObject(snapshot())
        val data = snapshot.getJSONObject("data")
        return JSONObject().put("code", code).put("owner", owner).put("semester", SEMESTER).put("courseCount", 8)
            .put("createdAt", "2026-10-01T02:00:00.000Z").put("updatedAt", "2026-10-07T02:00:00.000Z")
            .put("schedule", JSONObject().put("cells", data.getJSONArray("cells")))
            .put("calendar", snapshot.getJSONObject("calendar"))
    }

    /** A stand-in for `/api/schedule-shares`, so the sharing pages work without an account. */
    fun shares(payload: JSONObject): String {
        val code = payload.optString("code")
        fun meta(value: String, owner: String) = shareDocument(value, owner).apply { remove("schedule"); remove("calendar") }
        val data: JSONObject? = when (payload.optString("action")) {
            "mine" -> JSONObject().put("shares", JSONArray().apply { if (published) put(meta(OWN_CODE, "我")) })
            "publish" -> meta(OWN_CODE, "我").put("created", !published).put("changed", !published).also { published = true }
            "revoke" -> JSONObject().put("ok", true).also { published = false }
            "meta" -> if (code == FRIEND_CODE) meta(code, "小王") else null
            "get" -> if (code == FRIEND_CODE) shareDocument(code, "小王") else null
            else -> null
        }
        return (if (data == null) JSONObject().put("error", "分享课表不存在或已撤销").put("status", 404) else JSONObject().put("data", data)).toString()
    }

    /** A complete term whose week 4 is the current week. */
    fun snapshot(): String {
        val calendar = Calendar.getInstance()
        val weekday = calendar.get(Calendar.DAY_OF_WEEK)
        calendar.add(Calendar.DAY_OF_YEAR, if (weekday == Calendar.SUNDAY) -6 else Calendar.MONDAY - weekday)
        val weeks = JSONArray()
        val base = calendar.clone() as Calendar
        base.add(Calendar.DAY_OF_YEAR, -21)
        for (number in 1..18) {
            val days = JSONArray()
            for (offset in 0 until 7) {
                val day = base.clone() as Calendar
                day.add(Calendar.DAY_OF_YEAR, (number - 1) * 7 + offset)
                days.put(String.format(Locale.US, "%04d-%02d-%02d", day.get(Calendar.YEAR), day.get(Calendar.MONTH) + 1, day.get(Calendar.DAY_OF_MONTH)))
            }
            weeks.put(JSONObject().put("week", number).put("days", days).put("monday", days.getString(0)).put("sunday", days.getString(6)))
        }
        fun course(name: String, start: Int, end: Int, location: String, teacher: String, list: List<Int>) = JSONObject()
            .put("name", name).put("startSlot", start).put("endSlot", end).put("location", location).put("teacher", teacher)
            .put("weeks", ScheduleStore.weekText(list)).put("weekList", JSONArray(list)).put("sourceKey", "debug|$name|$start")
        val all = (1..18).toList()
        val odd = all.filter { it % 2 == 1 }
        fun cell(day: Int, slot: Int, vararg courses: JSONObject) =
            JSONObject().put("day", day).put("bigSlot", slot).put("courses", JSONArray(courses.toList()))
        val cells = JSONArray()
            .put(cell(1, 1, course("药理学", 1, 2, "药学楼 302", "王老师", all)))
            .put(cell(1, 3, course("有机化学实验", 5, 7, "艺术固定教室 YS403", "李老师", odd)))
            .put(cell(2, 2, course("大学英语 III", 3, 4, "文科楼 A201", "陈老师", all)))
            .put(cell(3, 1, course("生物化学", 1, 2, "药学楼 105", "周老师", all), course("体育（羽毛球）", 1, 2, "体育馆", "赵老师", all)))
            .put(cell(4, 3, course("药物分析", 5, 6, "实验楼 201", "孙老师", all)))
            .put(cell(5, 5, course("形势与政策", 9, 10, "图书馆报告厅", "吴老师", odd)))
            .put(cell(6, 2, course("周末选修：中药鉴定", 3, 4, "中药标本馆", "郑老师", all)))
        return JSONObject()
            .put("version", 1).put("source", "jwxt").put("completeSemester", true).put("fetchedAt", System.currentTimeMillis())
            .put("data", JSONObject()
                .put("currentSemester", SEMESTER).put("currentWeek", "4")
                .put("semesters", JSONArray().put(JSONObject().put("value", SEMESTER).put("label", "2026-2027 学年第一学期").put("current", true)))
                .put("weeks", JSONArray(all.map { JSONObject().put("value", "$it").put("label", "第${it}周").put("current", it == 4) }))
                .put("cells", cells))
            .put("calendar", JSONObject().put("currentWeek", 4).put("currentSemester", SEMESTER).put("weeks", weeks))
            .put("auth", JSONObject().put("authenticated", true).put("account", "debug"))
            .toString()
    }
}
