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
        ) {
            NativeScale(content)
        }
    }
}

/** The native UI does not follow the system text size. */
const val NATIVE_FONT_SCALE = 1f

/** The phone width the native UI is drawn for: an iPhone's 393 points. */
const val DESIGN_WIDTH_DP = 393f

/** Phones at least this wide are close enough to [DESIGN_WIDTH_DP] to be left as they are. */
const val FULL_WIDTH_DP = 384f

/** The most a narrow phone shrinks the UI; below it text would get too small to read. */
const val MIN_LAYOUT_SCALE = 0.84f

/**
 * How much a phone whose short side is narrower than [FULL_WIDTH_DP] shrinks the
 * native UI. Many Android phones are 360dp wide, or 320dp with the system
 * display size turned up, where sizes meant for 393 looked oversized next to
 * the iPhone and ran out of room. Wider phones and tablets are left alone. The
 * Web pages of the app use the same numbers (web/public/appearance-bootstrap.js).
 */
fun phoneLayoutScale(shortSideDp: Float): Float =
    if (shortSideDp <= 0f || shortSideDp >= FULL_WIDTH_DP) 1f
    else (shortSideDp / DESIGN_WIDTH_DP).coerceAtLeast(MIN_LAYOUT_SCALE)

/**
 * The short side of the whole screen in dp, whichever way the phone is held and
 * however small the app's window is: the scale must not change on rotation or
 * in split screen. 0 when it cannot be read.
 */
fun deviceShortSideDp(context: android.content.Context): Float {
    val manager = context.getSystemService(android.content.Context.WINDOW_SERVICE) as? android.view.WindowManager ?: return 0f
    val density = context.resources.displayMetrics.density
    if (density <= 0f) return 0f
    val shortSide = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
        manager.maximumWindowMetrics.bounds.let { minOf(it.width(), it.height()) }
    } else {
        val size = android.graphics.Point()
        @Suppress("DEPRECATION")
        manager.defaultDisplay.getRealSize(size)
        minOf(size.x, size.y)
    }
    return shortSide / density
}

/** The density a [NativeScale] put in place, so one nested in the same window leaves it alone. */
private val LocalNativeDensity = staticCompositionLocalOf<androidx.compose.ui.unit.Density?> { null }

/**
 * The app's own scale for everything native: a narrow phone lays out as one of
 * [DESIGN_WIDTH_DP], and text keeps its designed size whatever the system text
 * size is (the timetable, its sheets and the tab bar are dense, and larger text
 * cut them short; the text on course cards has its own setting in 课表设置).
 *
 * [CpuTheme] applies it to the page. A sheet, dialog or menu is a window of its
 * own and starts again from the system's values, so each goes through the
 * wrappers in CpuWindows.kt, which apply it again.
 */
@Composable
fun NativeScale(content: @Composable () -> Unit) {
    val density = androidx.compose.ui.platform.LocalDensity.current
    if (density === LocalNativeDensity.current) {
        content()
        return
    }
    val context = androidx.compose.ui.platform.LocalContext.current
    // A new configuration (unfolding, another display size) is a reason to measure again.
    val configuration = androidx.compose.ui.platform.LocalConfiguration.current
    val scale = androidx.compose.runtime.remember(density, configuration) { phoneLayoutScale(deviceShortSideDp(context)) }
    // Kept across rotations: Compose rebuilds a dialog, and drops what was typed in it, when its density changes.
    val scaled = androidx.compose.runtime.remember(density, scale) {
        androidx.compose.ui.unit.Density(density.density * scale, NATIVE_FONT_SCALE)
    }
    androidx.compose.runtime.CompositionLocalProvider(
        androidx.compose.ui.platform.LocalDensity provides scaled,
        LocalNativeDensity provides scaled,
        content = content,
    )
}

/**
 * The configuration both activities lay over the system's: text size 100%. It
 * reaches whatever [NativeScale] does not wrap, such as platform views.
 */
fun nativeConfigurationOverride(): android.content.res.Configuration =
    android.content.res.Configuration().apply { fontScale = NATIVE_FONT_SCALE }
