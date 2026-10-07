package cn.lizmt.cpuweb.schedule

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/**
 * "共享课表": the user's own share code on top, the timetables other people
 * shared with them below (iOS `NativeScheduleSharingView`).
 */
@Composable
fun ScheduleSharingSheet(activity: MainActivity, store: ScheduleStore, onDismiss: () -> Unit, onOpen: (String) -> Unit) {
    val sharing = activity.sharing
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }
    var importing by remember { mutableStateOf(false) }
    var revokeTarget by remember { mutableStateOf<ShareMeta?>(null) }
    var removeTarget by remember { mutableStateOf<SharedSchedule?>(null) }
    var renameTarget by remember { mutableStateOf<SharedSchedule?>(null) }
    var renameText by remember { mutableStateOf("") }
    val semester = store.selectedSemester.ifEmpty { store.result?.currentSemester.orEmpty() }
    val semesterLabel = store.semesterOptions().firstOrNull { it.value == semester }?.label?.takeIf { it.isNotBlank() } ?: semester

    // Either may fail offline; the saved state stays on screen.
    LaunchedEffect(Unit) {
        runCatching { sharing.loadMine() }
        sharing.refresh()
    }

    fun perform(work: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = ""
        notice = ""
        scope.launch {
            try {
                work()
            } catch (failure: ShareRequestException) {
                error = failure.message.orEmpty()
            } catch (failure: SharedScheduleException) {
                error = failure.message.orEmpty()
            } finally {
                busy = false
            }
        }
    }

    fun publish() = perform {
        val result = sharing.publish(store.completeSnapshot())
        notice = when {
            result.created -> "分享码已生成，发给朋友就能看到你的课表。"
            result.changed -> "分享内容已更新，对方下次打开就能看到。"
            else -> "分享内容已经是最新的。"
        }
    }

    revokeTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { revokeTarget = null },
            title = { Text("撤销这个分享码？") },
            text = { Text("撤销后这个码立刻失效，服务器上的课表副本也会删除。已经保存到对方设备上的课表不会消失，只是不再更新。") },
            confirmButton = {
                TextButton(onClick = {
                    revokeTarget = null
                    perform {
                        sharing.revoke(target.code)
                        notice = "分享码 ${target.code} 已撤销。"
                    }
                }) { Text("撤销并删除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { revokeTarget = null }) { Text("取消") } },
        )
    }
    removeTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { removeTarget = null },
            title = { Text("移除「${target.name}」？") },
            text = { Text("只从这台设备上移除，对方的分享不受影响。") },
            confirmButton = {
                TextButton(onClick = {
                    removeTarget = null
                    sharing.remove(target.meta.code)
                }) { Text("移除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { removeTarget = null }) { Text("取消") } },
        )
    }
    renameTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text("修改备注") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = renameText, onValueChange = { renameText = it.take(40) }, label = { Text("备注") }, singleLine = true)
                    Text("备注只保存在这台设备上，对方看不到。", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    sharing.rename(target.meta.code, renameText)
                    renameTarget = null
                }) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { renameTarget = null }) { Text("取消") } },
        )
    }

    ScheduleSheetContainer(onDismiss) {
        if (importing) {
            ShareImportForm(sharing, onBack = { importing = false })
        } else {
        SheetTitle("共享课表")
        SectionLabel("分享我的课表")
        val share = sharing.share(semester)
        if (share != null) {
            SelectionContainer {
                Text(share.code, fontSize = 30.sp, letterSpacing = 3.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace,
                    modifier = Modifier.semantics { contentDescription = "分享码 " + share.code.toList().joinToString(" ") })
            }
            Text(
                listOfNotNull(semesterLabel, "${share.courseCount} 门课", SharedSchedule.updatedText(share.updatedAt)).joinToString(" · "),
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(10.dp))
            Button(onClick = {
                val intent = Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_TEXT, SharedSchedule.invitation(share.code, AppConfig.origin))
                runCatching { activity.startActivity(Intent.createChooser(intent, "发送分享码")) }.onFailure { activity.toast("分享面板暂时不可用") }
            }, modifier = Modifier.fillMaxWidth()) { Text("发送给朋友") }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                FilledTonalButton(onClick = { publish() }, enabled = !busy, modifier = Modifier.weight(1f)) { Text("更新分享内容") }
                OutlinedButton(onClick = { revokeTarget = share }, enabled = !busy) { Text("撤销分享", color = MaterialTheme.colorScheme.error) }
            }
        } else {
            Button(onClick = { publish() }, enabled = !busy && store.result != null, modifier = Modifier.fillMaxWidth()) { Text("生成分享码") }
        }
        if (busy) {
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Text("正在处理…", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (notice.isNotEmpty()) Text(notice, fontSize = 12.sp, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 8.dp))
        if (error.isNotEmpty()) Text(error, fontSize = 12.sp, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
        Footnote("分享会上传「$semesterLabel」的课程、上课时间、教室、老师和调休安排，自己添加和修改的课程也在内。拿到分享码的人不用登录就能查看。课表有变化时点「更新分享内容」，分享码不变。")

        val others = sharing.mine.filter { it.semester != semester }
        if (others.isNotEmpty()) {
            SectionLabel("其他学期的分享码")
            others.forEach { other ->
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(other.code, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium)
                        Text("${other.semester} · ${other.courseCount} 门课", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    TextButton(onClick = { revokeTarget = other }, enabled = !busy) { Text("撤销", color = MaterialTheme.colorScheme.error) }
                }
            }
        }

        SectionLabel("共享给我的课表")
        sharing.library.schedules.forEach { schedule ->
            var menu by remember(schedule.meta.code) { mutableStateOf(false) }
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable {
                    onDismiss()
                    onOpen(schedule.meta.code)
                }.semantics { contentDescription = "打开共享课表 ${schedule.name}" }.padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(Modifier.size(34.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Group, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                }
                Column(Modifier.weight(1f)) {
                    Text(schedule.name, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (schedule.revoked) {
                        Text("分享已撤销，不会再更新", fontSize = 12.sp, color = MaterialTheme.colorScheme.tertiary)
                    } else {
                        Text(sharedSummary(schedule), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
                            overflow = TextOverflow.Ellipsis)
                    }
                }
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, contentDescription = "${schedule.name} 的更多操作") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text("修改备注") }, onClick = {
                            menu = false
                            renameText = schedule.remark
                            renameTarget = schedule
                        })
                        DropdownMenuItem(text = { Text("移除", color = MaterialTheme.colorScheme.error) }, onClick = {
                            menu = false
                            removeTarget = schedule
                        })
                    }
                }
            }
        }
        TextButton(onClick = { importing = true }) { Text("＋ 用分享码导入") }
        Footnote("轻点打开对方的课表，只能查看。导入的课表只保存在这台设备上，对方更新后会自动换成新的。")
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Spacer(Modifier.height(18.dp))
    Text(text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Spacer(Modifier.height(8.dp))
}

@Composable
private fun Footnote(text: String) {
    Text(text, fontSize = 12.sp, lineHeight = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 10.dp))
}

/** The remark is the title; the nickname is worth a line only when it differs. */
internal fun sharedSummary(schedule: SharedSchedule): String = listOfNotNull(
    schedule.meta.ownerName?.takeIf { it != schedule.name }?.let { "来自 $it" },
    "${schedule.courseCount} 门课",
    SharedSchedule.updatedText(schedule.meta.updatedAt),
).joinToString(" · ")

/** Type a code, look at what it is, name it, keep it. */
@Composable
private fun ShareImportForm(sharing: ScheduleSharing, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    var remark by remember { mutableStateOf("") }
    var preview by remember { mutableStateOf<SharedSchedule?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("用分享码导入", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        TextButton(onClick = onBack) { Text("返回") }
    }
    Spacer(Modifier.height(10.dp))
    OutlinedTextField(
        value = code,
        onValueChange = {
            code = it.take(200)
            preview = null
            error = ""
        },
        label = { Text("8 位分享码，或粘贴分享链接") }, singleLine = true,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
        textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(8.dp))
    FilledTonalButton(
        onClick = {
            loading = true
            error = ""
            val input = code
            scope.launch {
                try {
                    val schedule = sharing.preview(input)
                    if (input == code) {
                        sharing.library.schedules.firstOrNull { it.meta.code == schedule.meta.code }?.let { remark = it.remark }
                        preview = schedule
                    }
                } catch (failure: ShareRequestException) {
                    error = failure.message.orEmpty()
                } catch (failure: SharedScheduleException) {
                    error = failure.message.orEmpty()
                } finally {
                    loading = false
                }
            }
        },
        enabled = !loading && code.isNotBlank(), modifier = Modifier.fillMaxWidth(),
    ) {
        Text("预览课表")
        if (loading) {
            Spacer(Modifier.width(8.dp))
            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        }
    }
    if (error.isNotEmpty()) Text(error, fontSize = 12.sp, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
    Footnote("分享码由对方在「课表 → 更多 → 共享课表」里生成。")
    preview?.let { schedule ->
        SectionLabel("这份课表")
        listOf(
            "来自" to (schedule.meta.ownerName ?: "没有留昵称"),
            "学期" to schedule.meta.semester,
            "课程" to "${schedule.courseCount} 门",
            "教学周" to "${schedule.weeks.size} 周",
        ).forEach { (label, value) ->
            Row(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(72.dp))
                Text(value, modifier = Modifier.weight(1f))
            }
        }
        HorizontalDivider(Modifier.padding(vertical = 8.dp))
        OutlinedTextField(
            value = remark, onValueChange = { remark = it.take(40) }, singleLine = true,
            label = { Text("备注") }, placeholder = { Text(schedule.meta.ownerName ?: "例如 室友小王") },
            modifier = Modifier.fillMaxWidth(),
        )
        Footnote("备注只保存在这台设备上，用来在列表里认出这份课表。")
        Spacer(Modifier.height(10.dp))
        Button(
            onClick = {
                sharing.save(schedule, remark)
                onBack()
            },
            enabled = remark.isNotBlank() || schedule.meta.ownerName != null,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) { Text("确认导入") }
    }
}

/**
 * Somebody else's timetable, over the user's own and read-only. It runs on
 * its own store, so nothing here reaches the user's widgets or archive.
 */
@Composable
fun SharedScheduleScreen(activity: MainActivity, code: String, onClose: () -> Unit) {
    val sharing = activity.sharing
    val current = sharing.library.schedules.firstOrNull { it.meta.code == code }
    if (current == null) {
        LaunchedEffect(code) { onClose() }
        return
    }
    val scope = rememberCoroutineScope()
    val store = remember(code) {
        ScheduleStore(scope, readOnly = true).apply {
            // Always the saved copy as it is now, so a refresh shows up here.
            loader = { (sharing.library.schedules.firstOrNull { it.meta.code == code } ?: current).snapshot() }
            markBridgeReady()
        }
    }
    LaunchedEffect(code) { sharing.refresh() }
    LaunchedEffect(current.meta.updatedAt, current.remark) { if (store.result != null) store.load(true) }
    BackHandler(onBack = onClose)
    val colors = LocalScheduleColors.current
    Column(Modifier.fillMaxSize().consumesTouches().background(colors.page)) {
        Row(
            Modifier.fillMaxWidth().background(colors.surface).padding(start = 16.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Rounded.Group, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
            Column(Modifier.weight(1f)) {
                Text(current.name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (current.revoked) "分享已撤销，不会再更新" else "共享课表 · 只能查看", fontSize = 11.sp,
                    color = if (current.revoked) MaterialTheme.colorScheme.tertiary else colors.secondary)
            }
            TextButton(onClick = onClose) { Text("关闭", fontWeight = FontWeight.SemiBold) }
        }
        HorizontalDivider(color = colors.divider)
        Box(Modifier.weight(1f).fillMaxWidth()) { ScheduleSurface(activity, store, onOpenShared = null) }
    }
}
