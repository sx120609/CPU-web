package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import cn.lizmt.cpuweb.schedule.custom.CustomizationStore
import cn.lizmt.cpuweb.schedule.custom.LAYOUT_PRESETS

/**
 * Shown once when this version arrives: what is new, and a starting layout.
 * The current layout stays selected unless the user picks another.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NextIntroSheet(activity: MainActivity) {
    val store = activity.customization
    val current = store.value
    var chosen by remember { mutableStateOf(LAYOUT_PRESETS.firstOrNull { CustomizationStore.normalize(it.apply(current)) == current }?.id) }
    val finish = { store.markIntroSeen() }
    ModalBottomSheet(onDismissRequest = finish, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("NEXT ${activity.updates.installedVersionName}", style = MaterialTheme.typography.headlineMedium)
                Spacer(Modifier.width(8.dp))
                NextBadge()
            }
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Feature("今天", "课和你自己的安排排在一条时间线上，下一件事放在最上面。")
                Feature("日程与待办", "随时记下要做的事，写「周五 14:00 组会」就能认出时间；到点在通知栏提醒。")
                Feature("拾间AI 个人模式", "让它结合你的课表回答、帮你找空闲时间、替你记事——每一步都先问过你。")
            }
            Panel("选一个开始的布局") {
                CheckList(LAYOUT_PRESETS.map { Triple(it.id as String?, it.title, it.detail) }, chosen) { chosen = it }
            }
            Button(
                onClick = {
                    LAYOUT_PRESETS.firstOrNull { it.id == chosen }?.let { preset -> store.update(preset.apply) }
                    activity.shell.layoutChanged()
                    finish()
                },
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(LocalCpuLook.current.radius(12.dp)),
            ) { Text(if (chosen == null) "保持现在的布局" else "开始") }
        }
    }
}

@Composable
private fun Feature(title: String, detail: String) {
    Column {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** After an update: the version the app now runs and what changed. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JustUpdatedSheet(activity: MainActivity, update: AppUpdater.JustUpdated) {
    ModalBottomSheet(onDismissRequest = { activity.updates.dismissJustUpdated() }, containerColor = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("已更新到 ${update.versionName}", style = MaterialTheme.typography.headlineSmall)
            if (update.notes.isEmpty()) {
                Text("这次更新修复了问题并改进了体验。", style = MaterialTheme.typography.bodyMedium)
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    update.notes.forEach { Text("· $it", style = MaterialTheme.typography.bodyMedium) }
                }
            }
            Button(onClick = { activity.updates.dismissJustUpdated() }, modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(LocalCpuLook.current.radius(12.dp))) { Text("好的") }
        }
    }
}
