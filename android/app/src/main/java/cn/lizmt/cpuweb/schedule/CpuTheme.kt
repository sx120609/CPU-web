package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

val CpuBrand = Color(0xFF0F8F7F)

/** Timetable surfaces shared by the week grid, day view and sheets. */
@Immutable
data class ScheduleColors(
    val dark: Boolean,
    val page: Color,
    val surface: Color,
    val softSurface: Color,
    val cell: Color,
    val text: Color,
    val secondary: Color,
    val accent: Color,
    val todayBorder: Color,
    val divider: Color,
)

private val LightSchedule = ScheduleColors(
    dark = false,
    page = Color(0xFFF5F8FC),
    surface = Color.White,
    softSurface = Color(0xFFE8EDF3),
    cell = Color(0x99FFFFFF),
    text = Color(0xFF172033),
    secondary = Color(0xFF64748B),
    accent = Color(0xFF2563EB),
    todayBorder = Color(0xFFDCE2F0),
    divider = Color(0xFFE2E4EA),
)

// The neutral greys of the site's dark theme, as on the iOS timetable, so the
// timetable tab matches the Web tabs beside it.
private val DarkSchedule = ScheduleColors(
    dark = true,
    page = Color(0xFF111316),
    surface = Color(0xFF23272C),
    softSurface = Color(0xFF1A1D21),
    cell = Color(0x802A2F35),
    text = Color(0xFFECEEF1),
    secondary = Color(0xFFB0B7C1),
    accent = Color(0xFF8DADFF),
    todayBorder = Color(0xFF454A52),
    divider = Color(0xFF34383E),
)

val LocalScheduleColors = staticCompositionLocalOf { LightSchedule }

fun resolveDark(mode: String, systemDark: Boolean): Boolean = when (mode) {
    "dark" -> true
    "light" -> false
    else -> systemDark
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun CpuTheme(mode: String, content: @Composable () -> Unit) {
    val dark = resolveDark(mode, isSystemInDarkTheme())
    val scheme = if (dark) {
        darkColorScheme(
            primary = Color(0xFF6FD3C1),
            onPrimary = Color(0xFF00382F),
            primaryContainer = Color(0xFF1E4A43),
            onPrimaryContainer = Color(0xFFB5EFE3),
            secondaryContainer = Color(0xFF2A3A37),
            background = Color(0xFF111416),
            surface = Color(0xFF15191B),
            surfaceContainer = Color(0xFF1C2124),
            surfaceContainerHigh = Color(0xFF232A2D),
            surfaceContainerLow = Color(0xFF181D1F),
        )
    } else {
        lightColorScheme(
            primary = CpuBrand,
            onPrimary = Color.White,
            primaryContainer = Color(0xFFD5F2EC),
            onPrimaryContainer = Color(0xFF00201B),
            secondaryContainer = Color(0xFFE2EBE9),
            background = Color(0xFFF7F8F6),
            surface = Color(0xFFFFFFFF),
            surfaceContainer = Color(0xFFF1F3F2),
            surfaceContainerHigh = Color(0xFFEAEDEC),
            surfaceContainerLow = Color(0xFFF6F8F7),
        )
    }
    MaterialTheme(colorScheme = scheme) {
        androidx.compose.runtime.CompositionLocalProvider(
            LocalScheduleColors provides if (dark) DarkSchedule else LightSchedule,
            // No stretch ("jelly") overscroll anywhere in the native UI; lists simply stop at their ends.
            androidx.compose.foundation.LocalOverscrollConfiguration provides null,
            content = content,
        )
    }
}
