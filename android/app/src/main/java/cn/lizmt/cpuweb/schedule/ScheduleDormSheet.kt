package cn.lizmt.cpuweb.schedule

import android.content.Intent
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
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

private enum class DormTab(val label: String) { Week("一周"), Free("空闲"), Morning("早八"), Dorm("宿舍") }

/**
 * 宿舍课表: who is free when, who has an 8 a.m. class, and the dorm itself.
 * [inviteCode] comes from a link and fills in the join field.
 */
@Composable
fun ScheduleDormSheet(activity: MainActivity, inviteCode: String, minute: Int, onDismiss: () -> Unit) {
    val room = activity.dorm
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }

    /** Runs a change of the dorm, then uploads the user's term and reads everyone's again. */
    fun perform(done: String = "", block: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = ""
        notice = ""
        scope.launch {
            try {
                block()
                notice = done
                if (room.active != null) {
                    room.sync(activity.currentTermSnapshot())
                    room.loadPeople()
                }
            } catch (failure: DormRequestException) {
                error = failure.message.orEmpty()
            } finally {
                busy = false
            }
        }
    }

    LaunchedEffect(Unit) {
        room.refresh(force = true)
        if (room.active != null) {
            room.sync(activity.currentTermSnapshot())
            room.loadPeople()
        }
    }

    ScheduleSheetContainer(onDismiss) {
        val dorm = room.active
        Row(verticalAlignment = Alignment.Bottom) {
            Text("宿舍课表", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            if (dorm != null && dorm.name.isNotEmpty()) {
                Text(dorm.name, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 10.dp, bottom = 3.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Spacer(Modifier.height(14.dp))
        when (val status = room.status) {
            DormStatus.Unknown -> Loading("正在读取宿舍…")
            DormStatus.None -> NoDorm(inviteCode, busy, onCreate = { perform("宿舍已建好，把宿舍码发给室友吧") { room.invite() } }) { code ->
                perform { room.join(code) }
            }
            is DormStatus.Active -> ActiveDorm(activity, room, status, minute, busy, ::perform)
        }
        if (busy) Loading("正在处理…", Modifier.padding(top = 10.dp))
        if (notice.isNotEmpty()) Text(notice, fontSize = 12.sp, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 10.dp))
        if (error.isNotEmpty()) Text(error, fontSize = 12.sp, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 10.dp))
    }
}

@Composable
private fun Loading(text: String, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        Text(text, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun NoDorm(inviteCode: String, busy: Boolean, onCreate: () -> Unit, onJoin: (String) -> Unit) {
    var code by remember(inviteCode) { mutableStateOf(ScheduleDorm.inviteCode(inviteCode)) }
    Text("和室友一起看什么时候大家都有空、谁明天要早八。", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    SettingsSection("用宿舍码加入")
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(
            value = code, onValueChange = { code = it.uppercase().take(12) }, singleLine = true,
            label = { Text("宿舍码") }, modifier = Modifier.weight(1f),
        )
        Button(onClick = { onJoin(code) }, enabled = !busy && ScheduleDorm.inviteCode(code).isNotEmpty(),
            modifier = Modifier.heightIn(min = 48.dp)) { Text("加入") }
    }
    SettingsSection("还没有宿舍")
    FilledTonalButton(onClick = onCreate, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("建一个宿舍") }
}

@Composable
private fun ActiveDorm(
    activity: MainActivity, room: ScheduleDormRoom, dorm: DormStatus.Active, minute: Int, busy: Boolean,
    perform: (String, suspend () -> Unit) -> Unit,
) {
    val colors = LocalScheduleColors.current
    val people = room.people
    val today = remember { DormRules.today() }
    var tab by remember { mutableStateOf(DormTab.Week) }

    MemberChips(dorm, people, colors.dark)
    val mornings = remember(people) { DormRules.mornings(people, today) }
    DormRules.nextMorning(mornings, today, minute)?.let { next ->
        val names = next.duties.joinToString("、") { duty -> people.firstOrNull { it.id == duty.id }?.nickname.orEmpty().ifEmpty { "室友" } }
        Text("${DormRules.dayName(next.date, today)}早八：$names", fontSize = 13.sp, fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(top = 10.dp))
    }
    Spacer(Modifier.height(14.dp))
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        SettingsSegmented(DormTab.entries.map { it.name to it.label }, tab.name) { tab = DormTab.valueOf(it) }
    }
    Spacer(Modifier.height(14.dp))
    if (room.loadingPeople && people.isEmpty()) {
        Loading("正在读取室友的课表…")
        return
    }
    when (tab) {
        DormTab.Week -> WeekTab(people, dorm.me.id, today, colors.dark)
        DormTab.Free -> FreeTab(people, today, colors.dark)
        DormTab.Morning -> MorningTab(people, mornings, today, colors.dark)
        DormTab.Dorm -> ManageTab(activity, room, dorm, busy, perform)
    }
}

/** Everyone in the dorm in their colour; a roommate without a timetable is marked. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MemberChips(dorm: DormStatus.Active, people: List<DormPerson>, dark: Boolean) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        dorm.members.forEach { member ->
            val (fill, border, ink) = DormRules.tone(member.color, dark)
            val synced = people.firstOrNull { it.id == member.id }?.hasData ?: member.syncedAt.isNotEmpty()
            Row(
                Modifier.clip(CircleShape).background(Color(fill)).border(1.dp, Color(border), CircleShape)
                    .padding(horizontal = 10.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(personName(member, dorm), fontSize = 12.sp, color = Color(ink), fontWeight = FontWeight.Medium)
                if (!synced) Text(" · 未同步", fontSize = 11.sp, color = Color(ink).copy(alpha = 0.7f))
            }
        }
    }
}

private fun personName(member: DormMember, dorm: DormStatus.Active): String =
    member.nickname.ifEmpty { "室友" } + if (member.id == dorm.me.id) "（我）" else ""

@Composable
private fun PersonDot(person: DormPerson?, dark: Boolean, size: Int = 8) {
    val (_, border, _) = DormRules.tone(person?.color ?: "blue", dark)
    Box(Modifier.size(size.dp).clip(CircleShape).background(Color(border)))
}

@Composable
private fun WeekTab(people: List<DormPerson>, meId: Int, today: String, dark: Boolean) {
    var offset by remember { mutableIntStateOf(0) }
    val monday = DormRules.addDays(DormRules.monday(today), offset * 7L)
    val grid = remember(people, monday) { DormRules.weekGrid(people, monday, meId) }
    var opened by remember { mutableStateOf<DormWeekCell?>(null) }
    val primary = MaterialTheme.colorScheme.primary
    val meta = MaterialTheme.colorScheme.onSurfaceVariant

    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { offset -= 1 }) { Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, contentDescription = "上一周") }
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            val title = listOfNotNull("本周".takeIf { offset == 0 }, grid.teachingWeek?.let { "第 $it 周" }).joinToString(" · ")
                .ifEmpty { if (offset > 0) "$offset 周后" else "${-offset} 周前" }
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Text("${grid.dates.first().substring(5)} – ${grid.dates.last().substring(5)}", fontSize = 12.sp, color = meta)
        }
        IconButton(onClick = { offset += 1 }) { Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = "下一周") }
    }
    // Header: weekday and date, today picked out.
    Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
        Spacer(Modifier.width(34.dp))
        grid.dates.forEachIndexed { index, date ->
            val isToday = date == today
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(DormRules.WEEKDAYS[index].substring(1), fontSize = 12.sp, fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal,
                    color = if (isToday) primary else MaterialTheme.colorScheme.onSurface)
                Text(date.substring(8).trimStart('0'), fontSize = 11.sp, color = if (isToday) primary else meta)
            }
        }
    }
    Spacer(Modifier.height(4.dp))
    grid.rows.forEach { row ->
        if (row.breakBefore) Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth().padding(vertical = 1.5.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.width(34.dp)) {
                Text("${row.period.number}", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                Text(row.period.startTime, fontSize = 9.sp, lineHeight = 10.sp, color = meta)
            }
            row.cells.forEach { cell ->
                val unknown = cell.known == 0
                val all = !unknown && cell.freeIds.size == cell.known
                val fill = when {
                    unknown -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                    cell.freeIds.isEmpty() -> Color.Transparent
                    else -> primary.copy(alpha = 0.18f + 0.62f * cell.freeRatio)
                }
                Box(
                    Modifier.weight(1f).height(34.dp).padding(horizontal = 1.5.dp).clip(RoundedCornerShape(7.dp)).background(fill)
                        .border(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = if (cell.freeIds.isEmpty()) 0.8f else 0f), RoundedCornerShape(7.dp))
                        .clickable { opened = cell }
                        .semantics { contentDescription = "${DormRules.WEEKDAYS[DormRules.weekday(cell.date) - 1]}第${row.period.number}节，${DormRules.cellSummary(cell)}" },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        when { unknown -> "?"; all -> "全"; cell.freeIds.isEmpty() -> ""; else -> "${cell.freeIds.size}" },
                        fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                        color = when { unknown -> meta; cell.freeRatio > 0.5f -> Color.White; else -> MaterialTheme.colorScheme.onSurface },
                    )
                }
            }
        }
    }
    Text("颜色越深有空的人越多，“全”是大家都有空；点一格看是谁。", fontSize = 12.sp, color = meta, modifier = Modifier.padding(top = 8.dp))
    opened?.let { cell -> CellDialog(cell, people, today, dark) { opened = null } }
}

@Composable
private fun CellDialog(cell: DormWeekCell, people: List<DormPerson>, today: String, dark: Boolean, onDismiss: () -> Unit) {
    fun name(id: Int) = people.firstOrNull { it.id == id }?.nickname.orEmpty().ifEmpty { "室友" }
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text("知道了") } },
        title = {
            Text("${DormRules.dayName(cell.date, today)} 第 ${cell.period.number} 节 · ${cell.period.startTime}–${cell.period.endTime}", fontSize = 17.sp)
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(DormRules.cellSummary(cell), fontWeight = FontWeight.SemiBold)
                cell.freeIds.forEach { id -> PersonLine(people.firstOrNull { it.id == id }, dark, name(id), "有空") }
                cell.busy.forEach { (id, courses) -> PersonLine(people.firstOrNull { it.id == id }, dark, name(id), courses.joinToString("、")) }
                cell.unknownIds.forEach { id -> PersonLine(people.firstOrNull { it.id == id }, dark, name(id), "没有课表数据") }
            }
        },
    )
}

@Composable
private fun PersonLine(person: DormPerson?, dark: Boolean, name: String, detail: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PersonDot(person, dark)
        Text(name, fontSize = 14.sp, fontWeight = FontWeight.Medium)
        Text(detail, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun FreeTab(people: List<DormPerson>, today: String, dark: Boolean) {
    var date by remember { mutableStateOf(today) }
    var minFree by remember { mutableStateOf<Int?>(null) }
    val day = remember(people, date, minFree) { DormRules.availability(people, date, minFree) }
    val known = day.knownIds.size
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        (0 until 7).forEach { index ->
            val value = DormRules.addDays(today, index.toLong())
            Chip("${DormRules.dayName(value, today)} ${value.substring(5).replace('-', '/')}", value == date) { date = value }
        }
    }
    if (known > 2) {
        Row(Modifier.fillMaxWidth().padding(top = 8.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Chip("全员", minFree == null) { minFree = null }
            (known - 1 downTo 2).forEach { count -> Chip("至少 $count 人", minFree == count) { minFree = count } }
        }
    }
    Spacer(Modifier.height(12.dp))
    if (day.windows.isEmpty()) {
        Text(DormRules.emptyText(day), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    day.windows.forEach { window ->
        Row(
            Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.primary.copy(alpha = if (dark) 0.16f else 0.08f)).padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(DormRules.span(window), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace)
                Text(DormRules.windowLabel(window, day) + " · ${(window.end - window.start) / 60} 小时 ${(window.end - window.start) % 60} 分"
                    .replace(" 0 小时 ", " ").replace(" 0 分", ""), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (window.freeIds.size < known) {
                Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    window.freeIds.forEach { id -> PersonDot(people.firstOrNull { it.id == id }, dark, 10) }
                }
            }
        }
    }
    if (day.unknownIds.isNotEmpty()) {
        val names = day.unknownIds.joinToString("、") { id -> people.firstOrNull { it.id == id }?.nickname.orEmpty().ifEmpty { "室友" } }
        Text("$names 这天没有课表数据，没算在内。", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun Chip(label: String, chosen: Boolean, onClick: () -> Unit) {
    Text(
        label, fontSize = 12.sp, fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Normal,
        color = if (chosen) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.clip(RoundedCornerShape(16.dp))
            .background(if (chosen) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh)
            .clickable(onClick = onClick).semantics { selected = chosen }.padding(horizontal = 12.dp, vertical = 7.dp),
    )
}

@Composable
private fun MorningTab(people: List<DormPerson>, days: List<DormMorningDay>, today: String, dark: Boolean) {
    val meta = MaterialTheme.colorScheme.onSurfaceVariant
    val missing = people.filter { !it.hasData }
    if (missing.isNotEmpty() && missing.size < people.size) {
        Text(missing.joinToString("、") { it.nickname.ifEmpty { "室友" } } + " 还没有同步课表，名单可能不全。", fontSize = 12.sp, color = meta,
            modifier = Modifier.padding(bottom = 4.dp))
    }
    days.forEach { day ->
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.width(64.dp)) {
                Text(DormRules.dayName(day.date, today), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                Text(day.date.substring(5).replace('-', '/'), fontSize = 11.sp, color = meta)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (day.duties.isEmpty()) {
                    Text(if (day.knownCount == 0) "没有数据" else "没人早八", fontSize = 13.sp, color = meta)
                }
                day.duties.forEach { duty ->
                    val person = people.firstOrNull { it.id == duty.id }
                    PersonLine(person, dark, person?.nickname.orEmpty().ifEmpty { "室友" }, "${duty.course} · ${DormRules.clock(duty.start)}")
                }
            }
        }
    }
}

@Composable
private fun ManageTab(
    activity: MainActivity, room: ScheduleDormRoom, dorm: DormStatus.Active, busy: Boolean,
    perform: (String, suspend () -> Unit) -> Unit,
) {
    val colors = LocalScheduleColors.current
    var renaming by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<DormMember?>(null) }
    var leaving by remember { mutableStateOf(false) }
    val meta = MaterialTheme.colorScheme.onSurfaceVariant

    SettingsSection("邀请室友 · ${dorm.members.size}/${dorm.memberLimit} 人", first = true)
    val invite = dorm.invite?.takeIf { !it.expired }
    when {
        !dorm.isOwner -> Text("宿舍码由舍长发出。", fontSize = 13.sp, color = meta)
        dorm.members.size >= dorm.memberLimit -> Text("宿舍已满。", fontSize = 13.sp, color = meta)
        invite != null -> {
            SelectionContainer {
                Text(invite.code, fontSize = 30.sp, letterSpacing = 6.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace,
                    textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()
                        .semantics { contentDescription = "宿舍码 " + invite.code.toList().joinToString(" ") })
            }
            Text("24 小时内有效，多个室友可以用同一个码。", fontSize = 12.sp, color = meta, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(10.dp))
            Button(onClick = {
                val intent = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, DormRules.invitation(invite.code, AppConfig.origin))
                runCatching { activity.startActivity(Intent.createChooser(intent, "发送宿舍码")) }.onFailure { activity.toast("分享面板暂时不可用") }
            }, modifier = Modifier.fillMaxWidth()) { Text("发送给室友") }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                FilledTonalButton(onClick = { perform("") { room.invite() } }, enabled = !busy, modifier = Modifier.weight(1f)) { Text("换一个") }
                TextButton(onClick = { perform("宿舍码已取消") { room.cancelInvite() } }, enabled = !busy) { Text("取消宿舍码") }
            }
        }
        else -> Button(onClick = { perform("") { room.invite() } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("生成宿舍码") }
    }

    SettingsSection("我的颜色")
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        DormRules.COLORS.forEach { (key, _) ->
            val (_, border, _) = DormRules.tone(key, colors.dark)
            val mine = dorm.me.color == key
            val holder = dorm.members.firstOrNull { it.color == key && it.id != dorm.me.id }
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clip(RoundedCornerShape(10.dp))
                .clickable(enabled = !busy && !mine) { perform(if (holder != null) "已和${holder.nickname.ifEmpty { "室友" }}互换颜色" else "颜色已保存") { room.setColor(key) } }
                .semantics { selected = mine; contentDescription = DormRules.COLOR_NAMES[key] + "色" }.padding(4.dp)) {
                Box(Modifier.size(30.dp).border(2.dp, if (mine) MaterialTheme.colorScheme.onSurface else Color.Transparent, CircleShape).padding(4.dp)
                    .clip(CircleShape).background(Color(border)))
                Text(holder?.nickname?.take(3)?.ifEmpty { "室友" } ?: DormRules.COLOR_NAMES[key].orEmpty(), fontSize = 10.sp, color = meta, maxLines = 1)
            }
        }
    }
    Text("选室友正在用的颜色就是两人互换。", fontSize = 12.sp, color = meta)

    SettingsSection("成员")
    dorm.members.forEach { member ->
        Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
            val (_, border, _) = DormRules.tone(member.color, colors.dark)
            Box(Modifier.size(10.dp).clip(CircleShape).background(Color(border)))
            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                Text(personName(member, dorm) + if (member.owner) " · 舍长" else "", fontSize = 15.sp)
                Text(if (member.syncedAt.isEmpty()) "还没有同步课表" else "课表同步于 " + CoupleRules.relative(member.syncedAt, System.currentTimeMillis()),
                    fontSize = 12.sp, color = meta)
            }
            if (dorm.isOwner && member.id != dorm.me.id) {
                TextButton(onClick = { removing = member }, enabled = !busy) { Text("移出", color = MaterialTheme.colorScheme.error) }
            }
        }
    }
    SettingsNavRow("立即同步我的课表") {
        perform("课表已同步") {
            if (!room.sync(activity.currentTermSnapshot(), force = true)) throw DormRequestException("本学期课表还没有加载完，请先刷新课表", 0)
        }
    }
    if (dorm.isOwner) SettingsNavRow("宿舍名", value = dorm.name.ifEmpty { "未命名" }) { renaming = true }
    TextButton(onClick = { leaving = true }, enabled = !busy, modifier = Modifier.padding(top = 6.dp)) {
        Text("退出宿舍", color = MaterialTheme.colorScheme.error)
    }

    if (renaming) {
        var name by remember { mutableStateOf(dorm.name) }
        AlertDialog(
            onDismissRequest = { renaming = false },
            title = { Text("宿舍名") },
            text = { OutlinedTextField(value = name, onValueChange = { name = it.take(24) }, singleLine = true, placeholder = { Text("比如 6 栋 302") }) },
            confirmButton = { TextButton(onClick = { renaming = false; perform("宿舍名已保存") { room.rename(name) } }) { Text("保存") } },
            dismissButton = { TextButton(onClick = { renaming = false }) { Text("取消") } },
        )
    }
    removing?.let { member ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text("移出${member.nickname.ifEmpty { "这位室友" }}？") },
            text = { Text("对方会收到通知，TA 的课表也会从宿舍里删除。") },
            confirmButton = { TextButton(onClick = { removing = null; perform("已移出") { room.remove(member) } }) { Text("移出", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("取消") } },
        )
    }
    if (leaving) {
        AlertDialog(
            onDismissRequest = { leaving = false },
            title = { Text("退出宿舍？") },
            text = { Text(if (dorm.isOwner && dorm.members.size > 1) "舍长会转给最早加入的室友，你的课表会从宿舍里删除。" else "你的课表会从宿舍里删除。") },
            confirmButton = { TextButton(onClick = { leaving = false; perform("已退出宿舍") { room.leave() } }) { Text("退出", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { leaving = false }) { Text("取消") } },
        )
    }
}
