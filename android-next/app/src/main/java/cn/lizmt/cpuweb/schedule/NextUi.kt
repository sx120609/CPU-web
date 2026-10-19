package cn.lizmt.cpuweb.schedule

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.DragIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex

/*
 * The building blocks of NEXT's native pages: a page title, grouped panels of
 * plain rows, and a few controls. One look everywhere: neutral panels on a
 * quiet page, hairlines between rows, the accent only where something is on
 * or can be tapped.
 */

/** A page's large title, with an optional line under it and actions on the right. */
@Composable
fun LargeTitle(title: String, subtitle: String? = null, modifier: Modifier = Modifier, actions: @Composable RowScope.() -> Unit = {}) {
    Row(modifier.fillMaxWidth().padding(start = 4.dp, top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.headlineMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!subtitle.isNullOrEmpty()) {
                Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
        }
        actions()
    }
}

/** A titled group of rows on a panel; the title may carry one action on the right. */
@Composable
fun Panel(
    title: String? = null,
    modifier: Modifier = Modifier,
    footer: String? = null,
    action: String? = null,
    onAction: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val look = LocalCpuLook.current
    Column(modifier.fillMaxWidth()) {
        if (title != null || action != null) {
            Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 2.dp, bottom = 6.dp), verticalAlignment = Alignment.Bottom) {
                Text(title.orEmpty(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                if (action != null && onAction != null) {
                    Text(action, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable(onClick = onAction).padding(horizontal = 4.dp, vertical = 2.dp))
                }
            }
        }
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(look.radius(16.dp))).background(MaterialTheme.colorScheme.surfaceContainer),
            content = content,
        )
        if (footer != null) {
            Text(footer, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = 6.dp))
        }
    }
}

/** The line between two rows of a panel, starting where the text starts. */
@Composable
fun Hairline(start: Dp = 16.dp) {
    Box(Modifier.fillMaxWidth().padding(start = start).height(0.5.dp).background(MaterialTheme.colorScheme.outlineVariant))
}

/**
 * A plain row: optional leading content, a title with an optional detail
 * under it, an optional value at the end, then a chevron when it opens something.
 */
@Composable
fun ListRow(
    title: String,
    modifier: Modifier = Modifier,
    detail: String? = null,
    value: String? = null,
    leading: @Composable (() -> Unit)? = null,
    trailing: @Composable (() -> Unit)? = null,
    titleColor: Color = Color.Unspecified,
    chevron: Boolean = false,
    enabled: Boolean = true,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier.fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(enabled = enabled, onClick = onClick) else Modifier)
            .heightIn(min = 48.dp).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) {
            leading()
            Spacer(Modifier.width(12.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis,
                color = if (!enabled) MaterialTheme.colorScheme.onSurfaceVariant else titleColor)
            if (!detail.isNullOrEmpty()) {
                Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3)
            }
        }
        if (value != null) {
            Spacer(Modifier.width(8.dp))
            Text(value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 180.dp))
        }
        if (trailing != null) {
            Spacer(Modifier.width(8.dp))
            trailing()
        }
        if (chevron) {
            Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f), modifier = Modifier.size(20.dp))
        }
    }
}

/** A row with a switch; the whole row toggles. */
@Composable
fun ToggleRow(title: String, checked: Boolean, detail: String? = null, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    ListRow(
        title = title, detail = detail, enabled = enabled,
        trailing = {
            Switch(
                checked = checked, onCheckedChange = if (enabled) onChange else null, enabled = enabled,
                colors = SwitchDefaults.colors(uncheckedBorderColor = Color.Transparent, uncheckedTrackColor = MaterialTheme.colorScheme.surfaceContainerHighest),
            )
        },
        onClick = if (enabled) ({ onChange(!checked) }) else null,
    )
}

/** Two to five equal choices in one rounded track; the chosen one is raised. */
@Composable
fun <T> Segmented(options: List<Pair<T, String>>, selected: T, modifier: Modifier = Modifier, onSelect: (T) -> Unit) {
    val look = LocalCpuLook.current
    val index = options.indexOfFirst { it.first == selected }.coerceAtLeast(0)
    BoxWithConstraints(
        modifier.fillMaxWidth().height(36.dp).clip(RoundedCornerShape(look.radius(10.dp)))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh).padding(3.dp),
    ) {
        val width = maxWidth / options.size.coerceAtLeast(1)
        val position by animateDpAsState(width * index, tween(look.duration(180)), label = "segment")
        Box(
            Modifier.offset(x = position).width(width).fillMaxHeight()
                .shadow(1.dp, RoundedCornerShape(look.radius(8.dp)))
                .clip(RoundedCornerShape(look.radius(8.dp))).background(MaterialTheme.colorScheme.surface),
        )
        Row(Modifier.fillMaxWidth().fillMaxHeight()) {
            options.forEach { (value, label) ->
                val chosen = value == selected
                Box(
                    Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(look.radius(8.dp)))
                        .clickable { onSelect(value) }
                        .semantics { role = Role.RadioButton; this.selected = chosen },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 1,
                        color = if (chosen) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Medium)
                }
            }
        }
    }
}

/** A small pill that can be chosen. */
@Composable
fun ChoicePill(label: String, selected: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    val look = LocalCpuLook.current
    val background by animateColorAsState(
        if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
        tween(look.duration(150)), label = "pill",
    )
    Row(
        Modifier.clip(RoundedCornerShape(look.radius(10.dp))).background(background)
            .then(if (selected) Modifier.border(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.35f), RoundedCornerShape(look.radius(10.dp))) else Modifier)
            .clickable(enabled = enabled, onClick = onClick)
            .heightIn(min = 32.dp).padding(horizontal = 12.dp)
            .semantics { role = Role.RadioButton; this.selected = selected },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 1,
            color = when {
                !enabled -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                selected -> MaterialTheme.colorScheme.onPrimaryContainer
                else -> MaterialTheme.colorScheme.onSurface
            })
    }
}

/** Pills in rows that wrap. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun <T> PillChoices(options: List<Pair<T, String>>, selected: T, modifier: Modifier = Modifier, onSelect: (T) -> Unit) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        options.forEach { (value, label) -> ChoicePill(label, value == selected) { onSelect(value) } }
    }
}

/** Rows that each select one value, with a check on the chosen one. */
@Composable
fun <T> CheckList(options: List<Triple<T, String, String?>>, selected: T, onSelect: (T) -> Unit) {
    options.forEachIndexed { index, (value, title, detail) ->
        if (index > 0) Hairline()
        ListRow(title, detail = detail, onClick = { onSelect(value) }, trailing = {
            if (value == selected) Icon(Icons.Rounded.Check, contentDescription = "已选", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
            else Spacer(Modifier.size(20.dp))
        })
    }
}

/** The quiet mark of the separate test app. */
@Composable
fun NextBadge(modifier: Modifier = Modifier) {
    Text(
        "NEXT",
        modifier = modifier.clip(RoundedCornerShape(5.dp))
            .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f), RoundedCornerShape(5.dp))
            .padding(horizontal = 5.dp, vertical = 0.dp),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
    )
}

/**
 * A list whose rows can be dragged into a new order by their handle (long
 * press anywhere on the handle, then move). [onMove] is called each time the
 * dragged row passes a neighbour; the row keeps following the finger.
 */
@Composable
fun <T> ReorderableRows(
    items: List<T>,
    key: (T) -> Any,
    onMove: (from: Int, to: Int) -> Unit,
    row: @Composable (item: T, handle: Modifier, dragging: Boolean) -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val look = LocalCpuLook.current
    var draggingKey by remember { mutableStateOf<Any?>(null) }
    var offset by remember { mutableFloatStateOf(0f) }
    val heights = remember { mutableStateMapOf<Any, Int>() }
    val currentItems by rememberUpdatedState(items)
    val currentMove by rememberUpdatedState(onMove)
    items.forEachIndexed { index, item ->
        val itemKey = key(item)
        key(itemKey) {
            val dragging = draggingKey == itemKey
            if (index > 0) Hairline()
            Box(
                Modifier.fillMaxWidth().zIndex(if (dragging) 1f else 0f)
                    .onSizeChanged { heights[itemKey] = it.height }
                    .graphicsLayer { translationY = if (dragging) offset else 0f }
                    .then(if (dragging) Modifier.shadow(8.dp, RoundedCornerShape(look.radius(12.dp))) else Modifier)
                    .background(MaterialTheme.colorScheme.surfaceContainer),
            ) {
                val handle = Modifier.pointerInput(itemKey) {
                    detectDragGesturesAfterLongPress(
                        onDragStart = {
                            draggingKey = itemKey
                            offset = 0f
                            if (look.haptics) haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        },
                        onDragEnd = { draggingKey = null; offset = 0f },
                        onDragCancel = { draggingKey = null; offset = 0f },
                        onDrag = { change, amount ->
                            change.consume()
                            offset += amount.y
                            val list = currentItems
                            val from = list.indexOfFirst { key(it) == itemKey }
                            if (from < 0) return@detectDragGesturesAfterLongPress
                            if (offset > 0 && from < list.lastIndex) {
                                val next = heights[key(list[from + 1])] ?: return@detectDragGesturesAfterLongPress
                                if (offset > next / 2f) {
                                    currentMove(from, from + 1)
                                    offset -= next
                                }
                            } else if (offset < 0 && from > 0) {
                                val previous = heights[key(list[from - 1])] ?: return@detectDragGesturesAfterLongPress
                                if (-offset > previous / 2f) {
                                    currentMove(from, from - 1)
                                    offset += previous
                                }
                            }
                        },
                    )
                }
                row(item, handle, dragging)
            }
        }
    }
}

/** The grip a reorderable row shows on its right. */
@Composable
fun DragHandle(modifier: Modifier) {
    Box(modifier.size(40.dp), contentAlignment = Alignment.Center) {
        Icon(Icons.Rounded.DragIndicator, contentDescription = "按住拖动排序", tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f))
    }
}

/** A round check for to-dos. */
@Composable
fun TodoCheck(done: Boolean, modifier: Modifier = Modifier, onToggle: () -> Unit) {
    val accent = MaterialTheme.colorScheme.primary
    Box(
        modifier.size(40.dp).clip(CircleShape).clickable(onClick = onToggle)
            .semantics { role = Role.Checkbox; selected = done },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(20.dp).clip(CircleShape)
                .then(if (done) Modifier.background(accent) else Modifier.border(1.5.dp, MaterialTheme.colorScheme.outline, CircleShape)),
            contentAlignment = Alignment.Center,
        ) {
            if (done) Icon(Icons.Rounded.Check, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(14.dp))
        }
    }
}
