package cn.lizmt.cpuweb.schedule

import android.content.SharedPreferences
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.RadioButtonUnchecked
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Somebody else's timetable drawn over the user's (the couple timetable, or a
 * shared one laid on top) may come from another school with other bells:
 * NJMU's third period is not CPU's. Their courses are placed on the user's
 * periods by clock time and keep their real clock times for every label
 * (iOS `ScheduleOverlayTiming`).
 */
object OverlayTiming {
    data class Period(val number: Int, val start: Int, val end: Int)

    /** Minutes since midnight of "HH:mm". */
    fun minutes(value: String): Int? {
        val parts = value.split(':').mapNotNull { it.trim().toIntOrNull() }
        if (parts.size < 2 || parts[0] !in 0..23 || parts[1] !in 0..59) return null
        return parts[0] * 60 + parts[1]
    }

    fun periods(value: List<SchedulePeriod>): List<Period> = value.mapNotNull { period ->
        val start = minutes(period.startTime) ?: return@mapNotNull null
        val end = minutes(period.endTime) ?: return@mapNotNull null
        Period(period.number, start, end)
    }.sortedBy { it.start }

    /**
     * The user's periods that a class from [start] to [end] (minutes) covers:
     * from the first period still running at its start to the last one begun
     * before its end. A class wholly inside a break takes the nearest period.
     */
    fun place(start: Int, end: Int, mine: List<Period>): Pair<Int, Int>? {
        if (mine.isEmpty()) return null
        val first = mine.firstOrNull { it.end > start }
        val last = mine.lastOrNull { it.start < end }
        if (first != null && last != null && first.number <= last.number) return first.number to last.number
        val middle = (start + end) / 2
        val nearest = mine.minBy { abs((it.start + it.end) / 2 - middle) }
        return nearest.number to nearest.number
    }

    /** Whether two bell schedules agree on every period both have: period numbers can then be used as they are. */
    fun sameBells(theirs: List<Period>, mine: List<Period>): Boolean {
        val own = mine.associateBy { it.number }
        return theirs.all { own[it.number] == it }
    }

    fun clock(minutes: Int): String = "%02d:%02d".format(minutes / 60, minutes % 60)

    /** [block], read with their bells, moved onto the user's; its course keeps its real clock times. */
    fun remap(block: CourseBlock, theirs: List<Period>, mine: List<Period>): CourseBlock {
        if (sameBells(theirs, mine)) return block
        val course = block.course
        val start = course.customStartTime?.let(::minutes) ?: theirs.firstOrNull { it.number == block.startSlot }?.start ?: return block
        val end = course.customEndTime?.let(::minutes) ?: theirs.firstOrNull { it.number == block.endSlot }?.end ?: return block
        if (end <= start) return block
        val (first, last) = place(start, end, mine) ?: return block
        return block.copy(
            bigSlot = (first + 1) / 2, startSlot = first, endSlot = last,
            course = course.copy(customStartTime = clock(start), customEndTime = clock(end), startSlot = first, endSlot = last),
        )
    }

    /** Their school when it is named and is not the user's own. */
    fun otherSchool(theirs: String, mine: String): String? = theirs.trim().takeIf { it.isNotEmpty() && it != mine.trim() }
}

/** Which saved shared timetable is laid over the user's (叠加到我的课表); kept on this device, empty for none. */
class OverlayChoice(private val preferences: SharedPreferences?) {
    var code by mutableStateOf(preferences?.getString(KEY, "").orEmpty())
        private set

    fun select(value: String) {
        code = value
        preferences?.edit()?.putString(KEY, value)?.apply()
    }

    private companion object {
        const val KEY = "overlay_code"
    }
}

/**
 * 叠加到我的课表: whose courses are drawn beside the user's own. The
 * partner's (情侣课表), one of the saved shared timetables, or nobody's.
 * Somebody at another school is placed by clock time.
 */
@Composable
internal fun OverlayPickerSheet(
    activity: MainActivity,
    onSharing: () -> Unit,
    onCouple: () -> Unit,
    onDismiss: () -> Unit,
) {
    val couple = activity.couple
    val choice = activity.overlay
    val bound = couple.active
    val current = when {
        choice.code.isNotEmpty() && activity.sharing.library.schedules.any { it.meta.code == choice.code } -> "shared:" + choice.code
        bound != null && couple.visible -> "couple"
        else -> "nobody"
    }
    ScheduleSheetContainer(onDismiss) {
        SheetTitle("叠加到我的课表")
        Row(verticalAlignment = Alignment.Top) {
            Box(Modifier.size(40.dp)) {
                Box(Modifier.offset(x = 4.dp, y = 8.dp).size(22.dp, 30.dp).clip(RoundedCornerShape(7.dp)).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.85f)))
                Box(Modifier.offset(x = 14.dp, y = 2.dp).size(22.dp, 30.dp).clip(RoundedCornerShape(7.dp)).background(OverlayTeal.copy(alpha = 0.85f)))
            }
            Spacer(Modifier.width(12.dp))
            Text("选一个人的课表，和你的课并排显示：一起上课、谁有空，一眼就能看出来。别的学校的同学也可以，课会按实际上课时间对齐。",
                fontSize = 13.sp, lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        }
        SettingsSection("情侣")
        if (bound != null) {
            val school = couple.partnerStore?.calendar?.school.orEmpty()
            OverlayChoiceRow(
                bound.partner.nickname.ifEmpty { "TA" },
                listOfNotNull(school.takeIf { it.isNotEmpty() }, if (couple.partnerStore == null) "还没有同步课表" else "情侣课表").joinToString(" · "),
                Icons.Rounded.Favorite, CoupleAccent, current == "couple",
            ) {
                choice.select("")
                couple.updateVisible(true)
            }
        } else {
            OverlayActionRow("绑定情侣课表", Icons.Rounded.FavoriteBorder, CoupleAccent, onCouple)
        }
        SettingsSection("同学的分享课表")
        val schedules = activity.sharing.library.schedules
        schedules.forEach { schedule ->
            OverlayChoiceRow(
                schedule.name,
                listOfNotNull(schedule.school.takeIf { it.isNotEmpty() }, "${schedule.courseCount} 门课",
                    "对方已停止分享".takeIf { schedule.revoked }).joinToString(" · "),
                null, OverlayTeal, current == "shared:" + schedule.meta.code, initial = schedule.name.take(1),
            ) { choice.select(schedule.meta.code) }
        }
        OverlayActionRow(if (schedules.isEmpty()) "输入同学的分享码" else "再添加一份", Icons.Rounded.Add, OverlayTeal, onSharing)
        Text("分享码保存在这台设备上；对方更新课表后，这里也会跟着更新。", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp))
        Spacer(Modifier.height(10.dp))
        OverlayChoiceRow("不叠加", "只看自己的课", Icons.Rounded.Person, Color.Gray, current == "nobody") {
            choice.select("")
            if (bound != null) couple.updateVisible(false)
        }
    }
}

@Composable
private fun OverlayChoiceRow(
    title: String, detail: String, icon: androidx.compose.ui.graphics.vector.ImageVector?, tint: Color, selected: Boolean,
    initial: String = "", onClick: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick)
            .semantics(mergeDescendants = true) { this.selected = selected }.padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(tint), contentAlignment = Alignment.Center) {
            if (icon != null) Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
            else Text(initial, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(detail, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(if (selected) Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked, contentDescription = null,
            tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline)
    }
}

@Composable
private fun OverlayActionRow(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector, tint: Color, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(tint.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(title, fontSize = 16.sp, color = tint)
    }
}

internal val OverlayTeal = Color(0xFF1E9C94)

/** One date of the overlay strip. */
internal data class OverlayStripPage(val week: Int, val day: Int, val date: String)

internal object OverlayStripRules {
    /** A phone held upright shows three days; a wider window up to seven. */
    fun dayCount(width: Float, axis: Float): Int = min(7, max(3, ((width - axis) / 96f).toInt()))

    /** The leftmost day for a selected date: that date or the first after it; near the end of term the last full screen. */
    fun leadingIndex(selection: String?, pages: List<OverlayStripPage>, count: Int): Int? {
        if (pages.isEmpty()) return null
        val index = selection?.let { date -> pages.indexOfFirst { it.date >= date }.takeIf { it >= 0 } } ?: pages.lastIndex
        return max(0, min(index, pages.size - count))
    }

    /** Every dated day of the term, in order. */
    fun pages(calendar: ScheduleCalendar?): List<OverlayStripPage> = calendar?.weeks.orEmpty().sortedBy { it.week }.flatMap { week ->
        week.days.mapIndexedNotNull { index, date -> if (date.length == 10) OverlayStripPage(week.week, index + 1, date) else null }
    }

    /**
     * Courses that overlap in a half-width column become one card: the first
     * one drawn, with how many more are behind it.
     */
    fun clusters(blocks: List<PlacedBlock>): List<Pair<PlacedBlock, Int>> {
        val ordered = blocks.sortedWith(compareBy({ it.startSlot }, { -it.span }, { it.course.name }))
        val result = mutableListOf<Pair<PlacedBlock, MutableList<PlacedBlock>>>()
        var end = Int.MIN_VALUE
        for (block in ordered) {
            if (result.isNotEmpty() && block.startSlot <= end) {
                result.last().second += block
                end = max(end, block.endSlot)
            } else {
                result += block to mutableListOf()
                end = block.endSlot
            }
        }
        return result.map { (first, rest) ->
            val last = max(first.endSlot, rest.maxOfOrNull { it.endSlot } ?: first.endSlot)
            first.copy(endSlot = last, lane = 0, lanes = 1) to rest.size
        }
    }
}

/**
 * The week view while somebody else's timetable is laid over the user's:
 * consecutive days side by side, each split into the user's own column and a
 * column of the other person's courses as hollow outlined cards. The period
 * axis stays put while the days slide past one at a time, and the leftmost
 * day is the browsing position the week title and arrows follow
 * (NapTable's `ScheduleOverlayStrip`, as on iOS).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun OverlayStrip(
    store: ScheduleStore,
    layer: CoupleLayer,
    height: Dp,
    rowScale: Float,
    now: Int?,
    onCourse: (PlacedBlock, String) -> Unit,
    onOpenDay: (OverlayStripPage) -> Unit,
) {
    val scope = LocalScheduleStyle.current
    val colors = LocalScheduleColors.current
    val classic = scope.style == ScheduleVisualStyle.Classic
    val periods = (1..store.slotCount).map(store::periodTime)
    val pages = remember(store.calendar) { OverlayStripRules.pages(store.calendar) }
    val selection = store.calendarWeek()?.days?.getOrNull(store.selectedDay - 1)?.takeIf { it.length == 10 }
    val today = ScheduleStore.todayKey()
    val header = 44.dp
    val rowHeight = (styledWeekRowHeight(height.value - 4f, scope.style, periods.size) * rowScale).dp
    val gap = StyledSlotGap
    val gridHeight = rowHeight * periods.size + gap * (periods.size - 1)
    val pad = if (classic) 0.dp else styledPanelPadding(scope.style)
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val inner = maxWidth - pad * 2
        val count = OverlayStripRules.dayCount(inner.value, StyledAxisWidth.value)
        val dayWidth = (inner - StyledAxisWidth) / count
        val columnGap = 2.dp
        val dayGap = 4.dp
        val columnWidth = ((dayWidth - dayGap - columnGap) / 2).coerceAtLeast(20.dp)
        val initial = OverlayStripRules.leadingIndex(selection, pages, count) ?: 0
        val list = rememberLazyListState(initialFirstVisibleItemIndex = initial)
        // The page asked for another date (arrows, week list, 回到今天): scroll there.
        LaunchedEffect(selection, count, pages) {
            val target = OverlayStripRules.leadingIndex(selection, pages, count) ?: return@LaunchedEffect
            if (list.isScrollInProgress) return@LaunchedEffect
            if (list.firstVisibleItemIndex != target || list.firstVisibleItemScrollOffset != 0) list.animateScrollToItem(target)
        }
        // The user slid the strip: the new leftmost day becomes the selection.
        LaunchedEffect(list, pages) {
            snapshotFlow { list.isScrollInProgress to list.firstVisibleItemIndex }.distinctUntilChanged().collect { (moving, index) ->
                if (moving) return@collect
                val page = pages.getOrNull(index) ?: return@collect
                val shown = store.calendarWeek()?.days?.getOrNull(store.selectedDay - 1)
                if (page.date == shown) return@collect
                // The strip stops at its last full screen: a later selected day there stays selected.
                if (OverlayStripRules.leadingIndex(shown, pages, count) == index) return@collect
                store.selectDay(page.day)
                if (page.week.toString() != store.selectedWeek) store.selectWeek(page.week.toString())
            }
        }
        val nowY = if (now != null && !scope.static && pages.any { it.date == today }) nowPosition(now, periods, rowHeight.value, gap.value)?.first else null
        Box(
            Modifier.fillMaxWidth().then(if (classic) Modifier else Modifier.scheduleSurface(20.dp, panel = true, border = scope.style.framesPanel))
                .padding(pad),
        ) {
            Row {
                Column(Modifier.width(StyledAxisWidth)) {
                    Box(Modifier.width(StyledAxisWidth).height(header), contentAlignment = Alignment.Center) {
                        val leading = pages.getOrNull(list.firstVisibleItemIndex)
                        Text(leading?.let { monthLabel(it.date) } ?: "节次", fontSize = 11.sp, fontWeight = FontWeight.Bold,
                            fontFamily = scope.fontFamily, color = scope.meta, maxLines = 1)
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(gap)) {
                        periods.forEachIndexed { index, period ->
                            StyledSlotLabel(
                                period,
                                startsSession = index == 0 ||
                                    ScheduleStyleTime.session(periods[index - 1].startTime) != ScheduleStyleTime.session(period.startTime),
                                rowHeight = rowHeight, modifier = Modifier.width(StyledAxisWidth).height(rowHeight),
                            )
                        }
                    }
                }
                LazyRow(
                    state = list, flingBehavior = rememberSnapFlingBehavior(list), modifier = Modifier.width(inner - StyledAxisWidth),
                ) {
                    itemsIndexed(pages, key = { _, page -> page.date }) { _, page ->
                        val weekValue = page.week.toString()
                        val data = store.resultFor(weekValue)
                        val mine = remember(page, data, store.dataRevision, store.occurrenceChanges, store.displayPriorities) {
                            if (data == null) emptyList() else store.placedBlocksForDay(page.day, weekValue, data)
                        }
                        val theirs = remember(page, layer) { layer.blocksOn(page.date).orEmpty() }
                        val isToday = page.date == today
                        val adjustment = store.adjustment(page.day, weekValue)?.kind
                        Column(
                            Modifier.width(dayWidth).padding(horizontal = dayGap / 2)
                                .then(if (isToday && !scope.static) Modifier.clip(RoundedCornerShape(12.dp)).background(scope.themeTint(scope.todayStrength)) else Modifier),
                        ) {
                            OverlayDayHeader(page, isToday, adjustment, layer.partnerName, columnWidth, columnGap, header,
                                count = mine.size + theirs.size) { onOpenDay(page) }
                            Box(Modifier.height(gridHeight)) {
                                Row(horizontalArrangement = Arrangement.spacedBy(columnGap)) {
                                    OverlayColumn(mine, periods, rowHeight, columnWidth, hollow = false, layer = layer, colors = colors) { onCourse(it, weekValue) }
                                    val together = mine.map(CoupleRules::key).toSet()
                                    OverlayColumn(
                                        theirs.map { it.copy(owner = CoupleOwner.Partner) }, periods, rowHeight, columnWidth, hollow = true, layer = layer,
                                        colors = colors, together = together,
                                    ) { onCourse(it, weekValue) }
                                }
                                if (isToday && nowY != null) ScheduleNowLine(Modifier.offset(y = nowY.dp - 3.5.dp).width(columnWidth * 2 + columnGap))
                            }
                        }
                    }
                }
            }
            if (nowY != null) {
                Box(Modifier.offset(y = header + nowY.dp - 8.dp).width(StyledAxisWidth), contentAlignment = Alignment.Center) { ScheduleNowBadge(now!!) }
            }
        }
    }
}

@Composable
private fun OverlayDayHeader(
    page: OverlayStripPage, today: Boolean, adjustment: String?, otherName: String, columnWidth: Dp, columnGap: Dp, height: Dp,
    count: Int, onClick: () -> Unit,
) {
    val scope = LocalScheduleStyle.current
    val tint = if (today) scope.themeText else scope.meta
    Column(
        Modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(10.dp)).clickable(onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = listOfNotNull(WEEKDAY_LABELS[page.day - 1], OccurrenceRules.dateText(page.date),
                    adjustment?.let { if (it == "off") "休息" else "补班" }, if (count > 0) "$count 门课" else "没有课", "打开这一天的日视图").joinToString("，")
            },
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(WEEKDAY_LABELS[page.day - 1].removePrefix("周"), fontSize = 13.sp, lineHeight = 15.sp, fontWeight = FontWeight.Bold,
                fontFamily = scope.textFamily, color = tint)
            Spacer(Modifier.width(3.dp))
            Text(page.date.substring(5).replace('-', '.'), fontSize = 11.sp, lineHeight = 13.sp, fontWeight = FontWeight.SemiBold,
                fontFamily = scope.fontFamily, color = tint, maxLines = 1)
            if (adjustment != null) ScheduleAdjustmentMark(adjustment)
        }
        Spacer(Modifier.height(3.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(columnGap)) {
            OverlayLegend("我", hollow = false, columnWidth)
            OverlayLegend(otherName.ifEmpty { "TA" }, hollow = true, columnWidth)
        }
    }
}

@Composable
private fun OverlayLegend(text: String, hollow: Boolean, width: Dp) {
    val scope = LocalScheduleStyle.current
    val ink = scope.meta
    Row(Modifier.width(width), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        Box(Modifier.size(6.dp).clip(RoundedCornerShape(1.5.dp)).then(
            if (hollow) Modifier.border(1.dp, ink, RoundedCornerShape(1.5.dp)) else Modifier.background(ink),
        ))
        Spacer(Modifier.width(2.5.dp))
        Text(text, fontSize = 9.sp, lineHeight = 11.sp, fontWeight = FontWeight.SemiBold, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** One person's column of a day: their courses at their periods, overlaps folded into one card with 「+N」. */
@Composable
private fun OverlayColumn(
    blocks: List<PlacedBlock>,
    periods: List<SchedulePeriod>,
    rowHeight: Dp,
    width: Dp,
    hollow: Boolean,
    layer: CoupleLayer,
    colors: ScheduleColors,
    together: Set<String> = emptySet(),
    onCourse: (PlacedBlock) -> Unit,
) {
    val scope = LocalScheduleStyle.current
    val gap = StyledSlotGap
    val step = rowHeight + gap
    Box(Modifier.width(width).height(rowHeight * periods.size + gap * (periods.size - 1))) {
        Column(verticalArrangement = Arrangement.spacedBy(gap)) {
            periods.forEach { _ ->
                Box(Modifier.width(width).height(rowHeight).clip(RoundedCornerShape(6.dp))
                    .background(if (scope.style == ScheduleVisualStyle.Classic) colors.cell.copy(alpha = 0.6f) else scope.cellSurface.copy(alpha = 0.55f)))
            }
        }
        OverlayStripRules.clusters(blocks).forEach { (block, more) ->
            val first = periods.indexOfFirst { it.number == block.startSlot }.coerceAtLeast(0)
            val span = max(1, block.endSlot - block.startSlot + 1)
            val tileHeight = rowHeight * span + gap * (span - 1)
            val place = Modifier.offset(y = step * first).width(width).height(tileHeight)
            Box(place.cancelledFade(block).courseTap(block) { onCourse(block) }.semantics {
                contentDescription = (if (hollow) layer.ownerTitle + "，" else "") + (occurrenceTag(block)?.let { "$it，" } ?: "") +
                    courseAccessibility(block.block) + if (more > 0) "，还有 $more 门课同时" else ""
            }) {
                if (hollow) OverlayHollowTile(block.course, tileHeight, together = CoupleRules.key(block) in together)
                else if (scope.style == ScheduleVisualStyle.Classic) {
                    val tone = scheduleCardTone(block.course.name, scope.palette, colors.dark)
                    Box(Modifier.fillMaxSize().clip(RoundedCornerShape(8.dp))
                        .background(Brush.verticalGradient(listOf(Color(tone.highlight), Color(tone.fill))))
                        .border(1.dp, Color(tone.border), RoundedCornerShape(8.dp)).padding(2.dp), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            occurrenceTag(block)?.let { ScheduleCardTag(it, Color(tone.text)) }
                            Text(block.course.name, fontSize = 10.sp, lineHeight = 12.sp, fontWeight = FontWeight.Medium, color = Color(tone.text),
                                textAlign = TextAlign.Center, maxLines = if (span == 1) 2 else 5, overflow = TextOverflow.Ellipsis)
                        }
                    }
                } else {
                    StyledCourseTile(block.course, Modifier.fillMaxSize(), tileHeight, compact = true, showLocation = width >= 36.dp,
                        tag = occurrenceTag(block))
                }
                if (more > 0) {
                    Text("+$more", fontSize = 9.sp, lineHeight = 11.sp, fontWeight = FontWeight.Bold, color = Color.White,
                        modifier = Modifier.align(Alignment.BottomEnd).padding(2.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.55f))
                            .padding(horizontal = 4.dp))
                }
            }
        }
    }
}

/**
 * A course of the other person's in the strip: no fill of its own, only an
 * outline and lettering in the course's colour, so it reads apart from the
 * user's solid cards beside it. Dashed where the user's cards are outlined too.
 */
@Composable
private fun OverlayHollowTile(course: ScheduleCourse, height: Dp, together: Boolean) {
    val scope = LocalScheduleStyle.current
    val accent = Color(scope.course(course.name).accent(scope.dark))
    val radius = if (scope.style == ScheduleVisualStyle.Classic) 9.dp else max(2f, scope.style.cornerRadius).dp
    val dashed = scope.style == ScheduleVisualStyle.Classic || scope.style.borderWidth > 0f
    val fill = when {
        scope.hasBackground -> if (scope.dark) Color.Black.copy(alpha = 0.34f) else Color.White.copy(alpha = 0.66f)
        scope.dark -> Color.White.copy(alpha = 0.04f)
        else -> Color.White.copy(alpha = 0.8f)
    }
    val short = height < 64.dp
    Box(
        Modifier.fillMaxSize().clip(RoundedCornerShape(radius)).background(fill).background(accent.copy(alpha = if (scope.dark) 0.10f else 0.05f))
            .drawBehind {
                val stroke = 1.2.dp.toPx()
                drawRoundRect(
                    accent.copy(alpha = if (scope.dark) 0.85f else 0.75f), topLeft = Offset(stroke / 2, stroke / 2),
                    size = Size(size.width - stroke, size.height - stroke), cornerRadius = CornerRadius(radius.toPx()),
                    style = Stroke(stroke, pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 2.5.dp.toPx())) else null),
                )
            }
            .padding(horizontal = 3.dp, vertical = if (short) 3.dp else 5.dp),
        contentAlignment = Alignment.TopStart,
    ) {
        Column {
            Text(course.name, fontSize = if (short) 10.sp else 11.sp, lineHeight = if (short) 12.sp else 13.sp, fontWeight = FontWeight.Bold,
                fontFamily = scope.textFamily, color = accent, maxLines = if (short) 2 else 4, overflow = TextOverflow.Ellipsis)
            ScheduleStyleTime.location(course.location)?.takeIf { !short }?.let {
                Text("@$it", fontSize = 9.sp, lineHeight = 11.sp, fontWeight = FontWeight.SemiBold, fontFamily = scope.textFamily,
                    color = accent.copy(alpha = 0.85f), maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
        if (together) Icon(Icons.Rounded.Favorite, contentDescription = null, tint = CoupleAccent,
            modifier = Modifier.align(Alignment.TopEnd).size(8.dp))
    }
}
