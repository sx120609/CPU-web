package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Code
import androidx.compose.material.icons.rounded.Dashboard
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material.icons.rounded.ViewDay
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.lizmt.cpuweb.schedule.custom.CustomizationStore
import cn.lizmt.cpuweb.schedule.custom.LAYOUT_PRESETS

/**
 * Shown once after this version arrives: what can now be rearranged, and a
 * choice of starting layouts. Keeping the current layout is the default.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NextIntroSheet(activity: MainActivity) {
    val store = activity.customization
    val current = store.value
    var chosen by remember { mutableStateOf(LAYOUT_PRESETS.firstOrNull { CustomizationStore.normalize(it.apply(current)) == current }?.id ?: "classic") }
    val look = LocalCpuLook.current
    val finish = { store.markIntroSeen() }
    ModalBottomSheet(onDismissRequest = finish, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 28.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("欢迎来到药大拾间", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(8.dp))
                NextBadge()
            }
            Spacer(Modifier.height(6.dp))
            Text("这是可以按你的方式重新组装的拾间，和正式版并存，互不影响。", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(16.dp))
            Feature(Icons.Rounded.ViewDay, "导航栏你说了算", "任意页面都能做成标签，改名、换图标、换顺序、选启动页")
            Feature(Icons.Rounded.Dashboard, "属于你的工作台", "下一节课倒计时、今日课程、未读、公告、热榜、倒计时和便签")
            Feature(Icons.Rounded.Palette, "主题引擎", "任意主题色、纯黑深色、圆角与密度，连网页一起换装")
            Feature(Icons.Rounded.Code, "网页改造", "隐藏不想看的模块，甚至写自己的样式")
            Feature(Icons.Rounded.SystemUpdate, "增量更新", "以后更新只下载变化的部分，离开拾间后自动装好")
            Spacer(Modifier.height(12.dp))
            Text("选一个开始的布局", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            LAYOUT_PRESETS.forEach { preset ->
                val selected = chosen == preset.id
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(look.radius(14.dp)))
                        .border(if (selected) 2.dp else 1.dp, if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                            RoundedCornerShape(look.radius(14.dp)))
                        .clickable { chosen = preset.id }.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(preset.title + if (preset.id == "classic") "（保持现在的样子）" else "", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                        Text(preset.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (selected) Icon(Icons.Rounded.Check, contentDescription = "已选", tint = MaterialTheme.colorScheme.primary)
                }
            }
            Spacer(Modifier.height(16.dp))
            Button(onClick = {
                LAYOUT_PRESETS.firstOrNull { it.id == chosen }?.let { preset -> store.update(preset.apply) }
                activity.shell.layoutChanged()
                finish()
            }, modifier = Modifier.fillMaxWidth()) { Text("就用这个") }
            TextButton(onClick = {
                finish()
                activity.openSettings("")
            }, modifier = Modifier.fillMaxWidth()) { Text("我要自己从头组装") }
        }
    }
}

@Composable
private fun Feature(icon: ImageVector, title: String, detail: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(38.dp).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** After an update: the version the app now runs and what changed. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JustUpdatedSheet(activity: MainActivity, update: AppUpdater.JustUpdated) {
    ModalBottomSheet(onDismissRequest = { activity.updates.dismissJustUpdated() }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 28.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("已更新到 ${update.versionName}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(8.dp))
                NextBadge()
            }
            Spacer(Modifier.height(10.dp))
            if (update.notes.isEmpty()) {
                Text("这次更新修复了问题并改进了体验。", style = MaterialTheme.typography.bodyMedium)
            } else {
                update.notes.forEach { Text("· $it", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 2.dp)) }
            }
            Spacer(Modifier.height(16.dp))
            Button(onClick = { activity.updates.dismissJustUpdated() }, modifier = Modifier.fillMaxWidth()) { Text("好的") }
        }
    }
}
