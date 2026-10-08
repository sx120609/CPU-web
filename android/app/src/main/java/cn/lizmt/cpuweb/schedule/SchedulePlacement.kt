package cn.lizmt.cpuweb.schedule

/**
 * One visible piece of a course on one day. [block] is always the whole
 * course; [startSlot]..[endSlot] is the part left showing, [lane] its column
 * among the courses it sits beside and [lanes] how many columns that group has.
 */
data class PlacedBlock(
    val block: CourseBlock,
    val startSlot: Int,
    val endSlot: Int,
    val lane: Int = 0,
    val lanes: Int = 1,
    /** Set while the couple timetable is drawn: whose course this is. */
    val owner: CoupleOwner? = null,
    /** The partner's courses that meet this one of the user's: written as a line under it instead of tiles of their own. */
    val notes: List<PlacedBlock> = emptyList(),
) {
    val course: ScheduleCourse get() = block.course
    val day: Int get() = block.day
    val span: Int get() = endSlot - startSlot + 1
}

/**
 * Which course shows when several sit in the same periods (iOS
 * `NativeSchedulePriority`). A priority belongs to a course, not to one of its
 * meetings, so it is keyed by the course name and saved with the schedule
 * edits (`server/src/shared/schedulePriority.ts`).
 */
object SchedulePriority {
    /** The saved key for a course name: trimmed, inner whitespace collapsed. */
    fun key(name: String): String = name.trim().split(WHITESPACE).filter { it.isNotEmpty() }.joinToString(" ")

    /** 0 means the course has no priority. */
    fun value(name: String, priorities: Map<String, Int>): Int = maxOf(0, priorities[key(name)] ?: 0)

    /**
     * Lays out one day's blocks, already filtered to the week on screen.
     *
     * A course with a strictly higher priority covers the periods it shares
     * with a lower one. The lower course keeps the runs of periods left
     * uncovered and disappears only when nothing is left. Courses of equal
     * priority, which includes every course when none is set, sit side by side
     * in lanes.
     */
    fun place(blocks: List<CourseBlock>, priorities: Map<String, Int>): List<PlacedBlock> {
        val pieces = mutableListOf<PlacedBlock>()
        for (block in blocks) {
            if (block.startSlot > block.endSlot) continue
            val own = value(block.course.name, priorities)
            val covering = blocks.filter {
                value(it.course.name, priorities) > own && it.startSlot <= block.endSlot && block.startSlot <= it.endSlot
            }
            var start: Int? = null
            for (slot in block.startSlot..block.endSlot) {
                if (covering.any { it.startSlot <= slot && slot <= it.endSlot }) {
                    start?.let { pieces += PlacedBlock(block, it, slot - 1) }
                    start = null
                } else if (start == null) {
                    start = slot
                }
            }
            start?.let { pieces += PlacedBlock(block, it, block.endSlot) }
        }
        pieces.sortWith(compareBy({ it.startSlot }, { it.endSlot }, { it.course.name }))
        val laneEnds = mutableListOf<Int>()
        val laned = pieces.map { piece ->
            val free = laneEnds.indexOfFirst { it < piece.startSlot }
            val lane = if (free < 0) laneEnds.size else free
            if (lane == laneEnds.size) laneEnds += piece.endSlot else laneEnds[lane] = piece.endSlot
            piece.copy(lane = lane)
        }
        // Courses that overlap, directly or through a chain, share the width;
        // everything else stays full width.
        val result = mutableListOf<PlacedBlock>()
        var cluster = mutableListOf<PlacedBlock>()
        var clusterEnd = Int.MIN_VALUE
        fun flush() {
            val lanes = (cluster.maxOfOrNull { it.lane } ?: 0) + 1
            cluster.forEach { result += it.copy(lanes = lanes) }
            cluster = mutableListOf()
        }
        for (piece in laned) {
            if (cluster.isNotEmpty() && piece.startSlot > clusterEnd) flush()
            clusterEnd = if (cluster.isEmpty()) piece.endSlot else maxOf(clusterEnd, piece.endSlot)
            cluster += piece
        }
        flush()
        return result
    }

    private val WHITESPACE = Regex("\\s+")
}

/**
 * One "when it meets" group of a course in the editor: a weekday, any set of
 * periods and the weeks it runs (iOS `NativeCourseArrangement`). The saved
 * edit payload describes one contiguous block per item, so an arrangement is
 * written as one item per run of consecutive periods.
 */
data class CourseArrangement(val day: Int, val slots: Set<Int>, val weekList: List<Int>) {
    /** The runs of consecutive periods, in order: [1, 2, 5, 6, 9] → 1..2, 5..6, 9..9. */
    val runs: List<IntRange>
        get() {
            val result = mutableListOf<IntRange>()
            for (slot in slots.sorted()) {
                val last = result.lastOrNull()
                if (last != null && last.last + 1 == slot) result[result.lastIndex] = last.first..slot else result += slot..slot
            }
            return result
        }

    /**
     * Names of the courses this arrangement would sit on top of: same weekday,
     * intersecting periods and at least one week in common. Courses that only
     * alternate weeks in the same periods do not count. A course without a
     * week list meets every week.
     */
    fun conflicts(cells: List<ScheduleCell>, ignoring: (ScheduleCell, ScheduleCourse) -> Boolean = { _, _ -> false }): List<String> {
        if (slots.isEmpty()) return emptyList()
        val weeks = weekList.toSet()
        val names = mutableListOf<String>()
        for (cell in cells) {
            if (cell.day != day) continue
            for (course in cell.courses) {
                if (ignoring(cell, course)) continue
                val start = course.startSlot ?: (cell.bigSlot * 2 - 1)
                val end = maxOf(start, course.endSlot ?: (cell.bigSlot * 2))
                if (slots.none { it in start..end }) continue
                val courseWeeks = course.weekList.toSet()
                if (weeks.isNotEmpty() && courseWeeks.isNotEmpty() && weeks.intersect(courseWeeks).isEmpty()) continue
                if (course.name !in names) names += course.name
            }
        }
        return names
    }

    companion object {
        /** "第 1–2、5 节 · 08:00–09:40、13:30–14:15", or a prompt while nothing is picked. */
        fun summary(slots: Set<Int>, period: (Int) -> SchedulePeriod): String {
            val runs = CourseArrangement(1, slots, emptyList()).runs
            if (runs.isEmpty()) return "轻点选择上课的节次，可以不连续"
            val numbers = runs.joinToString("、") { if (it.first == it.last) "${it.first}" else "${it.first}–${it.last}" }
            val times = runs.joinToString("、") { "${period(it.first).startTime}–${period(it.last).endTime}" }
            return "第 $numbers 节 · $times"
        }
    }
}

/**
 * Two of the user's own courses in the same periods. That is usually wrong data
 * from the academic system (a cancelled course still listed, the old row of a
 * moved one), so the first time it shows the user is told: check the academic
 * system first, then edit or delete here.
 */
data class OverlapNotice(val day: Int, val startSlot: Int, val endSlot: Int, val names: List<String>) {
    /** The same overlap is pointed out once: same term, weekday and course names. */
    fun key(semester: String): String = "$semester|$day|${names.sorted().joinToString("/")}"

    val text: String
        get() {
            val slots = if (startSlot == endSlot) "第 $startSlot 节" else "第 $startSlot–$endSlot 节"
            val listed = names.take(3).joinToString("、") { "「$it」" } + if (names.size > 3) " 等" else ""
            return "${WEEKDAY_LABELS.getOrElse(day - 1) { "" }}${slots}同时排了 $listed。这通常是教务系统的数据有误，建议先到教务系统核对原始课表；" +
                "确认哪一门不该在这里以后，点这门课就可以编辑或删除。"
        }

    companion object {
        /**
         * The first place in a week where courses sit side by side. A course set
         * to show first covers the other one: the user has dealt with that, so
         * it is not pointed out.
         */
        fun find(week: List<PlacedBlock>): OverlapNotice? {
            val side = week.filter { it.lanes > 1 }.sortedWith(compareBy({ it.day }, { it.startSlot }, { it.lane }))
            val first = side.firstOrNull() ?: return null
            // The cluster of that day that the first course belongs to.
            val cluster = mutableListOf(first)
            var end = first.endSlot
            side.drop(1).forEach { block ->
                if (block.day != first.day || block.startSlot > end) return@forEach
                cluster += block
                end = maxOf(end, block.endSlot)
            }
            val names = cluster.map { it.course.name }.distinct()
            return if (names.size < 2) null else OverlapNotice(first.day, first.startSlot, end, names)
        }
    }
}
