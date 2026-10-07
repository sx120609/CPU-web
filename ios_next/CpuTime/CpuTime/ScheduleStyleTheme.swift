import SwiftUI

// Colour tokens and surfaces for the NapTable timetable styles. The classic
// style keeps its own drawing in NativeScheduleView and does not use these.

/// Theme-colour tiers. One brand colour is resolved once per appearance into:
/// - `text`: text, icons, hairlines and the "now" line; at least 4.5:1 on the
///   timetable canvas, the week panel and the tinted today column.
/// - `fill`: a solid fill that carries `onFill` (white) at 4.5:1 or better.
/// - `tint(_:)`: the brand colour at a given strength, for washes.
///
/// Only OKLCH lightness is moved, so hue and chroma stay those of the brand;
/// chroma is scaled back where it leaves sRGB. A brand that already passes is
/// used unchanged.
nonisolated struct ThemePalette: Equatable, Sendable {
    /// Gamma-encoded sRGB components, 0...1.
    struct RGB: Hashable, Sendable {
        var red: Double
        var green: Double
        var blue: Double

        static let white = RGB(red: 1, green: 1, blue: 1)
        static let black = RGB(red: 0, green: 0, blue: 0)

        init(red: Double, green: Double, blue: Double) {
            self.red = min(max(red, 0), 1)
            self.green = min(max(green, 0), 1)
            self.blue = min(max(blue, 0), 1)
        }

        /// `0xRRGGBB`.
        init(hex: UInt32) {
            self.init(red: Double(hex >> 16 & 0xFF) / 255, green: Double(hex >> 8 & 0xFF) / 255,
                      blue: Double(hex & 0xFF) / 255)
        }

        var color: Color { Color(.sRGB, red: red, green: green, blue: blue, opacity: 1) }

        /// `top` composited over this colour at `amount` opacity, on the encoded
        /// components as the screen does.
        func overlaid(by top: RGB, amount: Double) -> RGB {
            RGB(red: red + (top.red - red) * amount,
                green: green + (top.green - green) * amount,
                blue: blue + (top.blue - blue) * amount)
        }

        /// WCAG relative luminance.
        var luminance: Double {
            0.2126 * ThemePalette.linear(red) + 0.7152 * ThemePalette.linear(green)
                + 0.0722 * ThemePalette.linear(blue)
        }
    }

    struct Tier: Equatable, Sendable {
        let text: RGB
        let fill: RGB
        let onFill: RGB
    }

    let base: RGB
    let light: Tier
    let dark: Tier

    /// WCAG AA for body text.
    static let minimumContrast = 4.5

    init(base: RGB) {
        self.base = base
        let fill = Self.adjusted(base, lighten: false) { Self.contrast($0, .white) >= Self.minimumContrast }
        light = Tier(text: Self.text(for: base, dark: false), fill: fill, onFill: .white)
        dark = Tier(text: Self.text(for: base, dark: true), fill: fill, onFill: .white)
    }

    func tier(dark: Bool) -> Tier { dark ? self.dark : light }
    func text(dark: Bool) -> Color { tier(dark: dark).text.color }
    func fill(dark: Bool) -> Color { tier(dark: dark).fill.color }
    func onFill(dark: Bool) -> Color { tier(dark: dark).onFill.color }
    func tint(_ strength: Double) -> Color { base.color.opacity(strength) }

    // MARK: Cache

    private static let cacheLock = NSLock()
    nonisolated(unsafe) private static var cache: [RGB: ThemePalette] = [:]

    /// Shape styles ask on every redraw; each brand is resolved once.
    static func of(_ base: RGB) -> ThemePalette {
        cacheLock.lock()
        defer { cacheLock.unlock() }
        if let cached = cache[base] { return cached }
        let palette = ThemePalette(base: base)
        if cache.count >= 16 { cache.removeAll() }
        cache[base] = palette
        return palette
    }

    // MARK: Surfaces the text tier has to clear

    enum Surface {
        /// The week panel without a photo: white at this opacity over the canvas.
        static func panelWhiteOpacity(dark: Bool) -> Double { dark ? 0.09 : 0.96 }
        /// The wash over today's whole column.
        static func todayStrength(dark: Bool) -> Double { dark ? 0.15 : 0.08 }
        /// The page gradient drawn by `NativeScheduleBackground`, end stops.
        static func canvases(dark: Bool) -> [RGB] {
            dark ? [RGB(hex: 0x15181C), RGB(hex: 0x0E1012)] : [RGB(hex: 0xEDF4FF), RGB(hex: 0xF8FAFC), .white]
        }
    }

    static func textSurfaces(brand: RGB, dark: Bool) -> [RGB] {
        Surface.canvases(dark: dark).flatMap { canvas in
            let panel = canvas.overlaid(by: .white, amount: Surface.panelWhiteOpacity(dark: dark))
            return [canvas, panel, panel.overlaid(by: brand, amount: Surface.todayStrength(dark: dark))]
        }
    }

    static func contrast(_ first: RGB, _ second: RGB) -> Double {
        contrast(first.luminance, second.luminance)
    }

    private static func contrast(_ first: Double, _ second: Double) -> Double {
        (max(first, second) + 0.05) / (min(first, second) + 0.05)
    }

    private static func text(for base: RGB, dark: Bool) -> RGB {
        let surfaces = textSurfaces(brand: base, dark: dark).map(\.luminance)
        return adjusted(base, lighten: dark) { candidate in
            let luminance = candidate.luminance
            return surfaces.allSatisfy { contrast(luminance, $0) >= minimumContrast }
        }
    }

    /// Bisects OKLCH lightness towards `lighten` for the value nearest the brand
    /// that satisfies `passes`.
    private static func adjusted(_ base: RGB, lighten: Bool, passes: (RGB) -> Bool) -> RGB {
        if passes(base) { return base }
        let color = OKLCH(base)
        var good = lighten ? 1.0 : 0.0
        var bad = color.lightness
        for _ in 0..<32 {
            let middle = (good + bad) / 2
            if passes(color.rgb(lightness: middle)) { good = middle } else { bad = middle }
        }
        return color.rgb(lightness: good)
    }

    // MARK: Colour spaces

    static func linear(_ value: Double) -> Double {
        value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
    }

    static func encoded(_ value: Double) -> Double {
        let value = min(max(value, 0), 1)
        return value <= 0.0031308 ? value * 12.92 : 1.055 * pow(value, 1 / 2.4) - 0.055
    }

    /// OKLCH (Björn Ottosson's OKLab in polar form): lightness, chroma, hue in radians.
    struct OKLCH: Sendable {
        var lightness: Double
        var chroma: Double
        var hue: Double

        init(_ rgb: RGB) {
            let red = ThemePalette.linear(rgb.red)
            let green = ThemePalette.linear(rgb.green)
            let blue = ThemePalette.linear(rgb.blue)
            let l = cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
            let m = cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
            let s = cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)
            lightness = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
            let a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
            let b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
            chroma = (a * a + b * b).squareRoot()
            hue = atan2(b, a)
        }

        /// Same hue and chroma at `lightness`, with chroma scaled to the sRGB
        /// boundary when needed and the result rounded to 8 bits.
        func rgb(lightness: Double) -> RGB {
            let a = chroma * cos(hue), b = chroma * sin(hue)
            var channels = Self.linearRGB(lightness, a, b)
            if !Self.inGamut(channels) {
                var inside = 0.0, outside = 1.0
                for _ in 0..<32 {
                    let middle = (inside + outside) / 2
                    if Self.inGamut(Self.linearRGB(lightness, a * middle, b * middle)) {
                        inside = middle
                    } else {
                        outside = middle
                    }
                }
                channels = Self.linearRGB(lightness, a * inside, b * inside)
            }
            func byte(_ value: Double) -> Double { (ThemePalette.encoded(value) * 255).rounded() / 255 }
            return RGB(red: byte(channels.red), green: byte(channels.green), blue: byte(channels.blue))
        }

        private static func linearRGB(_ lightness: Double, _ a: Double, _ b: Double)
            -> (red: Double, green: Double, blue: Double) {
            func cube(_ value: Double) -> Double { value * value * value }
            let l = cube(lightness + 0.3963377774 * a + 0.2158037573 * b)
            let m = cube(lightness - 0.1055613458 * a - 0.0638541728 * b)
            let s = cube(lightness - 0.0894841775 * a - 1.2914855480 * b)
            return (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
        }

        private static func inGamut(_ channels: (red: Double, green: Double, blue: Double)) -> Bool {
            let tolerance = 1e-7
            return [channels.red, channels.green, channels.blue].allSatisfy { $0 >= -tolerance && $0 <= 1 + tolerance }
        }
    }
}

// MARK: - Environment

private struct ScheduleStyleKey: EnvironmentKey {
    static let defaultValue = ScheduleStyle.classic
}

private struct ScheduleThemeBrandKey: EnvironmentKey {
    /// `Color.cpuBrand`.
    static let defaultValue = ThemePalette.RGB(hex: 0x0F8F7F)
}

private struct SchedulePaletteKey: EnvironmentKey {
    static let defaultValue = "color-glass"
}

private struct ScheduleStaticRenderingKey: EnvironmentKey {
    static let defaultValue = false
}

private struct ScheduleBackgroundVisibilityKey: EnvironmentKey {
    static let defaultValue = 0.0
}

extension EnvironmentValues {
    var scheduleStyle: ScheduleStyle {
        get { self[ScheduleStyleKey.self] }
        set { self[ScheduleStyleKey.self] = newValue }
    }

    /// The theme colour of the styled timetable: the accent of a single-colour
    /// course palette, otherwise the app brand.
    var scheduleThemeBrand: ThemePalette.RGB {
        get { self[ScheduleThemeBrandKey.self] }
        set { self[ScheduleThemeBrandKey.self] = newValue }
    }

    /// The course palette key shared with Web and Android.
    var schedulePalette: String {
        get { self[SchedulePaletteKey.self] }
        set { self[SchedulePaletteKey.self] = newValue }
    }

    /// Set while rendering a share image: no today, no "now", nothing greyed as
    /// finished, so the picture reads the same whenever it is opened.
    var scheduleStaticRendering: Bool {
        get { self[ScheduleStaticRenderingKey.self] }
        set { self[ScheduleStaticRenderingKey.self] = newValue }
    }

    /// How much of the background photo shows; the week panel veils more of a
    /// stronger photo.
    var scheduleBackgroundVisibility: Double {
        get { self[ScheduleBackgroundVisibilityKey.self] }
        set { self[ScheduleBackgroundVisibilityKey.self] = newValue }
    }
}

extension ScheduleStyle {
    /// The theme colour that goes with a course palette.
    @MainActor static func themeBrand(palette: String) -> ThemePalette.RGB {
        guard let brand = NativeSchedulePalette.brand(for: palette) else { return ThemePalette.RGB(hex: 0x0F8F7F) }
        return ThemePalette.RGB(red: brand.red, green: brand.green, blue: brand.blue)
    }
}

// MARK: - Style colours

@available(iOS 17.0, *)
extension ScheduleStyle {
    var fontDesign: Font.Design {
        switch layout.font {
        case .standard: .default
        case .rounded: .rounded
        case .serif: .serif
        case .monospaced: .monospaced
        }
    }

    /// The typeface of running text: course names, rooms, 「第 3–4 节」. The
    /// board keeps its monospaced face for times and dates only; set in it, the
    /// space between a character and a digit is a full digit wide and the line
    /// falls apart.
    var textDesign: Font.Design { layout.font == .monospaced ? .default : fontDesign }

    /// Paper and board bring their own page colour; the others keep the page
    /// background and any photo set on it.
    func canvasColor(dark: Bool) -> Color? {
        switch self {
        case .paper: Self.color(dark ? 0x201E1B : 0xF1ECE2)
        case .board: Self.color(dark ? 0x171A1C : 0xF4F5F4)
        default: nil
        }
    }

    func inkColor(dark: Bool) -> Color {
        switch self {
        case .paper: Self.color(dark ? 0xEDE6D8 : 0x2A251F)
        case .board: Self.color(dark ? 0xFFE4A3 : 0x171A1C)
        default: .primary
        }
    }

    func styleAccent(dark: Bool, fallback: Color) -> Color {
        switch self {
        case .paper: Self.color(dark ? 0xF39B85 : 0xA63F29)
        case .board: Self.color(dark ? 0xFFD477 : 0x242C32)
        default: fallback
        }
    }

    private static func color(_ hex: UInt32) -> Color {
        Color(.sRGB, red: Double((hex >> 16) & 255) / 255,
              green: Double((hex >> 8) & 255) / 255,
              blue: Double(hex & 255) / 255, opacity: 1)
    }
}

/// A course's colours in the styled timetable. The hue comes from the same
/// UTF-16 name hash as Web and Android, so a course keeps its colour family on
/// every client; a single-colour palette gives every course that palette's hue.
@available(iOS 17.0, *)
struct ScheduleStyleCourseColor: Equatable {
    /// Degrees, 0..<360.
    let hue: Double
    /// Percent.
    let saturation: Double
    let backgroundLightness: Double

    init(name: String, palette: String) {
        if let brand = NativeSchedulePalette.brand(for: palette) {
            let (hue, saturation) = Self.hueSaturation(red: brand.red, green: brand.green, blue: brand.blue)
            self.hue = hue
            // Slate stays grey; only an over-vivid accent is held back.
            self.saturation = min(76, saturation)
            backgroundLightness = 91
        } else {
            let hash = NativeSchedulePalette.hash(name)
            hue = Double(hash % 360)
            saturation = Double(58 + ((hash >> 8) % 18))
            backgroundLightness = Double(89 + ((hash >> 16) % 5))
        }
    }

    /// Text, stripes and dots. Light text sits at a fixed lightness so every
    /// hue clears 4.5:1 on its own pale fill; dark uses a brighter step.
    func accent(dark: Bool) -> Color {
        dark
            ? NativeSchedulePalette.hsl(hue, min(82, saturation + 8), 80).color
            : NativeSchedulePalette.hsl(hue, min(76, saturation + 4), 24).color
    }

    /// The flat fill behind a course: an opaque pale tint in light mode, a
    /// translucent course colour over the dark canvas in dark mode.
    func fill(dark: Bool, hasBackground: Bool = false) -> Color {
        let saturation = min(45, saturation)
        if dark { return NativeSchedulePalette.hsl(hue, saturation, 50, 0.22).color }
        return NativeSchedulePalette.hsl(hue, saturation, max(93, backgroundLightness), hasBackground ? 0.92 : 1).color
    }

    func border(dark: Bool) -> Color {
        NativeSchedulePalette.hsl(hue, min(50, saturation), dark ? 70 : 55, dark ? 0.34 : 0.22).color
    }

    private static func hueSaturation(red: Double, green: Double, blue: Double) -> (Double, Double) {
        let maxValue = max(red, green, blue), minValue = min(red, green, blue)
        let delta = maxValue - minValue
        guard delta > 0 else { return (0, 0) }
        let lightness = (maxValue + minValue) / 2
        let saturation = delta / (1 - abs(2 * lightness - 1))
        var hue: Double
        switch maxValue {
        case red: hue = ((green - blue) / delta).truncatingRemainder(dividingBy: 6)
        case green: hue = (blue - red) / delta + 2
        default: hue = (red - green) / delta + 4
        }
        hue *= 60
        if hue < 0 { hue += 360 }
        return (hue, min(100, saturation * 100))
    }
}

// MARK: - Shape styles

/// Secondary metadata grey for period times and the like: at least 4.5:1 on
/// the canvas and the panel in both appearances.
@available(iOS 17.0, *)
struct ScheduleMetaTextStyle: ShapeStyle {
    func resolve(in environment: EnvironmentValues) -> Color {
        environment.colorScheme == .dark
            ? Color(.sRGB, red: 0x98 / 255, green: 0x98 / 255, blue: 0x9D / 255, opacity: 1)
            : Color(.sRGB, red: 0x6E / 255, green: 0x6E / 255, blue: 0x73 / 255, opacity: 1)
    }
}

@available(iOS 17.0, *)
struct ScheduleThemeTextStyle: ShapeStyle {
    func resolve(in environment: EnvironmentValues) -> Color {
        ThemePalette.of(environment.scheduleThemeBrand).text(dark: environment.colorScheme == .dark)
    }
}

@available(iOS 17.0, *)
struct ScheduleThemeFillStyle: ShapeStyle {
    func resolve(in environment: EnvironmentValues) -> Color {
        ThemePalette.of(environment.scheduleThemeBrand).fill(dark: environment.colorScheme == .dark)
    }
}

@available(iOS 17.0, *)
struct ScheduleThemeOnFillStyle: ShapeStyle {
    func resolve(in environment: EnvironmentValues) -> Color {
        ThemePalette.of(environment.scheduleThemeBrand).onFill(dark: environment.colorScheme == .dark)
    }
}

@available(iOS 17.0, *)
struct ScheduleThemeTintStyle: ShapeStyle {
    let amount: Double

    func resolve(in environment: EnvironmentValues) -> Color {
        ThemePalette.of(environment.scheduleThemeBrand).tint(amount)
    }
}

@available(iOS 17.0, *)
extension ShapeStyle where Self == ScheduleMetaTextStyle {
    static var scheduleMeta: ScheduleMetaTextStyle { ScheduleMetaTextStyle() }
}

@available(iOS 17.0, *)
extension ShapeStyle where Self == ScheduleThemeTextStyle {
    static var themeText: ScheduleThemeTextStyle { ScheduleThemeTextStyle() }
}

@available(iOS 17.0, *)
extension ShapeStyle where Self == ScheduleThemeFillStyle {
    static var themeFill: ScheduleThemeFillStyle { ScheduleThemeFillStyle() }
}

@available(iOS 17.0, *)
extension ShapeStyle where Self == ScheduleThemeOnFillStyle {
    static var themeOnFill: ScheduleThemeOnFillStyle { ScheduleThemeOnFillStyle() }
}

@available(iOS 17.0, *)
extension ShapeStyle where Self == ScheduleThemeTintStyle {
    static func themeTint(_ amount: Double) -> ScheduleThemeTintStyle {
        ScheduleThemeTintStyle(amount: amount)
    }
}

@available(iOS 17.0, *)
extension ShapeStyle where Self == Color {
    /// Empty cells and other small surfaces: a flat fill, no gradient.
    static func scheduleCellSurface(hasBackground: Bool, dark: Bool) -> Color {
        if hasBackground { return dark ? Color.white.opacity(0.08) : Color.white.opacity(0.55) }
        return dark ? Color.white.opacity(0.05) : Color.white
    }

    /// The whole week panel. Over a photo it is a thin flat veil rather than a
    /// blur, which would smear the picture; a stronger photo gets more veil.
    static func schedulePanelSurface(hasBackground: Bool, dark: Bool, imageVisibility: Double) -> Color {
        guard hasBackground else {
            return Color.white.opacity(ThemePalette.Surface.panelWhiteOpacity(dark: dark))
        }
        let veil = 0.14 + 0.32 * min(1, max(0, imageVisibility))
        return dark ? Color.black.opacity(veil) : Color.white.opacity(veil)
    }

    /// The hairline around cells and cards.
    static func scheduleCellBorder(dark: Bool) -> Color {
        dark ? Color.white.opacity(0.12)
            : Color(.sRGB, red: 0.14, green: 0.18, blue: 0.28, opacity: 0.14)
    }
}

/// A single card such as the rest-day card: white, or a material over a photo.
@available(iOS 17.0, *)
struct ScheduleCardSurface: ShapeStyle {
    var hasBackground: Bool

    func resolve(in environment: EnvironmentValues) -> AnyShapeStyle {
        if hasBackground { return AnyShapeStyle(.regularMaterial) }
        return AnyShapeStyle(environment.colorScheme == .dark ? Color.white.opacity(0.07) : Color.white)
    }
}

/// One content surface of the styled timetable: a flat fill and a hairline.
@available(iOS 17.0, *)
struct ScheduleSurface: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scheduleHasBackground) private var hasBackground
    @Environment(\.scheduleBackgroundVisibility) private var backgroundVisibility
    let cornerRadius: CGFloat
    /// A standalone card; a material over a photo.
    var isCard = false
    /// The whole week or day panel.
    var isPanel = false
    /// Off where the content draws its own frame, as the table's rules do.
    var showsBorder = true

    var body: some View {
        let radius = style == .minimal || style == .grid ? cornerRadius : CGFloat(style.layout.cornerRadius)
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        Group {
            if let canvas = style.canvasColor(dark: colorScheme == .dark), !hasBackground {
                shape.fill(canvas)
            } else if isPanel {
                shape.fill(.schedulePanelSurface(hasBackground: hasBackground, dark: colorScheme == .dark,
                                                 imageVisibility: backgroundVisibility))
            } else if isCard {
                shape.fill(ScheduleCardSurface(hasBackground: hasBackground))
            } else {
                shape.fill(.scheduleCellSurface(hasBackground: hasBackground, dark: colorScheme == .dark))
            }
        }
        .overlay {
            if style == .paper && isPanel {
                // Paper frames its panel with a heavy outer and a fine inner rule.
                let ink = style.inkColor(dark: colorScheme == .dark)
                shape.strokeBorder(ink.opacity(0.6), lineWidth: 1.2)
                    .overlay { shape.inset(by: 3).stroke(ink.opacity(0.24), lineWidth: 0.6) }
            } else if showsBorder {
                shape.strokeBorder(.scheduleCellBorder(dark: colorScheme == .dark), lineWidth: 1)
            }
        }
        .allowsHitTesting(false)
    }
}
