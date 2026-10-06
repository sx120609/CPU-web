import Foundation
import SwiftUI

/// Web / Android timetable colors. Keep the UTF-16, wrapping UInt32 hash in
/// sync with getColorGlassCourseTone in web/components/jwxt/scheduleTheme.ts.
enum NativeSchedulePalette {
    struct RGBA: Equatable {
        let red: Double
        let green: Double
        let blue: Double
        var alpha: Double = 1

        init(_ hex: UInt32, alpha: Double = 1) {
            red = Double((hex >> 16) & 255) / 255
            green = Double((hex >> 8) & 255) / 255
            blue = Double(hex & 255) / 255
            self.alpha = alpha
        }
        init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
            self.red = red; self.green = green; self.blue = blue; self.alpha = alpha
        }
        var color: Color { Color(.sRGB, red: red, green: green, blue: blue, opacity: alpha) }
        func mixed(with other: RGBA, weight: Double) -> RGBA {
            RGBA(red: red * weight + other.red * (1 - weight),
                 green: green * weight + other.green * (1 - weight),
                 blue: blue * weight + other.blue * (1 - weight))
        }
    }
    struct Tone {
        let top: RGBA
        let bottom: RGBA
        let border: RGBA
        let text: RGBA
    }

    static func hash(_ name: String) -> UInt32 {
        let seed = name.replacingOccurrences(of: "[\\u0009-\\u000D\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: " "))
        return seed.utf16.reduce(UInt32(0)) { ($0 &* 31) &+ UInt32($1) }
    }

    static func tone(name: String, palette: String, dark: Bool) -> Tone {
        if let simple = simple[palette] {
            let background = dark ? simple.bg.mixed(with: RGBA(0x101c19), weight: 0.32) : simple.bg
            return Tone(top: background, bottom: background,
                        border: dark ? simple.border.mixed(with: RGBA(0xffffff), weight: 0.72) : simple.border,
                        text: dark ? simple.text.mixed(with: RGBA(0xffffff), weight: 0.22) : simple.text)
        }
        let hash = hash(name)
        let hue = Double(hash % 360)
        let saturation = Double(58 + ((hash >> 8) % 18))
        if dark {
            return Tone(top: hsl(hue, min(82, saturation + 4), 34, 0.84),
                        bottom: hsl(hue, min(82, saturation + 4), 24, 0.88),
                        border: hsl(hue, min(86, saturation + 8), 72, 0.72),
                        text: RGBA(0xf8fffd))
        }
        let background = hsl(hue, saturation, Double(89 + ((hash >> 16) % 5)), 0.86)
        return Tone(top: background, bottom: background,
                    border: hsl(hue, min(82, saturation + 8), Double(48 + ((hash >> 20) % 10)), 0.48),
                    text: hsl(hue, min(76, saturation + 4), Double(25 + ((hash >> 24) % 8))))
    }

    private static let simple: [String: (bg: RGBA, border: RGBA, text: RGBA)] = [
        "green": (RGBA(0xf4fbf8), RGBA(0x168776), RGBA(0x0f5d52)),
        "blue": (RGBA(0xf3f8ff), RGBA(0x2563eb), RGBA(0x1e3a8a)),
        "teal": (RGBA(0xf0fbff), RGBA(0x0891b2), RGBA(0x164e63)),
        // The persisted Web key "indigo" denotes its pink theme.
        "indigo": (RGBA(0xfff5fa), RGBA(0xdb2777), RGBA(0x9d174d)),
        "violet": (RGBA(0xfaf7ff), RGBA(0x7c3aed), RGBA(0x5b21b6)),
        "orange": (RGBA(0xfff7f1), RGBA(0xea580c), RGBA(0x9a3412)),
        "rose": (RGBA(0xfff5f7), RGBA(0xe11d48), RGBA(0x9f1239)),
        "slate": (RGBA(0xf8fafc), RGBA(0x64748b), RGBA(0x334155)),
    ]

    /// The accent of a single-color palette; nil for the per-course palette.
    static func brand(for palette: String) -> RGBA? { simple[palette]?.border }

    static func hsl(_ hue: Double, _ saturation: Double, _ lightness: Double, _ alpha: Double = 1) -> RGBA {
        let s = saturation / 100, l = lightness / 100
        let chroma = (1 - abs(2 * l - 1)) * s
        let scaled = hue / 60
        let x = chroma * (1 - abs(scaled.truncatingRemainder(dividingBy: 2) - 1))
        let rgb: (Double, Double, Double)
        switch scaled {
        case 0..<1: rgb = (chroma, x, 0)
        case 1..<2: rgb = (x, chroma, 0)
        case 2..<3: rgb = (0, chroma, x)
        case 3..<4: rgb = (0, x, chroma)
        case 4..<5: rgb = (x, 0, chroma)
        default: rgb = (chroma, 0, x)
        }
        let match = l - chroma / 2
        return RGBA(red: rgb.0 + match, green: rgb.1 + match, blue: rgb.2 + match, alpha: alpha)
    }
}

/// The month view uses the same course hue, with a visible accent for its dots.
enum NativeScheduleThemeColor {
    static func accent(for name: String, palette: String, scheme: ColorScheme) -> Color {
        let tone = NativeSchedulePalette.tone(name: name, palette: palette, dark: scheme == .dark)
        return scheme == .dark ? tone.border.color : tone.text.color
    }
    static func primary(_ scheme: ColorScheme) -> Color {
        NativeSchedulePalette.RGBA(scheme == .dark ? 0xeef8f5 : 0x172033).color
    }
    static func secondary(_ scheme: ColorScheme) -> Color {
        NativeSchedulePalette.RGBA(scheme == .dark ? 0xabc5be : 0x667085).color
    }
    static func cellBorder(_ scheme: ColorScheme) -> Color {
        NativeSchedulePalette.RGBA(scheme == .dark ? 0xa3bab3 : 0xdae3ef,
                                   alpha: scheme == .dark ? 0.20 : 0.82).color
    }
}
