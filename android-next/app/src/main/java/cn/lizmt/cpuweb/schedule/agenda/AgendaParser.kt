package cn.lizmt.cpuweb.schedule.agenda

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.temporal.TemporalAdjusters

/**
 * Reads a quick note such as 「明天下午3点 实验报告」 or 「每周三晚上7点 羽毛球 @体育馆」
 * into an agenda item, offline. It understands common Chinese dates, times,
 * ranges, repeats, reminders and an `@place`; whatever is left is the title.
 * The result has an empty id; the caller assigns one when it saves.
 */
object AgendaParser {
    fun parse(input: String, now: LocalDateTime): AgendaItem {
        var text = normalizeDigits(input).trim()
        val today = now.toLocalDate()

        var remind = AgendaRemind.NONE
        Regex("提前\\s*(\\d+|半)\\s*(分钟|分|个?小时|天)\\s*(提醒我?|通知我?)?").find(text)?.let { match ->
            val amount = match.groupValues[1].let { if (it == "半") -1 else it.toInt() }
            remind = when {
                match.groupValues[2].endsWith("天") -> (if (amount < 0) 1 else amount) * 1440
                match.groupValues[2].endsWith("小时") -> if (amount < 0) 30 else amount * 60
                else -> if (amount < 0) 30 else amount
            }.coerceAtMost(10_080)
            text = text.removeRange(match.range)
        }
        val asksReminder = Regex("提醒我|提醒一下|叫我|通知我|提醒").containsMatchIn(text)
        text = text.replace(Regex("提醒我一下|提醒我|提醒一下|叫我|通知我|记得|别忘了|帮我|请|添加|新建|加个|加一个|记一下|安排"), " ")

        var repeat = AgendaRepeat.None
        var date: LocalDate? = null
        Regex("每(?:天|日)").find(text)?.let { repeat = AgendaRepeat.Daily; text = text.removeRange(it.range) }
        Regex("(?:每个?)?工作日").find(text)?.let { repeat = AgendaRepeat.Weekdays; text = text.removeRange(it.range) }
        Regex("每(?:个)?(?:周|星期|礼拜)([一二三四五六日天7])").find(text)?.let { match ->
            repeat = AgendaRepeat.Weekly
            date = today.with(TemporalAdjusters.nextOrSame(weekday(match.groupValues[1])))
            text = text.removeRange(match.range)
        }
        Regex("每(?:个)?月(\\d{1,2})[号日]").find(text)?.let { match ->
            repeat = AgendaRepeat.Monthly
            date = nextDayOfMonth(today, match.groupValues[1].toInt())
            text = text.removeRange(match.range)
        }

        var period: Period? = null
        val dateRules: List<Pair<Regex, (MatchResult) -> LocalDate?>> = listOf(
            Regex("(\\d{4})[-/年](\\d{1,2})[-/月](\\d{1,2})[日号]?") to { m -> safeDate(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt()) },
            Regex("(\\d{1,2})月(\\d{1,2})[日号]?") to { m -> upcoming(today, m.groupValues[1].toInt(), m.groupValues[2].toInt()) },
            Regex("(?<![\\d:])(\\d{1,2})/(\\d{1,2})(?![\\d:])") to { m -> upcoming(today, m.groupValues[1].toInt(), m.groupValues[2].toInt()) },
            Regex("大后天") to { _ -> today.plusDays(3) },
            Regex("后天") to { _ -> today.plusDays(2) },
            Regex("明早|明天早上|明天上午") to { _ -> period = Period.Morning; today.plusDays(1) },
            Regex("明晚|明天晚上") to { _ -> period = Period.Evening; today.plusDays(1) },
            Regex("明天|明日") to { _ -> today.plusDays(1) },
            Regex("今早|今天早上|今天上午") to { _ -> period = Period.Morning; today },
            Regex("今晚|今夜|今天晚上") to { _ -> period = Period.Evening; today },
            Regex("今天|今日") to { _ -> today },
            Regex("(下下|下|这|本)?(?:个)?(?:周|星期|礼拜)([一二三四五六日天7])") to { m -> weekdayDate(today, m.groupValues[1], weekday(m.groupValues[2])) },
            Regex("(\\d{1,3})天(?:后|以后|之后)") to { m -> today.plusDays(m.groupValues[1].toLong()) },
            Regex("(?<![\\d月])(\\d{1,2})[号日](?![\\d])") to { m -> nextDayOfMonth(today, m.groupValues[1].toInt()) },
        )
        if (date == null) {
            for ((regex, resolve) in dateRules) {
                val match = regex.find(text) ?: continue
                val resolved = resolve(match) ?: continue
                date = resolved
                text = text.removeRange(match.range)
                break
            }
        }

        // A period word may stand apart from the time: 「下午 3点」.
        Regex("凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里").find(text)?.let { match ->
            period = Period.of(match.value)
            text = text.removeRange(match.range)
        }
        var start: Pair<Int, Int>? = null
        var end: Pair<Int, Int>? = null
        val clock = "(\\d{1,2})(?:[:：](\\d{2})|点(半|一刻|三刻|(\\d{1,2})分?)?|时)"
        Regex("$clock\\s*(?:-|~|～|到|至|—)\\s*$clock").find(text)?.let { match ->
            start = time(match.groupValues[1], match.groupValues[2], match.groupValues[3], match.groupValues[4])
            end = time(match.groupValues[5], match.groupValues[6], match.groupValues[7], match.groupValues[8])
            text = text.removeRange(match.range)
        } ?: Regex(clock).find(text)?.let { match ->
            start = time(match.groupValues[1], match.groupValues[2], match.groupValues[3], match.groupValues[4])
            text = text.removeRange(match.range)
        }
        // Without 上午/下午, 1–6 o'clock means the afternoon, as people say it for classes and meetings.
        start = start?.let { if (period == null && it.first in 1..6) it.first + 12 to it.second else applyPeriod(it, period) }
        end = end?.let { value ->
            val shifted = applyPeriod(value, period)
            // 「下午3点到5点」「19:00-21:00」: the end follows the start's half of the day.
            if (start != null && minutes(shifted) <= minutes(start!!) && shifted.first < 12) shifted.first + 12 to shifted.second else shifted
        }

        var location = ""
        Regex("[@＠]\\s*([^\\s，,。；;]{1,20})").find(text)?.let { match ->
            location = match.groupValues[1]
            text = text.removeRange(match.range)
        }
        Regex("地点\\s*[:：]\\s*([^\\s，,。；;]{1,20})").find(text)?.let { match ->
            location = match.groupValues[1]
            text = text.removeRange(match.range)
        }

        val explicitTodo = Regex("待办|todo|TODO|任务|要做").containsMatchIn(text)
        text = text.replace(Regex("待办事项|待办|todo|TODO|日程|一个|一下"), " ")
        val title = text.replace(Regex("\\s+"), " ").trim().trim('，', ',', '。', '：', ':', '、', ' ', '的', '要', '在').ifEmpty { "未命名" }
        val deliverable = Regex("^(交|提交|完成|写|做|买|取|还|带|复习|预习|打印|缴|报名|准备|看|背|整理|洗|打扫|回复|联系)").containsMatchIn(title)

        // An event needs a day; time alone means today, or tomorrow once that time has passed.
        if (date == null && start != null) {
            val candidate = LocalDateTime.of(today, java.time.LocalTime.of(start!!.first, start!!.second))
            date = if (candidate.isBefore(now)) today.plusDays(1) else today
        }
        val kind = when {
            explicitTodo -> AgendaKind.Todo
            date == null -> AgendaKind.Todo
            end != null -> AgendaKind.Event
            deliverable -> AgendaKind.Todo
            else -> AgendaKind.Event
        }
        if (remind == AgendaRemind.NONE && asksReminder && date != null) remind = 0
        return AgendaItem(
            id = "",
            kind = kind,
            title = title,
            date = date?.toString().orEmpty(),
            start = start?.let { "%02d:%02d".format(it.first, it.second) }.orEmpty(),
            end = end?.let { "%02d:%02d".format(it.first, it.second) }.orEmpty(),
            location = location,
            remind = remind,
            repeat = repeat,
        )
    }

    private enum class Period {
        Dawn, Morning, Noon, Afternoon, Evening;

        companion object {
            fun of(word: String): Period = when (word) {
                "凌晨" -> Dawn
                "早上", "早晨", "上午" -> Morning
                "中午" -> Noon
                "下午", "傍晚" -> Afternoon
                else -> Evening
            }
        }
    }

    private fun time(hour: String, colonMinutes: String, halfOrQuarter: String, pointMinutes: String): Pair<Int, Int>? {
        val h = hour.toIntOrNull() ?: return null
        val m = when {
            colonMinutes.isNotEmpty() -> colonMinutes.toInt()
            halfOrQuarter == "半" -> 30
            halfOrQuarter == "一刻" -> 15
            halfOrQuarter == "三刻" -> 45
            pointMinutes.isNotEmpty() -> pointMinutes.toInt()
            else -> 0
        }
        return if (h in 0..24 && m in 0..59) (if (h == 24) 0 else h) to m else null
    }

    private fun applyPeriod(value: Pair<Int, Int>, period: Period?): Pair<Int, Int> {
        val (hour, minute) = value
        return when (period) {
            Period.Afternoon, Period.Evening -> (if (hour in 1..11) hour + 12 else hour) to minute
            Period.Noon -> (if (hour in 1..5) hour + 12 else hour) to minute
            Period.Dawn, Period.Morning -> (if (hour == 12) 0 else hour) to minute
            null -> value
        }
    }

    private fun minutes(value: Pair<Int, Int>) = value.first * 60 + value.second

    private fun weekday(word: String): DayOfWeek = when (word) {
        "一" -> DayOfWeek.MONDAY
        "二" -> DayOfWeek.TUESDAY
        "三" -> DayOfWeek.WEDNESDAY
        "四" -> DayOfWeek.THURSDAY
        "五" -> DayOfWeek.FRIDAY
        "六" -> DayOfWeek.SATURDAY
        else -> DayOfWeek.SUNDAY
    }

    /** 「周三」 is the next Wednesday (today included); 「这周三」 this week's; 「下周三」 next week's. */
    private fun weekdayDate(today: LocalDate, prefix: String, day: DayOfWeek): LocalDate {
        val monday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        return when (prefix) {
            "下下" -> monday.plusWeeks(2).with(TemporalAdjusters.nextOrSame(day))
            "下" -> monday.plusWeeks(1).with(TemporalAdjusters.nextOrSame(day))
            "这", "本" -> monday.with(TemporalAdjusters.nextOrSame(day))
            else -> today.with(TemporalAdjusters.nextOrSame(day))
        }
    }

    private fun safeDate(year: Int, month: Int, day: Int): LocalDate? =
        runCatching { LocalDate.of(year, month, day) }.getOrNull()

    /** A month and day this year, or next year once it has passed. */
    private fun upcoming(today: LocalDate, month: Int, day: Int): LocalDate? {
        val thisYear = safeDate(today.year, month, day) ?: return null
        return if (thisYear.isBefore(today)) safeDate(today.year + 1, month, day) else thisYear
    }

    private fun nextDayOfMonth(today: LocalDate, day: Int): LocalDate? {
        if (day !in 1..31) return null
        var month = today.withDayOfMonth(1)
        repeat(13) {
            val candidate = safeDate(month.year, month.monthValue, day)
            if (candidate != null && !candidate.isBefore(today)) return candidate
            month = month.plusMonths(1)
        }
        return null
    }

    /** Full-width digits and Chinese numerals before 点/时/号/日/天/月/分/小时 become ASCII digits. */
    internal fun normalizeDigits(input: String): String {
        val ascii = buildString {
            for (char in input) append(if (char in '０'..'９') '0' + (char - '０') else if (char == '：') ':' else char)
        }
        return Regex("([零一二两三四五六七八九十]{1,3})(?=点|时|号|日|天|月|分钟|分|个?小时|周后)").replace(ascii) { match ->
            chineseNumber(match.value)?.toString() ?: match.value
        }
    }

    private fun chineseNumber(text: String): Int? {
        val digits = mapOf('零' to 0, '一' to 1, '二' to 2, '两' to 2, '三' to 3, '四' to 4, '五' to 5, '六' to 6, '七' to 7, '八' to 8, '九' to 9)
        if (text == "十") return 10
        val tenAt = text.indexOf('十')
        if (tenAt < 0) return if (text.length == 1) digits[text[0]] else null
        val tens = if (tenAt == 0) 1 else digits[text[0]] ?: return null
        val ones = if (tenAt == text.lastIndex) 0 else digits[text[tenAt + 1]] ?: return null
        return tens * 10 + ones
    }
}
