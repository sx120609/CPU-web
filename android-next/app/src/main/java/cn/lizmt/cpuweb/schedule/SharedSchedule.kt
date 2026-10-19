package cn.lizmt.cpuweb.schedule

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.GregorianCalendar
import java.util.Locale
import java.util.TimeZone

/*
 * Shared timetables, ported from the iOS `NativeSharedSchedule`: the share
 * code of one's own semester, and the timetables other people shared, which
 * are kept whole on this device and open read-only.
 */

/** What the server says about a share without the timetable itself. */
data class ShareMeta(
    val code: String,
    val owner: String = "",
    val semester: String = "",
    val courseCount: Int = 0,
    val createdAt: String = "",
    val updatedAt: String = "",
) {
    /** The publisher's nickname, when they shared under one ("同学" is the server's placeholder). */
    val ownerName: String?
        get() = owner.trim().takeIf { it.isNotEmpty() && it != "同学" }

    fun toJson(): JSONObject = JSONObject().put("code", code).put("owner", owner).put("semester", semester)
        .put("courseCount", courseCount).put("createdAt", createdAt).put("updatedAt", updatedAt)

    companion object {
        fun fromJson(json: JSONObject): ShareMeta? {
            val code = json.optString("code", "").trim()
            if (code.isEmpty()) return null
            return ShareMeta(
                code = code,
                owner = json.optString("owner", ""),
                semester = json.optString("semester", ""),
                courseCount = json.optInt("courseCount", 0),
                createdAt = json.optString("createdAt", ""),
                updatedAt = json.optString("updatedAt", ""),
            )
        }
    }
}

/** The answer to publishing one's own timetable. */
data class PublishedShare(val meta: ShareMeta, val created: Boolean, val changed: Boolean)

class SharedScheduleException(message: String) : Exception(message)

/**
 * Somebody else's timetable, saved whole on this device. It carries the
 * publisher's own calendar (weeks, period times, make-up days), so it is laid
 * out with theirs rather than the reader's.
 */
data class SharedSchedule(
    val meta: ShareMeta,
    val cells: List<ScheduleCell>,
    val weeks: List<CalendarWeek>,
    val semesterStart: String = "",
    val semesterEnd: String = "",
    val periods: List<SchedulePeriod> = emptyList(),
    val adjustments: List<ScheduleAdjustment> = emptyList(),
    /** The reader's own name for it; only on this device. */
    val remark: String = "",
    val fetchedAt: Long = 0L,
    /** The publisher withdrew the share. The saved copy still opens, it just will not change again. */
    val revoked: Boolean = false,
) {
    /** The remark wins: a nickname is the publisher's choice and may be shared by many. */
    val name: String get() = remark.trim().ifEmpty { meta.ownerName ?: "共享课表" }

    /** The semester value of the store showing it, prefixed so it cannot be mistaken for one of the reader's terms. */
    val semesterValue: String get() = "share:${meta.code}"

    val courseCount: Int get() = cells.sumOf { it.courses.size }

    /**
     * The week `today` ("yyyy-MM-dd") falls in. Before the term it is the
     * first week and after it the last, so the grid always has a week to show.
     */
    fun week(today: String): Int {
        weeks.firstOrNull { today in it.days }?.let { return it.week }
        val first = weeks.firstOrNull() ?: return 1
        return if (today < first.days.firstOrNull().orEmpty()) first.week else weeks.last().week
    }

    /**
     * A complete-semester snapshot in the bridge's shape, as [ScheduleStore]
     * takes it. The current week is worked out from `today`: the one saved in
     * the share is whatever week the publisher happened to share it in. It is
     * stamped `now`, not [fetchedAt]: the store drops entries older than its
     * cache lifetime, and a saved copy is as current as it will get.
     */
    fun snapshot(today: String = ScheduleStore.todayKey(), now: Long = System.currentTimeMillis()): String {
        val current = week(today)
        val semesters = JSONArray().put(JSONObject().put("value", semesterValue).put("label", name).put("current", true))
        val weekOptions = JSONArray(weeks.map {
            JSONObject().put("value", it.week.toString()).put("label", "第 ${it.week} 周").put("current", it.week == current)
        })
        return JSONObject()
            .put("version", 1).put("completeSemester", true).put("source", "shared").put("fetchedAt", now)
            .put("periods", JSONArray(periods.map { JSONObject().put("number", it.number).put("startTime", it.startTime).put("endTime", it.endTime) }))
            .put("data", JSONObject()
                .put("source", "shared").put("semesters", semesters).put("weeks", weekOptions)
                .put("currentSemester", semesterValue).put("currentWeek", current.toString())
                .put("cells", JSONArray(cells.map { it.toJson() })))
            .put("calendar", calendarJson().put("source", "shared").put("semesters", semesters)
                .put("currentSemester", semesterValue).put("currentWeek", current))
            .put("auth", JSONObject().put("authenticated", true))
            .toString()
    }

    private fun calendarJson(): JSONObject = JSONObject()
        .put("semesterStart", semesterStart).put("semesterEnd", semesterEnd)
        .put("weeks", JSONArray(weeks.map { week ->
            JSONObject().put("week", week.week).put("days", JSONArray(week.days)).put("monday", week.monday).put("sunday", week.sunday)
        }))
        .put("adjustments", JSONArray(adjustments.map { adjustment ->
            JSONObject().put("date", adjustment.date).put("kind", adjustment.kind).apply {
                adjustment.source?.let { put("source", it) }
                adjustment.note?.let { put("note", it) }
            }
        }))

    fun toJson(): JSONObject = JSONObject()
        .put("meta", meta.toJson())
        .put("cells", JSONArray(cells.map { it.toJson() }))
        .put("calendar", calendarJson())
        .put("periods", JSONArray(periods.map { JSONObject().put("number", it.number).put("startTime", it.startTime).put("endTime", it.endTime) }))
        .put("remark", remark).put("fetchedAt", fetchedAt).put("revoked", revoked)

    companion object {
        const val MAXIMUM_COURSES = 600
        private const val CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789"

        /**
         * A share code out of whatever was typed or pasted: any case, spaces or
         * dashes, or a whole `/schedule/share/CODE` link. Null when none is there.
         */
        fun normalizedCode(input: String): String? {
            var text = input.trim()
            val marker = text.indexOf("/schedule/share/", ignoreCase = true)
            if (marker >= 0) {
                text = text.substring(marker + "/schedule/share/".length).takeWhile { it != '?' && it != '#' && it != '/' }
            }
            val code = text.uppercase(Locale.ROOT).filter { !it.isWhitespace() && it != '-' }
            return code.takeIf { it.length == 8 && it.all { character -> character in CODE_ALPHABET } }
        }

        /**
         * The server's share document. The server checks little more than that
         * every course has a name, so everything a grid indexes with is clamped
         * here: a bad row is dropped instead of drawn somewhere it cannot be.
         */
        fun read(document: JSONObject, fetchedAt: Long): SharedSchedule {
            val meta = ShareMeta.fromJson(document) ?: throw SharedScheduleException("这份共享课表无法读取")
            val result = document.optJSONObject("schedule")?.let(ScheduleJson::parseResult)
            var remaining = MAXIMUM_COURSES
            val cells = result?.cells.orEmpty().filter { it.day in 1..7 && it.bigSlot in 1..20 }.mapNotNull { cell ->
                val courses = cell.courses.mapNotNull { course ->
                    val name = course.name.trim()
                    if (remaining <= 0 || name.isEmpty()) return@mapNotNull null
                    remaining -= 1
                    val start = course.startSlot?.coerceIn(1, 20)
                    // Edit identities belong to the publisher's account; a reader
                    // cannot edit this timetable, so they are left behind.
                    ScheduleCourse(
                        name = name.take(80),
                        teacher = course.teacher?.take(80),
                        weeks = course.weeks.take(120),
                        weekList = course.weekList.filter { it in 1..64 }.distinct().sorted(),
                        location = course.location?.take(80),
                        slotNote = course.slotNote?.take(120),
                        startSlot = start,
                        endSlot = course.endSlot?.coerceIn(start ?: 1, 20),
                    )
                }
                if (courses.isEmpty()) null else ScheduleCell(cell.day, cell.bigSlot, courses)
            }
            if (cells.isEmpty()) throw SharedScheduleException("这份共享课表里没有课程")
            val calendarJson = document.optJSONObject("calendar") ?: JSONObject()
            val calendar = ScheduleJson.parseCalendar(calendarJson)
            val weeks = calendar.weeks.filter { it.week in 1..64 }.mapNotNull { week ->
                mondayFirstDays(week.days)?.let { CalendarWeek(week.week, it, it[0], it[6]) }
            }.sortedBy { it.week }
            if (weeks.isEmpty()) throw SharedScheduleException("这份共享课表没有校历，无法按周显示")
            return SharedSchedule(
                meta = meta,
                cells = cells,
                weeks = weeks,
                semesterStart = calendar.semesterStart,
                semesterEnd = calendar.semesterEnd,
                periods = readPeriods(calendarJson.optJSONArray("periods")),
                adjustments = calendar.adjustments,
                fetchedAt = fetchedAt,
            )
        }

        /** A saved copy written by [toJson]; null when it cannot be used. */
        fun fromJson(json: JSONObject): SharedSchedule? = runCatching {
            val document = JSONObject(json.optJSONObject("meta")?.toString() ?: return null)
                .put("schedule", JSONObject().put("cells", json.optJSONArray("cells") ?: JSONArray()))
                .put("calendar", (json.optJSONObject("calendar") ?: JSONObject()).put("periods", json.optJSONArray("periods") ?: JSONArray()))
            read(document, json.optLong("fetchedAt", 0L)).copy(
                remark = json.optString("remark", ""),
                revoked = json.optBoolean("revoked", false),
            )
        }.getOrNull()

        /** The Web share page writes periods as `{id, name, start, end}`, the native bridge as `{number, startTime, endTime}`. */
        private fun readPeriods(array: JSONArray?): List<SchedulePeriod> {
            if (array == null) return emptyList()
            return (0 until array.length()).mapNotNull { index ->
                val item = array.optJSONObject(index) ?: return@mapNotNull null
                val number = item.optInt("number", item.optInt("id", 0))
                val start = item.optString("startTime", "").ifEmpty { item.optString("start", "") }
                val end = item.optString("endTime", "").ifEmpty { item.optString("end", "") }
                if (number !in 1..48 || !CLOCK.matches(start) || !CLOCK.matches(end)) null else SchedulePeriod(number, start, end)
            }.distinctBy { it.number }.sortedBy { it.number }
        }

        /**
         * Seven dates, Monday first, out of a week as 教务 lists it: the list may
         * start on Sunday or miss days. The Web share page reads a week the same
         * way (`normalizeCalendarWeekDays`). Null when no entry is a date.
         */
        fun mondayFirstDays(raw: List<String>): List<String>? {
            fun date(text: String): Calendar? {
                val parts = text.trim().split('-')
                if (parts.size != 3 || parts[0].length != 4) return null
                val year = parts[0].toIntOrNull() ?: return null
                val month = parts[1].toIntOrNull() ?: return null
                val day = parts[2].toIntOrNull() ?: return null
                val value = GregorianCalendar(TimeZone.getTimeZone("UTC"), Locale.US).apply {
                    clear()
                    isLenient = false
                }
                return runCatching {
                    value.set(year, month - 1, day)
                    value.timeInMillis
                    value
                }.getOrNull()
            }
            // 1 is Monday, 7 is Sunday.
            fun weekday(value: Calendar): Int = (value.get(Calendar.DAY_OF_WEEK) + 5) % 7 + 1
            val anchors = raw.mapIndexedNotNull { index, text -> date(text)?.let { Triple(index, it, weekday(it)) } }
            val anchor = anchors.firstOrNull() ?: return null
            val sundayFirst = anchors.count { it.third == (if (it.first == 0) 7 else it.first) } > anchors.count { it.third == it.first + 1 }
            val offset = if (sundayFirst) (if (anchor.first == 0) -1 else anchor.first - 1) else anchor.first
            return (0 until 7).map { index ->
                val day = anchor.second.clone() as Calendar
                day.isLenient = true
                day.add(Calendar.DAY_OF_YEAR, index - offset)
                String.format(Locale.US, "%04d-%02d-%02d", day.get(Calendar.YEAR), day.get(Calendar.MONTH) + 1, day.get(Calendar.DAY_OF_MONTH))
            }
        }

        /**
         * The request body for publishing a complete semester, in the shape the
         * Web share page reads: periods are `{id, name, start, end}` there. Only
         * what a reader needs to draw the timetable goes out; the publisher's
         * list of terms and the identities that tie a course to their account
         * stay behind. The bridge adds the site nickname.
         */
        fun publishBody(snapshot: ScheduleSnapshot?): JSONObject {
            val data = snapshot?.data
            val semester = data?.currentSemester?.trim().orEmpty()
            if (snapshot == null || data == null || !snapshot.completeSemester || !snapshot.authenticated || semester.isEmpty()) {
                throw SharedScheduleException("整学期课表还没有加载完，请刷新课表后再试")
            }
            val calendar = snapshot.calendar?.takeIf { it.weeks.isNotEmpty() } ?: throw SharedScheduleException("课表还没有校历，暂时不能分享")
            val cells = JSONArray()
            data.cells.forEach { cell ->
                val courses = JSONArray()
                cell.courses.forEach { course ->
                    val name = course.name.trim()
                    if (name.isEmpty()) return@forEach
                    courses.put(JSONObject().put("name", name).put("weeks", course.weeks).put("weekList", JSONArray(course.weekList)).apply {
                        course.teacher?.let { put("teacher", it) }
                        course.location?.let { put("location", it) }
                        (course.sourceNote ?: course.slotNote)?.let { put("slotNote", it) }
                        course.startSlot?.let { put("startSlot", it) }
                        course.endSlot?.let { put("endSlot", it) }
                    })
                }
                if (courses.length() > 0) cells.put(JSONObject().put("day", cell.day).put("bigSlot", cell.bigSlot).put("courses", courses))
            }
            if (cells.length() == 0) throw SharedScheduleException("这个学期没有课程，没有可以分享的内容")
            val firstWeek = calendar.weeks[0].week
            val weeks = JSONArray(calendar.weeks.map {
                JSONObject().put("week", it.week).put("days", JSONArray(it.days)).put("monday", it.monday).put("sunday", it.sunday)
            })
            val periods = JSONArray(snapshot.periods.ifEmpty { BUNDLED_PERIODS }.map {
                JSONObject().put("id", it.number).put("name", "第${it.number}节").put("start", it.startTime).put("end", it.endTime)
            })
            val adjustments = JSONArray(calendar.adjustments.map { adjustment ->
                JSONObject().put("date", adjustment.date).put("kind", adjustment.kind).apply {
                    adjustment.source?.let { put("source", it) }
                    adjustment.note?.let { put("note", it) }
                }
            })
            return JSONObject()
                .put("semester", semester)
                .put("schedule", JSONObject()
                    .put("scope", "semester").put("semesters", JSONArray())
                    .put("weeks", JSONArray(calendar.weeks.map {
                        JSONObject().put("value", it.week.toString()).put("label", "第 ${it.week} 周").put("current", false)
                    }))
                    .put("currentSemester", semester).put("currentWeek", firstWeek.toString()).put("cells", cells))
                .put("calendar", JSONObject()
                    .put("currentSemester", semester).put("currentWeek", firstWeek)
                    .put("semesterStart", calendar.semesterStart).put("semesterEnd", calendar.semesterEnd)
                    .put("weeks", weeks).put("periods", periods).put("adjustments", adjustments))
        }

        /** What the share sheet sends: the code, where to type it, and the link that opens it in a browser. */
        fun invitation(code: String, origin: String): String =
            "我的课表分享码：$code\n在药大拾间「课表 → 更多 → 共享课表」里输入就能看，也可以直接打开：${origin.trimEnd('/')}/schedule/share/$code"

        /** "更新于 10月7日" from the server's ISO timestamp, in Beijing time. */
        fun updatedText(value: String): String? {
            val time = ScheduleJson.parseIsoTime(value) ?: return null
            val calendar = GregorianCalendar(TimeZone.getTimeZone("Asia/Shanghai"), Locale.US).apply { timeInMillis = time }
            return "更新于 ${calendar.get(Calendar.MONTH) + 1}月${calendar.get(Calendar.DAY_OF_MONTH)}日"
        }

        private val CLOCK = Regex("\\d{1,2}:\\d{2}")
    }
}

/**
 * The reader's saved shared timetables, as a plain value so the rules can be
 * checked without a device.
 */
data class SharedScheduleLibrary(
    /** The account the library was saved under. A different account signing in starts from an empty one. */
    val account: String = "",
    val schedules: List<SharedSchedule> = emptyList(),
) {
    /** Saves a previewed share under the reader's remark. Importing a code again replaces the saved copy. */
    fun save(schedule: SharedSchedule, remark: String): SharedScheduleLibrary {
        val saved = schedule.copy(remark = remark.trim())
        return if (schedules.any { it.meta.code == saved.meta.code }) {
            copy(schedules = schedules.map { if (it.meta.code == saved.meta.code) saved else it })
        } else copy(schedules = schedules + saved)
    }

    /** A newer download of a saved share. The remark stays. */
    fun refresh(schedule: SharedSchedule): SharedScheduleLibrary =
        copy(schedules = schedules.map { if (it.meta.code == schedule.meta.code) schedule.copy(remark = it.remark) else it })

    fun rename(code: String, remark: String): SharedScheduleLibrary =
        copy(schedules = schedules.map { if (it.meta.code == code) it.copy(remark = remark.trim()) else it })

    /** The publisher withdrew it: keep the copy, stop treating it as live. */
    fun markRevoked(code: String): SharedScheduleLibrary =
        copy(schedules = schedules.map { if (it.meta.code == code) it.copy(revoked = true) else it })

    fun remove(code: String): SharedScheduleLibrary = copy(schedules = schedules.filter { it.meta.code != code })

    /**
     * Starts over when another account signs in. An empty fingerprint (signed
     * out, or a Web build that sends none) changes nothing.
     */
    fun adopt(next: String): SharedScheduleLibrary {
        val value = next.trim()
        if (value.isEmpty() || value == account) return this
        return if (account.isEmpty()) copy(account = value) else SharedScheduleLibrary(account = value)
    }

    fun toJson(): JSONObject = JSONObject().put("version", 1).put("account", account)
        .put("schedules", JSONArray(schedules.map { it.toJson() }))

    companion object {
        fun fromJson(json: JSONObject): SharedScheduleLibrary {
            val array = json.optJSONArray("schedules") ?: JSONArray()
            return SharedScheduleLibrary(
                account = json.optString("account", ""),
                schedules = (0 until array.length()).mapNotNull { array.optJSONObject(it)?.let(SharedSchedule::fromJson) },
            )
        }
    }
}
