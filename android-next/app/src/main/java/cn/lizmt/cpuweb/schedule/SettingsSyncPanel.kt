package cn.lizmt.cpuweb.schedule

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

/** Where sync stands, in a line. */
private fun syncStatus(activity: MainActivity): String {
    val sync = activity.sync
    return when {
        !sync.enabled -> "日程和对话只留在这台手机上"
        !activity.web.authState.authenticated -> "登录后开始同步"
        sync.otherAccount -> "已暂停：这台手机上的数据来自另一个账号"
        sync.running -> "正在同步…"
        sync.error != null -> sync.error.orEmpty()
        sync.lastSyncedAt > 0 -> "上次同步 ${shortTime(sync.lastSyncedAt)}"
        else -> "还没有同步过"
    }
}

/** Cross-device sync: on or off, its state, a sync now, and the two ways out (other account, delete the server copy). */
@Composable
internal fun SyncPanel(activity: MainActivity) {
    val sync = activity.sync
    val scheme = MaterialTheme.colorScheme
    var confirmDelete by remember { mutableStateOf(false) }
    var confirmAdopt by remember { mutableStateOf(false) }
    Panel("跨设备同步", footer = "日程、拾间AI 对话和操作记录保存在你的拾间账号下，登录同一账号的其他手机会自动同步。") {
        ToggleRow("同步到我的其他手机", checked = sync.enabled, detail = syncStatus(activity)) { sync.switch(it) }
        if (sync.enabled && activity.web.authState.authenticated && !sync.otherAccount) {
            Hairline()
            ListRow("立即同步", enabled = !sync.running, titleColor = scheme.primary) { sync.request() }
        }
        if (sync.otherAccount) {
            Hairline()
            ListRow("改用当前账号", detail = "清空这台手机上的日程、对话和操作记录，再下载当前账号的", titleColor = scheme.primary) { confirmAdopt = true }
        }
        if (activity.web.authState.authenticated) {
            Hairline()
            ListRow("删除云端副本", titleColor = scheme.error) { confirmDelete = true }
        }
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("删除云端副本？") },
            text = { Text("服务器上保存的日程、对话和操作记录会被删除，这台手机随后不再同步。每台手机上已有的内容不受影响。") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    sync.deleteCloud { ok -> activity.toast(if (ok) "已删除云端副本" else "删除失败，请稍后重试") }
                }) { Text("删除", color = scheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("取消") } },
        )
    }
    if (confirmAdopt) {
        AlertDialog(
            onDismissRequest = { confirmAdopt = false },
            title = { Text("改用当前账号？") },
            text = { Text("这台手机上的日程、拾间AI 对话和操作记录会被清空（它们仍在原来那个账号下），然后下载当前账号的内容。") },
            confirmButton = { TextButton(onClick = { confirmAdopt = false; sync.adoptCurrentAccount() }) { Text("改用", color = scheme.error) } },
            dismissButton = { TextButton(onClick = { confirmAdopt = false }) { Text("取消") } },
        )
    }
}
