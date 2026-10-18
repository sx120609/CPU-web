package cn.lizmt.cpuweb.schedule

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.MenuBook
import androidx.compose.material.icons.rounded.AdminPanelSettings
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.Coffee
import androidx.compose.material.icons.rounded.Dashboard
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.EmojiEvents
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
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.Work
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.res.painterResource
import cn.lizmt.cpuweb.schedule.custom.Destination

/** The vector for an icon key; unknown keys fall back to a link. */
fun iconVector(key: String): ImageVector = when (key) {
    "dashboard" -> Icons.Rounded.Dashboard
    "home" -> Icons.Rounded.Home
    "calendar" -> Icons.Rounded.CalendarMonth
    "school" -> Icons.Rounded.School
    "apps" -> Icons.Rounded.Apps
    "person" -> Icons.Rounded.Person
    "forum" -> Icons.Rounded.Forum
    "mail" -> Icons.Rounded.Mail
    "bag" -> Icons.Rounded.ShoppingBag
    "sparkle" -> Icons.Rounded.AutoAwesome
    "campaign" -> Icons.Rounded.Campaign
    "search" -> Icons.Rounded.Search
    "star" -> Icons.Rounded.Star
    "extension" -> Icons.Rounded.Extension
    "build" -> Icons.Rounded.Build
    "edit" -> Icons.Rounded.Edit
    "music" -> Icons.Rounded.MusicNote
    "download" -> Icons.Rounded.Download
    "tune" -> Icons.Rounded.Tune
    "bookmark" -> Icons.Rounded.Bookmark
    "heart" -> Icons.Rounded.Favorite
    "bolt" -> Icons.Rounded.Bolt
    "book" -> Icons.AutoMirrored.Rounded.MenuBook
    "coffee" -> Icons.Rounded.Coffee
    "flag" -> Icons.Rounded.Flag
    "globe" -> Icons.Rounded.Public
    "image" -> Icons.Rounded.Image
    "lightbulb" -> Icons.Rounded.Lightbulb
    "pets" -> Icons.Rounded.Pets
    "rocket" -> Icons.Rounded.RocketLaunch
    "sports" -> Icons.Rounded.SportsBasketball
    "trophy" -> Icons.Rounded.EmojiEvents
    "work" -> Icons.Rounded.Work
    "shield" -> Icons.Rounded.AdminPanelSettings
    "update" -> Icons.Rounded.SystemUpdate
    else -> Icons.Rounded.Link
}

/**
 * The original five tabs keep their drawn outline symbols (shared with iOS)
 * until the user picks another icon; everything else uses the vector set.
 */
@Composable
fun destinationPainter(destination: Destination, customIcon: Boolean): Painter {
    val drawable = if (customIcon) null else when (destination.id) {
        "home" -> R.drawable.tab_home
        "academic" -> R.drawable.tab_academic
        "schedule" -> R.drawable.tab_schedule
        "services" -> R.drawable.tab_services
        "profile" -> R.drawable.tab_profile
        else -> null
    }
    return if (drawable != null) painterResource(drawable) else rememberVectorPainter(iconVector(destination.icon))
}
