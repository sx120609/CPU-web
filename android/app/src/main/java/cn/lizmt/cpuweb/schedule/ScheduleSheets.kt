package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.layout.statusBarsPadding
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduleSheetContainer(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    ModalBottomSheet(modifier = Modifier.statusBarsPadding(), onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
            content()
        }
    }
}

@Composable
fun SheetTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(14.dp))
}

@Composable
fun OverlapSheet(blocks: List<CourseBlock>, palette: String, onDismiss: () -> Unit, onSelect: (CourseBlock) -> Unit) {
    val colors = LocalScheduleColors.current
    ScheduleSheetContainer(onDismiss) {
        SheetTitle("同一时段的课程")
        blocks.forEach { block ->
            val tone = scheduleCardTone(block.course.name, palette, colors.dark)
            Row(
                Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(12.dp)).background(Color(tone.fill))
                    .border(1.dp, Color(tone.border), RoundedCornerShape(12.dp)).clickable { onSelect(block) }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(block.course.name, fontWeight = FontWeight.Medium, color = Color(tone.text))
                    Text(
                        listOf(ScheduleStyleTime.location(block.course.location) ?: "地点待定", block.course.slotNote.orEmpty()).filter { it.isNotEmpty() }.joinToString(" · "),
                        fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WeekPickerSheet(store: ScheduleStore, onDismiss: () -> Unit) {
    val colors = LocalScheduleColors.current
    val current = store.weekOptions().firstOrNull { store.isCurrentWeek(it.value) }?.value
    ModalBottomSheet(
        modifier = Modifier.statusBarsPadding(),
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        dragHandle = {
            Box(Modifier.padding(vertical = 8.dp).size(width = 28.dp, height = 3.dp)
                .clip(CircleShape).background(colors.secondary.copy(alpha = 0.3f)))
        },
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
            Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("选择周次", fontSize = 15.sp, lineHeight = 20.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                TextButton(onClick = { onDismiss(); store.returnToCurrentWeek() }, modifier = Modifier.height(32.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 4.dp)) {
                    Text("回到本周", fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.sp, color = colors.accent)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                store.weekOptions().chunked(6).forEach { weeks ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        weeks.forEach { week ->
                            val chosen = week.value == store.selectedWeek
                            Box(
                                Modifier.weight(1f).height(36.dp).clip(RoundedCornerShape(8.dp))
                                    .background(if (chosen) colors.accent else colors.softSurface.copy(alpha = 0.65f))
                                    .border(if (week.value == current && !chosen) 1.dp else 0.dp,
                                        if (week.value == current && !chosen) colors.accent else Color.Transparent, RoundedCornerShape(8.dp))
                                    .clickable { onDismiss(); store.selectWeek(week.value) }
                                    .semantics { contentDescription = "第${week.value}周"; selected = chosen },
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(week.value, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.sp, fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Medium,
                                    color = if (chosen) Color.White else colors.text)
                            }
                        }
                        repeat(6 - weeks.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

@Composable
fun PaletteChoices(selected: String, onSelect: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        SCHEDULE_THEME_ORDER.forEach { theme ->
            val chosen = selected == theme
            Column(
                Modifier.width(52.dp).clip(RoundedCornerShape(12.dp)).clickable { onSelect(theme) }
                    .semantics { contentDescription = scheduleThemeLabel(theme) + "配色"; this.selected = chosen }
                    .padding(vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    Modifier.size(36.dp).border(1.5.dp, if (chosen) MaterialTheme.colorScheme.primary else Color.Transparent, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    val swatch = if (theme == "color-glass") {
                        Modifier.background(Brush.linearGradient(listOf(Color(0xFF78C9AF), Color(0xFF74A5F5), Color(0xFFB696E9), Color(0xFFEC9BB7))), CircleShape)
                    } else {
                        Modifier.background(Color(parseHexColor(schedulePalette(theme).accent)), CircleShape)
                    }
                    Box(Modifier.size(26.dp).clip(CircleShape).then(swatch))
                }
                Spacer(Modifier.height(4.dp))
                Text(scheduleThemeLabel(theme), fontSize = 11.sp,
                    color = if (chosen) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
