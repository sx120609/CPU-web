package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val CoupleDayRow = 50.dp
private val CoupleDayGap = 3.dp
private val CoupleDayAxis = 46.dp

/**
 * The day of the couple timetable, the same in every style: the time axis runs
 * down the middle with the user's courses on its left and the partner's on its
 * right. Each side lays out its own overlaps, so nobody gives up width to the
 * other. A class both attend is drawn on both sides with a small heart.
 */
@Composable
internal fun CoupleDayView(
    blocks: List<PlacedBlock>,
    periods: List<SchedulePeriod>,
    layer: CoupleLayer,
    palette: String,
    /** Minutes since midnight when the day shown is today and "now" is marked. */
    now: Int?,
    canAdd: Boolean,
    onCourse: (PlacedBlock) -> Unit,
    onAddSlot: (Int) -> Unit,
) {
    val colors = LocalScheduleColors.current
    val scope = LocalScheduleStyle.current
    val classic = scope.style == ScheduleVisualStyle.Classic
    val ink = if (classic) colors.text else scope.ink
    val meta = if (classic) colors.secondary else scope.meta
    val mine = blocks.filter { it.owner != CoupleOwner.Partner }
    // The partner's side holds everything of theirs: a class both attend is theirs too.
    val theirs = CoupleRules.partnerSide(blocks)
    val place = now?.let { nowPosition(it, periods, CoupleDayRow.value, CoupleDayGap.value) }
    val current = place?.second?.takeIf { it.first == it.last }?.first
    val chip = CoupleRules.personTone(layer.partnerColor, colors.dark)
    val own = CoupleRules.personTone(layer.myColor, colors.dark)
    Column(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
        Row(Modifier.fillMaxWidth().height(30.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                Text("我", fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Bold, color = Color(own.text),
                    modifier = Modifier.clip(CircleShape).background(Color(own.fill)).border(1.dp, Color(own.border), CircleShape)
                        .padding(horizontal = 14.dp, vertical = 2.dp))
            }
            Text("节次", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = meta, textAlign = TextAlign.Center,
                modifier = Modifier.width(CoupleDayAxis))
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                Text(layer.partnerName.ifEmpty { "TA" }, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Bold,
                    color = Color(chip.text), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.clip(CircleShape).background(Color(chip.fill)).border(1.dp, Color(chip.border), CircleShape)
                        .padding(horizontal = 14.dp, vertical = 2.dp))
            }
        }
        Box(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                CoupleDaySide(Modifier.weight(1f), mine, partnerSide = false, periods, layer, palette, meta,
                    onCourse = onCourse, onAddSlot = if (canAdd) onAddSlot else null)
                Column(Modifier.width(CoupleDayAxis), verticalArrangement = Arrangement.spacedBy(CoupleDayGap)) {
                    periods.forEach { period ->
                        // The period running now takes the theme colour.
                        val running = period.number == current
                        Column(
                            Modifier.fillMaxWidth().height(CoupleDayRow).clip(RoundedCornerShape(if (classic) 10.dp else scope.style.cornerRadius.coerceIn(2f, 10f).dp))
                                .background(if (running) scope.themeFill else ink.copy(alpha = 0.05f))
                                .clearAndSetSemantics { contentDescription = "第 ${period.number} 节，${period.startTime} 至 ${period.endTime}" },
                            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                        ) {
                            Text(period.number.toString(), fontSize = 13.sp, lineHeight = 15.sp, fontWeight = FontWeight.Bold,
                                color = if (running) scope.onFill else ink)
                            Text(period.startTime, fontSize = 10.sp, lineHeight = 12.sp, letterSpacing = 0.sp,
                                color = if (running) scope.onFill.copy(alpha = 0.85f) else meta)
                        }
                    }
                }
                CoupleDaySide(Modifier.weight(1f), theirs, partnerSide = true, periods, layer, palette, meta, onCourse = onCourse, onAddSlot = null)
            }
            if (place != null) {
                Box(Modifier.offset(y = place.first.dp).fillMaxWidth().height(1.5.dp).background(scope.themeText.copy(alpha = 0.8f)))
            }
        }
    }
}

/** One person's side of the couple day: a hairline per period and that person's courses over them. */
@Composable
private fun CoupleDaySide(
    modifier: Modifier,
    blocks: List<PlacedBlock>,
    partnerSide: Boolean,
    periods: List<SchedulePeriod>,
    layer: CoupleLayer,
    palette: String,
    rule: Color,
    onCourse: (PlacedBlock) -> Unit,
    onAddSlot: ((Int) -> Unit)?,
) {
    val step = CoupleDayRow + CoupleDayGap
    BoxWithConstraints(modifier.height(CoupleDayRow * periods.size + CoupleDayGap * (periods.size - 1).coerceAtLeast(0))) {
        val width = maxWidth
        Column(verticalArrangement = Arrangement.spacedBy(CoupleDayGap)) {
            periods.forEach { period ->
                Box(
                    Modifier.fillMaxWidth().height(CoupleDayRow).clip(RoundedCornerShape(12.dp)).background(rule.copy(alpha = 0.05f))
                        .then(if (onAddSlot != null) Modifier.clickable { onAddSlot(period.number) }
                            .semantics { contentDescription = "第${period.number}节，添加课程" } else Modifier),
                )
            }
        }
        blocks.forEach { block ->
            val first = periods.indexOfFirst { it.number == block.startSlot }.coerceAtLeast(0)
            val lane = width / block.lanes
            CoupleDayTile(
                block, partnerSide, periods, layer, palette,
                Modifier.offset(x = lane * block.lane, y = step * first)
                    .width(lane - if (block.lanes > 1) 2.dp else 0.dp)
                    .height(CoupleDayRow * block.span + CoupleDayGap * (block.span - 1)),
                narrow = block.lanes > 1,
                onClick = { onCourse(if (partnerSide && block.owner == CoupleOwner.Both) block.copy(owner = CoupleOwner.Partner) else block) },
            )
        }
    }
}

@Composable
private fun CoupleDayTile(
    block: PlacedBlock,
    partnerSide: Boolean,
    periods: List<SchedulePeriod>,
    layer: CoupleLayer,
    palette: String,
    modifier: Modifier,
    narrow: Boolean,
    onClick: () -> Unit,
) {
    val colors = LocalScheduleColors.current
    val scope = LocalScheduleStyle.current
    val course = block.course
    // One person, one colour: the user's side in the user's, the partner's side in the partner's.
    val tone = CoupleRules.personTone(if (partnerSide) layer.partnerColor else layer.myColor, colors.dark)
    val fill = Color(tone.fill)
    val edge = Color(tone.border)
    val ink = Color(tone.text)
    val shape = RoundedCornerShape(12.dp)
    val start = periods.firstOrNull { it.number == block.startSlot }?.startTime.orEmpty()
    val end = periods.firstOrNull { it.number == block.endSlot }?.endTime.orEmpty()
    val location = ScheduleStyleTime.location(course.location)
    Box(
        modifier.clip(shape).background(fill).border(0.5.dp, edge.copy(alpha = 0.55f), shape)
            // A bar of the person's colour down the leading edge.
            .drawBehind {
                drawRoundRect(edge, topLeft = Offset(4.dp.toPx(), 6.dp.toPx()), size = androidx.compose.ui.geometry.Size(3.dp.toPx(), size.height - 12.dp.toPx()),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(2.dp.toPx()))
            }
            .clickable(onClick = onClick)
            .semantics { contentDescription = (if (partnerSide) "TA 的课，" else "") + courseAccessibility(block.block) },
    ) {
        Column(
            Modifier.fillMaxSize().padding(start = if (narrow) 10.dp else 12.dp, end = if (narrow) 4.dp else 9.dp, top = 4.dp, bottom = 4.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
        ) {
            Text(course.name, fontSize = if (narrow) 12.sp else 14.sp, lineHeight = if (narrow) 15.sp else 17.sp, letterSpacing = 0.sp,
                fontWeight = FontWeight.SemiBold, fontFamily = scope.textFamily, color = ink,
                maxLines = if (block.span == 1) 1 else 2, overflow = TextOverflow.Ellipsis,
                modifier = if (block.owner == CoupleOwner.Both) Modifier.padding(end = 13.dp) else Modifier)
            if (location != null) {
                Text("@$location", fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.sp, color = ink.copy(alpha = 0.86f),
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (block.span > 1 && start.isNotEmpty() && end.isNotEmpty()) {
                Text("$start–$end", fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.sp, color = ink.copy(alpha = 0.86f), maxLines = 1,
                    softWrap = false, overflow = TextOverflow.Clip)
            }
        }
        if (block.owner == CoupleOwner.Both) CoupleHeart(Modifier.align(Alignment.TopEnd).padding(top = 5.dp, end = 6.dp), 11.dp)
    }
}

/** The small heart on a class both attend. */
@Composable
internal fun CoupleHeart(modifier: Modifier, size: Dp) {
    Icon(Icons.Rounded.Favorite, contentDescription = null, tint = CoupleAccent, modifier = modifier.size(size))
}
