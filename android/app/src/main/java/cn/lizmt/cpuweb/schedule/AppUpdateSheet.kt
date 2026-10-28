package cn.lizmt.cpuweb.schedule

import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

internal fun formatBytes(bytes: Long): String = when {
    bytes >= 1024 * 1024 -> "%.1f MB".format(Locale.ROOT, bytes / 1048576.0)
    bytes >= 1024 -> "%.0f KB".format(Locale.ROOT, bytes / 1024.0)
    else -> "$bytes B"
}

/** 应用更新: the state of the native updater, its two ways to update, and its settings. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AppUpdateSheet(activity: MainActivity, onDismiss: () -> Unit) {
    val updates = activity.updates
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("应用更新", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            UpdateStatus(activity)
            HorizontalDivider()
            SettingRow("自动检查更新", checked = updates.autoCheck) { updates.changeAutoCheck(it) }
            Text("自动下载", style = MaterialTheme.typography.bodyLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(DownloadPolicy.Wifi to "仅 Wi-Fi", DownloadPolicy.Always to "任何网络", DownloadPolicy.Manual to "手动").forEach { (policy, label) ->
                    FilterChip(selected = updates.downloadPolicy == policy, onClick = { updates.changeDownloadPolicy(policy) }, label = { Text(label) })
                }
            }
            val silentCapable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            SettingRow(
                "离开拾间后自动安装",
                detail = if (silentCapable) "下载好之后，离开拾间约一分半钟自动装好，不弹系统确认" else "需要 Android 12 及以上",
                checked = updates.installOnLeave && silentCapable,
                enabled = silentCapable,
            ) { updates.changeInstallOnLeave(it) }
            Text(
                buildString {
                    append("有增量包时只下载变化的部分，也可以选择下载完整安装包；两者都从企业盘下载，拾间会校验签名和指纹。")
                    if (updates.silentAfterPermission) append("允许拾间“安装未知应用”后，以后的更新会在你离开拾间后自动装好。")
                },
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun UpdateStatus(activity: MainActivity) {
    val updates = activity.updates
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("当前版本 ${updates.installedVersionName}", style = MaterialTheme.typography.bodyMedium)
        if (updates.lastCheckedAt > 0) {
            Text(
                "上次检查：" + SimpleDateFormat("M月d日 HH:mm", Locale.CHINA).format(Date(updates.lastCheckedAt)),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        val progress = @Composable { value: Float? ->
            val modifier = Modifier.fillMaxWidth().height(3.dp).clip(CircleShape)
            if (value == null) LinearProgressIndicator(modifier) else LinearProgressIndicator(progress = { value }, modifier = modifier)
        }
        when (val state = updates.state) {
            UpdateState.Idle -> Button(onClick = { updates.check() }) { Text("检查更新") }
            UpdateState.Checking -> {
                Text("正在检查…", style = MaterialTheme.typography.bodyMedium)
                progress(null)
            }
            is UpdateState.UpToDate -> {
                Text("已是最新版本", style = MaterialTheme.typography.bodyMedium)
                OutlinedButton(onClick = { updates.check() }) { Text("再检查一次") }
            }
            is UpdateState.Available -> {
                Text("发现新版 ${state.release.versionName}", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                ReleaseNotes(state.release.notes)
                val patch = state.release.patch
                if (patch != null) {
                    Button(onClick = { updates.startDownload() }) { Text("增量更新（${formatBytes(patch.size)}）") }
                    OutlinedButton(onClick = { updates.startDownload(full = true) }) { Text("下载完整安装包（${formatBytes(state.release.size)}）") }
                } else {
                    Button(onClick = { updates.startDownload() }) { Text("下载更新（${formatBytes(state.release.size)}）") }
                }
            }
            is UpdateState.Downloading -> {
                Text(if (state.viaPatch) "正在下载增量包" else "正在下载安装包", style = MaterialTheme.typography.bodyMedium)
                progress(if (state.total > 0) state.downloaded.toFloat() / state.total else 0f)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "${formatBytes(state.downloaded)} / ${formatBytes(state.total)}", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = { updates.cancel() }) { Text("暂停") }
                }
            }
            is UpdateState.Preparing -> {
                Text(state.step, style = MaterialTheme.typography.bodyMedium)
                progress(null)
            }
            is UpdateState.Ready -> {
                Text("${state.release.versionName} 已准备好", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                if (state.viaPatch && state.savedBytes > 0) {
                    Text(
                        "用增量包合成，少下载了 ${formatBytes(state.savedBytes)}",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                ReleaseNotes(state.release.notes)
                Text(
                    when {
                        state.needsConfirmation -> "系统需要你确认一次安装"
                        updates.canInstallSilently && updates.installOnLeave -> "离开拾间一会儿后会自动装好；现在安装会立即重启拾间"
                        updates.canInstallSilently -> "安装时拾间会自动重启，不需要重新下载或卸载"
                        else -> "安装时会弹出系统确认，覆盖安装，数据都会保留"
                    },
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Button(onClick = { updates.install() }) { Text(if (state.needsConfirmation) "确认安装" else "立即安装") }
            }
            is UpdateState.Installing -> {
                Text("正在安装 ${state.release.versionName}，拾间会自动重启", style = MaterialTheme.typography.bodyMedium)
                progress(null)
            }
            is UpdateState.Failed -> {
                Text(state.message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { if (state.release != null) updates.startDownload() else updates.check() }) { Text("重试") }
                    OutlinedButton(onClick = { activity.shell.openWeb("/download", ShellTab.Services) }) { Text("在下载页安装") }
                }
            }
        }
    }
}

@Composable
private fun SettingRow(title: String, detail: String? = null, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (detail != null) {
                Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.padding(start = 12.dp))
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}

@Composable
private fun ReleaseNotes(notes: List<String>) {
    if (notes.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        notes.take(8).forEach { note -> Text("· $note", style = MaterialTheme.typography.bodySmall) }
    }
}

/** Once, after the app has updated itself: the new version and what changed. */
@Composable
internal fun JustUpdatedDialog(update: AppUpdater.JustUpdated, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text("知道了") } },
        title = { Text("已更新到 ${update.versionName}") },
        text = {
            if (update.notes.isEmpty()) Text("新版已经装好，课表和设置都保留着。")
            else ReleaseNotes(update.notes)
        },
    )
}
