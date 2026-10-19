package cn.lizmt.cpuweb.schedule

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Science
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
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

@Composable
internal fun UpdatePage(activity: MainActivity) {
    val updates = activity.updates
    val context = LocalContext.current
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        updates.changeNotifyAfterUpdate(granted)
        if (!granted) activity.toast("没有通知权限，更新完成后不会提醒")
    }
    UpdateStatusCard(activity)
    NextAboutCard()
    SettingsGroup("自动更新", footer = buildString {
        append("有增量包时只下载变化的部分，通常只有完整安装包的几分之一；")
        append("安装包和增量包都从企业盘下载，拾间会校验签名和指纹。")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) append("你的系统低于 Android 12，安装时需要在系统弹窗里确认。")
    }) {
        SwitchRow("自动检查更新", "打开拾间时每 6 小时最多检查一次", updates.autoCheck) { updates.changeAutoCheck(it) }
        Divider()
        ChoiceRow("下载", DownloadPolicy.entries.map { it to it.title }, updates.downloadPolicy) { updates.changeDownloadPolicy(it) }
        Divider()
        SwitchRow(
            "离开拾间后自动安装",
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) "下载好的新版在你离开拾间一会儿后静默装好，不用重装、不打断使用"
            else "需要 Android 12 及以上",
            updates.installOnLeave && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S,
            enabled = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S,
        ) { updates.changeInstallOnLeave(it) }
        Divider()
        SwitchRow("更新完成后通知我", checked = updates.notifyAfterUpdate) { on ->
            if (on && Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                updates.changeNotifyAfterUpdate(on)
            }
        }
    }
}

@Composable
private fun UpdateStatusCard(activity: MainActivity) {
    val updates = activity.updates
    val look = LocalCpuLook.current
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(look.radius(18.dp))).background(MaterialTheme.colorScheme.surfaceContainer).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("当前版本 ${updates.installedVersionName}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.width(8.dp))
            NextBadge()
        }
        if (updates.lastCheckedAt > 0) {
            Text("上次检查：" + SimpleDateFormat("M月d日 HH:mm", Locale.CHINA).format(Date(updates.lastCheckedAt)),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        when (val state = updates.state) {
            UpdateState.Idle -> Button(onClick = { updates.check() }) { Text("检查更新") }
            UpdateState.Checking -> {
                Text("正在检查…", style = MaterialTheme.typography.bodyMedium)
                LinearProgressIndicator(Modifier.fillMaxWidth())
            }
            is UpdateState.UpToDate -> {
                Text("已是最新版本", style = MaterialTheme.typography.bodyMedium)
                OutlinedButton(onClick = { updates.check() }) { Text("再检查一次") }
            }
            is UpdateState.Available -> {
                Text("发现新版 ${state.release.versionName}", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                ReleaseNotes(state.release.notes)
                val patch = state.release.patch
                Text(
                    if (patch != null) "增量更新 ${formatBytes(patch.size)}（完整包 ${formatBytes(state.release.size)}）" else "下载 ${formatBytes(state.release.size)}",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Button(onClick = { updates.startDownload() }) { Text("下载更新") }
            }
            is UpdateState.Downloading -> {
                Text(if (state.viaPatch) "正在下载增量包" else "正在下载安装包", style = MaterialTheme.typography.bodyMedium)
                LinearProgressIndicator(progress = { if (state.total > 0) state.downloaded.toFloat() / state.total else 0f }, modifier = Modifier.fillMaxWidth())
                Text("${formatBytes(state.downloaded)} / ${formatBytes(state.total)}", style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { updates.cancel() }) { Text("暂停") }
            }
            is UpdateState.Preparing -> {
                Text(state.step, style = MaterialTheme.typography.bodyMedium)
                LinearProgressIndicator(Modifier.fillMaxWidth())
            }
            is UpdateState.Ready -> {
                Text("${state.release.versionName} 已准备好", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                if (state.viaPatch && state.savedBytes > 0) {
                    Text("用增量包合成，少下载了 ${formatBytes(state.savedBytes)}", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                LinearProgressIndicator(Modifier.fillMaxWidth())
            }
            is UpdateState.Failed -> {
                Text(state.message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { if (state.release != null) updates.startDownload() else updates.check() }) { Text("重试") }
                    OutlinedButton(onClick = { activity.shell.openWeb("/download") }) { Text("在下载页安装") }
                }
            }
        }
    }
}

@Composable
private fun ReleaseNotes(notes: List<String>) {
    if (notes.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        notes.take(8).forEach { note ->
            Text("· $note", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun NextAboutCard() {
    val look = LocalCpuLook.current
    val scheme = MaterialTheme.colorScheme
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(look.radius(18.dp)))
            .background(Brush.linearGradient(listOf(mix(scheme.primaryContainer, scheme.surface, 0.1f), mix(scheme.primaryContainer, androidx.compose.ui.graphics.Color(0xFF7A4CC2), 0.22f))))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            androidx.compose.material3.Icon(Icons.Rounded.Science, contentDescription = null, tint = scheme.primary)
            Spacer(Modifier.width(8.dp))
            Text("药大拾间 NEXT", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.width(8.dp))
            NextBadge()
        }
        Text("NEXT 是药大拾间的独立测试版，新功能先在这里打磨。它和正式版是两个应用，可以同时安装，账号和设置互不影响。",
            style = MaterialTheme.typography.bodyMedium)
        Text("不想用了直接卸载 NEXT 即可，正式版不受影响。遇到问题请在论坛或反馈群告诉我们。",
            style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant)
    }
}
