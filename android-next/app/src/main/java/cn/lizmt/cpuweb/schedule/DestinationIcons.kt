package cn.lizmt.cpuweb.schedule

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.automirrored.rounded.MenuBook
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.Apps
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Bookmark
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Coffee
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Pets
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.RocketLaunch
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material.icons.outlined.SportsBasketball
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material.icons.outlined.Today
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.Work
import androidx.compose.material.icons.rounded.AdminPanelSettings
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.ChatBubble
import androidx.compose.material.icons.rounded.Coffee
import androidx.compose.material.icons.rounded.Dashboard
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.EmojiEvents
import androidx.compose.material.icons.rounded.Event
import androidx.compose.material.icons.rounded.Extension
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.Flag
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Mail
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Pets
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.RocketLaunch
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.ShoppingBag
import androidx.compose.material.icons.rounded.SportsBasketball
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material.icons.rounded.Today
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.Work
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.res.painterResource
import cn.lizmt.cpuweb.schedule.custom.Destination

/** The outline and filled vectors for an icon key; unknown keys fall back to a link. */
fun iconPair(key: String): Pair<ImageVector, ImageVector> = when (key) {
    "today" -> Icons.Outlined.Today to Icons.Rounded.Today
    "event" -> Icons.Outlined.Event to Icons.Rounded.Event
    "assistant" -> Icons.Outlined.ChatBubbleOutline to Icons.Rounded.ChatBubble
    "dashboard" -> Icons.Outlined.Dashboard to Icons.Rounded.Dashboard
    "home" -> Icons.Outlined.Home to Icons.Rounded.Home
    "calendar" -> Icons.Outlined.CalendarMonth to Icons.Rounded.CalendarMonth
    "school" -> Icons.Outlined.School to Icons.Rounded.School
    "apps" -> Icons.Outlined.Apps to Icons.Rounded.Apps
    "person" -> Icons.Outlined.Person to Icons.Rounded.Person
    "forum" -> Icons.Outlined.Forum to Icons.Rounded.Forum
    "mail" -> Icons.Outlined.Mail to Icons.Rounded.Mail
    "bag" -> Icons.Outlined.ShoppingBag to Icons.Rounded.ShoppingBag
    "sparkle" -> Icons.Outlined.AutoAwesome to Icons.Rounded.AutoAwesome
    "campaign" -> Icons.Outlined.Campaign to Icons.Rounded.Campaign
    "search" -> Icons.Outlined.Search to Icons.Rounded.Search
    "star" -> Icons.Outlined.StarOutline to Icons.Rounded.Star
    "extension" -> Icons.Outlined.Extension to Icons.Rounded.Extension
    "build" -> Icons.Outlined.Build to Icons.Rounded.Build
    "edit" -> Icons.Outlined.Edit to Icons.Rounded.Edit
    "music" -> Icons.Outlined.MusicNote to Icons.Rounded.MusicNote
    "download" -> Icons.Outlined.Download to Icons.Rounded.Download
    "tune" -> Icons.Outlined.Tune to Icons.Rounded.Tune
    "bookmark" -> Icons.Outlined.Bookmark to Icons.Rounded.Bookmark
    "heart" -> Icons.Outlined.FavoriteBorder to Icons.Rounded.Favorite
    "bolt" -> Icons.Outlined.Bolt to Icons.Rounded.Bolt
    "book" -> Icons.AutoMirrored.Outlined.MenuBook to Icons.AutoMirrored.Rounded.MenuBook
    "coffee" -> Icons.Outlined.Coffee to Icons.Rounded.Coffee
    "flag" -> Icons.Outlined.Flag to Icons.Rounded.Flag
    "globe" -> Icons.Outlined.Public to Icons.Rounded.Public
    "image" -> Icons.Outlined.Image to Icons.Rounded.Image
    "lightbulb" -> Icons.Outlined.Lightbulb to Icons.Rounded.Lightbulb
    "pets" -> Icons.Outlined.Pets to Icons.Rounded.Pets
    "rocket" -> Icons.Outlined.RocketLaunch to Icons.Rounded.RocketLaunch
    "sports" -> Icons.Outlined.SportsBasketball to Icons.Rounded.SportsBasketball
    "trophy" -> Icons.Outlined.EmojiEvents to Icons.Rounded.EmojiEvents
    "work" -> Icons.Outlined.Work to Icons.Rounded.Work
    "shield" -> Icons.Outlined.AdminPanelSettings to Icons.Rounded.AdminPanelSettings
    "update" -> Icons.Outlined.SystemUpdate to Icons.Rounded.SystemUpdate
    else -> Icons.Outlined.Link to Icons.Rounded.Link
}

/** The outline vector for an icon key, as lists and panels show it. */
fun iconVector(key: String): ImageVector = iconPair(key).first

/**
 * The original five tabs keep their drawn outline symbols (shared with iOS)
 * until the user picks another icon; everything else uses the vector set,
 * filled when [selected].
 */
@Composable
fun destinationPainter(destination: Destination, customIcon: Boolean, selected: Boolean = false): Painter {
    val drawable = if (customIcon) null else when (destination.id) {
        "home" -> R.drawable.tab_home
        "academic" -> R.drawable.tab_academic
        "schedule" -> R.drawable.tab_schedule
        "services" -> R.drawable.tab_services
        "profile" -> R.drawable.tab_profile
        else -> null
    }
    if (drawable != null) return painterResource(drawable)
    val (outline, filled) = iconPair(destination.icon)
    return rememberVectorPainter(if (selected) filled else outline)
}
