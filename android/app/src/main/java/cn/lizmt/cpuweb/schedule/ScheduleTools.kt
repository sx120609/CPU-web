package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Alarm
import androidx.compose.material.icons.rounded.Bed
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Checklist
import androidx.compose.material.icons.rounded.EditCalendar
import androidx.compose.material.icons.rounded.EventAvailable
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.Layers
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Widgets
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** One entry of 更多; a null action leaves it out. */
internal class ScheduleTool(val title: String, val icon: ImageVector, val tint: Color, val detail: String? = null, val enabled: Boolean = true, val action: (() -> Unit)?)

/** The icons and colours of 更多, kept together so the groups read alike (iOS `scheduleToolsSheet`). */
internal object ScheduleToolStyle {
    val refresh = Icons.Rounded.Refresh to Color(0xFF13887A)
    val addCourse = Icons.Rounded.Add to Color(0xFF2F6FE4)
    val addAgenda = Icons.Rounded.EditCalendar to Color(0xFFE08A1E)
    val share = Icons.Rounded.Share to Color(0xFF5B5BD6)
    val calendar = Icons.Rounded.CalendarMonth to Color(0xFFE5484D)
    val agenda = Icons.Rounded.Checklist to Color(0xFFE08A1E)
    val sharing = Icons.Rounded.Group to Color(0xFF2F6FE4)
    val overlay = Icons.Rounded.Layers to OverlayTeal
    val free = Icons.Rounded.EventAvailable to Color(0xFF5B5BD6)
    val couple = Icons.Rounded.Favorite to CoupleAccent
    val dorm = Icons.Rounded.Bed to Color(0xFF0E9FBF)
    val alarm = Icons.Rounded.Alarm to Color(0xFFE5484D)
    val settings = Icons.Rounded.Settings to Color(0xFF8E8E93)
    val widgets = Icons.Rounded.Widgets to Color(0xFF8E59D9)
}

/**
 * 更多: the quick actions as tiles, then 日历与日程, 一起看 and 外观与设置,
 * regrouped after the iOS NapTable work. Every row closes the sheet first.
 */
@Composable
internal fun ScheduleToolsSheet(tiles: List<ScheduleTool>, sections: List<Pair<String, List<ScheduleTool>>>, onDismiss: () -> Unit) {
    ScheduleSheetContainer(onDismiss) {
        SheetTitle("更多")
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            tiles.filter { it.action != null }.forEach { tile ->
                Column(
                    Modifier.weight(1f).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f))
                        .clickable(enabled = tile.enabled) {
                            onDismiss()
                            tile.action?.invoke()
                        }
                        .alpha(if (tile.enabled) 1f else 0.45f)
                        .semantics(mergeDescendants = true) { role = Role.Button }
                        .padding(vertical = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(tile.icon, contentDescription = null, tint = tile.tint, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.size(6.dp))
                    Text(tile.title, fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 1, textAlign = TextAlign.Center)
                }
            }
        }
        sections.forEach { (title, rows) ->
            val shown = rows.filter { it.action != null }
            if (shown.isEmpty()) return@forEach
            Text(title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 4.dp, top = 20.dp, bottom = 8.dp))
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f))) {
                shown.forEachIndexed { index, row ->
                    if (index > 0) HorizontalDivider(Modifier.padding(start = 58.dp))
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(enabled = row.enabled) {
                            onDismiss()
                            row.action?.invoke()
                        }.semantics(mergeDescendants = true) { contentDescription = listOfNotNull(row.title, row.detail).joinToString("，") }
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(32.dp).clip(RoundedCornerShape(9.dp)).background(row.tint), contentAlignment = Alignment.Center) {
                            Icon(row.icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                        }
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Text(row.title, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            row.detail?.let {
                                Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                        }
                        Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}
