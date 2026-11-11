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
 * `debugPriority`, `debugSheet`, `debugPublished`, `debugShared` and
 * `debugCouple` (`active`, `pending` or `none`).
 */
object DebugScheduleFixture {
    const val EXTRA = "debugMockSchedule"
    private const val SEMESTER = "2026-2027-1"
    private const val FRIEND_CODE = "FRKEND23"
    private const val OWN_CODE = "DEMQ2345"
    private const val OVERLAY_CODE = "LINKS234"
    /** NJMU's fifteen periods: the third is 09:40–10:20 there, 09:55–10:40 here. */
    private val NJMU_BELLS = listOf(
        "08:00" to "08:40", "08:50" to "09:30", "09:40" to "10:20", "10:30" to "11:10", "11:20" to "12:00",
        "12:10" to "12:50", "14:00" to "14:40", "14:50" to "15:30", "15:40" to "16:20", "16:30" to "17:10",
        "17:20" to "18:00", "18:10" to "18:50", "19:00" to "19:40", "19:50" to "20:30", "20:40" to "21:20",
    )

    /** "Now" pinned by `--es debugNow 10:20`, so a state of the day view can be looked at on demand. */
    var pinnedNow: Int? = null
        private set
    /** The shared timetable to open at launch (`--ez debugShared true`). */
    var openSharedCode: String? = null
        private set
    /** The fixture has two courses in one period on purpose; its screenshots stay free of the notice unless asked for. */
    var suppressesOverlapNotice = false
        private set
    private var sheet = ""
    private var published = false
    private var coupleState = "none"
    private var dormState = "none"
    private var dormName = "6 栋 302"
    private var dormMyColor = "teal"
    private var coupleMine = "blue"
    private var coupleTheirs = "pink"
    private var coupleAnniversary = "2025-05-20"
    /**
     * Single-meeting changes of the sample timetable (`--ez debugOccurrences true`):
     * applied to it the way the site does, so 这次停课 and 调整这一次 work offline. Null keeps them off.
     */
    private var occurrences: MutableList<OccurrenceChange>? = null

    fun initialSheet(): ScheduleSheet? = when (sheet) {
        "settings", "visual", "display", "style" -> ScheduleSheet.Settings
        "sharing" -> ScheduleSheet.Sharing
        "couple" -> ScheduleSheet.Couple
        "widgets" -> ScheduleSheet.Widgets
        "dorm" -> ScheduleSheet.Dorm()
        "agenda" -> ScheduleSheet.AgendaList
        "commonFree" -> ScheduleSheet.CommonFree
        "overlay" -> ScheduleSheet.Overlay
        "agendaNew" -> ScheduleSheet.AgendaEdit(newAgendaDraft(java.time.LocalDate.now().toString(), "14:00"))
        // 截图识别 with the fixture's sample reading (needs debugAgenda for the frozen remote).
        "agendaExtract" -> ScheduleSheet.AgendaEdit(newAgendaDraft(""), AgendaSource.Text("debug"))
        else -> null
    }

    /** Applies the screenshot extras of a debug launch. Nothing here runs in a release build. */
    /** Sample 日程 around today, the same set as 药大拾间 NEXT's fixture. */
    private fun sampleAgenda(): List<cn.lizmt.cpuweb.schedule.agenda.AgendaItem> {
        val today = java.time.LocalDate.now()
        val wednesday = today.with(java.time.temporal.TemporalAdjusters.nextOrSame(java.time.DayOfWeek.WEDNESDAY))
        fun item(id: String, title: String, date: String, start: String = "", end: String = "", location: String = "", repeat: cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat = cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat.None) =
            cn.lizmt.cpuweb.schedule.agenda.AgendaItem(id, cn.lizmt.cpuweb.schedule.agenda.AgendaKind.Event, title, date, start, end, location, repeat = repeat, createdAt = 1)
        return listOf(
            item("debugagenda01", "有机化学实验", today.toString(), "15:00", "16:30", "实验楼 B204"),
            item("debugagenda02", "交药理学实验报告", today.toString()),
            item("debugagenda03", "体检", today.plusDays(1).toString(), location = "校医院"),
            // Over a class of the sample timetable: drawn beside it in the week grid.
            item("debugagenda04", "英语答疑", today.plusDays(1).toString(), "10:00", "10:40", "文科楼"),
            item("debugagenda05", "羽毛球", wednesday.toString(), "19:00", "20:30", "体育馆", cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat.Weekly),
            // At the same time as Wednesday's classes: a bar on the class's border, and listed in its quick look.
            item("debugagenda06", "生物化学小测", wednesday.toString(), "08:20", "08:40", "药学楼 105"),
        )
    }

    fun configure(activity: MainActivity, intent: Intent) {
        intent.getStringExtra("debugStyle")?.let { activity.style.selectVisualStyle(ScheduleVisualStyle.fromId(it)) }
        if (intent.getBooleanExtra("debugAgenda", false)) activity.agenda.debugSeed(sampleAgenda())
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
        // Monday's first course is cancelled this week and Tuesday's moved to Thursday evening.
        occurrences = if (!intent.getBooleanExtra("debugOccurrences", false)) null else {
            val week = JSONObject(snapshot()).getJSONObject("calendar").getJSONArray("weeks").getJSONObject(3).getJSONArray("days")
            mutableListOf(
                OccurrenceChange("debug|药理学|1", week.getString(0), cancelled = true),
                OccurrenceChange("debug|大学英语 III|3", week.getString(1), toDate = week.getString(3), startSlot = 9, endSlot = 10, location = "教学楼 B305"),
            )
        }
        if (occurrences != null) activity.schedule.load(true)
        suppressesOverlapNotice = !intent.getBooleanExtra("debugOverlapNotice", false)
        coupleState = intent.getStringExtra("debugCouple")?.takeIf { it == "active" || it == "pending" } ?: "none"
        dormState = if (intent.getStringExtra("debugDorm") == "active") "active" else "none"
        // "debugCoupleColors teal,amber": the user's colour, then the partner's.
        intent.getStringExtra("debugCoupleColors")?.split(',')?.takeIf { it.size == 2 }?.let { (mine, theirs) ->
            coupleMine = mine.trim()
            coupleTheirs = theirs.trim()
        }
        val friend = SharedSchedule.read(shareDocument(FRIEND_CODE, "小王"), System.currentTimeMillis()).copy(remark = "室友小王")
        activity.sharing.installDebugState(
            SharedScheduleLibrary(account = "debug", schedules = listOf(friend)),
            if (published) listOf(ShareMeta(OWN_CODE, "我", SEMESTER, friend.courseCount, updatedAt = "2026-10-07T02:00:00.000Z")) else emptyList(),
        )
        openSharedCode = if (intent.getBooleanExtra("debugShared", false)) FRIEND_CODE else null
        // "debugOverlay njmu": a classmate at NJMU, whose bells differ, laid over the timetable; "same" keeps this school's bells.
        intent.getStringExtra("debugOverlay")?.let { kind ->
            val classmate = SharedSchedule.read(shareDocument(OVERLAY_CODE, "小林", njmu = kind == "njmu"), System.currentTimeMillis()).copy(remark = "小林")
            activity.sharing.installDebugState(
                SharedScheduleLibrary(account = "debug", schedules = listOf(friend, classmate)), activity.sharing.mine,
            )
            activity.overlay.select(OVERLAY_CODE)
        }
        // "debugUpdate available|ready|updated": the update sheet or 更新完成 with sample notes.
        intent.getStringExtra("debugUpdate")?.let { kind ->
            activity.updates.debugSample(kind, listOf(
                "以后可以在 App 里直接更新，只下载变化的部分；每次更新前后都会告诉你这次改了什么。",
                "桌面小组件跨天不再停在前一天，重启手机或改了时间后也会自动刷新。",
                "小组件设置里新增“保持小组件准时”，一键打开省电和自启动设置。",
            ))
            if (kind != "updated") activity.updateSheetOpen = true
        }
    }

    /**
     * A stand-in for `/api/dorm`: the user and three roommates, each with part of the sample
     * timetable so the free-time views have something to show; 小周 never synced.
     */
    fun dorm(payload: JSONObject): String {
        val synced = JSONObject().put("semester", SEMESTER).put("syncedAt", "2026-10-08T01:30:00.000Z").put("changedAt", "2026-10-07T02:00:00.000Z")
        val people = listOf(Triple(1, "阿青", dormMyColor), Triple(2, "小王", "pink"), Triple(3, "老李", "amber"), Triple(4, "小周", "purple"))
        fun member(id: Int, name: String, color: String) = JSONObject().put("id", id).put("nickname", name).put("color", color)
            .put("avatar", JSONObject.NULL).put("isOwner", id == 1).put("snapshot", if (id == 4) JSONObject.NULL else synced)
        fun status(): JSONObject = if (dormState != "active") JSONObject().put("status", "none") else JSONObject().put("status", "active")
            .put("id", 9).put("name", dormName).put("memberLimit", 6).put("isOwner", true).put("since", "2026-09-01T02:00:00.000Z")
            .put("invite", JSONObject().put("code", "D6K3PQ").put("expiresAt", "2099-01-01T00:00:00.000Z").put("expired", false))
            .put("me", member(1, "阿青", dormMyColor))
            .put("members", JSONArray(people.map { (id, name, color) -> member(id, name, color) }))
        val data: JSONObject = when (payload.optString("action")) {
            "invite", "join" -> { dormState = "active"; status() }
            "leave" -> { dormState = "none"; status() }
            "settings" -> {
                val body = payload.optJSONObject("body") ?: JSONObject()
                if (body.has("myColor")) dormMyColor = body.optString("myColor")
                if (body.has("name")) dormName = if (body.isNull("name")) "" else body.optString("name")
                status()
            }
            "schedules" -> {
                val snapshot = JSONObject(snapshot())
                val cells = snapshot.getJSONObject("data").getJSONArray("cells")
                fun cellsFor(id: Int) = JSONArray((0 until cells.length()).map { cells.getJSONObject(it) }.filterIndexed { index, cell ->
                    when (id) { 2 -> index % 2 == 0; 3 -> cell.optInt("day") >= 3; else -> true }
                })
                JSONObject().put("members", JSONArray(people.map { (id, name, color) ->
                    JSONObject().put("id", id).put("nickname", name).put("color", color).put("snapshot", if (id == 4) JSONObject.NULL else
                        JSONObject(synced.toString()).put("schedule", JSONObject().put("cells", cellsFor(id)))
                            .put("calendar", snapshot.getJSONObject("calendar")))
                }))
            }
            "sync" -> JSONObject().put("changed", false)
            else -> status()
        }
        return JSONObject().put("data", data).toString()
    }

    private fun shareDocument(code: String, owner: String, njmu: Boolean = false): JSONObject {
        val snapshot = JSONObject(snapshot())
        val data = snapshot.getJSONObject("data")
        val calendar = snapshot.getJSONObject("calendar")
        var cells = data.getJSONArray("cells")
        if (code == OVERLAY_CODE) {
            // A classmate: some courses shared, some of their own, at their own periods.
            val all = (1..18).toList()
            fun course(name: String, start: Int, end: Int, location: String) = JSONObject().put("name", name).put("startSlot", start)
                .put("endSlot", end).put("location", location).put("weeks", ScheduleStore.weekText(all)).put("weekList", JSONArray(all))
            fun cell(day: Int, value: JSONObject) = JSONObject().put("day", day).put("bigSlot", (value.getInt("startSlot") + 1) / 2)
                .put("courses", JSONArray().put(value))
            cells = JSONArray()
                .put(cell(1, course("药理学", 1, 2, "药学楼 302")))
                .put(cell(2, course("病理学", 3, 4, "基础楼 B201")))
                .put(cell(3, course("系统解剖学", 7, 8, "解剖楼 101")))
                .put(cell(3, course("组织胚胎学", 7, 8, "基础楼 A105")))
                .put(cell(4, course("医学免疫学", 1, 3, "基础楼 C302")))
                .put(cell(5, course("诊断学", 9, 10, "临床楼 401")))
        }
        if (njmu) {
            calendar.put("school", "南京医科大学").put("periods", JSONArray(NJMU_BELLS.mapIndexed { index, (start, end) ->
                JSONObject().put("number", index + 1).put("startTime", start).put("endTime", end)
            }))
        }
        return JSONObject().put("code", code).put("owner", owner).put("semester", SEMESTER).put("courseCount", 8)
            .put("createdAt", "2026-10-01T02:00:00.000Z").put("updatedAt", "2026-10-07T02:00:00.000Z")
            .put("schedule", JSONObject().put("cells", cells))
            .put("calendar", calendar)
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

    /** A stand-in for `/api/couple`: a partner whose timetable meets the user's in every way the grid draws. */
    fun couple(payload: JSONObject): String {
        fun status(): JSONObject = when (coupleState) {
            "pending" -> JSONObject().put("status", "pending")
                .put("invite", JSONObject().put("code", "K7M2QX").put("expiresAt", "2099-01-01T00:00:00.000Z").put("expired", false))
            "active" -> {
                val synced = JSONObject().put("semester", SEMESTER).put("syncedAt", "2026-10-08T01:30:00.000Z").put("changedAt", "2026-10-07T02:00:00.000Z")
                JSONObject().put("status", "active").put("since", "2026-09-01T02:00:00.000Z")
                    .put("anniversary", if (coupleAnniversary.isEmpty()) JSONObject.NULL else coupleAnniversary)
                    .put("me", JSONObject().put("id", 1).put("color", coupleMine).put("nickname", "阿青").put("snapshot", synced))
                    .put("partner", JSONObject().put("id", 2).put("color", coupleTheirs).put("nickname", "小鹿").put("snapshot", synced))
            }
            else -> JSONObject().put("status", "none")
        }
        val data: JSONObject = when (payload.optString("action")) {
            "invite" -> { coupleState = "pending"; status() }
            "cancelInvite", "unbind" -> { coupleState = "none"; status() }
            "accept" -> { coupleState = "active"; status() }
            "settings" -> {
                val body = payload.optJSONObject("body") ?: JSONObject()
                if (body.has("myColor")) {
                    // Picking the partner's colour swaps the two, as the server does.
                    val picked = body.optString("myColor")
                    if (picked == coupleTheirs) coupleTheirs = coupleMine
                    coupleMine = picked
                }
                if (body.has("anniversary")) coupleAnniversary = if (body.isNull("anniversary")) "" else body.optString("anniversary")
                status()
            }
            "schedules" -> {
                val all = (1..18).toList()
                fun course(name: String, start: Int, end: Int, location: String) = JSONObject().put("name", name).put("startSlot", start)
                    .put("endSlot", end).put("location", location).put("teacher", "").put("weeks", ScheduleStore.weekText(all)).put("weekList", JSONArray(all))
                fun cell(day: Int, slot: Int, value: JSONObject) = JSONObject().put("day", day).put("bigSlot", slot).put("courses", JSONArray().put(value))
                // Monday: the same class. Tuesday and Thursday: classes that meet the user's. The rest: hers alone.
                val cells = JSONArray()
                    .put(cell(1, 1, course("药理学", 1, 2, "药学楼 302")))
                    .put(cell(2, 2, course("高等数学", 3, 4, "理科楼 B105")))
                    .put(cell(3, 2, course("物理化学", 3, 4, "药学楼 210")))
                    .put(cell(4, 3, course("分析化学实验", 5, 7, "实验楼 305")))
                    .put(cell(5, 1, course("医用物理学", 1, 2, "理科楼 A301")))
                    .put(cell(7, 2, course("周日社团：合唱", 3, 4, "大学生活动中心")))
                val calendar = JSONObject(snapshot()).getJSONObject("calendar")
                JSONObject().put("me", JSONObject.NULL).put("partner", JSONObject().put("semester", SEMESTER)
                    .put("syncedAt", "2026-10-08T01:30:00.000Z").put("changedAt", "2026-10-07T02:00:00.000Z")
                    .put("schedule", JSONObject().put("cells", cells)).put("calendar", calendar))
            }
            "sync" -> JSONObject().put("changed", false)
            else -> status()
        }
        return JSONObject().put("data", data).toString()
    }

    /** 这次停课 / 调整这一次 / 恢复原安排 on the sample timetable: what the editor bridge does with the site. */
    fun changeOccurrence(keys: List<String>, date: String, changes: List<OccurrenceChange>) {
        val list = occurrences ?: mutableListOf<OccurrenceChange>().also { occurrences = it }
        list.removeAll { it.key in keys && it.date == date }
        list += changes
    }

    /** The site's `applyOccurrenceChanges` for the sample: a cancelled week leaves the course, a moved meeting is a one-week course. */
    private fun applyOccurrences(cells: JSONArray, weeks: JSONArray) {
        val changes = occurrences ?: return
        fun place(date: String): Pair<Int, Int>? {
            for (index in 0 until weeks.length()) {
                val days = weeks.getJSONObject(index).getJSONArray("days")
                for (day in 0 until days.length()) if (days.getString(day) == date) return weeks.getJSONObject(index).getInt("week") to day + 1
            }
            return null
        }
        for (change in changes) {
            val (week, day) = place(change.date) ?: continue
            var original: JSONObject? = null
            for (index in 0 until cells.length()) {
                val cell = cells.getJSONObject(index)
                if (cell.getInt("day") != day) continue
                val courses = cell.getJSONArray("courses")
                for (position in 0 until courses.length()) {
                    val course = courses.getJSONObject(position)
                    if (course.optString("sourceKey") != change.key) continue
                    val list = course.getJSONArray("weekList")
                    val kept = (0 until list.length()).map { list.getInt(it) }.filter { it != week }
                    original = JSONObject(course.toString())
                    course.put("sourceWeeks", course.optString("weeks")).put("weekList", JSONArray(kept)).put("weeks", ScheduleStore.weekText(kept))
                }
            }
            val source = original ?: continue
            if (change.cancelled) continue
            val (targetWeek, targetDay) = place(change.toDate ?: change.date) ?: continue
            val start = change.startSlot ?: source.getInt("startSlot")
            val end = change.endSlot ?: source.getInt("endSlot")
            val moved = JSONObject(source.toString()).put("weekList", JSONArray(listOf(targetWeek))).put("weeks", "第 $targetWeek 周")
                .put("startSlot", start).put("endSlot", end).put("occurrenceKey", change.key).put("occurrenceFrom", change.date)
                .put("nativeId", "occ:${change.key}@${change.date}").put("editKeys", JSONArray())
            moved.remove("sourceKey")
            change.location?.let { moved.put("location", it) }
            change.note?.let { moved.put("slotNote", it) }
            cells.put(JSONObject().put("day", targetDay).put("bigSlot", (start + 1) / 2).put("courses", JSONArray().put(moved)))
        }
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
            .put("editKeys", JSONArray().put("debug|$name|$start"))
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
        applyOccurrences(cells, weeks)
        return JSONObject()
            .put("version", 1).put("source", "jwxt").put("completeSemester", true).put("fetchedAt", System.currentTimeMillis())
            .put("data", JSONObject()
                .put("currentSemester", SEMESTER).put("currentWeek", "4")
                .put("semesters", JSONArray().put(JSONObject().put("value", SEMESTER).put("label", "2026-2027 学年第一学期").put("current", true)))
                .put("weeks", JSONArray(all.map { JSONObject().put("value", "$it").put("label", "第${it}周").put("current", it == 4) }))
                .put("cells", cells))
            .put("calendar", JSONObject().put("currentWeek", 4).put("currentSemester", SEMESTER).put("weeks", weeks))
            .put("auth", JSONObject().put("authenticated", true).put("account", "debug"))
            .apply { occurrences?.let { put("occurrenceChanges", OccurrenceChange.toJsonArray(it)) } }
            .toString()
    }
}
