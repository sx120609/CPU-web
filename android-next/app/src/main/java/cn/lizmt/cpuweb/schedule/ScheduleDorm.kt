package cn.lizmt.cpuweb.schedule

import org.json.JSONObject

/*
 * The dorm timetable ("宿舍课表", docs/dorm-schedule.md) is the Web page
 * `/dorm-schedule` in the shared WebView: the page owns the dorm, its members
 * and the free-time maths. The shell only hands it this term's whole
 * timetable, edits included, through `window.CPUTimeNativeDorm`; the page
 * uploads it by the Web timetable's rules.
 */
object ScheduleDorm {
    const val PAGE = "/dorm-schedule"
    private val CODE = Regex("[A-Z0-9]{4,12}")

    /** A dorm code as typed or linked: no spaces, upper case; empty when it cannot be one. */
    fun inviteCode(value: String): String =
        value.filterNot(Char::isWhitespace).uppercase().takeIf { CODE.matches(it) }.orEmpty()

    /** The page for a dorm code; the code is filled in on the page. */
    fun page(code: String = ""): String = inviteCode(code).let { if (it.isEmpty()) PAGE else "$PAGE?code=$it" }

    /**
     * The dorm page for an in-app link to the invite (`/schedule?dorm=1&code=…`),
     * which the native timetable would otherwise swallow with its code; null for
     * any other path.
     */
    fun pagePath(path: String): String? {
        val target = path.substringBefore('#')
        if (target.substringBefore('?') != "/schedule") return null
        val query = target.substringAfter('?', "").split('&').filter { it.isNotEmpty() }.associate { part ->
            decode(part.substringBefore('=')) to decode(part.substringAfter('=', ""))
        }
        if (query["dorm"] != "1") return null
        return page(query["code"].orEmpty())
    }

    /**
     * The `offer` request for `CPUTimeNativeDorm`: the term's whole timetable in
     * the couple upload's shape, with each course's own clock times. Null until
     * that term is complete; the caller only offers the term running now.
     */
    fun offer(snapshot: ScheduleSnapshot?, force: Boolean = false): JSONObject? {
        val body = runCatching { SharedSchedule.publishBody(snapshot, clockTimes = true) }.getOrNull() ?: return null
        return JSONObject().put("action", "offer").put("snapshot", body).put("force", force).apply {
            snapshot?.account?.takeIf { it.isNotEmpty() }?.let { put("account", it) }
        }
    }

    private fun decode(value: String): String =
        runCatching { java.net.URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)
}
