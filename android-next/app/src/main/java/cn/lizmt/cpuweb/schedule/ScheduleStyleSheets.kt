package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Notes
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The course quick look: the name, "weekday · periods · times", then room,
 * teacher, weeks and note. Tapping a course anywhere on the timetable opens
 * it; "编辑" goes on to the editor.
 */
@Composable
fun CourseQuickLookSheet(
    store: ScheduleStore, block: CourseBlock, palette: String, onDismiss: () -> Unit, onEdit: (() -> Unit)?,
    /** Shown in place of the usual footnote, e.g. for a course that does not run this week. */
    note: String? = null,
) {
    val colors = LocalScheduleColors.current
    val course = block.course
    val accent = Color(StyleCourseColor(course.name, palette).accent(colors.dark))
    val meta = MaterialTheme.colorScheme.onSurfaceVariant
    // Rows without a value take no space.
    val details: List<Triple<String, ImageVector, String>> = listOfNotNull(
        ScheduleStyleTime.location(course.location)?.let { Triple("教室", Icons.Outlined.Place, it) },
        course.teacher?.trim()?.takeIf { it.isNotEmpty() }?.let { Triple("老师", Icons.Outlined.Person, it) },
        course.weeks.trim().takeIf { it.isNotEmpty() }?.let { Triple("周次", Icons.Outlined.CalendarMonth, it) },
        course.editableNote.takeIf { it.isNotEmpty() }?.let { Triple("备注", Icons.AutoMirrored.Outlined.Notes, it) },
    )
    ScheduleSheetContainer(onDismiss) {
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            // The course-colour bar matches the card on the timetable.
            Box(Modifier.width(4.dp).fillMaxHeight().clip(CircleShape).background(accent))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(course.name, fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold, modifier = Modifier.semantics { heading() })
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Outlined.Schedule, contentDescription = null, tint = meta, modifier = Modifier.size(15.dp))
                    Text(
                        "${WEEKDAY_LABELS[block.day - 1]} · ${ScheduleStyleTime.slotText(block.startSlot, block.endSlot)} · " +
                            store.timeRange(block.startSlot, block.endSlot).replace('-', '–'),
                        fontSize = 14.sp, color = meta,
                    )
                }
            }
            if (onEdit != null) {
                Text(
                    "编辑", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.primary.copy(alpha = if (colors.dark) 0.2f else 0.1f))
                        .clickable(onClick = onEdit).semantics { contentDescription = "编辑课程" }.padding(horizontal = 14.dp, vertical = 7.dp),
                )
            }
        }
        if (details.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(Modifier.height(16.dp))
            // The four titles are two characters each, so the values line up in a column.
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                details.forEach { (title, icon, value) ->
                    Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(18.dp))
                            Text(title, fontSize = 14.sp, color = meta)
                        }
                        Text(value, fontSize = 16.sp, lineHeight = 22.sp, modifier = Modifier.weight(1f))
                    }
                }
            }
        }
        val footnote = note ?: when {
            course.orphaned -> "教务课表里已找不到这门课，请核对后保留或删除。"
            course.custom || course.customId != null -> "自己添加或修改过的课程"
            else -> null
        }
        if (footnote != null) {
            Spacer(Modifier.height(16.dp))
            Text(footnote, fontSize = 13.sp, color = if (course.orphaned) MaterialTheme.colorScheme.tertiary else meta)
        }
    }
}

/**
 * Picks the timetable style. Every style shares the same course data and the
 * same tap-to-edit behaviour; a choice takes effect at once.
 */
@Composable
fun VisualStyleSheet(style: ScheduleStyleSettings, onDismiss: () -> Unit) {
    ScheduleSheetContainer(onDismiss) {
        SheetTitle("课表风格")
        ScheduleVisualStyle.entries.forEach { option ->
            val chosen = style.visualStyle == option
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { style.selectVisualStyle(option) }
                    .semantics(mergeDescendants = true) { selected = chosen }.padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                StylePreview(option, style.palette)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(option.title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                    Text(option.subtitle, fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (chosen) Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            }
        }
        Spacer(Modifier.height(6.dp))
        Text("课表风格不改变课程数据、课程配色或背景图片。", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * How the week view is drawn: row height, text size, what a card shows and
 * which days appear. Every change shows at once on the timetable behind.
 */
@Composable
fun DisplaySettingsSheet(style: ScheduleStyleSettings, onDismiss: () -> Unit) {
    val meta = MaterialTheme.colorScheme.onSurfaceVariant
    ScheduleSheetContainer(onDismiss) {
        SheetTitle("显示设置")
        Text("课程格子", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = meta)
        Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("格子高度", fontSize = 15.sp, modifier = Modifier.weight(1f))
            Text("${style.rowHeight}%", fontSize = 13.sp, color = meta)
        }
        Slider(
            value = style.rowHeight.toFloat(),
            onValueChange = { style.updateRowHeight(it.toInt()) },
            valueRange = ScheduleDisplayRules.ROW_HEIGHT_MIN.toFloat()..ScheduleDisplayRules.ROW_HEIGHT_MAX.toFloat(),
            steps = (ScheduleDisplayRules.ROW_HEIGHT_MAX - ScheduleDisplayRules.ROW_HEIGHT_MIN) / ScheduleDisplayRules.ROW_HEIGHT_STEP - 1,
            modifier = Modifier.semantics { contentDescription = "格子高度" },
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("文字大小", fontSize = 15.sp, modifier = Modifier.weight(1f))
            Row(
                Modifier.clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(2.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                ScheduleDisplayRules.TEXT_SIZES.forEach { (key, label) ->
                    val chosen = style.textSize == key
                    Text(
                        label, fontSize = 13.sp, fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (chosen) MaterialTheme.colorScheme.primary else meta, textAlign = TextAlign.Center,
                        modifier = Modifier.clip(RoundedCornerShape(8.dp))
                            .background(if (chosen) MaterialTheme.colorScheme.surface else Color.Transparent)
                            .clickable { style.selectTextSize(key) }.semantics { selected = chosen }
                            .padding(horizontal = 14.dp, vertical = 6.dp),
                    )
                }
            }
        }
        SettingSwitch("紧凑排版", "收紧卡片里的留白和字距，多放一行。", style.compactLayout) { style.updateCompactLayout(it) }
        SettingSwitch("显示老师", "在教室下面多写一行任课老师。", style.showTeacher) { style.updateShowTeacher(it) }
        SettingSwitch("显示非本周课程", "本周不上的课淡显在空着的节次里。", style.showOffWeek) { style.updateShowOffWeek(it) }
        Spacer(Modifier.height(18.dp))
        HorizontalDivider()
        Spacer(Modifier.height(14.dp))
        Text("课表网格", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = meta)
        SettingSwitch("显示节次时间", "关闭后节次栏只写第几节。", style.showSlotTime) { style.updateShowSlotTime(it) }
        SettingSwitch("高亮当前节次", "在今天这一列标出现在，日视图显示正在上和下一节。", style.showNowIndicator) { style.updateShowNowIndicator(it) }
        SettingSwitch("显示回到本周按钮", "右上角回到今天的按钮。", style.showBackToWeek) { style.updateShowBackToWeek(it) }
        SettingSwitch("显示周六", "关闭后，周六有课或补班时仍会显示。", style.showSaturday) { style.updateShowSaturday(it) }
        SettingSwitch("显示周日", "关闭后，周日有课或补班时仍会显示。", style.showSunday) { style.updateShowSunday(it) }
        SettingSwitch("周日排在首列", "第一列是周一前一天的那个周日。", style.sundayFirst, enabled = style.showSunday) { style.updateSundayFirst(it) }
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = { style.resetDisplay() }, enabled = !style.displayIsDefault) { Text("恢复默认") }
    }
}

@Composable
private fun SettingSwitch(title: String, detail: String, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 15.sp)
            Text(detail, fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.width(10.dp))
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}

private val PreviewSamples = listOf("高等数学" to 1, "大学英语" to 3, "药物化学" to 1)

/** A thumbnail drawn with the real week components at full size, then scaled. */
@Composable
private fun StylePreview(style: ScheduleVisualStyle, palette: String) {
    val colors = LocalScheduleColors.current
    val rowHeight = 32.dp
    val slots = 4
    val canvasWidth = 264.dp
    val canvasHeight = StyledHeaderHeight + rowHeight * slots + StyledSlotGap * (slots - 1) + 16.dp
    val width = 82.dp
    val scale = width / canvasWidth
    val scope = ScheduleStyleScope(style, colors.dark, palette, colors.text, colors.secondary, static = true)
    Box(Modifier.size(width, canvasHeight * scale).clip(RoundedCornerShape(6.dp)).background(colors.page).clipToBounds().clearAndSetSemantics {}) {
        Box(
            Modifier.wrapContentSize(Alignment.TopStart, unbounded = true).size(canvasWidth, canvasHeight)
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    transformOrigin = TransformOrigin(0f, 0f)
                }.padding(if (style == ScheduleVisualStyle.Table) 8.dp else 2.dp),
        ) {
            CompositionLocalProvider(LocalScheduleStyle provides scope) {
                if (style == ScheduleVisualStyle.Classic) ClassicPreview(rowHeight, slots) else {
                    StyledWeekGrid(
                        days = PreviewSamples.mapIndexed { index, (name, start) ->
                            val course = ScheduleCourse(name = name, location = "A10${index + 1}", startSlot = start, endSlot = start + 1)
                            StyledWeekDay(index + 1, "2026-09-0${index + 6}", false, null,
                                listOf(PlacedBlock(CourseBlock(index + 1, 1, start, start + 1, course), start, start + 1)))
                        },
                        periods = BUNDLED_PERIODS.take(slots), rowHeight = rowHeight, now = null, canAdd = false,
                        onCourse = { _, _ -> }, onAddSlot = { _, _ -> }, onDay = null, interactive = false, panelRadius = 12.dp,
                    )
                }
            }
        }
    }
}

/** The classic look in miniature: glass cells and gradient cards with a coloured edge. */
@Composable
private fun ClassicPreview(rowHeight: androidx.compose.ui.unit.Dp, slots: Int) {
    val colors = LocalScheduleColors.current
    val border = colors.divider
    Row(Modifier.fillMaxWidth().padding(6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        PreviewSamples.forEachIndexed { index, (name, start) ->
            val tone = scheduleCardTone(name, "color-glass", colors.dark)
            Column(Modifier.weight(1f)) {
                Column(
                    Modifier.fillMaxWidth().height(StyledHeaderHeight - 8.dp).clip(RoundedCornerShape(10.dp))
                        .background(Color.White.copy(alpha = if (colors.dark) 0.08f else 0.56f)).border(1.dp, border, RoundedCornerShape(10.dp)),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                ) {
                    Text(WEEKDAY_LABELS[index], fontSize = 13.sp, lineHeight = 15.sp, fontWeight = FontWeight.Bold, color = colors.secondary)
                    Text("${index + 6}", fontSize = 11.sp, lineHeight = 13.sp, fontWeight = FontWeight.SemiBold, color = colors.secondary)
                }
                Spacer(Modifier.height(8.dp))
                Box(Modifier.fillMaxWidth()) {
                    Column(verticalArrangement = Arrangement.spacedBy(StyledSlotGap)) {
                        repeat(slots) {
                            Box(Modifier.fillMaxWidth().height(rowHeight).padding(1.dp).clip(RoundedCornerShape(8.dp))
                                .background(Color.White.copy(alpha = if (colors.dark) 0.06f else 0.36f)).border(0.7.dp, border, RoundedCornerShape(8.dp)))
                        }
                    }
                    Box(
                        Modifier.padding(top = (rowHeight + StyledSlotGap) * (start - 1)).fillMaxWidth().height(rowHeight * 2 + StyledSlotGap)
                            .padding(1.dp).clip(RoundedCornerShape(9.dp))
                            .background(Brush.verticalGradient(listOf(Color(tone.highlight), Color(tone.fill))))
                            .border(1.5.dp, Color(tone.border), RoundedCornerShape(9.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(name, fontSize = 10.sp, lineHeight = 12.sp, fontWeight = FontWeight.Bold, color = Color(tone.text), textAlign = TextAlign.Center)
                    }
                }
            }
        }
    }
}
