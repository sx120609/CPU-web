package cn.lizmt.cpuweb.schedule

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.text.Normalizer
import java.util.Calendar

enum class ScheduleStatus { Idle, Loading, Loaded, Unauthorized, Failed }

data class ScheduleRequest(val semester: String, val week: String, val force: Boolean)

/**
 * Native timetable state. Ported from the HarmonyOS `NativeScheduleStore` and
 * aligned with the iOS store's rules:
 *
 * - The Web bridge owns the education session and the HTML parser; this store
 *   only caches parsed snapshots and filters them by week.
 * - A complete semester is cached once (`semester|*`); single weeks are cached
 *   per week. At most four semesters are kept.
 * - A timetable that is already on screen is never replaced by a status page:
 *   authorization expiry, bridge failures and refresh errors become a banner.
 * - Account changes clear the memory cache and the disk archive at once.
 * - A read-only store shows somebody else's shared timetable. It has no
 *   archive and no priorities, and nothing in it reaches the widgets.
 */
class ScheduleStore(
    private val scope: CoroutineScope,
    private val archive: ScheduleArchive? = null,
    private val clock: () -> Long = System::currentTimeMillis,
    val readOnly: Boolean = false,
    /** The display priorities kept across launches, as handed to [savePriorities]. */
    savedPriorities: String? = null,
    private val savePriorities: (String) -> Unit = {},
) {
    var status by mutableStateOf(ScheduleStatus.Idle)
        private set
    var result by mutableStateOf<ScheduleResult?>(null)
        private set
    var calendar by mutableStateOf<ScheduleCalendar?>(null)
        private set
    var periods by mutableStateOf(BUNDLED_PERIODS)
        private set
    var selectedSemester by mutableStateOf("")
        private set
    var selectedWeek by mutableStateOf("")
        private set
    var selectedDay by mutableIntStateOf(todayWeekday())
        private set
    var viewMode by mutableStateOf("week")
        private set
    var errorMessage by mutableStateOf("")
        private set
    /** JWXT authorization lapsed while an older timetable remains visible. */
    var authorizationExpired by mutableStateOf(false)
        private set
    /** A quiet revalidation of an already visible timetable is running. */
    var refreshing by mutableStateOf(false)
        private set
    var lastUpdatedAt by mutableLongStateOf(0L)
        private set
    var source by mutableStateOf("")
        private set
    var bridgeReady by mutableStateOf(false)
        private set
    /** Bumped whenever the cache changes so adjacent pager pages recompute. */
    var dataRevision by mutableIntStateOf(0)
        private set

    var loader: (suspend (ScheduleRequest) -> String?)? = null
    var prioritizer: ((String, String) -> Unit)? = null
    var onLoaded: (() -> Unit)? = null
    /** Reads the saved display priorities of a semester; null when they could not be read. */
    var priorityLoader: (suspend (String) -> Map<String, Int>?)? = null

    /**
     * Display priority of overlapping courses, by semester and then by
     * [SchedulePriority.key]. Read with the schedule edits and kept across
     * launches, so the grid does not reshuffle once the edits arrive.
     */
    private var prioritiesBySemester by mutableStateOf(parsePriorities(savedPriorities))
    private val prioritiesFetched = mutableSetOf<String>()

    private class CacheEntry(val snapshot: ScheduleSnapshot, val savedAt: Long, val stale: Boolean)

    private val cache = LinkedHashMap<String, CacheEntry>()
    private var navigationWeeks: List<ScheduleOption> = emptyList()
    /**
     * The first timetable option set, matching the iOS bridge and Harmony's
     * navigation list. Calendar/history responses must not expand this menu.
     */
    private var knownSemesters by mutableStateOf<List<ScheduleOption>>(emptyList())
    /** The term shown before a switch; a switch that fails returns to it. */
    private var fallbackSemester = ""
    private var fallbackWeek = ""
    private var failedSemester = ""
    private var job: Job? = null
    private var requestGeneration = 0
    private var pendingKey = ""
    private var pendingForce = false
    private var refreshBarrier = 0L
    var accountScope = ""
        private set

    val isGraduate: Boolean get() = source == "graduate"

    /** Personal edits exist for the user's own undergraduate timetable only. */
    val canEdit: Boolean get() = !readOnly && !isGraduate

    /** The display priorities of the semester on screen. */
    val displayPriorities: Map<String, Int>
        get() = prioritiesBySemester[selectedSemester.ifEmpty { result?.currentSemester.orEmpty() }].orEmpty()

    // region Lifecycle

    /** Paint the last verified timetable before the WebView has booted. */
    fun restoreArchive(): Boolean {
        if (result != null || accountScope.isNotEmpty()) return false
        val saved = archive?.read() ?: return false
        saved.snapshots.forEach { raw ->
            val snapshot = ScheduleJson.parseSnapshot(raw) ?: return@forEach
            val age = clock() - snapshot.fetchedAt
            if (snapshot.version == 1 && snapshot.authenticated && snapshot.error == null &&
                snapshot.data != null && age in 0..ARCHIVE_LIFETIME_MS) {
                remember(snapshot, stale = true, persist = false)
            }
        }
        val entry = freshCache(saved.semester, saved.week)
        if (entry == null) {
            cache.clear()
            knownSemesters = emptyList()
            return false
        }
        accountScope = saved.account
        selectedSemester = saved.semester
        selectedWeek = saved.week
        selectedDay = if (saved.day in 1..7) saved.day else todayWeekday()
        viewMode = normalizedViewMode(saved.viewMode)
        applySnapshot(entry.snapshot)
        return true
    }

    /**
     * `autoLoad == false` leaves the first request to the caller, which restores
     * the education session first so the opening fetch never races it.
     */
    fun markBridgeReady(autoLoad: Boolean = true) {
        bridgeReady = true
        if (!autoLoad) return
        val restored = freshCache(selectedSemester, selectedWeek)
        if (status == ScheduleStatus.Idle || status == ScheduleStatus.Failed ||
            (status == ScheduleStatus.Loading && job == null) || restored?.stale == true) {
            load(false)
        }
    }

    fun markBridgeUnavailable(message: String = "") {
        bridgeReady = false
        cancelRequest()
        if (message.isNotEmpty()) fail(message)
    }

    // endregion

    // region Loading

    fun load(force: Boolean) {
        if (!force) {
            val cached = freshCache(selectedSemester, selectedWeek)
            if (cached != null) {
                if (!(status == ScheduleStatus.Loaded && result == cached.snapshot.data && errorMessage.isEmpty())) {
                    cancelRequest()
                    applySnapshot(cached.snapshot)
                }
                if (revalidates(cached)) request(force = false, quiet = true)
                return
            }
        }
        request(force, quiet = force && result != null)
    }

    private fun request(force: Boolean, quiet: Boolean) {
        val key = "$selectedSemester|$selectedWeek"
        if (job?.isActive == true && pendingKey == key && (!force || pendingForce)) return
        cancelRequest()
        if (force) refreshBarrier = clock()
        val loader = loader
        if (!bridgeReady || loader == null) {
            if (result == null) status = ScheduleStatus.Loading
            return
        }
        val generation = ++requestGeneration
        pendingKey = key
        pendingForce = force
        val request = ScheduleRequest(selectedSemester, selectedWeek, force)
        if (quiet && result != null) refreshing = true else status = ScheduleStatus.Loading
        job = scope.launch {
            val raw = withTimeoutOrNull(REQUEST_TIMEOUT_MS) { loader(request) }
            if (generation != requestGeneration) return@launch
            job = null
            pendingKey = ""
            refreshing = false
            if (raw == null) fail("请求超时，请检查网络后重试") else accept(raw, force)
        }
    }

    /**
     * A stale entry, or any entry shown under an expired authorization, is
     * shown at once and checked quietly: returning from re-authorization must
     * clear the banner even while the cached copy is still fresh.
     */
    private fun revalidates(entry: CacheEntry) = entry.stale || authorizationExpired

    private fun cancelRequest() {
        requestGeneration += 1
        job?.cancel()
        job = null
        pendingKey = ""
        pendingForce = false
        refreshing = false
    }

    internal fun accept(raw: String, refreshed: Boolean) {
        val snapshot = ScheduleJson.parseSnapshot(raw)
        if (snapshot == null) {
            fail("课表数据无法读取")
            return
        }
        if (snapshot.cancelled) {
            // A newer selection superseded this request; keep whatever is shown.
            status = if (result != null) ScheduleStatus.Loaded else ScheduleStatus.Idle
            return
        }
        if (!snapshot.authenticated) {
            authorizationExpired = true
            if (result != null) {
                status = ScheduleStatus.Loaded
                errorMessage = snapshot.error ?: "教务授权已失效，已保留上次课表；完成教务授权后可继续更新。"
            } else {
                status = ScheduleStatus.Unauthorized
                errorMessage = ""
            }
            return
        }
        val error = snapshot.error
        if (error != null) {
            fail(if (error == "service-unavailable") "课表服务暂时不可用，请稍后重试" else error)
            return
        }
        val data = snapshot.data
        if (snapshot.version != 1 || data == null) {
            fail("教务系统未返回有效课表")
            return
        }
        if (selectedSemester.isNotEmpty() && data.currentSemester != selectedSemester) {
            fail("教务系统返回了其他学期的课表，请重新选择")
            return
        }
        if (accountScope.isEmpty() && !snapshot.account.isNullOrEmpty()) accountScope = snapshot.account
        authorizationExpired = false
        if (refreshed) cache.keys.filter { it.startsWith(data.currentSemester + "|") }.forEach(cache::remove)
        remember(snapshot, stale = false)
        applySnapshot(snapshot)
        refreshPriorities(force = refreshed)
        onLoaded?.invoke()
    }

    /**
     * Reads the saved priorities of the semester on screen, once per semester
     * unless forced. A failure keeps what is known: the grid then simply shows
     * overlapping courses side by side.
     */
    fun refreshPriorities(force: Boolean = false) {
        val loader = priorityLoader ?: return
        val semester = selectedSemester.ifEmpty { result?.currentSemester.orEmpty() }
        if (!canEdit || semester.isEmpty()) return
        if (!prioritiesFetched.add(semester) && !force) return
        val account = accountScope
        scope.launch {
            val loaded = loader(semester)
            if (account != accountScope) return@launch
            if (loaded == null) prioritiesFetched -= semester else setPriorities(semester, loaded)
        }
    }

    /** The priorities an edit just saved, or the ones read with the edits. */
    fun setPriorities(semester: String, priorities: Map<String, Int>) {
        if (readOnly || semester.isEmpty()) return
        val cleaned = priorities.filter { it.key.isNotEmpty() && it.value > 0 }
        if (prioritiesBySemester[semester].orEmpty() == cleaned) return
        prioritiesBySemester = if (cleaned.isEmpty()) prioritiesBySemester - semester else prioritiesBySemester + (semester to cleaned)
        val json = org.json.JSONObject()
        prioritiesBySemester.forEach { (key, values) ->
            json.put(key, org.json.JSONObject().apply { values.forEach { (name, value) -> put(name, value) } })
        }
        savePriorities(json.toString())
    }

    /** Weeks prefetched by the Web bridge. They never switch the visible week. */
    fun acceptPrefetched(raw: String) {
        val snapshot = ScheduleJson.parseSnapshot(raw) ?: return
        val data = snapshot.data ?: return
        if (snapshot.version != 1 || !snapshot.authenticated || snapshot.error != null) return
        val time = snapshot.fetchedAt
        if (time < refreshBarrier || clock() - time > CACHE_LIFETIME_MS) return
        if (!snapshot.account.isNullOrEmpty() && accountScope.isNotEmpty() && snapshot.account != accountScope) return
        var known = false
        var newer = false
        cache.values.forEach { entry ->
            if (entry.snapshot.data?.currentSemester == data.currentSemester) {
                known = true
                if (entry.savedAt > time && !entry.stale) newer = true
            }
        }
        if (!known || newer) return
        remember(snapshot, stale = false)
        if (snapshot.completeSemester && job == null && data.currentSemester == selectedSemester) {
            applySnapshot(snapshot)
        }
    }

    /**
     * Returns true when the account really changed and account data was cleared.
     * An empty account is a confirmed sign-out.
     */
    fun handleAuthChanged(account: String): Boolean {
        if (account.isNotEmpty() && account == accountScope) return false
        accountScope = account
        cancelRequest()
        refreshBarrier = clock()
        cache.clear()
        if (prioritiesBySemester.isNotEmpty()) {
            prioritiesBySemester = emptyMap()
            savePriorities("{}")
        }
        prioritiesFetched.clear()
        navigationWeeks = emptyList()
        knownSemesters = emptyList()
        clearFallback()
        result = null
        calendar = null
        periods = BUNDLED_PERIODS
        selectedSemester = ""
        selectedWeek = ""
        errorMessage = ""
        authorizationExpired = false
        lastUpdatedAt = 0L
        status = ScheduleStatus.Idle
        dataRevision += 1
        archive?.clear()
        if (account.isNotEmpty() && bridgeReady && loader != null) load(false)
        return true
    }

    // endregion

    // region Selection

    fun selectSemester(value: String) {
        val semester = value.trim()
        if (semester.isEmpty() || semester == selectedSemester) return
        rememberFallback()
        selectedSemester = semester
        navigationWeeks = emptyList()
        selectedWeek = ""
        result = null
        calendar = null
        load(false)
    }

    fun selectWeek(value: String) {
        val week = value.trim()
        if (week.isEmpty() || week == selectedWeek) return
        selectedWeek = week
        cancelRequest()
        val cached = freshCache(selectedSemester, week)
        if (cached != null) {
            applySnapshot(cached.snapshot)
            if (cached.stale) request(force = false, quiet = true) else prioritizer?.invoke(selectedSemester, week)
            return
        }
        result = null
        load(false)
    }

    fun selectDay(day: Int) {
        if (day in 1..7) selectedDay = day
        persist()
    }

    fun selectViewMode(mode: String) {
        viewMode = normalizedViewMode(mode)
        persist()
    }

    /** Jump to a dated day of the selected term, as the month view does. False when the term has no such date. */
    fun selectDate(date: String): Boolean {
        val week = calendar?.weeks?.firstOrNull { date in it.days } ?: return false
        selectedDay = week.days.indexOf(date) + 1
        if (week.week.toString() != selectedWeek) selectWeek(week.week.toString()) else persist()
        return true
    }

    fun canMoveWeek(delta: Int): Boolean {
        val index = weekOptions().indexOfFirst { it.value == selectedWeek }
        return index >= 0 && index + delta in weekOptions().indices
    }

    fun moveWeek(delta: Int) {
        if (!canMoveWeek(delta)) return
        val index = weekOptions().indexOfFirst { it.value == selectedWeek }
        selectWeek(weekOptions()[index + delta].value)
    }

    /** Back to today: reuse the cached current term when available, else ask the bridge. */
    fun returnToCurrentWeek() {
        selectedDay = todayWeekday()
        val currentSemester = currentSemesterValue()
        val currentWeek = if (currentSemester == selectedSemester) currentWeekValue() else cachedCurrentWeek(currentSemester)
        if (currentSemester.isNotEmpty() && currentWeek.isNotEmpty()) {
            val cached = freshCache(currentSemester, currentWeek)
            if (cached != null) {
                cancelRequest()
                selectedSemester = currentSemester
                selectedWeek = currentWeek
                applySnapshot(cached.snapshot)
                if (revalidates(cached)) request(force = false, quiet = true)
                return
            }
        }
        cancelRequest()
        rememberFallback()
        selectedSemester = ""
        navigationWeeks = emptyList()
        selectedWeek = ""
        result = null
        calendar = null
        load(false)
    }

    /** Bumped by [open] so the screen can close its sheets and show the timetable itself. */
    var openRequests by mutableIntStateOf(0)
        private set

    /** Open the timetable from a widget or a Web link, optionally at a given week. */
    fun open(semester: String?, week: String?) {
        openRequests += 1
        if (!semester.isNullOrBlank() && semester != selectedSemester) {
            rememberFallback()
            selectedSemester = semester
            navigationWeeks = emptyList()
            selectedWeek = week.orEmpty()
            result = null
            calendar = null
            load(false)
            return
        }
        if (!week.isNullOrBlank()) selectWeek(week) else returnToCurrentWeek()
    }

    // endregion

    // region Derived data

    fun semesterOptions(): List<ScheduleOption> = knownSemesters

    /** The term as exports name it: its value, or the name of a shared timetable. */
    fun semesterTitle(): String =
        if (readOnly) knownSemesters.firstOrNull { it.value == selectedSemester }?.label ?: "共享课表" else selectedSemester

    fun weekOptions(): List<ScheduleOption> = result?.weeks?.takeIf { it.isNotEmpty() } ?: navigationWeeks

    fun selectedWeekIndex(): Int = weekOptions().indexOfFirst { it.value == selectedWeek }.coerceAtLeast(0)

    fun currentWeekValue(): String {
        calendar?.currentWeek?.takeIf { it > 0 }?.let { return it.toString() }
        return weekOptions().firstOrNull { it.current }?.value ?: result?.currentWeek.orEmpty()
    }

    /**
     * The term that is running today. The timetable's own semester list marks
     * it; the calendar's list marks whichever term is being viewed, so it is
     * only a fallback.
     */
    fun currentSemesterValue(): String =
        result?.semesters?.firstOrNull { it.current }?.value
            ?: semesterOptions().firstOrNull { it.current }?.value
            ?: calendar?.currentSemester.orEmpty()

    /**
     * Whether a week of the selected term contains today. Calendar dates decide
     * when present: a past term reports its first week as "current".
     */
    fun isCurrentWeek(week: String = selectedWeek): Boolean {
        if (week.isEmpty()) return false
        calendarWeek(week)?.days?.takeIf { it.size == 7 }?.let { return todayKey() in it }
        val current = currentSemesterValue()
        if (current.isNotEmpty() && current != selectedSemester) return false
        return week == currentWeekValue()
    }

    /** The current week recorded in a cached term, so "today" can switch back without a request. */
    private fun cachedCurrentWeek(semester: String): String {
        val snapshot = cache["$semester|*"]?.snapshot ?: return ""
        snapshot.calendar?.currentWeek?.takeIf { it > 0 }?.let { return it.toString() }
        return snapshot.data?.currentWeek.orEmpty()
    }

    /** The data a pager page may show: the selected week, or a cached/complete term. */
    fun resultFor(week: String): ScheduleResult? {
        if (week == selectedWeek) return result
        return freshCache(selectedSemester, week)?.snapshot?.data
    }

    fun blocksForDay(day: Int, week: String = selectedWeek, data: ScheduleResult? = resultFor(week)): List<CourseBlock> {
        var source = data ?: return emptyList()
        var weekNumber = (week.ifEmpty { source.currentWeek }).toIntOrNull()
        var sourceDay = day
        // Holidays and make-up days follow the real date, as on the Web and iOS:
        // a day off has no classes, a swap day holds another date's classes.
        adjustment(day, week)?.let { adjustment ->
            if (adjustment.kind == "off") return emptyList()
            val sourceDate = adjustment.source ?: return emptyList()
            val sourceWeek = calendar?.weeks?.firstOrNull { sourceDate in it.days } ?: return emptyList()
            sourceDay = sourceWeek.days.indexOf(sourceDate) + 1
            if (sourceWeek.week != weekNumber) {
                source = resultFor(sourceWeek.week.toString()) ?: source
                weekNumber = sourceWeek.week
            }
        }
        val blocks = mutableListOf<CourseBlock>()
        source.cells.filter { it.day == sourceDay }.forEach { cell ->
            cell.courses.filter { course ->
                course.weekList.isEmpty() || weekNumber == null || course.weekList.contains(weekNumber)
            }.forEach { course ->
                val fallbackStart = (cell.bigSlot * 2 - 1).coerceIn(1, SLOT_COUNT)
                val fallbackEnd = (cell.bigSlot * 2).coerceIn(fallbackStart, SLOT_COUNT)
                val startSlot = (course.startSlot ?: fallbackStart).coerceIn(1, SLOT_COUNT)
                val endSlot = (course.endSlot ?: fallbackEnd).coerceIn(startSlot, SLOT_COUNT)
                val block = CourseBlock(day, cell.bigSlot, startSlot, endSlot, course)
                val index = blocks.indexOfFirst { canMergeBlocks(it, block) }
                if (index < 0) {
                    blocks += CourseBlock(day, (startSlot + 1) / 2, startSlot, endSlot, courseWithRange(course, startSlot, endSlot))
                } else {
                    val previous = blocks[index]
                    val start = minOf(previous.startSlot, startSlot)
                    val end = maxOf(previous.endSlot, endSlot)
                    blocks[index] = CourseBlock(day, (start + 1) / 2, start, end, courseWithRange(previous.course, start, end, course))
                }
            }
        }
        return blocks.sortedBy { it.startSlot }
    }

    fun overlapping(block: CourseBlock, week: String = selectedWeek): List<CourseBlock> =
        blocksForDay(block.day, week).filter { it.startSlot <= block.endSlot && it.endSlot >= block.startSlot }

    /**
     * One day's courses as they are drawn: a course set to show first covers
     * the periods it shares with the others, and the rest sit side by side.
     */
    fun placedBlocksForDay(day: Int, week: String = selectedWeek, data: ScheduleResult? = resultFor(week)): List<PlacedBlock> =
        SchedulePriority.place(blocksForDay(day, week, data), displayPriorities)

    /** The whole selected semester when it is cached complete; publishing a share needs it. */
    fun completeSnapshot(): ScheduleSnapshot? = cache[selectedSemester + "|*"]?.snapshot

    /** The weekdays a week shows: weekends can be hidden unless a class or a make-up day falls on them. */
    fun visibleDays(week: String, showWeekend: Boolean, data: ScheduleResult? = resultFor(week)): List<Int> =
        visibleDays(week, showWeekend, showWeekend, data)

    fun visibleDays(week: String, showSaturday: Boolean, showSunday: Boolean, data: ScheduleResult? = resultFor(week)): List<Int> =
        (1..7).filter { day ->
            day <= 5 || (if (day == 6) showSaturday else showSunday) ||
                adjustment(day, week)?.kind == "swap" || blocksForDay(day, week, data).isNotEmpty()
        }

    /** The week before [week] in this term, or null at the first one. */
    fun previousWeek(week: String): String? {
        val options = weekOptions()
        val index = options.indexOfFirst { it.value == week }
        return if (index > 0) options[index - 1].value else null
    }

    /**
     * The courses of a weekday that do not run in [week], for the periods
     * [taken] leaves free. Only whole-term data lists other weeks' courses;
     * holidays and make-up days follow their own date and get none.
     */
    fun offWeekBlocksForDay(day: Int, week: String, taken: List<CourseBlock>, data: ScheduleResult? = resultFor(week)): List<CourseBlock> {
        val source = data ?: return emptyList()
        val weekNumber = week.ifEmpty { source.currentWeek }.toIntOrNull() ?: return emptyList()
        if (adjustment(day, week) != null) return emptyList()
        val blocks = mutableListOf<CourseBlock>()
        source.cells.filter { it.day == day }.forEach { cell ->
            cell.courses.filter { it.weekList.isNotEmpty() && weekNumber !in it.weekList }.forEach { course ->
                val fallbackStart = (cell.bigSlot * 2 - 1).coerceIn(1, SLOT_COUNT)
                val fallbackEnd = (cell.bigSlot * 2).coerceIn(fallbackStart, SLOT_COUNT)
                val startSlot = (course.startSlot ?: fallbackStart).coerceIn(1, SLOT_COUNT)
                val endSlot = (course.endSlot ?: fallbackEnd).coerceIn(startSlot, SLOT_COUNT)
                val block = CourseBlock(day, cell.bigSlot, startSlot, endSlot, course)
                val index = blocks.indexOfFirst { it.course.weekList == course.weekList && canMergeBlocks(it, block) }
                if (index < 0) {
                    blocks += CourseBlock(day, (startSlot + 1) / 2, startSlot, endSlot, courseWithRange(course, startSlot, endSlot))
                } else {
                    val previous = blocks[index]
                    val start = minOf(previous.startSlot, startSlot)
                    val end = maxOf(previous.endSlot, endSlot)
                    blocks[index] = CourseBlock(day, (start + 1) / 2, start, end, courseWithRange(previous.course, start, end, course))
                }
            }
        }
        return ScheduleDisplayRules.offWeekBlocks(blocks, taken, weekNumber)
    }

    fun calendarWeek(week: String = selectedWeek): CalendarWeek? {
        val number = (week.ifEmpty { result?.currentWeek.orEmpty() }).toIntOrNull() ?: return null
        return calendar?.weeks?.firstOrNull { it.week == number }
    }

    /** `MM-dd` of a weekday in the given week, or empty when the calendar has no date. */
    fun dayDate(day: Int, week: String = selectedWeek): String {
        val value = calendarWeek(week)?.days?.getOrNull(day - 1).orEmpty()
        return if (value.length >= 10) value.substring(5) else value
    }

    /** The holiday or make-up day that falls on a weekday of the given week, if any. */
    fun adjustment(day: Int, week: String = selectedWeek): ScheduleAdjustment? {
        val adjustments = calendar?.adjustments.orEmpty()
        if (adjustments.isEmpty()) return null
        val date = calendarWeek(week)?.days?.takeIf { it.size == 7 }?.getOrNull(day - 1)?.takeIf { it.isNotEmpty() } ?: return null
        return adjustments.firstOrNull { it.date == date }
    }

    /** Short explanation of an adjustment, worded like the iOS client. */
    fun adjustmentDetail(adjustment: ScheduleAdjustment): String {
        val note = adjustment.note?.trim().orEmpty()
        if (adjustment.kind == "off") return note.ifEmpty { "放假，不上课" }
        val source = adjustment.source ?: return if (note.isEmpty()) "补班，课程待确认" else "$note · 课程待确认"
        // A make-up day says whose classes it holds, not only the holiday's name.
        val swap = "上 ${source.substring(5).replace('-', '.')} 的课"
        return if (note.isEmpty()) swap else "$note · $swap"
    }

    fun isToday(day: Int, week: String = selectedWeek): Boolean {
        val value = calendarWeek(week)?.days?.getOrNull(day - 1) ?: return false
        return value == todayKey()
    }

    fun periodTime(slot: Int): SchedulePeriod =
        periods.firstOrNull { it.number == slot } ?: BUNDLED_PERIODS[(slot - 1).coerceIn(0, BUNDLED_PERIODS.lastIndex)]

    fun timeRange(startSlot: Int, endSlot: Int): String =
        "${periodTime(startSlot).startTime}-${periodTime(endSlot).endTime}"

    // endregion

    // region Widget local schedule

    /**
     * The widgets' local record (docs/schedule-widget-rules.md §7), a port of the
     * Web `buildScheduleWidgetLocalRecord`: the current term's dated days with
     * holidays and make-up days applied, period times and published holidays.
     * Null while another term is shown, so browsing old terms never replaces it.
     */
    fun widgetLocalRecord(): org.json.JSONObject? {
        val data = result ?: return null
        val calendar = calendar ?: return null
        val semester = data.currentSemester.trim()
        if (semester.isEmpty() || calendar.weeks.isEmpty()) return null
        if (!calendar.currentSemester.isNullOrEmpty() && calendar.currentSemester != semester) return null
        val running = data.semesters.firstOrNull { it.current }?.value
        if (running != null && running != semester) return null
        val complete = cache.containsKey("$semester|*")
        val days = java.util.TreeMap<String, org.json.JSONObject>()
        for (week in calendar.weeks) {
            val weekKey = week.week.toString()
            val source = if (complete) data else freshCache(semester, weekKey)?.snapshot?.data ?: continue
            week.days.forEachIndexed { index, date ->
                if (date.length != 10 || days.containsKey(date)) return@forEachIndexed
                val day = index + 1
                val courses = blocksForDay(day, weekKey, source).map { block ->
                    val course = block.course
                    val slotNote = (course.sourceNote ?: course.slotNote)?.trim()?.takeIf { it.isNotEmpty() }
                    org.json.JSONObject()
                        .put("name", course.name)
                        .put("teacher", course.teacher?.trim()?.takeIf { it.isNotEmpty() } ?: org.json.JSONObject.NULL)
                        .put("location", course.location?.trim()?.takeIf { it.isNotEmpty() } ?: org.json.JSONObject.NULL)
                        // Like the server: the period note first, else the course weeks.
                        .put("note", slotNote ?: course.weeks.trim().takeIf { it.isNotEmpty() } ?: org.json.JSONObject.NULL)
                        .put("slotNote", slotNote ?: org.json.JSONObject.NULL)
                        .put("startTime", periodTime(block.startSlot).startTime)
                        .put("endTime", periodTime(block.endSlot).endTime)
                        .put("startSlot", block.startSlot)
                        .put("endSlot", block.endSlot)
                }.sortedWith(compareBy({ it.optString("startTime") }, { it.optString("name") }))
                days[date] = org.json.JSONObject().put("day", day).put("label", WEEKDAY_LABELS[day - 1])
                    .put("date", date).put("week", week.week).put("courses", org.json.JSONArray(courses))
            }
        }
        if (days.isEmpty()) return null
        val holidays = org.json.JSONArray()
        calendar.adjustments.filter { it.kind == "off" }.sortedBy { it.date }.forEach { adjustment ->
            // The statutory holiday named first in the note, as iOS PublishedHoliday.fromOffDays.
            val note = adjustment.note.orEmpty()
            val name = STATUTORY_HOLIDAYS.map { it to note.indexOf(it) }.filter { it.second >= 0 }.minByOrNull { it.second }?.first
            if (name != null) holidays.put(org.json.JSONObject().put("date", adjustment.date).put("name", name))
        }
        return org.json.JSONObject().put("semester", semester).put("complete", complete)
            .put("days", org.json.JSONArray(days.values.toList())).put("holidays", holidays)
    }

    // endregion

    // region Merging (ported from HarmonyOS; keep in step with the Web card merge)

    private fun canMergeBlocks(left: CourseBlock, right: CourseBlock): Boolean {
        if (left.course.customId != null || right.course.customId != null) {
            return left.course.customId == right.course.customId && rangesOverlap(left, right)
        }
        val sameName = identityPart(left.course.name) == identityPart(right.course.name)
        val sameTeacher = compatible(teacherIdentity(left.course.teacher), teacherIdentity(right.course.teacher))
        val sameLocation = compatible(locationIdentity(left.course.location), locationIdentity(right.course.location))
        val adjacent = left.endSlot + 1 == right.startSlot || right.endSlot + 1 == left.startSlot
        val leftIdentity = explicitIdentity(left.course)
        val rightIdentity = explicitIdentity(right.course)
        if (leftIdentity.isNotEmpty() && rightIdentity.isNotEmpty() && leftIdentity != rightIdentity) return false
        return sameName && sameTeacher && sameLocation && (rangesOverlap(left, right) || adjacent)
    }

    private fun rangesOverlap(left: CourseBlock, right: CourseBlock) =
        left.startSlot <= right.endSlot && right.startSlot <= left.endSlot

    private fun compatible(a: String, b: String) = a.isEmpty() || b.isEmpty() || a == b

    private fun explicitIdentity(course: ScheduleCourse): String {
        course.sourceKey?.let { return "source:$it" }
        val native = course.nativeId.orEmpty()
        return if (native.startsWith("source:") || native.startsWith("custom:")) native else ""
    }

    private fun identityPart(value: String?): String =
        Normalizer.normalize(value.orEmpty(), Normalizer.Form.NFKC).lowercase()
            .replace(Regex("\\s+"), "")
            .replace(Regex("[.,，。:：;；/\\\\()\\[\\]{}【】_—–~～-]+"), "")

    private fun teacherIdentity(value: String?): String = identityPart(value).replace(TEACHER_TITLE, "")

    private fun locationIdentity(value: String?): String {
        val compact = identityPart(value)
        val match = Regex("[a-z]?\\d{2,4}[a-z]?$", RegexOption.IGNORE_CASE).find(compact) ?: return compact
        val prefix = compact.substring(0, compact.length - match.value.length)
        return if (prefix.isEmpty() || !Regex("[a-z0-9]$", RegexOption.IGNORE_CASE).containsMatchIn(prefix)) match.value else compact
    }

    private fun courseWithRange(course: ScheduleCourse, start: Int, end: Int, next: ScheduleCourse? = null): ScheduleCourse {
        val weekList = (course.weekList + next?.weekList.orEmpty()).distinct().sorted()
        return course.copy(
            nativeId = course.nativeId ?: next?.nativeId,
            teacher = course.teacher ?: next?.teacher,
            weeks = if (weekList.isNotEmpty()) weekText(weekList) else course.weeks.ifEmpty { next?.weeks.orEmpty() },
            weekList = weekList,
            location = course.location ?: next?.location,
            slotNote = slotLabel(start, end),
            sourceNote = course.sourceNote ?: course.slotNote,
            startSlot = start,
            endSlot = end,
        )
    }

    // endregion

    // region Cache

    private fun applySnapshot(snapshot: ScheduleSnapshot) {
        val data = snapshot.data ?: return
        result = data
        navigationWeeks = data.weeks
        learnSemesters(snapshot)
        clearFallback()
        calendar = snapshot.calendar
        // Keep supplied period times when an older bridge only knows eleven slots.
        val suppliedPeriods = snapshot.periods.associateBy { it.number }
        periods = BUNDLED_PERIODS.map { suppliedPeriods[it.number] ?: it }
        if (selectedSemester.isEmpty()) selectedSemester = data.currentSemester
        if (selectedWeek.isEmpty()) {
            selectedWeek = data.currentWeek.ifEmpty { snapshot.calendar?.currentWeek?.takeIf { it > 0 }?.toString().orEmpty() }
        }
        source = snapshot.source ?: data.source.orEmpty()
        lastUpdatedAt = snapshot.fetchedAt
        if (!authorizationExpired) errorMessage = ""
        status = ScheduleStatus.Loaded
        persist()
    }

    private fun fail(message: String) {
        val text = message.ifEmpty { "课表暂时无法加载，请重试" }
        if (result == null && returnToFallback()) {
            val label = knownSemesters.firstOrNull { it.value == failedSemester }?.label ?: failedSemester
            errorMessage = if (label.isEmpty()) text else "$label 的课表无法读取：$text"
            return
        }
        errorMessage = text
        status = if (result != null) ScheduleStatus.Loaded else ScheduleStatus.Failed
    }

    private fun rememberFallback() {
        // A chain of failing switches keeps the last term that actually loaded.
        if (result == null || selectedSemester.isEmpty()) return
        fallbackSemester = selectedSemester
        fallbackWeek = selectedWeek
    }

    private fun clearFallback() {
        fallbackSemester = ""
        fallbackWeek = ""
    }

    /** Shows the term from before a failed switch again, if it is still cached. */
    private fun returnToFallback(): Boolean {
        val semester = fallbackSemester
        val week = fallbackWeek
        clearFallback()
        if (semester.isEmpty() || semester == selectedSemester) return false
        val cached = freshCache(semester, week) ?: return false
        failedSemester = selectedSemester
        selectedSemester = semester
        selectedWeek = week
        applySnapshot(cached.snapshot)
        return true
    }

    private fun learnSemesters(snapshot: ScheduleSnapshot) {
        if (knownSemesters.isNotEmpty()) return
        val merged = LinkedHashMap<String, ScheduleOption>()
        snapshot.data?.semesters.orEmpty().forEach { option ->
            val value = option.value.trim()
            if (value.isEmpty()) return@forEach
            val previous = merged[value]
            merged[value] = previous?.copy(current = previous.current || option.current)
                ?: option.copy(value = value, label = option.label.ifBlank { value })
        }
        var options = merged.values.toList()
        // JWXT lists terms newest first; keep that order across merged lists.
        if (options.all { TERM_VALUE.matches(it.value) }) options = options.sortedByDescending { it.value }
        if (options != knownSemesters) knownSemesters = options
    }

    private fun remember(snapshot: ScheduleSnapshot, stale: Boolean, persist: Boolean = true) {
        val data = snapshot.data ?: return
        val semester = data.currentSemester
        val entry = CacheEntry(snapshot, snapshot.fetchedAt, stale)
        learnSemesters(snapshot)
        if (snapshot.completeSemester) {
            cache.keys.filter { it.startsWith("$semester|") }.forEach(cache::remove)
            cache["$semester|*"] = entry
        } else {
            cache["$semester|${data.currentWeek}"] = entry
        }
        trimCache()
        dataRevision += 1
        if (persist) persist()
    }

    private fun freshCache(semester: String, week: String): CacheEntry? {
        if (semester.isEmpty()) return null
        val key = if (cache.containsKey("$semester|*")) "$semester|*" else "$semester|$week"
        val entry = cache[key] ?: return null
        val lifetime = if (entry.stale) ARCHIVE_LIFETIME_MS else CACHE_LIFETIME_MS
        if (clock() - entry.savedAt > lifetime) {
            cache.remove(key)
            return null
        }
        return entry
    }

    private fun trimCache() {
        val semesters = cache.keys.map { it.substringBefore('|') }.distinct().toMutableList()
        while (semesters.size > MAX_SEMESTERS) {
            val oldest = semesters.removeAt(0)
            cache.keys.filter { it.startsWith("$oldest|") }.forEach(cache::remove)
        }
    }

    private fun persist() {
        val archive = archive ?: return
        if (accountScope.isEmpty() || cache.isEmpty()) return
        archive.write(
            ScheduleArchive.Saved(
                account = accountScope,
                semester = selectedSemester,
                week = selectedWeek,
                day = selectedDay,
                viewMode = viewMode,
                snapshots = cache.values.map { it.snapshot.raw },
            ),
        )
    }

    // endregion

    companion object {
        const val CACHE_LIFETIME_MS = 12L * 60 * 60 * 1000
        /** The seven statutory holidays the server's adjustment notes name. */
        val STATUTORY_HOLIDAYS = listOf("元旦", "春节", "清明节", "劳动节", "端午节", "中秋节", "国庆节")
        const val ARCHIVE_LIFETIME_MS = 30L * 24 * 60 * 60 * 1000
        const val REQUEST_TIMEOUT_MS = 60_000L
        const val MAX_SEMESTERS = 4
        private val TERM_VALUE = Regex("\\d{4}-\\d{4}-[123]")
        private val TEACHER_TITLE = Regex(
            "(?:其他正高级|其他副高级|正高级|副高级|主任医师|副主任医师|高级实验师|副研究员|实验师|研究员|副教授|教授|讲师|助教|未评级)$",
        )

        fun normalizedViewMode(mode: String): String = if (mode == "day" || mode == "month") mode else "week"

        private fun parsePriorities(raw: String?): Map<String, Map<String, Int>> {
            val json = raw?.let { runCatching { org.json.JSONObject(it) }.getOrNull() } ?: return emptyMap()
            val result = mutableMapOf<String, Map<String, Int>>()
            for (semester in json.keys()) {
                val item = json.optJSONObject(semester) ?: continue
                val values = item.keys().asSequence().associateWith { item.optInt(it, 0) }.filter { it.value > 0 }
                if (values.isNotEmpty()) result[semester] = values
            }
            return result
        }

        fun todayWeekday(): Int {
            val day = Calendar.getInstance().get(Calendar.DAY_OF_WEEK)
            return if (day == Calendar.SUNDAY) 7 else day - 1
        }

        fun todayKey(offsetDays: Int = 0): String {
            val calendar = Calendar.getInstance()
            calendar.add(Calendar.DAY_OF_YEAR, offsetDays)
            return String.format(
                java.util.Locale.US, "%04d-%02d-%02d",
                calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH) + 1, calendar.get(Calendar.DAY_OF_MONTH),
            )
        }

        fun slotLabel(start: Int, end: Int): String {
            val first = start.toString().padStart(2, '0')
            return if (start == end) "${first}节" else "$first-${end.toString().padStart(2, '0')}节"
        }

        fun weekText(values: List<Int>): String {
            if (values.isEmpty()) return ""
            val ranges = mutableListOf<String>()
            var start = values[0]
            var end = values[0]
            values.drop(1).forEach { value ->
                if (value == end + 1) {
                    end = value
                } else {
                    ranges += if (start == end) "$start" else "$start-$end"
                    start = value
                    end = value
                }
            }
            ranges += if (start == end) "$start" else "$start-$end"
            return ranges.joinToString("、") + "周"
        }
    }
}
