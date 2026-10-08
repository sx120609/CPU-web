package cn.lizmt.cpuweb.schedule

import android.content.Intent
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Calendar
import java.util.GregorianCalendar
import java.util.Locale
import java.util.TimeZone

/** The heart of the couple timetable; the same pink in both appearances, as on the Web. */
internal val CoupleAccent = Color(0xFFE2568A)

/** The room a course leaves at its bottom for the line that says what the partner is doing then. */
internal val CoupleNoteSpace = 17.dp

/**
 * The line under one of the user's courses: 一起 with a heart for a class both
 * attend, or "TA 课名" in the partner's colour for a course of theirs then.
 */
@Composable
internal fun CoupleNote(modifier: Modifier, label: String?, tint: CoupleTint?, onClick: (() -> Unit)?) {
    val colors = LocalScheduleColors.current
    val shape = RoundedCornerShape(8.dp)
    val ink = tint?.let { Color(it.text) } ?: CoupleAccent
    Row(
        modifier.height(15.dp).clip(shape).background(colors.surface)
            .background(tint?.let { Color(it.fill) } ?: CoupleAccent.copy(alpha = 0.12f))
            .border(0.5.dp, ink.copy(alpha = 0.25f), shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .semantics { contentDescription = if (label == null) "一起上" else "TA $label" }
            .padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        if (label == null) {
            Icon(Icons.Rounded.Favorite, contentDescription = null, tint = CoupleAccent, modifier = Modifier.size(9.dp))
            Text("一起", fontSize = 9.sp, lineHeight = 11.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, color = ink, maxLines = 1, softWrap = false)
        } else {
            Text("TA", fontSize = 8.sp, lineHeight = 11.sp, letterSpacing = 0.sp, fontWeight = FontWeight.ExtraBold, color = ink, maxLines = 1, softWrap = false)
            Text(label, fontSize = 9.sp, lineHeight = 11.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, color = ink, maxLines = 1,
                softWrap = false, overflow = TextOverflow.Clip)
        }
    }
}

/**
 * "情侣课表": inviting and accepting while unbound, and the binding's settings
 * once bound (the Web's `CoupleDialog`).
 */
@Composable
fun ScheduleCoupleSheet(activity: MainActivity, minute: Int, onDismiss: () -> Unit) {
    val couple = activity.couple
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }
    var confirmUnbind by remember { mutableStateOf(false) }
    var pickDate by remember { mutableStateOf(false) }

    // Opening the sheet always asks again; while an invite waits, keep asking so
    // the inviter sees the binding happen.
    LaunchedEffect(Unit) {
        couple.refresh(force = true)
        while (true) {
            delay(10_000)
            if (couple.status is CoupleStatus.Pending && !busy) couple.refresh(force = true)
        }
    }

    fun perform(success: String = "", work: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = ""
        notice = ""
        scope.launch {
            try {
                work()
                notice = success
            } catch (failure: CoupleRequestException) {
                error = failure.message.orEmpty()
            } finally {
                busy = false
            }
        }
    }

    val status = couple.status
    if (confirmUnbind && status is CoupleStatus.Active) {
        AlertDialog(
            onDismissRequest = { confirmUnbind = false },
            title = { Text("解除绑定") },
            text = { Text("确定解除和 ${status.partner.nickname.ifEmpty { "TA" }} 的绑定吗？双方的课表快照和纪念日会立即删除。") },
            confirmButton = {
                TextButton(onClick = {
                    confirmUnbind = false
                    perform("已解除绑定") { couple.unbind() }
                }) { Text("解除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmUnbind = false }) { Text("再想想") } },
        )
    }
    if (pickDate && status is CoupleStatus.Active) {
        AnniversaryPicker(status.anniversary, onDismiss = { pickDate = false }) { date ->
            pickDate = false
            perform(if (date.isEmpty()) "纪念日已清除" else "纪念日已保存") { couple.setAnniversary(date) }
        }
    }

    ScheduleSheetContainer(onDismiss) {
        SheetTitle("情侣课表")
        when (status) {
            CoupleStatus.Unknown -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Text("正在读取绑定状态…", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            is CoupleStatus.Active -> BoundContent(
                couple, status, minute, busy,
                onColor = { color -> perform(if (color == status.partner.color) "已和 TA 互换颜色" else "颜色已保存") { couple.setColor(color) } },
                onAnniversary = { pickDate = true },
                onUnbind = { confirmUnbind = true },
                onDone = onDismiss,
            )
            else -> UnboundContent(
                activity, status as? CoupleStatus.Pending, busy,
                onInvite = { perform { couple.invite() } },
                onCancel = { perform { couple.cancelInvite() } },
                onAccept = { code ->
                    perform {
                        couple.accept(code)
                        (couple.status as? CoupleStatus.Active)?.let { notice = "已和 ${it.partner.nickname.ifEmpty { "TA" }} 绑定" }
                    }
                },
            )
        }
        if (busy) {
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Text("正在处理…", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (notice.isNotEmpty()) Text(notice, fontSize = 12.sp, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 8.dp))
        if (error.isNotEmpty()) Text(error, fontSize = 12.sp, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun BoundContent(
    couple: ScheduleCouple,
    status: CoupleStatus.Active,
    minute: Int,
    busy: Boolean,
    onColor: (String) -> Unit,
    onAnniversary: () -> Unit,
    onUnbind: () -> Unit,
    onDone: () -> Unit,
) {
    val dark = LocalScheduleColors.current.dark
    val today = ScheduleStore.todayKey()
    val days = CoupleRules.daysTogether(status.anniversary, today)
    val partnerName = status.partner.nickname.ifEmpty { "TA" }
    Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Person(status.me.nickname.ifEmpty { "我" }, status.me.color, dark, Modifier.weight(1f))
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.semantics(mergeDescendants = true) {}) {
            Icon(Icons.Rounded.Favorite, contentDescription = null, tint = CoupleAccent, modifier = Modifier.size(24.dp))
            if (days != null) {
                Text("第 $days 天", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = CoupleAccent)
            }
        }
        Person(partnerName, status.partner.color, dark, Modifier.weight(1f))
    }
    val now = System.currentTimeMillis()
    val partnerNow = couple.statusText(today, minute).orEmpty().removePrefix(partnerName).trim()
    CoupleLine("TA 此刻") { CoupleValue(partnerNow) }
    CoupleLine("TA 的课表") {
        CoupleValue(CoupleRules.relative(status.partner.syncedAt, now).let { if (it.isEmpty()) "还没有同步" else "同步于 $it" })
    }
    CoupleLine("我的课表") {
        CoupleValue(CoupleRules.relative(status.me.syncedAt, now).let { if (it.isEmpty()) "打开课表后自动同步" else "同步于 $it" })
    }
    // Seven colours, one for each person; the partner's is marked and picking it swaps the two.
    Text("我的颜色", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp))
    Row(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        CoupleRules.COLORS.forEach { (color, _) ->
            val tint = CoupleRules.personTone(color, dark)
            val mine = color == status.me.color
            val theirs = color == status.partner.color
            Box(
                Modifier.size(34.dp)
                    .then(if (mine) Modifier.border(2.dp, MaterialTheme.colorScheme.onSurface, CircleShape).padding(4.dp) else Modifier.padding(2.dp))
                    .clip(CircleShape).background(Color(tint.fill)).border(1.dp, Color(tint.border), CircleShape)
                    .clickable(enabled = !busy && !mine) { onColor(color) }
                    .semantics {
                        selected = mine
                        contentDescription = CoupleRules.COLOR_NAMES[color].orEmpty() + "色" +
                            if (mine) "，我的颜色" else if (theirs) "，TA 正在用，选它就和 TA 互换" else ""
                    },
                contentAlignment = Alignment.Center,
            ) {
                if (mine || theirs) Text(if (mine) "我" else "TA", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color(tint.text))
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f))
    CoupleLine("在课表里显示 TA 的课") {
        Switch(checked = couple.visible, onCheckedChange = couple::updateVisible)
    }
    CoupleLine("纪念日") {
        TextButton(onClick = onAnniversary, enabled = !busy) {
            Text(status.anniversary.ifEmpty { "未设置" }.replace('-', '.'))
        }
    }
    CoupleFootnote("课表里一个人一种颜色：你的课全是你选的颜色，TA 的课全是 TA 的颜色。颜色各选各的，双方看到的一样；选 TA 正在用的那个就是两人互换。")
    Spacer(Modifier.height(12.dp))
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onUnbind, enabled = !busy) { Text("解除绑定", color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.weight(1f))
        Button(onClick = onDone) { Text("完成") }
    }
}

@Composable
private fun UnboundContent(
    activity: MainActivity,
    pending: CoupleStatus.Pending?,
    busy: Boolean,
    onInvite: () -> Unit,
    onCancel: () -> Unit,
    onAccept: (String) -> Unit,
) {
    var code by remember { mutableStateOf("") }
    val invite = pending?.takeIf { it.code.isNotEmpty() && !it.expired }
    Text(
        "绑定后，TA 的课会和你的课显示在同一张课表里，两人都有空的时间一目了然。任何一方都可以随时解除，解除后双方的课表快照立即删除。",
        fontSize = 13.sp, lineHeight = 19.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    CoupleSection("邀请 TA")
    if (invite != null) {
        SelectionContainer(Modifier.fillMaxWidth()) {
            Text(
                invite.code, fontSize = 30.sp, letterSpacing = 6.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "邀请码 " + invite.code.toList().joinToString(" ") },
            )
        }
        Text("24 小时内有效，TA 在「课表 → 更多 → 情侣课表」里输入。正在等待 TA 接受…", fontSize = 12.sp, lineHeight = 17.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
        Spacer(Modifier.height(10.dp))
        Button(onClick = {
            val intent = Intent(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, CoupleRules.invitation(invite.code, AppConfig.origin))
            runCatching { activity.startActivity(Intent.createChooser(intent, "发送邀请")) }.onFailure { activity.toast("分享面板暂时不可用") }
        }, modifier = Modifier.fillMaxWidth()) { Text("发送给 TA") }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            FilledTonalButton(onClick = onInvite, enabled = !busy, modifier = Modifier.weight(1f)) { Text("换一个") }
            TextButton(onClick = onCancel, enabled = !busy) { Text("取消邀请") }
        }
    } else {
        Text("生成一个邀请码发给 TA。", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(8.dp))
        Button(onClick = onInvite, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("生成邀请码") }
    }
    CoupleSection("输入 TA 的邀请码")
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(
            value = code, onValueChange = { code = it.take(20) }, singleLine = true,
            label = { Text("6 位邀请码") },
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
            textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
            modifier = Modifier.weight(1f),
        )
        Button(onClick = { onAccept(code.trim()) }, enabled = !busy && code.isNotBlank(), modifier = Modifier.heightIn(min = 48.dp)) { Text("绑定") }
    }
}

@Composable
private fun Person(name: String, color: String, dark: Boolean, modifier: Modifier) {
    val tint = CoupleRules.personTone(color, dark)
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(
            Modifier.size(46.dp).clip(CircleShape).background(Color(tint.fill)).border(1.dp, Color(tint.border), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(name.take(1), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color(tint.text))
        }
        Text(name, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun CoupleLine(label: String, value: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp).semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(label, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) { value() }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f))
}

@Composable
private fun CoupleValue(text: String) {
    Text(text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.End, maxLines = 2, overflow = TextOverflow.Ellipsis)
}

@Composable
private fun CoupleSection(text: String) {
    Spacer(Modifier.height(18.dp))
    Text(text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Spacer(Modifier.height(8.dp))
}

@Composable
private fun CoupleFootnote(text: String) {
    Text(text, fontSize = 12.sp, lineHeight = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 10.dp))
}

/** A day up to today; `onPick("")` clears the anniversary. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AnniversaryPicker(current: String, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val utc = TimeZone.getTimeZone("UTC")
    fun millis(date: String): Long? = runCatching {
        GregorianCalendar(utc, Locale.US).apply {
            clear()
            set(date.substring(0, 4).toInt(), date.substring(5, 7).toInt() - 1, date.substring(8, 10).toInt())
        }.timeInMillis
    }.getOrNull()
    val latest = millis(ScheduleStore.todayKey()) ?: System.currentTimeMillis()
    val state = rememberDatePickerState(
        initialSelectedDateMillis = millis(current) ?: latest,
        selectableDates = object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean = utcTimeMillis <= latest
            override fun isSelectableYear(year: Int): Boolean = year in 1970..ScheduleStore.todayKey().take(4).toInt()
        },
    )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                val picked = state.selectedDateMillis ?: return@TextButton
                val calendar = GregorianCalendar(utc, Locale.US).apply { timeInMillis = picked }
                onPick(String.format(Locale.US, "%04d-%02d-%02d", calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH) + 1,
                    calendar.get(Calendar.DAY_OF_MONTH)))
            }, enabled = state.selectedDateMillis != null) { Text("保存") }
        },
        dismissButton = {
            Row {
                if (current.isNotEmpty()) TextButton(onClick = { onPick("") }) { Text("清除", color = MaterialTheme.colorScheme.error) }
                TextButton(onClick = onDismiss) { Text("取消") }
            }
        },
    ) { DatePicker(state = state, title = { Text("纪念日", modifier = Modifier.padding(start = 24.dp, top = 16.dp)) }) }
}
