package cn.lizmt.cpuweb.schedule

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.lizmt.cpuweb.schedule.custom.Customization

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

private val BlackSchedule = DarkSchedule.copy(
    page = Color.Black,
    surface = Color(0xFF151515),
    softSurface = Color(0xFF0B0B0B),
    cell = Color(0x80161616),
    todayBorder = Color(0xFF333333),
    divider = Color(0xFF242424),
)

val LocalScheduleColors = staticCompositionLocalOf { LightSchedule }

/**
 * The user's look beyond colours: how round, how dense and how lively the
 * native surfaces are. New shell components read it; the timetable keeps its
 * own measured layout.
 */
@Immutable
data class CpuLook(
    val corners: Float = 1f,
    val density: Float = 1f,
    val reduceMotion: Boolean = false,
    val haptics: Boolean = true,
) {
    fun radius(base: Dp): Dp = base * corners
    fun space(base: Dp): Dp = base * density
    fun duration(millis: Int): Int = if (reduceMotion) 0 else millis
}

val LocalCpuLook = staticCompositionLocalOf { CpuLook() }

fun resolveDark(mode: String, systemDark: Boolean): Boolean = when (mode) {
    "dark" -> true
    "light" -> false
    else -> systemDark
}

/** Colours, shapes and type scale for one customization; brand colours stay exactly as before. */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun CpuTheme(mode: String, custom: Customization = Customization(), content: @Composable () -> Unit) {
    val dark = resolveDark(mode, isSystemInDarkTheme())
    val context = LocalContext.current
    var scheme = when {
        custom.accent == "dynamic" && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        custom.accent.startsWith("#") -> accentScheme(parseHex(custom.accent) ?: CpuBrand, dark)
        else -> brandScheme(dark)
    }
    if (dark && custom.pureBlack) scheme = scheme.blackened()
    val look = CpuLook(
        corners = custom.corners,
        density = custom.density.scale,
        reduceMotion = custom.reduceMotion,
        haptics = custom.haptics,
    )
    val baseDensity = LocalDensity.current
    MaterialTheme(colorScheme = scheme, shapes = scaledShapes(custom.corners), typography = CpuTypography) {
        CompositionLocalProvider(
            LocalScheduleColors provides when {
                !dark -> LightSchedule
                custom.pureBlack -> BlackSchedule
                else -> DarkSchedule
            },
            LocalCpuLook provides look,
            // Text drawn straight on the page (not inside a Surface) follows the theme too.
            androidx.compose.material3.LocalContentColor provides scheme.onBackground,
            LocalDensity provides Density(baseDensity.density, baseDensity.fontScale * custom.fontScale),
            // No stretch ("jelly") overscroll anywhere in the native UI; lists simply stop at their ends.
            androidx.compose.foundation.LocalOverscrollConfiguration provides null,
            content = content,
        )
    }
}

/**
 * Compact type on the site's scale (12/13/14/16/18/24) without the Latin letter
 * spacing Material adds, which only loosens Chinese text.
 */
val CpuTypography: Typography = Typography().let { base ->
    fun TextStyle.tuned(size: Int, line: Int, weight: FontWeight? = fontWeight) =
        copy(fontSize = size.sp, lineHeight = line.sp, letterSpacing = 0.sp, fontWeight = weight)
    base.copy(
        displaySmall = base.displaySmall.tuned(32, 40, FontWeight.Bold),
        headlineLarge = base.headlineLarge.tuned(28, 34, FontWeight.Bold),
        headlineMedium = base.headlineMedium.tuned(24, 30, FontWeight.Bold),
        headlineSmall = base.headlineSmall.tuned(24, 30, FontWeight.SemiBold),
        titleLarge = base.titleLarge.tuned(18, 24, FontWeight.SemiBold),
        titleMedium = base.titleMedium.tuned(16, 22, FontWeight.SemiBold),
        titleSmall = base.titleSmall.tuned(14, 20, FontWeight.Medium),
        bodyLarge = base.bodyLarge.tuned(16, 22),
        bodyMedium = base.bodyMedium.tuned(14, 20),
        bodySmall = base.bodySmall.tuned(12, 16),
        labelLarge = base.labelLarge.tuned(14, 18, FontWeight.Medium),
        labelMedium = base.labelMedium.tuned(13, 16, FontWeight.Medium),
        labelSmall = base.labelSmall.tuned(12, 14, FontWeight.Medium),
    )
}

// Neutral grounds: grouped white (or graphite) panels on a quiet page; the
// accent is kept for what is active or tappable, not for surfaces.
private val LightPage = Color(0xFFF3F4F3)
private val LightPanel = Color(0xFFFFFFFF)
private val LightFill = Color(0xFFECEDEC)
private val LightHairline = Color(0xFFE3E4E3)
private val LightSecondary = Color(0xFF6A6E6D)
private val DarkPage = Color(0xFF0E0F10)
private val DarkPanel = Color(0xFF18191B)
private val DarkFill = Color(0xFF232427)
private val DarkHairline = Color(0xFF2C2D30)
private val DarkSecondary = Color(0xFF9A9DA1)

private fun brandScheme(dark: Boolean): ColorScheme = if (dark) {
    darkColorScheme(
        primary = Color(0xFF6FD3C1),
        onPrimary = Color(0xFF00382F),
        primaryContainer = Color(0xFF1B3D38),
        onPrimaryContainer = Color(0xFFB5EFE3),
        secondaryContainer = Color(0xFF26302E),
        background = DarkPage,
        onBackground = Color(0xFFECEDEE),
        surface = DarkPanel,
        onSurface = Color(0xFFECEDEE),
        onSurfaceVariant = DarkSecondary,
        surfaceContainer = DarkPanel,
        surfaceContainerHigh = DarkFill,
        surfaceContainerHighest = Color(0xFF2B2C2F),
        surfaceContainerLow = Color(0xFF141517),
        outlineVariant = DarkHairline,
    )
} else {
    lightColorScheme(
        primary = CpuBrand,
        onPrimary = Color.White,
        primaryContainer = Color(0xFFDDF3EE),
        onPrimaryContainer = Color(0xFF00201B),
        secondaryContainer = Color(0xFFE6ECEB),
        background = LightPage,
        onBackground = Color(0xFF16181B),
        surface = LightPanel,
        onSurface = Color(0xFF16181B),
        onSurfaceVariant = LightSecondary,
        surfaceContainer = LightPanel,
        surfaceContainerHigh = LightFill,
        surfaceContainerHighest = Color(0xFFE4E5E4),
        surfaceContainerLow = Color(0xFFF7F8F7),
        outlineVariant = LightHairline,
    )
}

/**
 * A scheme around any accent. The accent is darkened (light) or lifted (dark)
 * until it keeps 4.5:1 against the page, so a pale pick never fades out.
 */
fun accentScheme(accent: Color, dark: Boolean): ColorScheme {
    return if (dark) {
        val primary = readable(mix(accent, Color.White, 0.38f), DarkPage, lighten = true)
        brandScheme(true).copy(
            primary = primary,
            onPrimary = mix(accent, Color.Black, 0.78f),
            primaryContainer = mix(accent, DarkPanel, 0.66f),
            onPrimaryContainer = mix(accent, Color.White, 0.78f),
            secondaryContainer = mix(accent, DarkPanel, 0.82f),
            onSecondaryContainer = mix(accent, Color.White, 0.82f),
        )
    } else {
        val primary = readable(accent, Color.White, lighten = false)
        brandScheme(false).copy(
            primary = primary,
            onPrimary = Color.White,
            primaryContainer = mix(accent, Color.White, 0.86f),
            onPrimaryContainer = mix(accent, Color.Black, 0.72f),
            secondaryContainer = mix(accent, Color.White, 0.9f),
            onSecondaryContainer = mix(accent, Color.Black, 0.7f),
        )
    }
}

private fun ColorScheme.blackened(): ColorScheme = copy(
    background = Color.Black,
    surface = Color.Black,
    surfaceContainerLowest = Color.Black,
    surfaceContainerLow = Color(0xFF080808),
    surfaceContainer = Color(0xFF0F0F0F),
    surfaceContainerHigh = Color(0xFF171717),
    surfaceContainerHighest = Color(0xFF1F1F1F),
)

private fun scaledShapes(scale: Float) = Shapes(
    extraSmall = RoundedCornerShape((4 * scale).dp),
    small = RoundedCornerShape((8 * scale).dp),
    medium = RoundedCornerShape((12 * scale).dp),
    large = RoundedCornerShape((16 * scale).dp),
    extraLarge = RoundedCornerShape((28 * scale).dp),
)

/** `#RRGGBB` to a colour; null for anything else. */
fun parseHex(value: String): Color? {
    if (!Regex("^#[0-9A-Fa-f]{6}$").matches(value)) return null
    return Color(0xFF000000 or value.substring(1).toLong(16))
}

fun Color.toHex(): String {
    val argb = (red * 255).toInt() shl 16 or ((green * 255).toInt() shl 8) or (blue * 255).toInt()
    return "#%06X".format(argb and 0xFFFFFF)
}

/** [amount] of [other] over this colour. */
fun mix(color: Color, other: Color, amount: Float): Color = other.copy(alpha = amount.coerceIn(0f, 1f)).compositeOver(color)

fun contrast(a: Color, b: Color): Float {
    val la = a.luminance() + 0.05f
    val lb = b.luminance() + 0.05f
    return if (la > lb) la / lb else lb / la
}

/** Step towards black or white until [color] reads at 4.5:1 on [background]. */
fun readable(color: Color, background: Color, lighten: Boolean): Color {
    var value = color
    var step = 0
    while (contrast(value, background) < 4.5f && step < 20) {
        value = mix(value, if (lighten) Color.White else Color.Black, 0.12f)
        step += 1
    }
    return value
}
