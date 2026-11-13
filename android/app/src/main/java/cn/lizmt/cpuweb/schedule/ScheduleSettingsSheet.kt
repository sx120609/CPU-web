package cn.lizmt.cpuweb.schedule

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

// region Shared rows: every settings sheet uses these, so they read as one set.

/** A group heading: small, muted, with the space above it separating groups. */
@Composable
fun SettingsSection(title: String, first: Boolean = false) {
    Text(
        title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = if (first) 0.dp else 22.dp, bottom = 6.dp).semantics { heading() },
    )
}

@Composable
fun SettingsSwitchRow(title: String, checked: Boolean, detail: String? = null, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(10.dp))
            .clickable(enabled = enabled) { onChange(!checked) }.padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 15.sp, color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
            if (detail != null) Text(detail, fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.width(12.dp))
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}

/** A row that opens something else, with its current value on the right. */
@Composable
fun SettingsNavRow(title: String, value: String? = null, valueColor: Color = Color.Unspecified, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(10.dp)).clickable(onClick = onClick).padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, fontSize = 15.sp, modifier = Modifier.weight(1f))
        if (value != null) {
            Text(value, fontSize = 13.sp,
                color = if (valueColor == Color.Unspecified) MaterialTheme.colorScheme.onSurfaceVariant else valueColor)
        }
        Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 2.dp))
    }
}

/** A title on the left and a small control on the right, at the height of a switch row. */
@Composable
fun SettingsValueRow(title: String, trailing: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, fontSize = 15.sp, modifier = Modifier.weight(1f))
        trailing()
    }
}

/**
 * Few choices side by side, the chosen one raised. A label never wraps: with
 * large text the row scrolls sideways instead of stacking 「3 小时」 a character
 * a line.
 */
@Composable
fun SettingsSegmented(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    val meta = MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        Modifier.horizontalScroll(rememberScrollState())
            .clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        options.forEach { (key, label) ->
            val chosen = selected == key
            Text(
                label, fontSize = 13.sp, fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Normal,
                color = if (chosen) MaterialTheme.colorScheme.primary else meta, textAlign = TextAlign.Center,
                maxLines = 1, softWrap = false,
                modifier = Modifier.clip(RoundedCornerShape(8.dp))
                    .background(if (chosen) MaterialTheme.colorScheme.surface else Color.Transparent)
                    .clickable { onSelect(key) }.semantics { this.selected = chosen }
                    .padding(horizontal = 14.dp, vertical = 6.dp),
            )
        }
    }
}

// endregion

/**
 * 课表设置: everything about how the timetable looks, in one sheet. A shared
 * timetable being viewed ([readOnly]) keeps only the style and the layout.
 */
@Composable
fun ScheduleSettingsSheet(activity: MainActivity, readOnly: Boolean, together: Boolean = false, onWidgets: () -> Unit, onDismiss: () -> Unit) {
    val style = activity.style
    ScheduleSheetContainer(onDismiss) {
        SheetTitle("课表设置")

        SettingsSection("风格", first = true)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ScheduleVisualStyle.entries.forEach { option ->
                val chosen = style.visualStyle == option
                Column(
                    Modifier.clip(RoundedCornerShape(10.dp)).clickable { style.selectVisualStyle(option) }
                        .semantics(mergeDescendants = true) { selected = chosen; contentDescription = "${option.title}风格" },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    val outline = if (chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
                    Column(Modifier.border(if (chosen) 2.dp else 1.dp, outline, RoundedCornerShape(9.dp)).padding(3.dp)) {
                        StylePreview(option, style.palette)
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(option.title, fontSize = 13.sp, fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                }
            }
        }

        if (!readOnly) {
            SettingsSection("配色")
            PaletteChoices(style.palette) { style.selectPalette(it) }

            SettingsSection("背景图片")
            BackgroundChoice(activity)
            if (style.hasBackground) {
                SettingsValueRow("显现程度") { Text("${(style.visibility * 100).roundToInt()}%", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Slider(
                    value = style.visibility, onValueChange = { style.updateVisibility(it) },
                    valueRange = ScheduleStyleSettings.MIN_VISIBILITY..ScheduleStyleSettings.MAX_VISIBILITY,
                    modifier = Modifier.semantics { contentDescription = "背景显现程度" },
                )
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    SettingsValueRow("柔化") { Text("${style.blur.roundToInt()}", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    Slider(value = style.blur, onValueChange = { style.updateBlur(it) }, valueRange = 0f..ScheduleStyleSettings.MAX_BLUR,
                        modifier = Modifier.semantics { contentDescription = "背景柔化" })
                }
            }
        }

        SettingsSection("课程格子")
        SettingsValueRow("格子高度") { Text("${style.rowHeight}%", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        Slider(
            value = style.rowHeight.toFloat(),
            onValueChange = { style.updateRowHeight(it.toInt()) },
            valueRange = ScheduleDisplayRules.ROW_HEIGHT_MIN.toFloat()..ScheduleDisplayRules.ROW_HEIGHT_MAX.toFloat(),
            steps = (ScheduleDisplayRules.ROW_HEIGHT_MAX - ScheduleDisplayRules.ROW_HEIGHT_MIN) / ScheduleDisplayRules.ROW_HEIGHT_STEP - 1,
            modifier = Modifier.semantics { contentDescription = "格子高度" },
        )
        SettingsValueRow("文字大小") { SettingsSegmented(ScheduleDisplayRules.TEXT_SIZES, style.textSize) { style.selectTextSize(it) } }
        SettingsSwitchRow("紧凑排版", style.compactLayout) { style.updateCompactLayout(it) }
        SettingsSwitchRow("显示老师", style.showTeacher) { style.updateShowTeacher(it) }
        SettingsSwitchRow("显示非本周课程", style.showOffWeek) { style.updateShowOffWeek(it) }

        SettingsSection("课表网格")
        SettingsSwitchRow("显示节次时间", style.showSlotTime) { style.updateShowSlotTime(it) }
        SettingsSwitchRow("高亮当前节次", style.showNowIndicator) { style.updateShowNowIndicator(it) }
        SettingsSwitchRow("显示“回到本周”按钮", style.showBackToWeek) { style.updateShowBackToWeek(it) }
        // Only worth saying once the day is hidden.
        SettingsSwitchRow("显示周六", style.showSaturday, detail = if (style.showSaturday) null else "有课或补班时仍会显示") { style.updateShowSaturday(it) }
        SettingsSwitchRow("显示周日", style.showSunday, detail = if (style.showSunday) null else "有课或补班时仍会显示") { style.updateShowSunday(it) }
        SettingsSwitchRow("周日排在首列", style.sundayFirst, enabled = style.showSunday) { style.updateSundayFirst(it) }
        if (!style.displayIsDefault) {
            TextButton(onClick = { style.resetDisplay() }, modifier = Modifier.padding(top = 2.dp)) { Text("课程格子和网格恢复默认") }
        }

        // Only somebody who looks at two timetables has this choice to make.
        if (!readOnly && together) {
            SettingsSection("一起看")
            CoupleWeekLayoutChoice(style)
        }

        if (!readOnly) {
            SettingsSection("应用外观")
            AppearancePicker(activity.appearance)

            SettingsSection("更多")
            SettingsNavRow("桌面课表小组件", onClick = onWidgets)
        }
    }
}

/** 一起看的周视图: 并排 (the two-column day strip) or 合并 (one week grid), with a line on what each is. */
@Composable
fun CoupleWeekLayoutChoice(style: ScheduleStyleSettings) {
    SettingsValueRow(CoupleWeekLayout.SETTING_TITLE) {
        SettingsSegmented(CoupleWeekLayout.OPTIONS, style.coupleWeekLayout.id) { style.selectCoupleWeekLayout(CoupleWeekLayout.fromId(it)) }
    }
    Text(CoupleWeekLayout.SETTING_DETAIL, fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/**
 * 背景图片 for each appearance: 浅色模式 and 深色模式 (which keeps the light
 * photo until it has one of its own), each with 调整范围 to frame it. A new
 * photo opens the framing at once.
 */
@Composable
private fun BackgroundChoice(activity: MainActivity) {
    val style = activity.style
    var dark by rememberSaveable { mutableStateOf(style.appearanceDark) }
    var framing by remember { mutableStateOf<Boolean?>(null) }
    // A photo just picked: frame it now.
    androidx.compose.runtime.LaunchedEffect(activity.backgroundToFrame) {
        activity.backgroundToFrame?.let {
            dark = it
            framing = it
            activity.backgroundToFrame = null
        }
    }
    SettingsSegmented(listOf("light" to "浅色模式", "dark" to "深色模式"), if (dark) "dark" else "light") { dark = it == "dark" }
    Spacer(Modifier.height(4.dp))
    val own = if (dark) style.darkBackground else style.lightBackground
    val status = when {
        own != null -> "已设置"
        dark && style.lightBackground != null -> "跟随浅色模式"
        else -> "未设置"
    }
    SettingsValueRow(status) {
        if (own != null) TextButton(onClick = { style.clearBackground(dark) }) { Text("清除") }
        TextButton(onClick = { activity.pickScheduleBackground(dark) }) { Text(if (own == null) "从相册选择" else "更换") }
    }
    if (own != null) SettingsNavRow("调整范围", if ((if (dark) style.darkCrop else style.lightCrop) == null) "整张" else "已裁剪") { framing = dark }
    framing?.let { which ->
        val original = androidx.compose.runtime.remember(which) { style.originalBackground(which) }
        if (original == null) {
            androidx.compose.runtime.LaunchedEffect(which) { framing = null }
        } else {
            BackgroundCropEditor(original, if (which) style.darkCrop else style.lightCrop,
                onDone = { crop ->
                    style.setCrop(crop, which)
                    framing = null
                },
                onDismiss = { framing = null })
        }
    }
}
