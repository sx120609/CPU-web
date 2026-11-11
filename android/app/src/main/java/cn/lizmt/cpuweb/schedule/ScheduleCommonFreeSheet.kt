package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** 白天, 晚上 or 全天: the part of the day 找共同空闲 looks in. */
private enum class FreeSpan(val label: String, val earliest: Int, val latest: Int) {
    Day("白天", 8 * 60, 18 * 60), Evening("晚上", 18 * 60, 22 * 60 + 30), All("全天", 8 * 60, 22 * 60 + 30),
}

/**
 * 找共同空闲: pick whose timetables to compare, the dates, the shortest window
 * worth having and the part of the day; the free times come out by date,
 * each day drawn as a bar of classes and gaps. A window can become a 日程.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CommonFreeSheet(
    activity: MainActivity,
    store: ScheduleStore,
    /** Opens a new 日程 at that date and "HH:mm"; null when 日程 cannot be added. */
    onAgenda: ((String, String) -> Unit)?,
    onDismiss: () -> Unit,
) {
    val couple = activity.couple
    val shares = activity.sharing.library.schedules
    val partner = couple.partnerStore?.takeIf { couple.active != null }?.completeSnapshot()
    val today = ScheduleStore.todayKey()
    var includesPartner by remember { mutableStateOf(true) }
    // Somebody to compare with from the start: the partner, else the first saved share.
    var chosen by remember { mutableStateOf(if (partner == null) shares.take(1).map { it.meta.code }.toSet() else emptySet()) }
    var from by remember { mutableStateOf(today) }
    var to by remember { mutableStateOf(ScheduleCommonFree.shift(today, 6)) }
    var minimum by remember { mutableStateOf(60) }
    var span by remember { mutableStateOf(FreeSpan.All) }
    var picking by remember { mutableStateOf<String?>(null) }
    val mine = store.completeSnapshot()
    val shareSnapshots = remember(shares) {
        shares.associate { it.meta.code to ScheduleJson.parseSnapshot(it.snapshot()) }
    }
    val participants = listOfNotNull(mine) + listOfNotNull(partner.takeIf { includesPartner }) +
        shares.filter { it.meta.code in chosen }.mapNotNull { shareSnapshots[it.meta.code] }
    val others = participants.size - (if (mine != null) 1 else 0)
    val minute = ScheduleStyleTime.minutesNow()
    val days = remember(participants, from, to, minimum, span, today) {
        ScheduleCommonFree.days(participants, from, to, span.earliest, span.latest, minimum, today, minute)
    }
    val meta = MaterialTheme.colorScheme.onSurfaceVariant
    val brand = MaterialTheme.colorScheme.primary
    ScheduleSheetContainer(onDismiss) {
        SheetTitle("找共同空闲")
        SectionLine("和谁比", if (others == 0) "只看自己的空闲" else "共 ${others + 1} 人")
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            FreePerson("我", "我的课表", brand, Icons.Rounded.Person, selected = true, onClick = null)
            couple.active?.let { bound ->
                FreePerson(bound.partner.nickname.ifEmpty { "TA" }, if (partner == null) "还没同步" else "情侣课表", CoupleAccent,
                    Icons.Rounded.Favorite, selected = includesPartner && partner != null,
                    onClick = if (partner == null) null else ({ includesPartner = !includesPartner }))
            }
            shares.forEach { schedule ->
                val code = schedule.meta.code
                FreePerson(schedule.name, schedule.school.ifEmpty { "分享课表" }, OverlayTeal, null, selected = code in chosen) {
                    chosen = if (code in chosen) chosen - code else chosen + code
                }
            }
        }
        if (couple.active == null && shares.isEmpty()) {
            Text("保存同学的分享码或绑定情侣课表后，就能在这里一起比较。", fontSize = 13.sp, color = meta, modifier = Modifier.padding(top = 4.dp))
        }

        SettingsSection("条件")
        SettingsNavRow("开始日期", OccurrenceRules.dateText(from)) { picking = "from" }
        SettingsNavRow("结束日期", OccurrenceRules.dateText(to)) { picking = "to" }
        Text("至少空出", fontSize = 13.sp, color = meta, modifier = Modifier.padding(top = 8.dp, bottom = 6.dp))
        SettingsSegmented(listOf(30, 60, 120, 180).map { it.toString() to if (it < 60) "$it 分钟" else "${it / 60} 小时" }, minimum.toString()) {
            minimum = it.toInt()
        }
        Text("时段", fontSize = 13.sp, color = meta, modifier = Modifier.padding(top = 12.dp, bottom = 6.dp))
        SettingsSegmented(FreeSpan.entries.map { it.name to it.label }, span.name) { span = FreeSpan.valueOf(it) }

        val total = days.sumOf { it.windows.size }
        Spacer(Modifier.height(14.dp))
        SectionLine("空闲时段", if (total == 0) null else "$total 段")
        when {
            mine == null -> FreeEmptyCard("整学期课表还没有加载完，请刷新课表后再试")
            days.isEmpty() -> FreeEmptyCard("所选日期不在大家都有课表的学期内")
            total == 0 -> FreeEmptyCard("这些天没有满足条件的共同空闲，试试缩短时长或换个时段")
            else -> days.filter { it.windows.isNotEmpty() }.forEach { day ->
                FreeDayCard(day, span, today, brand, onAgenda?.let { create -> { window -> onDismiss(); create(window.date, OverlayTiming.clock(window.start)) } })
            }
        }
        Text("比较的是各自的课表（含停课、调课和调休），不包括日程等个人安排。", fontSize = 12.sp, color = meta.copy(alpha = 0.75f),
            modifier = Modifier.padding(top = 8.dp, start = 4.dp))
    }

    picking?.let { which ->
        val state = rememberDatePickerState(initialSelectedDateMillis = OccurrenceRules.utcMillis(if (which == "from") from else to))
        DatePickerDialog(
            onDismissRequest = { picking = null },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { millis ->
                        val picked = OccurrenceRules.fromUtcMillis(millis)
                        if (which == "from") {
                            from = picked
                            if (to < picked) to = picked
                        } else to = maxOf(picked, from)
                    }
                    picking = null
                }) { Text("确定") }
            },
            dismissButton = { TextButton(onClick = { picking = null }) { Text("取消") } },
        ) { DatePicker(state = state, title = null, headline = null, showModeToggle = false) }
    }
}

@Composable
private fun SectionLine(title: String, trailing: String?) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp)) {
        Text(title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        if (trailing != null) Text(trailing, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun FreePerson(name: String, detail: String, tint: Color, icon: ImageVector?, selected: Boolean, onClick: (() -> Unit)?) {
    Column(
        Modifier.width(84.dp).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f))
            .border(1.5.dp, if (selected && onClick != null) tint.copy(alpha = 0.6f) else Color.Transparent, RoundedCornerShape(16.dp))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .semantics(mergeDescendants = true) { this.selected = selected }
            .padding(vertical = 10.dp, horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box {
            Box(Modifier.size(46.dp).clip(CircleShape).background(if (selected) tint else tint.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
                if (icon != null) Icon(icon, contentDescription = null, tint = if (selected) Color.White else tint, modifier = Modifier.size(20.dp))
                else Text(name.take(1), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = if (selected) Color.White else tint)
            }
            if (selected && onClick != null) {
                Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = tint,
                    modifier = Modifier.align(Alignment.BottomEnd).offset(3.dp, 3.dp).size(17.dp).clip(CircleShape).background(Color.White))
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(name, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(detail, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, textAlign = TextAlign.Center,
            overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun FreeEmptyCard(text: String) {
    Text(
        text, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f))
            .padding(horizontal = 20.dp, vertical = 28.dp),
    )
}

@Composable
private fun FreeDayCard(day: ScheduleCommonFree.Day, span: FreeSpan, today: String, brand: Color, onAgenda: ((ScheduleCommonFree.Window) -> Unit)?) {
    val meta = MaterialTheme.colorScheme.onSurfaceVariant
    Column(
        Modifier.fillMaxWidth().padding(vertical = 5.dp).clip(RoundedCornerShape(18.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(OccurrenceRules.dateText(day.date), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            val relative = when (day.date) {
                today -> "今天"
                ScheduleCommonFree.shift(today, 1) -> "明天"
                else -> null
            }
            if (relative != null) {
                Spacer(Modifier.width(6.dp))
                Text(relative, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = brand,
                    modifier = Modifier.clip(CircleShape).background(brand.copy(alpha = 0.12f)).padding(horizontal = 7.dp, vertical = 1.dp))
            }
            Spacer(Modifier.weight(1f))
            Text("${day.windows.size} 段", fontSize = 12.sp, color = meta)
        }
        FreeDayBar(day, span, brand)
        day.windows.forEach { window ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.semantics(mergeDescendants = true) {
                contentDescription = "${OverlayTiming.clock(window.start)} 到 ${OverlayTiming.clock(window.end)}，${ScheduleCommonFree.durationText(window.minutes)}"
            }) {
                Box(Modifier.size(width = 4.dp, height = 34.dp).clip(RoundedCornerShape(2.dp)).background(brand))
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("${OverlayTiming.clock(window.start)} – ${OverlayTiming.clock(window.end)}", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    Text(ScheduleCommonFree.durationText(window.minutes), fontSize = 12.sp, color = meta)
                }
                if (onAgenda != null) OutlinedButton(onClick = { onAgenda(window) }) { Text("建日程", fontSize = 13.sp) }
            }
        }
    }
}

/** One day from the start to the end of the chosen span: classes grey, the free windows in the brand colour. */
@Composable
private fun FreeDayBar(day: ScheduleCommonFree.Day, span: FreeSpan, brand: Color) {
    val meta = MaterialTheme.colorScheme.onSurfaceVariant
    Column {
        BoxWithConstraints(Modifier.fillMaxWidth().height(10.dp).clip(CircleShape).background(meta.copy(alpha = 0.12f))) {
            val scale = maxWidth / (span.latest - span.earliest).coerceAtLeast(1)
            day.busy.forEach { range ->
                val start = maxOf(range.first, span.earliest)
                val end = minOf(range.last, span.latest)
                if (end > start) Box(Modifier.offset(x = scale * (start - span.earliest)).width(scale * (end - start)).height(10.dp)
                    .clip(RoundedCornerShape(3.dp)).background(meta.copy(alpha = 0.35f)))
            }
            day.windows.forEach { window ->
                Box(Modifier.offset(x = scale * (window.start - span.earliest)).width(maxOf(3.dp, scale * (window.end - window.start))).height(10.dp)
                    .clip(RoundedCornerShape(3.dp)).background(brand))
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            listOf(span.earliest, (span.earliest + span.latest) / 2, span.latest).forEachIndexed { index, value ->
                if (index > 0) Spacer(Modifier.weight(1f))
                Text(OverlayTiming.clock(value), fontSize = 10.sp, color = meta.copy(alpha = 0.7f))
            }
        }
    }
}
