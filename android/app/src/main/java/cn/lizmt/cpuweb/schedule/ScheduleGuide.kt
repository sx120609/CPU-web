package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.TouchApp
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * How the week view draws somebody else's courses beside the user's (情侣课表
 * or 叠加到我的课表): the two-column day strip, or the one week grid both
 * people's courses used to share.
 */
enum class CoupleWeekLayout(val id: String, val title: String) {
    /** 并排: days side by side, the user's column and the other person's in each. */
    Split("split", "并排"),
    /** 合并: one week grid with both people's courses in it. */
    Merged("merged", "合并");

    companion object {
        /** The stored value; a missing or unknown one is the strip. */
        fun fromId(id: String?): CoupleWeekLayout = entries.firstOrNull { it.id == id } ?: Split

        val OPTIONS: List<Pair<String, String>> = entries.map { it.id to it.title }

        const val SETTING_TITLE = "一起看的周视图"
        const val SETTING_DETAIL = "并排：每天两栏，左边是你，右边是 TA。合并：两人的课排在同一张周课表里。"
    }
}

/** When the guide, the strip and the strip's hint show. Pure, so the rules are unit tested. */
object ScheduleGuideRules {
    /** Raise it when the guide says something new: everybody then sees it once more. */
    const val VERSION = 1

    /** The week view is the two-column day strip: somebody's courses are laid beside the user's and 并排 is chosen. */
    fun usesStrip(viewMode: String, hasLayer: Boolean, layout: CoupleWeekLayout): Boolean =
        viewMode == "week" && hasLayer && layout == CoupleWeekLayout.Split

    /**
     * 课表怎么用 opens by itself once: on the user's own timetable, when it has
     * something to show and nothing else is open over it.
     */
    fun opensGuide(seenVersion: Int, readOnly: Boolean, hasData: Boolean, busy: Boolean): Boolean =
        seenVersion < VERSION && !readOnly && hasData && !busy

    /** The line over the strip that says how it works, until it was seen once. */
    fun showsStripHint(stripShown: Boolean, hintSeen: Boolean): Boolean = stripShown && !hintSeen

    /** 和 TA 一起看 belongs in the guide only for somebody who looks at two timetables. */
    fun showsTogether(coupleBound: Boolean, overlayOn: Boolean): Boolean = coupleBound || overlayOn

    /** 换回经典 is offered while the style is the promoted default. */
    fun offersClassic(style: ScheduleVisualStyle): Boolean = style == ScheduleVisualStyle.Minimal
}

/**
 * The line over the two-column day strip the first time it is shown: what it
 * is, the way back to the one week grid, and a close button.
 */
@Composable
internal fun StripHintBar(onMerge: () -> Unit, onClose: () -> Unit) {
    val colors = LocalScheduleColors.current
    Row(
        Modifier.fillMaxWidth().padding(bottom = 6.dp).clip(RoundedCornerShape(12.dp)).background(colors.surface)
            .padding(start = 12.dp, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("两人的课并排显示，左右滑动换天。", fontSize = 12.sp, lineHeight = 16.sp, color = colors.text,
            modifier = Modifier.weight(1f).padding(vertical = 8.dp))
        Text(
            "改回合并", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = colors.accent, maxLines = 1, softWrap = false,
            modifier = Modifier.padding(start = 8.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onMerge)
                .padding(horizontal = 8.dp, vertical = 8.dp),
        )
        Box(
            Modifier.size(36.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onClose).semantics { contentDescription = "关闭提示" },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.Close, contentDescription = null, tint = colors.secondary, modifier = Modifier.size(16.dp))
        }
    }
}

/**
 * 课表怎么用: a few lines on what changed and where things are, opened once by
 * itself and from 更多 afterwards. [together] adds the line about the week view
 * with two people's courses.
 */
@Composable
internal fun ScheduleGuideSheet(style: ScheduleStyleSettings, together: Boolean, onDismiss: () -> Unit) {
    // What the buttons offer is decided when the sheet opens, so a button that was used stays as 已换回.
    val offeredClassic = remember { ScheduleGuideRules.offersClassic(style.visualStyle) }
    val offeredMerge = remember { style.coupleWeekLayout == CoupleWeekLayout.Split }
    // Reading the line about the strip counts as having seen its hint.
    LaunchedEffect(together) { if (together) style.markStripHintSeen() }
    ScheduleSheetContainer(onDismiss) {
        SheetTitle("课表怎么用")
        GuideRow(Icons.Rounded.TouchApp, Color(0xFF2F6FE4), "点一下课程", "看详情，编辑、调整这一次、这次停课都在里面。")
        if (offeredClassic) {
            val changed = style.visualStyle == ScheduleVisualStyle.Classic
            GuideRow(
                Icons.Rounded.Palette, Color(0xFF8E59D9), "课表风格",
                "现在默认是“简约”，想用原来的样子可以换回“经典”。以后在“更多 › 课表设置”里换。",
                action = if (changed) "已换回" else "换回经典", enabled = !changed,
            ) { style.selectVisualStyle(ScheduleVisualStyle.Classic) }
        } else {
            GuideRow(Icons.Rounded.Palette, Color(0xFF8E59D9), "课表风格", "六种风格，在“更多 › 课表设置”里换。")
        }
        if (together) {
            if (offeredMerge) {
                val changed = style.coupleWeekLayout == CoupleWeekLayout.Merged
                GuideRow(
                    Icons.Rounded.Favorite, CoupleAccent, "和 TA 一起看", "周视图里两人的课并排显示，左右滑动换天。",
                    action = if (changed) "已改回" else "改回合并", enabled = !changed,
                ) { style.selectCoupleWeekLayout(CoupleWeekLayout.Merged) }
            } else {
                GuideRow(Icons.Rounded.Favorite, CoupleAccent, "和 TA 一起看", "周视图里两人的课排在同一张课表里；想并排看，在课表设置里换。")
            }
        }
        GuideRow(Icons.Rounded.MoreHoriz, Color(0xFF8E8E93), "更多", "课表设置、小组件、日程和共享课表都在右上角“更多”里。")
        Spacer(Modifier.height(14.dp))
        Button(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) { Text("知道了") }
    }
}

@Composable
private fun GuideRow(
    icon: ImageVector, tint: Color, title: String, detail: String,
    action: String? = null, enabled: Boolean = true, onAction: () -> Unit = {},
) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(32.dp).clip(RoundedCornerShape(9.dp)).background(tint), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.Medium)
            Text(detail, fontSize = 13.sp, lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (action != null) {
            Spacer(Modifier.width(10.dp))
            FilledTonalButton(onClick = onAction, enabled = enabled, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp)) {
                Text(action, fontSize = 13.sp, maxLines = 1, softWrap = false)
            }
        }
    }
}
