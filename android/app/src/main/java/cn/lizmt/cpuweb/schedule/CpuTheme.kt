package cn.lizmt.cpuweb.schedule

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
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
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
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
    MaterialTheme(colorScheme = scheme, shapes = scaledShapes(custom.corners)) {
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

private fun brandScheme(dark: Boolean): ColorScheme = if (dark) {
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

/**
 * A scheme around any accent. The accent is darkened (light) or lifted (dark)
 * until it keeps 4.5:1 against the page, so a pale pick never fades out.
 */
fun accentScheme(accent: Color, dark: Boolean): ColorScheme {
    return if (dark) {
        val background = Color(0xFF111416)
        val primary = readable(mix(accent, Color.White, 0.38f), background, lighten = true)
        darkColorScheme(
            primary = primary,
            onPrimary = mix(accent, Color.Black, 0.78f),
            primaryContainer = mix(accent, Color(0xFF15191B), 0.62f),
            onPrimaryContainer = mix(accent, Color.White, 0.78f),
            secondaryContainer = mix(accent, Color(0xFF15191B), 0.8f),
            onSecondaryContainer = mix(accent, Color.White, 0.82f),
            background = background,
            surface = Color(0xFF15191B),
            surfaceContainer = mix(accent, Color(0xFF1C2124), 0.94f),
            surfaceContainerHigh = mix(accent, Color(0xFF232A2D), 0.93f),
            surfaceContainerLow = Color(0xFF181D1F),
        )
    } else {
        val background = Color(0xFFF7F8F7)
        val primary = readable(accent, Color.White, lighten = false)
        lightColorScheme(
            primary = primary,
            onPrimary = Color.White,
            primaryContainer = mix(accent, Color.White, 0.84f),
            onPrimaryContainer = mix(accent, Color.Black, 0.72f),
            secondaryContainer = mix(accent, Color.White, 0.9f),
            onSecondaryContainer = mix(accent, Color.Black, 0.7f),
            background = background,
            surface = Color.White,
            surfaceContainer = mix(accent, Color(0xFFF1F3F2), 0.95f),
            surfaceContainerHigh = mix(accent, Color(0xFFEAEDEC), 0.94f),
            surfaceContainerLow = Color(0xFFF6F8F7),
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
