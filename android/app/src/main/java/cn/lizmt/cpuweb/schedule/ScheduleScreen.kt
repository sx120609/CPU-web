package cn.lizmt.cpuweb.schedule

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.CompositionLocalProvider
import android.os.Build
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.NearMe
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import kotlin.math.max
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop

/** Sheets presented over the timetable. */
sealed interface ScheduleSheet {
    data class QuickLook(val block: CourseBlock, val offWeek: Boolean = false) : ScheduleSheet
    data class Overlap(val blocks: List<CourseBlock>) : ScheduleSheet
    data object WeekPicker : ScheduleSheet
    data object Style : ScheduleSheet
    data object VisualStyle : ScheduleSheet
    data object Display : ScheduleSheet
    data object Widgets : ScheduleSheet
    data object Editor : ScheduleSheet
    data object Appearance : ScheduleSheet
    data object Sharing : ScheduleSheet
}

/** What the timetable bodies need besides the store: how to draw and where taps go. */
private class ScheduleBodyContext(
    val palette: String,
    val translucent: Boolean,
    /** Minutes since midnight while "now" is marked, else null. */
    val now: Int?,
    val showSaturday: Boolean,
    val showSunday: Boolean,
    val sundayFirst: Boolean,
    val showOffWeek: Boolean,
    /** Week-view row height relative to "twelve periods fit the screen". */
    val rowScale: Float,
    val display: ScheduleDisplayOptions,
    val onLogin: () -> Unit,
    val onCourse: (PlacedBlock, String) -> Unit,
    val onOffWeek: (PlacedBlock) -> Unit,
    val onAddSlot: (Int, Int) -> Unit,
)

/** The user's own timetable, with a shared one opened over it when asked. */
@Composable
fun NativeScheduleScreen(activity: MainActivity) {
    val store = activity.schedule
    var shared by rememberSaveable { mutableStateOf(DebugScheduleFixture.openSharedCode) }
    // A widget or link opening the timetable lands on the user's own grid.
    val openRequests = store.openRequests
    val handledOpen = remember { intArrayOf(openRequests) }
    LaunchedEffect(openRequests) {
        if (openRequests != handledOpen[0]) {
            handledOpen[0] = openRequests
            shared = null
        }
    }
    Box(Modifier.fillMaxSize()) {
        ScheduleSurface(activity, store, onOpenShared = { shared = it })
        shared?.let { code -> SharedScheduleScreen(activity, code) { shared = null } }
    }
}

/**
 * One timetable: toolbar, week or month navigation and the pages. A read-only
 * store (a shared timetable) gets the same views without editing, widgets or
 * sharing of its own.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduleSurface(activity: MainActivity, store: ScheduleStore, onOpenShared: ((String) -> Unit)?) {
    val style = activity.style
    val colors = LocalScheduleColors.current
    var sheet by remember { mutableStateOf<ScheduleSheet?>(if (store.readOnly) null else DebugScheduleFixture.initialSheet()) }
    val editor = remember(store) {
        CourseEditorModel({ activity.web.editCourse(it) }, activity.lifecycleScope) { semester, priorities ->
            priorities?.let { store.setPriorities(semester, it) }
            store.load(true)
        }
    }
    // A widget or link opening the timetable lands on the grid, not on a sheet left open.
    val openRequests = store.openRequests
    val handledOpen = remember { intArrayOf(openRequests) }
    LaunchedEffect(openRequests) {
        if (openRequests != handledOpen[0]) {
            handledOpen[0] = openRequests
            if (sheet != ScheduleSheet.Editor || !editor.busy) sheet = null
        }
    }

    // The month on screen and the day picked in it; empty until the month view is first shown.
    var monthAnchor by rememberSaveable { mutableStateOf("") }
    var monthSelected by rememberSaveable { mutableStateOf("") }
    val today = ScheduleStore.todayKey()
    val browsingDate = store.calendarWeek()?.days?.getOrNull(store.selectedDay - 1)?.takeIf { it.length == 10 } ?: today
    LaunchedEffect(store.viewMode, store.selectedSemester) {
        if (store.viewMode == "month") {
            monthSelected = browsingDate
            monthAnchor = browsingDate
        }
    }
    val selectedDate = monthSelected.ifEmpty { browsingDate }
    val anchor = monthAnchor.ifEmpty { selectedDate }

    val minute by produceState(ScheduleStyleTime.minutesNow()) {
        while (true) {
            delay(60_000 - System.currentTimeMillis() % 60_000 + 50)
            value = ScheduleStyleTime.minutesNow()
        }
    }
    val now = if (style.showNowIndicator) DebugScheduleFixture.pinnedNow ?: minute else null

    fun openEditor(block: CourseBlock?, day: Int? = null, slot: Int? = null) {
        if (store.result == null || !store.canEdit) {
            activity.toast(if (store.readOnly) "共享课表只能查看" else "请先加载本科课表，研究生课表暂不支持个人修改")
            return
        }
        editor.open(store, block)
        if (day != null && slot != null) editor.prefill(day, slot)
        sheet = ScheduleSheet.Editor
    }

    fun openCourse(placed: PlacedBlock, week: String) {
        // Side-by-side courses are narrow in the week grid, so they are listed first.
        val matches = if (store.viewMode == "week" && placed.lanes > 1) store.overlapping(placed.block, week) else emptyList()
        sheet = if (matches.size > 1) ScheduleSheet.Overlap(matches) else ScheduleSheet.QuickLook(placed.block)
    }

    val context = ScheduleBodyContext(
        palette = style.palette,
        translucent = style.background != null,
        now = now,
        showSaturday = style.showSaturday,
        showSunday = style.showSunday,
        sundayFirst = style.sundayFirst,
        showOffWeek = style.showOffWeek,
        rowScale = style.rowHeight / 100f,
        display = style.displayOptions,
        onLogin = { activity.openAcademicAuthorization() },
        onCourse = ::openCourse,
        onOffWeek = { sheet = ScheduleSheet.QuickLook(it.block, offWeek = true) },
        onAddSlot = { day, slot -> if (store.canEdit) openEditor(null, day, slot) },
    )
    val styleScope = ScheduleStyleScope(
        style = style.visualStyle, dark = colors.dark, palette = style.palette, primary = colors.text, secondary = colors.secondary,
        hasBackground = style.background != null, backgroundVisibility = style.visibility,
    )

    // Over a background photo, header text sits on frosted plates like the iOS glass.
    val glass = if (style.background != null) colors.surface.copy(alpha = if (colors.dark) 0.7f else 0.78f) else null
    Box(Modifier.fillMaxSize().consumesTouches().background(colors.page)) {
        ScheduleBackground(style)
        CompositionLocalProvider(LocalScheduleGlass provides glass, LocalScheduleStyle provides styleScope) {
        Column(Modifier.fillMaxSize().padding(start = 10.dp, end = 10.dp, top = 4.dp)) {
            // A term that failed to load has no weeks, but its picker must stay
            // reachable so another term can be chosen.
            if (store.weekOptions().isNotEmpty() || store.semesterOptions().isNotEmpty()) {
                ScheduleToolbar(
                    store = store,
                    onToday = if (style.showBackToWeek) ({
                        monthSelected = today
                        monthAnchor = today
                        store.returnToCurrentWeek()
                    }) else null,
                    actions = listOfNotNull(
                        ("刷新课表" to { store.load(true) }).takeIf { !store.readOnly },
                        ("添加课程" to { openEditor(null) }).takeIf { store.canEdit },
                        "课表风格" to { sheet = ScheduleSheet.VisualStyle },
                        "显示设置" to { sheet = ScheduleSheet.Display },
                        ("课表配色与背景" to { sheet = ScheduleSheet.Style }).takeIf { !store.readOnly },
                        ("桌面课表小组件" to { sheet = ScheduleSheet.Widgets }).takeIf { !store.readOnly },
                        "分享所选周课表" to { shareSchedule(activity, store) },
                        "导出所选周日历" to { exportSchedule(activity, store) },
                        ("共享课表" to { sheet = ScheduleSheet.Sharing }).takeIf { !store.readOnly },
                        ("应用外观" to { sheet = ScheduleSheet.Appearance }).takeIf { !store.readOnly },
                    ),
                )
                if (store.viewMode == "month") {
                    MonthSwitcher(anchor) { monthAnchor = ScheduleMonth.shift(anchor, it) }
                } else if (store.weekOptions().isNotEmpty()) {
                    WeekSwitcher(store) { sheet = ScheduleSheet.WeekPicker }
                }
            }
            // The failure state card already carries the message.
            if (store.errorMessage.isNotEmpty() && !(store.result == null && store.status == ScheduleStatus.Failed)) {
                Banner(
                    message = store.errorMessage,
                    action = if (store.authorizationExpired) "去授权" else if (store.result == null) "" else "重试",
                    onAction = {
                        if (store.authorizationExpired) activity.openAcademicAuthorization() else store.load(true)
                    },
                )
                Spacer(Modifier.height(8.dp))
            }
            PullToRefreshBox(
                isRefreshing = store.status == ScheduleStatus.Loading && store.result != null || store.refreshing,
                onRefresh = { store.load(true) },
                modifier = Modifier.weight(1f).fillMaxWidth(),
            ) {
                if (store.viewMode == "month" && store.result != null) {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 6.dp)) {
                        ScheduleMonthView(
                            store = store, anchor = anchor, selectedDate = selectedDate,
                            onSelect = { date ->
                                monthSelected = date
                                if (!ScheduleMonth.sameMonth(date, anchor)) monthAnchor = date
                                store.selectDate(date)
                            },
                            onOpenDay = { date ->
                                if (store.selectDate(date)) store.selectViewMode("day")
                            },
                            onCourse = { placed, _ -> sheet = ScheduleSheet.QuickLook(placed.block) },
                        )
                    }
                } else {
                    SchedulePages(store, context)
                }
            }
        }
        }
    }

    when (val current = sheet) {
        null -> Unit
        is ScheduleSheet.QuickLook -> CourseQuickLookSheet(
            store, current.block, style.palette, onDismiss = { sheet = null },
            onEdit = if (store.canEdit && !current.offWeek) ({
                sheet = null
                openEditor(current.block)
            }) else null,
            note = if (current.offWeek) "这门课本周不上" else null,
        )
        is ScheduleSheet.Overlap -> OverlapSheet(current.blocks, style.palette, onDismiss = { sheet = null }) {
            sheet = ScheduleSheet.QuickLook(it)
        }
        ScheduleSheet.WeekPicker -> WeekPickerSheet(store, onDismiss = { sheet = null })
        ScheduleSheet.Style -> ScheduleStyleSheet(activity, onDismiss = { sheet = null })
        ScheduleSheet.VisualStyle -> VisualStyleSheet(style, onDismiss = { sheet = null })
        ScheduleSheet.Display -> DisplaySettingsSheet(style, onDismiss = { sheet = null })
        ScheduleSheet.Widgets -> WidgetSettingsSheet(activity, onDismiss = { sheet = null })
        ScheduleSheet.Editor -> CourseEditorSheet(editor, onDismiss = {
            // The sheet may already be hidden (Back), so it always goes away; a
            // save in flight finishes on its own and reloads the timetable.
            if (!editor.busy) editor.cancel()
            sheet = null
        })
        ScheduleSheet.Appearance -> AppearanceSheet(activity.appearance, onDismiss = { sheet = null })
        ScheduleSheet.Sharing -> ScheduleSharingSheet(activity, store, onDismiss = { sheet = null }) { code -> onOpenShared?.invoke(code) }
    }
    if (sheet == ScheduleSheet.Editor && !editor.visible) {
        LaunchedEffect(Unit) { sheet = null }
    }
}

@Composable
private fun ScheduleBackground(style: ScheduleStyleSettings) {
    val colors = LocalScheduleColors.current
    val image = style.background ?: return
    Box(Modifier.fillMaxSize()) {
        Image(
            bitmap = image,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize().let {
                if (style.blur > 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) it.blur(style.blur.dp) else it
            },
        )
        val overlay = 1 - style.visibility
        Box(
            Modifier.fillMaxSize().background(
                (if (colors.dark) Color(0xFF0E1012) else Color(0xFFF8FBFF))
                    .copy(alpha = if (colors.dark) max(0.22f, overlay * 0.58f) else overlay),
            ),
        )
    }
}

@Composable
private fun ScheduleToolbar(store: ScheduleStore, onToday: (() -> Unit)?, actions: List<Pair<String, () -> Unit>>) {
    val colors = LocalScheduleColors.current
    var semesterMenu by remember { mutableStateOf(false) }
    var moreMenu by remember { mutableStateOf(false) }
    val canChooseSemester = !store.readOnly && store.semesterOptions().size > 1
    Row(Modifier.fillMaxWidth().height(40.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(40.dp).clickable(enabled = canChooseSemester) { semesterMenu = true }) {
            Row(
                Modifier.fillMaxWidth().height(32.dp).align(Alignment.Center).clip(RoundedCornerShape(16.dp)).background(colors.surface)
                    .padding(start = 12.dp, end = 6.dp)
                    .semantics {
                        contentDescription = if (store.readOnly) "共享课表：${semesterLabel(store)}" else "选择学期，当前 ${semesterLabel(store)}"
                    },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // One shared timetable, nothing to switch to.
                if (store.readOnly) {
                    Icon(Icons.Rounded.Group, contentDescription = null, tint = colors.secondary, modifier = Modifier.padding(end = 6.dp).size(15.dp))
                }
                Text(
                    compactSemesterLabel(store), color = colors.text, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                if (canChooseSemester) Icon(Icons.Rounded.ArrowDropDown, contentDescription = null, tint = colors.secondary)
            }
            DropdownMenu(expanded = semesterMenu, onDismissRequest = { semesterMenu = false }) {
                store.semesterOptions().forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option.label, fontWeight = if (option.value == store.selectedSemester) FontWeight.Bold else FontWeight.Normal) },
                        onClick = {
                            semesterMenu = false
                            store.selectSemester(option.value)
                        },
                    )
                }
            }
        }
        Spacer(Modifier.width(6.dp))
        Row(
            Modifier.width(108.dp).height(32.dp).clip(RoundedCornerShape(16.dp)).background(colors.softSurface).padding(2.dp),
        ) {
            // The day/week order of the Web; month follows them, as on iOS.
            listOf("日" to "day", "周" to "week", "月" to "month").forEach { (label, mode) ->
                ModeButton(label, store.viewMode == mode, Modifier.weight(1f)) { store.selectViewMode(mode) }
            }
        }
        Spacer(Modifier.width(6.dp))
        if (onToday != null) Box(
            Modifier.size(32.dp).clip(CircleShape).background(colors.surface).clickable(onClick = onToday)
                .semantics { contentDescription = if (store.viewMode == "month") "回到本月" else "回到本周今日" },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.NearMe, contentDescription = null, tint = colors.text, modifier = Modifier.size(18.dp))
        }
        Box {
            IconButton(onClick = { moreMenu = true }, modifier = Modifier.size(width = 34.dp, height = 40.dp)) {
                if (store.status == ScheduleStatus.Loading || store.refreshing) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = colors.accent)
                } else {
                    Icon(Icons.Rounded.MoreHoriz, contentDescription = "更多课表操作", tint = colors.text)
                }
            }
            DropdownMenu(expanded = moreMenu, onDismissRequest = { moreMenu = false }) {
                actions.forEach { (label, action) ->
                    DropdownMenuItem(
                        text = { Text(label) },
                        enabled = label != "刷新课表" || store.status != ScheduleStatus.Loading,
                        onClick = {
                            moreMenu = false
                            action()
                        },
                    )
                }
            }
        }
    }
    Spacer(Modifier.height(2.dp))
}

private fun semesterLabel(store: ScheduleStore): String =
    store.semesterOptions().firstOrNull { it.value == store.selectedSemester }?.label ?: store.selectedSemester.ifEmpty { "选择学期" }

private fun compactSemesterLabel(store: ScheduleStore): String {
    val parts = store.selectedSemester.split('-')
    return if (parts.size == 3 && parts[0].length == 4 && parts[1].length == 4) {
        "${parts[0]}–${parts[1].takeLast(2)} · ${when (parts[2]) { "1" -> "秋"; "2" -> "春"; else -> "夏" }}"
    } else semesterLabel(store)
}

@Composable
private fun ModeButton(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val colors = LocalScheduleColors.current
    Box(
        modifier.fillMaxSize().clip(RoundedCornerShape(19.dp)).background(if (selected) colors.surface else Color.Transparent)
            .clickable(onClick = onClick).semantics {
                contentDescription = "${label}视图"
                this.selected = selected
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            color = if (selected) colors.text else colors.secondary)
    }
}

@Composable
private fun WeekSwitcher(store: ScheduleStore, onPick: () -> Unit) {
    val colors = LocalScheduleColors.current
    val label = store.selectedWeek.takeIf { it.isNotEmpty() }?.let { "第${it}周" } ?: "选择周次"
    val start = store.dayDate(1)
    val end = store.dayDate(7)
    val range = if (start.isNotEmpty() && end.isNotEmpty()) "${start.replace('-', '.')} - ${end.replace('-', '.')}" else "校历暂无日期"
    val current = store.isCurrentWeek()
    SwitcherRow(
        previous = "上一周", next = "下一周",
        canPrevious = store.canMoveWeek(-1), canNext = store.canMoveWeek(1),
        onPrevious = { store.moveWeek(-1) }, onNext = { store.moveWeek(1) },
        description = "选择周次，$label，$range", onPick = onPick,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, fontSize = 14.sp, lineHeight = 18.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, color = colors.text,
                fontFamily = navigatorTitleFamily())
            if (current) {
                Spacer(Modifier.width(6.dp))
                Text("本周", fontSize = 10.sp, color = colors.accent, fontWeight = FontWeight.Bold,
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(colors.accent.copy(alpha = 0.12f))
                        .padding(horizontal = 5.dp, vertical = 1.dp))
            }
        }
        // The date range is all digits, so the board may keep its monospaced face there.
        Text(range, fontSize = 10.sp, lineHeight = 14.sp, letterSpacing = 0.sp, color = colors.secondary, maxLines = 1,
            fontFamily = navigatorDateFamily())
    }
}

/** The week and month titles follow the style's typeface. Classic and minimal stay on the system face. */
@Composable
private fun navigatorTitleFamily(): FontFamily = LocalScheduleStyle.current.let { scope ->
    if (scope.style == ScheduleVisualStyle.Classic || scope.style == ScheduleVisualStyle.Minimal) FontFamily.Default else scope.textFamily
}

@Composable
private fun navigatorDateFamily(): FontFamily = LocalScheduleStyle.current.let { scope ->
    if (scope.style == ScheduleVisualStyle.Classic || scope.style == ScheduleVisualStyle.Minimal) FontFamily.Default else scope.fontFamily
}


@Composable
private fun MonthSwitcher(anchor: String, onMove: (Int) -> Unit) {
    val colors = LocalScheduleColors.current
    val title = ScheduleMonth.title(anchor)
    SwitcherRow(
        previous = "上一月", next = "下一月", canPrevious = true, canNext = true,
        onPrevious = { onMove(-1) }, onNext = { onMove(1) }, description = title, onPick = null,
    ) {
        Text(title, fontSize = 14.sp, lineHeight = 18.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, color = colors.text,
            fontFamily = navigatorTitleFamily())
        Text(if (ScheduleMonth.sameMonth(anchor, ScheduleStore.todayKey())) "本月" else "月历", fontSize = 10.sp, lineHeight = 14.sp,
            letterSpacing = 0.sp, color = colors.secondary, maxLines = 1, fontFamily = navigatorTitleFamily())
    }
}

@Composable
private fun SwitcherRow(
    previous: String,
    next: String,
    canPrevious: Boolean,
    canNext: Boolean,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    description: String,
    onPick: (() -> Unit)?,
    content: @Composable () -> Unit,
) {
    val colors = LocalScheduleColors.current
    val glass = LocalScheduleGlass.current
    Row(
        Modifier.fillMaxWidth().height(42.dp)
            .then(if (glass != null) Modifier.clip(RoundedCornerShape(18.dp)).background(glass) else Modifier),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onPrevious, enabled = canPrevious) {
            Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, contentDescription = previous, tint = colors.text)
        }
        Column(
            Modifier.weight(1f).clip(RoundedCornerShape(16.dp))
                .then(if (onPick != null) Modifier.clickable(onClick = onPick) else Modifier).padding(vertical = 2.dp)
                .semantics { contentDescription = description },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) { content() }
        IconButton(onClick = onNext, enabled = canNext) {
            Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = next, tint = colors.text)
        }
    }
    Spacer(Modifier.height(2.dp))
}

@Composable
private fun Banner(message: String, action: String, onAction: () -> Unit) {
    val colors = LocalScheduleColors.current
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(colors.surface).padding(horizontal = 11.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Info, contentDescription = null, tint = colors.accent, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text(message, fontSize = 12.sp, color = colors.text, maxLines = 3, modifier = Modifier.weight(1f))
        if (action.isNotEmpty()) TextButton(onClick = onAction) { Text(action, fontSize = 12.sp) }
    }
}

@Composable
private fun SchedulePages(store: ScheduleStore, context: ScheduleBodyContext) {
    val weeks = store.weekOptions()
    if (weeks.isEmpty()) {
        ScheduleBody(store, store.selectedWeek, store.result, context)
        return
    }
    if (store.viewMode == "day") {
        // Weekends can be hidden; a weekend day with classes or a make-up day still shows.
        val days = store.visibleDays(store.selectedWeek, context.showSaturday, context.showSunday)
        // Keep the page model keyed by semester and week so a new one rebuilds the pager.
        key(store.selectedSemester, store.selectedWeek, days) {
            val initial = days.indexOf(store.selectedDay).let { if (it < 0) days.lastIndex else it }.coerceAtLeast(0)
            val pager = rememberPagerState(initialPage = initial) { days.size }
            LaunchedEffect(store.selectedDay) {
                val target = days.indexOf(store.selectedDay)
                if (target >= 0 && pager.currentPage != target) pager.animateScrollToPage(target)
            }
            LaunchedEffect(pager) {
                snapshotFlow { pager.settledPage }.collect { page -> days.getOrNull(page)?.let(store::selectDay) }
            }
            Column(Modifier.fillMaxSize()) {
                val shown = days.getOrNull(pager.currentPage) ?: store.selectedDay
                if (LocalScheduleStyle.current.style == ScheduleVisualStyle.Classic) {
                    DayStrip(store, store.selectedWeek, days, shown) { store.selectDay(it) }
                } else {
                    StyledDayStripRow(store, store.selectedWeek, days, shown) { store.selectDay(it) }
                }
                HorizontalPager(state = pager, modifier = Modifier.weight(1f).fillMaxWidth(), beyondViewportPageCount = 1) { page ->
                    val data = store.resultFor(store.selectedWeek)
                    ScheduleBody(store, store.selectedWeek, data, context, day = days[page])
                }
            }
        }
    } else {
        // Keep the page model keyed by semester so a new term rebuilds the pager.
        key(store.selectedSemester, weeks.size) {
            val index = store.selectedWeekIndex()
            val pager = rememberPagerState(initialPage = index) { weeks.size }
            LaunchedEffect(index) {
                if (pager.currentPage != index) pager.animateScrollToPage(index)
            }
            LaunchedEffect(pager) {
                // The first emission is the initial page; when the selected week is
                // not in the list (a vacation week) it would wrongly select week 1.
                snapshotFlow { pager.settledPage }.drop(1).collect { page -> weeks.getOrNull(page)?.let { store.selectWeek(it.value) } }
            }
            HorizontalPager(state = pager, modifier = Modifier.fillMaxSize(), beyondViewportPageCount = 1) { page ->
                val week = weeks[page].value
                // Reading the revision lets an adjacent page pick up a prefetched week.
                val revision = store.dataRevision
                val data = remember(week, revision, store.result) { store.resultFor(week) }
                ScheduleBody(store, week, data, context)
            }
        }
    }
}

@Composable
private fun ScheduleBody(store: ScheduleStore, week: String, data: ScheduleResult?, context: ScheduleBodyContext, day: Int? = null) {
    val selected = week == store.selectedWeek
    val scope = LocalScheduleStyle.current
    val classic = scope.style == ScheduleVisualStyle.Classic
    val periods = (1..SLOT_COUNT).map(store::periodTime)
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val height = maxHeight
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 6.dp)) {
            when {
                data == null && selected && store.status == ScheduleStatus.Unauthorized -> StateCard(
                    "教务授权已失效", "请重新登录并完成教务授权后读取课表", "去授权", context.onLogin,
                )
                data == null && selected && store.status == ScheduleStatus.Failed -> StateCard(
                    "课表暂时无法加载", store.errorMessage.ifEmpty { "请检查网络连接后重试" }, "重新加载",
                ) { store.load(true) }
                data == null -> LoadingCard(store.bridgeReady)
                day != null -> {
                    val blocks = store.placedBlocksForDay(day, week, data)
                    val adjustment = store.adjustment(day, week)
                    val canAdd = store.canEdit
                    if (adjustment != null && blocks.isNotEmpty()) AdjustmentNotice(store, adjustment, day, week)
                    if (!classic) {
                        val date = store.calendarWeek(week)?.days?.getOrNull(day - 1).orEmpty()
                        val isToday = store.isToday(day, week)
                        val status = DayStatus(
                            store::periodTime,
                            now = if (isToday && !scope.static) context.now else null,
                            // A past day: everything on it is finished.
                            completedBefore = if (date.length == 10 && date < ScheduleStore.todayKey()) 24 * 60 else null,
                        )
                        StyledDayView(
                            day = day, blocks = blocks, periods = periods, status = status,
                            emptyNote = adjustment?.let { store.adjustmentDetail(it) }, emptyHeight = height - 12.dp, canAdd = canAdd,
                            onCourse = { context.onCourse(it, week) }, onAddSlot = { context.onAddSlot(day, it) },
                        )
                    } else if (blocks.isEmpty() && adjustment?.kind == "off") StateCard(
                        "这一天放假，不上课", store.adjustmentDetail(adjustment), if (canAdd) "添加课程" else "",
                    ) { context.onAddSlot(day, 1) }
                    else if (blocks.isEmpty()) StateCard(
                        "这一天没有课程",
                        adjustment?.let { store.adjustmentDetail(it) } ?: if (canAdd) "可以切换日期，或添加个人课程" else "可以切换日期查看其他课程",
                        if (canAdd) "添加课程" else "",
                    ) { context.onAddSlot(day, 1) }
                    else DayTimeline(store, day, week, blocks, context, height)
                }
                else -> {
                    val revision = store.dataRevision
                    val priorities = store.displayPriorities
                    val calendar = store.calendar
                    // Today is a key too: the column marked as today moves at midnight.
                    val days = remember(
                        week, data, revision, priorities, calendar, context.showSaturday, context.showSunday, context.sundayFirst,
                        context.showOffWeek, ScheduleStore.todayKey(),
                    ) {
                        // With Sunday first, the Sunday column is the day before this
                        // Monday: it belongs to the previous teaching week.
                        val previous = if (context.sundayFirst) store.previousWeek(week) else null
                        fun weekOf(day: Int): String? = if (context.sundayFirst && day == 7) previous else week
                        fun sourceOf(target: String) = if (target == week) data else store.resultFor(target)
                        ScheduleDisplayRules.weekColumns(context.showSaturday, context.showSunday, context.sundayFirst) { day ->
                            val target = weekOf(day) ?: return@weekColumns false
                            store.adjustment(day, target)?.kind == "swap" || store.blocksForDay(day, target, sourceOf(target)).isNotEmpty()
                        }.map { weekday ->
                            val target = weekOf(weekday)
                            if (target == null) {
                                val date = ScheduleDisplayRules.shiftDate(store.calendarWeek(week)?.days?.firstOrNull().orEmpty(), -1)
                                StyledWeekDay(weekday, date, date.isNotEmpty() && date == ScheduleStore.todayKey(), null, emptyList(), canAdd = false)
                            } else {
                                val source = sourceOf(target)
                                val blocks = store.placedBlocksForDay(weekday, target, source)
                                StyledWeekDay(
                                    day = weekday,
                                    date = store.calendarWeek(target)?.days?.getOrNull(weekday - 1).orEmpty(),
                                    today = store.isToday(weekday, target),
                                    adjustmentKind = store.adjustment(weekday, target)?.kind,
                                    blocks = blocks,
                                    week = target,
                                    offWeek = if (!context.showOffWeek) emptyList() else
                                        store.offWeekBlocksForDay(weekday, target, blocks.map { it.block }, source)
                                            .map { PlacedBlock(it, it.startSlot, it.endSlot) },
                                    canAdd = target == week,
                                )
                            }
                        }
                    }
                    val openDay: (Int) -> Unit = { weekday ->
                        days.firstOrNull { it.day == weekday }?.week?.takeIf { it.isNotEmpty() }?.let { target ->
                            if (target != store.selectedWeek) store.selectWeek(target)
                            store.selectDay(weekday)
                            store.selectViewMode("day")
                        }
                    }
                    CompositionLocalProvider(LocalScheduleDisplay provides context.display) {
                        if (classic) {
                            WeekGrid(store, days, context, height, openDay)
                        } else {
                            StyledWeekGrid(
                                days = days, periods = periods,
                                rowHeight = (styledWeekRowHeight(height.value, scope.style) * context.rowScale).dp,
                                now = context.now, canAdd = store.canEdit,
                                onCourse = { day, block -> context.onCourse(block, day.week) }, onAddSlot = context.onAddSlot,
                                onDay = openDay, onOffWeek = context.onOffWeek,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** The day view's note for a holiday or make-up day that still has classes. */
@Composable
private fun AdjustmentNotice(store: ScheduleStore, adjustment: ScheduleAdjustment, day: Int, week: String) {
    val colors = LocalScheduleColors.current
    Text(
        "${store.dayDate(day, week).replace('-', '.')} ${WEEKDAY_LABELS[day - 1]} · ${store.adjustmentDetail(adjustment)}",
        fontSize = 12.sp, color = colors.accent, fontWeight = FontWeight.Bold,
        modifier = Modifier.fillMaxWidth().padding(start = 4.dp, bottom = 8.dp),
    )
}

@Composable
private fun DayHeaderCell(
    store: ScheduleStore, day: Int, week: String, highlighted: Boolean, modifier: Modifier,
    /** `yyyy-MM-dd` of a column outside the term's weeks (the Sunday before week 1). */
    fallbackDate: String = "",
) {
    val colors = LocalScheduleColors.current
    val date = if (week.isEmpty()) fallbackDate.drop(5) else store.dayDate(day, week)
    val adjustment = if (week.isEmpty()) null else store.adjustment(day, week)
    val glass = LocalScheduleGlass.current
    Column(
        modifier.height(36.dp).clip(RoundedCornerShape(10.dp))
            .background(if (highlighted) colors.accent.copy(alpha = 0.10f) else glass ?: Color.Transparent)
            .border(if (highlighted) 0.8.dp else 0.dp, if (highlighted) colors.accent.copy(alpha = 0.28f) else Color.Transparent, RoundedCornerShape(12.dp)),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(WEEKDAY_LABELS[day - 1], fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, color = if (highlighted) colors.accent else colors.text)
            if (adjustment != null) {
                // 休 = day off, 班 = make-up day, like the iOS day badges.
                Text(
                    if (adjustment.kind == "off") "休" else "班", fontSize = 9.sp, lineHeight = 10.sp, fontWeight = FontWeight.Bold,
                    color = if (adjustment.kind == "off") colors.secondary else colors.accent,
                    modifier = Modifier.padding(start = 1.dp),
                )
            }
        }
        Text(if (date.isEmpty()) "—" else date.replace('-', '.'), fontSize = 9.sp, lineHeight = 12.sp, letterSpacing = 0.sp, color = colors.secondary)
    }
}

@Composable
private fun DayStrip(store: ScheduleStore, week: String, days: List<Int>, current: Int, onSelect: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        days.forEach { day ->
            DayHeaderCell(
                store, day, week, highlighted = day == current,
                modifier = Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).clickable { onSelect(day) }
                    .semantics {
                        contentDescription = WEEKDAY_LABELS[day - 1] + " " + store.dayDate(day, week) +
                            store.adjustment(day, week)?.let { if (it.kind == "off") "，休息" else "，补班" }.orEmpty()
                        selected = day == current
                    },
            )
        }
    }
}

/** The day strip of every style except classic: each draws it as the header row of its own week view. */
@Composable
private fun StyledDayStripRow(store: ScheduleStore, week: String, days: List<Int>, current: Int, onSelect: (Int) -> Unit) {
    val data = store.resultFor(week)
    val revision = store.dataRevision
    val calendar = store.calendar
    // Today is a key too: the day marked as today moves at midnight.
    val items = remember(week, days, data, revision, calendar, ScheduleStore.todayKey()) {
        days.map { day ->
            val adjustment = store.adjustment(day, week)
            val count = store.blocksForDay(day, week, data).size
            StyledStripDay(
                day = day,
                number = dayOfMonth(store.calendarWeek(week)?.days?.getOrNull(day - 1).orEmpty()),
                today = store.isToday(day, week),
                adjustmentKind = adjustment?.kind,
                description = listOfNotNull(
                    (WEEKDAY_LABELS[day - 1] + " " + store.dayDate(day, week).replace('-', '.')).trim(),
                    adjustment?.let { store.adjustmentDetail(it) },
                    if (count > 0) "$count 门课" else "没有课",
                ).joinToString("，"),
            )
        }
    }
    // The board's strip ends on a hairline and runs straight into the day panel of the same colour.
    val gap = if (LocalScheduleStyle.current.style == ScheduleVisualStyle.Board) 0.dp else 8.dp
    StyledDayStrip(items, current, Modifier.padding(top = 2.dp, bottom = gap), onSelect)
}

/** The classic week grid: glass cells and gradient cards, as this client has always drawn it. */
@Composable
private fun WeekGrid(
    store: ScheduleStore,
    days: List<StyledWeekDay>,
    context: ScheduleBodyContext,
    height: Dp,
    onDay: (Int) -> Unit,
) {
    val colors = LocalScheduleColors.current
    val display = context.display
    val stride = (compactWeekRowHeight(height.value) * context.rowScale).dp
    val cellColor = if (context.translucent) colors.cell.copy(alpha = if (colors.dark) 0.52f else 0.36f) else colors.cell
    val periods = (1..SLOT_COUNT).map(store::periodTime)
    val nowY = if (days.any { it.today }) context.now?.let { nowPosition(it, periods, stride.value - 4f, 4f)?.first } else null
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            val glass = LocalScheduleGlass.current
            Text("节次", fontSize = 10.sp, lineHeight = 14.sp, letterSpacing = 0.sp, color = colors.secondary, textAlign = TextAlign.Center,
                modifier = Modifier.width(38.dp).height(36.dp)
                    .then(if (glass != null) Modifier.clip(RoundedCornerShape(12.dp)).background(glass) else Modifier)
                    .padding(top = 10.dp))
            days.forEach { day ->
                DayHeaderCell(
                    store, day.day, day.week, highlighted = day.today,
                    modifier = Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).clickable { onDay(day.day) }.semantics {
                        val note = day.adjustmentKind?.let { if (it == "off") "，休息" else "，补班" }.orEmpty()
                        contentDescription = WEEKDAY_LABELS[day.day - 1] + note + "，查看当天课程"
                    },
                    fallbackDate = day.date,
                )
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Box(Modifier.width(38.dp)) {
                Column { (1..SLOT_COUNT).forEach { SlotAxis(store, it, stride) } }
                if (nowY != null) {
                    Box(Modifier.offset(y = nowY.dp - 8.dp).fillMaxWidth(), contentAlignment = Alignment.Center) { ScheduleNowBadge(context.now ?: 0) }
                }
            }
            days.forEach { day ->
                // Days off are drawn faded so the holiday reads at a glance.
                val dayCell = if (day.adjustmentKind == "off") cellColor.copy(alpha = cellColor.alpha * 0.45f) else cellColor
                BoxWithConstraints(Modifier.weight(1f).height(stride * SLOT_COUNT)) {
                    val columnWidth = maxWidth
                    Column {
                        (1..SLOT_COUNT).forEach { slot ->
                            Box(
                                Modifier.fillMaxWidth().height(stride - 4.dp).clip(RoundedCornerShape(8.dp)).background(dayCell)
                                    .border(0.5.dp, colors.divider.copy(alpha = if (colors.dark) 0.65f else 0.6f), RoundedCornerShape(8.dp))
                                    .then(if (store.canEdit && day.canAdd) Modifier.clickable { context.onAddSlot(day.day, slot) }
                                        .semantics { contentDescription = WEEKDAY_LABELS[day.day - 1] + "第${slot}节，添加课程" } else Modifier),
                            )
                            Spacer(Modifier.height(4.dp))
                        }
                    }
                    (day.offWeek.map { it to true } + day.blocks.map { it to false }).forEach { (block, ghost) ->
                        val tone = scheduleCardTone(block.course.name, context.palette, colors.dark)
                        // Courses of equal priority sit side by side and share the column.
                        val laneWidth = columnWidth / block.lanes
                        val narrow = block.lanes > 1
                        Column(
                            Modifier.offset(x = laneWidth * block.lane, y = stride * (block.startSlot - 1))
                                .width(laneWidth).height(stride * block.span - 4.dp)
                                .padding(end = if (narrow && block.lane < block.lanes - 1) 1.dp else 0.dp)
                                .then(if (ghost) Modifier.alpha(0.5f) else Modifier)
                                .clip(RoundedCornerShape(9.dp)).background(colors.surface)
                                .background(Brush.verticalGradient(listOf(Color(tone.highlight), Color(tone.fill))))
                                .border(1.dp, Color(tone.border), RoundedCornerShape(9.dp))
                                .clickable { if (ghost) context.onOffWeek(block) else context.onCourse(block, day.week) }
                                .semantics { contentDescription = (if (ghost) "非本周，" else "") + courseAccessibility(block.block) }
                                .padding(horizontal = if (narrow) 1.dp else 2.dp, vertical = if (display.compact) 1.dp else 3.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            ScheduleCardText {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    val gap = if (display.compact) 1.dp else 3.dp
                                    if (ghost) {
                                        ScheduleCardTag("非本周", Color(tone.text))
                                        Spacer(Modifier.height(gap))
                                    }
                                    Text(
                                        block.course.name, fontSize = if (narrow) 9.sp else 10.sp, lineHeight = if (narrow) 11.sp else 12.sp, letterSpacing = 0.sp,
                                        fontWeight = FontWeight.Medium, color = Color(tone.text), textAlign = TextAlign.Center,
                                        maxLines = if (block.span == 1) 2 else if (display.compact) 8 else 6, overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f, fill = false),
                                    )
                                    if (!block.course.location.isNullOrEmpty() && block.span > 1 && !narrow) {
                                        Spacer(Modifier.height(gap))
                                        Text(block.course.location.orEmpty(), fontSize = 9.sp, lineHeight = 11.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Normal,
                                            color = Color(tone.text).copy(alpha = 0.86f), textAlign = TextAlign.Center,
                                            maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    }
                                    val teacher = block.course.teacher?.trim().orEmpty()
                                    if (display.showTeacher && teacher.isNotEmpty() && block.span > 1 && !narrow) {
                                        Spacer(Modifier.height(gap))
                                        Text(teacher, fontSize = 9.sp, lineHeight = 11.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Normal,
                                            color = Color(tone.text).copy(alpha = 0.86f), textAlign = TextAlign.Center,
                                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                }
                            }
                        }
                    }
                    if (nowY != null && day.today) ScheduleNowLine(Modifier.offset(y = nowY.dp - 3.5.dp).fillMaxWidth())
                }
            }
        }
    }
}

@Composable
private fun SlotAxis(store: ScheduleStore, slot: Int, stride: Dp) {
    val colors = LocalScheduleColors.current
    val period = store.periodTime(slot)
    val glass = LocalScheduleGlass.current
    // With a photo behind, each label gets a plate shaped like the grid cells beside it.
    val plate = if (glass != null) Modifier.padding(bottom = 5.dp).clip(RoundedCornerShape(9.dp)).background(glass) else Modifier
    Column(
        Modifier.fillMaxWidth().height(stride).then(plate),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(slot.toString(), fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, color = colors.text)
        if (LocalScheduleDisplay.current.showSlotTime) {
            Text(period.startTime, fontSize = 8.sp, lineHeight = 10.sp, letterSpacing = 0.sp, color = colors.secondary)
            Text(period.endTime, fontSize = 8.sp, lineHeight = 10.sp, letterSpacing = 0.sp, color = colors.secondary)
        }
    }
}

/** The classic day view: the twelve periods as rows, courses over them. */
@Composable
private fun DayTimeline(
    store: ScheduleStore,
    day: Int,
    week: String,
    blocks: List<PlacedBlock>,
    context: ScheduleBodyContext,
    height: Dp,
) {
    val colors = LocalScheduleColors.current
    val stride = max(52f, (height.value - 12f) / SLOT_COUNT).dp
    val cellColor = if (context.translucent) colors.cell.copy(alpha = if (colors.dark) 0.52f else 0.36f) else colors.cell
    val periods = (1..SLOT_COUNT).map(store::periodTime)
    val nowY = if (store.isToday(day, week)) context.now?.let { nowPosition(it, periods, stride.value - 4f, 4f)?.first } else null
    Row(Modifier.fillMaxWidth()) {
        Box(Modifier.width(38.dp)) {
            Column { (1..SLOT_COUNT).forEach { SlotAxis(store, it, stride) } }
            if (nowY != null) {
                Box(Modifier.offset(y = nowY.dp - 8.dp).fillMaxWidth(), contentAlignment = Alignment.Center) { ScheduleNowBadge(context.now ?: 0) }
            }
        }
        Spacer(Modifier.width(10.dp))
        BoxWithConstraints(Modifier.weight(1f).height(stride * SLOT_COUNT)) {
            val columnWidth = maxWidth
            Column {
                (1..SLOT_COUNT).forEach { slot ->
                    Box(
                        Modifier.fillMaxWidth().height(stride - 4.dp).clip(RoundedCornerShape(10.dp)).background(cellColor)
                            .border(0.5.dp, colors.divider, RoundedCornerShape(10.dp))
                            .then(if (store.canEdit) Modifier.clickable { context.onAddSlot(day, slot) }
                                .semantics { contentDescription = "第${slot}节，添加课程" } else Modifier),
                    )
                    Spacer(Modifier.height(4.dp))
                }
            }
            blocks.forEach { block ->
                val tone = scheduleCardTone(block.course.name, context.palette, colors.dark)
                val span = block.span
                val laneWidth = columnWidth / block.lanes
                val narrow = block.lanes > 1
                val meta = listOfNotNull(block.course.location?.let { "@$it" }, block.course.teacher).joinToString(" · ")
                Column(
                    Modifier.offset(x = laneWidth * block.lane, y = stride * (block.startSlot - 1))
                        .width(laneWidth).height(stride * span - 4.dp)
                        .padding(end = if (narrow && block.lane < block.lanes - 1) 4.dp else 0.dp)
                        .clip(RoundedCornerShape(12.dp)).background(colors.surface)
                        .background(Brush.verticalGradient(listOf(Color(tone.highlight), Color(tone.fill))))
                        .border(1.dp, Color(tone.border), RoundedCornerShape(12.dp))
                        .clickable { context.onCourse(block, week) }
                        .semantics { contentDescription = courseAccessibility(block.block) }
                        .padding(horizontal = if (narrow) 10.dp else 16.dp, vertical = 6.dp),
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(block.course.name, fontSize = if (span == 1) 13.sp else 16.sp, fontWeight = FontWeight.Medium,
                        color = Color(tone.text), maxLines = if (span == 1) 1 else 3, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.height(4.dp))
                    Text(meta.ifEmpty { "地点待确认" }, fontSize = 11.sp, color = Color(tone.text).copy(alpha = 0.82f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (span > 1) {
                        Text("${ScheduleStyleTime.slotText(block.startSlot, block.endSlot)} · ${store.timeRange(block.startSlot, block.endSlot)}",
                            fontSize = 11.sp, color = Color(tone.text), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            if (nowY != null) ScheduleNowLine(Modifier.offset(y = nowY.dp - 3.5.dp).fillMaxWidth())
        }
    }
}

@Composable
private fun LoadingCard(bridgeReady: Boolean) {
    val colors = LocalScheduleColors.current
    Column(
        Modifier.fillMaxWidth().heightIn(min = 260.dp).clip(RoundedCornerShape(16.dp)).background(colors.surface).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        CircularProgressIndicator(Modifier.size(30.dp), strokeWidth = 3.dp)
        Spacer(Modifier.height(14.dp))
        Text("正在加载课表", fontSize = 17.sp, fontWeight = FontWeight.Medium, color = colors.text)
        Spacer(Modifier.height(6.dp))
        Text(if (bridgeReady) "正在从教务服务读取最新安排" else "正在恢复登录状态与课表服务",
            fontSize = 13.sp, color = colors.secondary, textAlign = TextAlign.Center)
    }
}

@Composable
private fun StateCard(title: String, message: String, action: String, onAction: () -> Unit) {
    val colors = LocalScheduleColors.current
    Column(
        Modifier.fillMaxWidth().heightIn(min = 220.dp).clip(RoundedCornerShape(16.dp)).background(colors.surface).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(title, fontSize = 17.sp, fontWeight = FontWeight.Medium, color = colors.text)
        Spacer(Modifier.height(8.dp))
        Text(message, fontSize = 13.sp, color = colors.secondary, textAlign = TextAlign.Center)
        if (action.isNotEmpty()) {
            Spacer(Modifier.height(14.dp))
            Button(onClick = onAction) { Text(action) }
        }
    }
}

internal fun courseAccessibility(block: CourseBlock): String =
    WEEKDAY_LABELS[block.day - 1] + "，" + block.course.name + "，第" + block.startSlot + "至" + block.endSlot + "节，" +
        block.course.location.orEmpty()

/** A frosted plate colour while a background photo is shown, else null (see [ScheduleSurface]). */
internal val LocalScheduleGlass = staticCompositionLocalOf<Color?> { null }
