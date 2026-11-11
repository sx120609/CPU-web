import SwiftUI
import WidgetKit

/// The look of the schedule widgets, after NapTable's `ScheduleWidgetStyle`.
///
/// It follows the timetable style chosen in the app (`scheduleVisualStyle`,
/// written by `NativeScheduleStyleSettings`) unless 小组件风格 in the widget
/// settings picks one. Classic, minimal and grid share one widget look,
/// `minimal`, which is the look the widgets always had: a grid of cells makes
/// no sense in a widget, and NapTable draws its grid widgets the same way.
/// Table, paper and board bring their own type, colours and decorations.
@available(iOS 17.0, *)
enum WidgetStyle: String, CaseIterable, Sendable {
    case minimal, table, paper, board

    /// The widget look for a stored timetable style (`classic`, `minimal`,
    /// `grid`, `table`, `paper`, `board`); unknown values fall back to minimal.
    init(timetableStyle raw: String?) {
        switch raw {
        case "table": self = .table
        case "paper": self = .paper
        case "board": self = .board
        default: self = .minimal
        }
    }

    /// The look to draw: 小组件风格 when it names one, else the timetable's style.
    static func load(from defaults: UserDefaults?) -> Self {
        let own = defaults?.string(forKey: AppWidgetConfiguration.widgetStyleKey)
        if let own, own != "follow", !own.isEmpty { return Self(timetableStyle: own) }
        return Self(timetableStyle: defaults?.string(forKey: AppWidgetConfiguration.timetableStyleKey))
    }

    var title: String {
        switch self {
        case .minimal: "简约"
        case .table: "表格"
        case .paper: "素笺"
        case .board: "站牌"
        }
    }

    enum Course: Equatable, Sendable { case card, stripe, ink, departure }
    enum Rule: Equatable, Sendable { case none, table, sessions, paper }

    var course: Course {
        switch self {
        case .minimal: .card
        case .table: .stripe
        case .paper: .ink
        case .board: .departure
        }
    }

    /// The hairline under each course on the large widgets.
    var rule: Rule {
        switch self {
        case .minimal: .none
        case .table: .table
        case .paper: .paper
        case .board: .sessions
        }
    }

    var cornerRadius: CGFloat {
        switch self {
        case .minimal: 9
        case .table: 0
        case .paper, .board: 2
        }
    }

    var courseShape: RoundedRectangle { RoundedRectangle(cornerRadius: cornerRadius, style: .continuous) }

    /// The typeface of running text. The board keeps its monospaced face for
    /// times and dates (`timeFont`); set in it, the space between a character
    /// and a digit is a full digit wide and a course name falls apart.
    var fontDesign: Font.Design {
        switch self {
        case .minimal, .table, .board: .default
        case .paper: .serif
        }
    }

    /// A root `fontDesign` cannot replace explicit designs on Text: minimal
    /// keeps every original font, the others apply theirs at the leaf.
    func widgetFont(size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) -> Font {
        .system(size: size, weight: weight, design: self == .minimal ? design : fontDesign)
    }

    /// Times and dates: monospaced on the board.
    func timeFont(size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) -> Font {
        self == .board ? .system(size: size, weight: weight, design: .monospaced) : widgetFont(size: size, weight: weight, design: design)
    }

    /// Paper and board bring their own page colour; the others keep the widget's.
    func canvasColor(dark: Bool) -> Color? {
        switch self {
        case .paper: Self.color(dark ? 0x201E1B : 0xF1ECE2)
        case .board: Self.color(dark ? 0x171A1C : 0xF4F5F4)
        default: nil
        }
    }

    /// Text on paper is ink; the board's tickets share a neutral ink.
    func inkColor(dark: Bool) -> Color? {
        switch self {
        case .paper: Self.color(dark ? 0xEDE6D8 : 0x2A251F)
        case .board: Color(white: dark ? 0.92 : 0.12)
        default: nil
        }
    }

    func styleAccent(dark: Bool, fallback: Color) -> Color {
        switch self {
        case .paper: Self.color(dark ? 0xF39B85 : 0xA63F29)
        case .board: inkColor(dark: dark) ?? fallback
        default: fallback
        }
    }

    /// The pale wash behind a course card, as a share of the course colour.
    func courseFillOpacity(dark: Bool) -> Double {
        switch course {
        case .card: dark ? 0.10 : 0.045
        case .stripe: dark ? 0.10 : 0.06
        case .ink: 0
        case .departure: dark ? 0.10 : 0.06
        }
    }

    private static func color(_ hex: UInt32) -> Color {
        Color(.sRGB, red: Double((hex >> 16) & 255) / 255,
              green: Double((hex >> 8) & 255) / 255,
              blue: Double(hex & 255) / 255, opacity: 1)
    }
}

@available(iOS 17.0, *)
private struct ScheduleWidgetStyleKey: EnvironmentKey {
    static let defaultValue = WidgetStyle.minimal
}

@available(iOS 17.0, *)
extension EnvironmentValues {
    var scheduleWidgetStyle: WidgetStyle {
        get { self[ScheduleWidgetStyleKey.self] }
        set { self[ScheduleWidgetStyleKey.self] = newValue }
    }
}

/// Colours that follow the style and leave accented and vibrant rendering to
/// WidgetKit. In particular, never paint dark paper ink into a tinted widget,
/// or onto StandBy's black when the system drops the paper.
@available(iOS 17.0, *)
@propertyWrapper
struct WidgetStyleColors: DynamicProperty {
    @Environment(\.scheduleWidgetStyle) private var style
    @Environment(\.colorScheme) private var scheme
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.showsWidgetContainerBackground) private var showsBackground
    var wrappedValue: Self { self }

    private var fullColor: Bool { renderingMode == .fullColor }
    private var styled: Bool { style != .minimal && fullColor && showsBackground }
    private var dark: Bool { scheme == .dark }

    var primary: Color { styled ? (style.inkColor(dark: dark) ?? WidgetPalette.primary) : WidgetPalette.primary }
    var secondary: Color { styled && style.inkColor(dark: dark) != nil ? primary.opacity(0.72) : WidgetPalette.secondary }
    var muted: Color { styled && style.inkColor(dark: dark) != nil ? primary.opacity(0.6) : WidgetPalette.muted }

    func accent(for theme: ScheduleWidgetTheme) -> Color {
        let base = WidgetPalette.accent(for: theme, dark: dark)
        guard style != .minimal else { return base }
        guard fullColor else { return .primary }
        return style.styleAccent(dark: dark, fallback: base)
    }

    /// A solid accent fill and the text on it. Paper and board put their page
    /// colour on the accent, so the text holds in dark mode where their accent
    /// turns light; the others keep white on the theme colour.
    func solidAccent(for theme: ScheduleWidgetTheme) -> (fill: Color, text: Color) {
        guard fullColor else { return (accent(for: theme), .white) }
        if styled, let canvas = style.canvasColor(dark: dark) { return (accent(for: theme), canvas) }
        // The light-mode tier: the lifted dark-mode accent is too pale under white text.
        return (WidgetPalette.accent(for: theme, dark: false), .white)
    }

    func accent(for course: ScheduleCourse, theme: ScheduleWidgetTheme, colorScheme: ColorScheme) -> Color {
        guard style == .minimal || fullColor else { return .primary }
        return WidgetPalette.accent(for: course, theme: theme, dark: colorScheme == .dark)
    }

    func tint(for course: ScheduleCourse, colorScheme: ColorScheme, theme: ScheduleWidgetTheme) -> Color {
        WidgetPalette.tint(for: course, colorScheme: colorScheme, theme: theme)
    }

    /// The fill behind a course card: minimal keeps its pale course tint, the
    /// others a faint wash of the course colour. Accented and vibrant modes
    /// remap opaque colours to solid white, so they get a translucent white.
    func cardFill(for course: ScheduleCourse, theme: ScheduleWidgetTheme) -> Color {
        guard fullColor else { return Color.white.opacity(0.14) }
        if style == .minimal { return tint(for: course, colorScheme: scheme, theme: theme) }
        return accent(for: course, theme: theme, colorScheme: scheme).opacity(style.courseFillOpacity(dark: dark))
    }
}

/// Decorations never take layout space, so small widgets keep their content
/// budget. Only the large widgets draw them.
@available(iOS 17.0, *)
struct WidgetCourseRule: View {
    @Environment(\.scheduleWidgetStyle) private var style
    @Environment(\.scheduleWidgetFamily) private var family
    let color: Color

    var body: some View {
        if family == .systemLarge {
            switch style.rule {
            case .none:
                EmptyView()
            case .table:
                VStack { Spacer(minLength: 0); Rectangle().fill(color.opacity(0.3)).frame(height: 0.5) }
            case .sessions:
                VStack { Spacer(minLength: 0); Rectangle().fill(color.opacity(0.25)).frame(height: 0.5) }
            case .paper:
                VStack { Spacer(minLength: 0); Rectangle().fill(color.opacity(0.3)).frame(height: 0.5) }
            }
        }
    }
}

/// The widget palette: the nine themes of 颜色主题 and the colour-glass course
/// colours. Dark mode lifts the accents a step so text in them stays readable
/// on the dark canvas.
enum WidgetPalette {
    static let primary = Color.primary
    static let secondary = Color.secondary
    static let muted = Color.secondary.opacity(0.72)

    private static let colorGlassAccents: [(Double, Double, Double)] = [
        (232, 91, 75), (74, 120, 242), (139, 92, 246), (23, 166, 154), (224, 162, 36), (236, 112, 161),
    ]
    private static let colorGlassDarkAccents: [(Double, Double, Double)] = [
        (255, 138, 122), (128, 163, 255), (178, 146, 255), (72, 214, 199), (240, 190, 84), (255, 150, 192),
    ]
    private static let colorGlassTints: [Color] = [
        Color(red: 253 / 255, green: 236 / 255, blue: 233 / 255),
        Color(red: 234 / 255, green: 240 / 255, blue: 1),
        Color(red: 242 / 255, green: 236 / 255, blue: 1),
        Color(red: 229 / 255, green: 248 / 255, blue: 245 / 255),
        Color(red: 1, green: 247 / 255, blue: 224 / 255),
        Color(red: 253 / 255, green: 235 / 255, blue: 244 / 255),
    ]

    static func accent(for theme: ScheduleWidgetTheme, dark: Bool = false) -> Color {
        let rgb: (Double, Double, Double)
        switch theme {
        case .green: rgb = dark ? (52, 196, 172) : (22, 135, 118)
        case .blue: rgb = dark ? (110, 156, 255) : (37, 99, 235)
        case .teal: rgb = dark ? (56, 196, 226) : (8, 145, 178)
        case .indigo: rgb = dark ? (244, 114, 182) : (219, 39, 119)
        case .violet: rgb = dark ? (167, 139, 250) : (124, 58, 237)
        case .orange: rgb = dark ? (251, 146, 60) : (234, 88, 12)
        case .rose: rgb = dark ? (251, 113, 133) : (225, 29, 72)
        case .slate: rgb = dark ? (148, 163, 184) : (71, 85, 105)
        case .colorGlass: rgb = dark ? (52, 196, 172) : (15, 143, 127)
        }
        return Color(red: rgb.0 / 255, green: rgb.1 / 255, blue: rgb.2 / 255)
    }

    static func accent(for course: ScheduleCourse, theme: ScheduleWidgetTheme, dark: Bool = false) -> Color {
        guard theme == .colorGlass else { return accent(for: theme, dark: dark) }
        let rgb = (dark ? colorGlassDarkAccents : colorGlassAccents)[index(for: course.displayName)]
        return Color(red: rgb.0 / 255, green: rgb.1 / 255, blue: rgb.2 / 255)
    }

    /// A course colour for any name: 日程 items share the course palette.
    static func accent(forName name: String, theme: ScheduleWidgetTheme, dark: Bool = false) -> Color {
        guard theme == .colorGlass else { return accent(for: theme, dark: dark) }
        let rgb = (dark ? colorGlassDarkAccents : colorGlassAccents)[index(for: name)]
        return Color(red: rgb.0 / 255, green: rgb.1 / 255, blue: rgb.2 / 255)
    }

    static func background(for colorScheme: ColorScheme) -> Color {
        colorScheme == .dark
            ? Color(red: 14 / 255, green: 20 / 255, blue: 32 / 255)
            : Color(red: 248 / 255, green: 251 / 255, blue: 1)
    }

    static func tint(
        for course: ScheduleCourse,
        colorScheme: ColorScheme,
        theme: ScheduleWidgetTheme
    ) -> Color {
        if colorScheme == .dark { return accent(for: course, theme: theme, dark: true).opacity(0.18) }
        guard theme != .colorGlass else { return colorGlassTints[index(for: course.displayName)] }
        switch theme {
        case .green: return Color(red: 244 / 255, green: 251 / 255, blue: 248 / 255)
        case .blue: return Color(red: 243 / 255, green: 248 / 255, blue: 1)
        case .teal: return Color(red: 240 / 255, green: 251 / 255, blue: 1)
        case .indigo: return Color(red: 1, green: 245 / 255, blue: 250 / 255)
        case .violet: return Color(red: 250 / 255, green: 247 / 255, blue: 1)
        case .orange: return Color(red: 1, green: 247 / 255, blue: 241 / 255)
        case .rose: return Color(red: 1, green: 245 / 255, blue: 247 / 255)
        case .slate: return Color(red: 248 / 255, green: 250 / 255, blue: 252 / 255)
        case .colorGlass: return colorGlassTints[index(for: course.displayName)]
        }
    }

    private static func index(for name: String) -> Int {
        let hash = name.unicodeScalars.reduce(0) { partial, scalar in
            (partial &* 31 &+ Int(scalar.value)) & 0x7fff_ffff
        }
        return hash % colorGlassAccents.count
    }
}

/// The photo set in the app's 小组件背景 (`NativeWidgetBackground`): the dark
/// one in dark appearance when there is one, else the light one.
enum WidgetBackgroundImage {
    private static var cache: [String: (modified: Date, image: UIImage)] = [:]

    static var veil: Double {
        let value = UserDefaults(suiteName: AppWidgetConfiguration.appGroup)?.object(forKey: "widgetBackgroundVeil") as? Double ?? 0.5
        return min(0.85, max(0.15, value))
    }

    static func load(dark: Bool) -> UIImage? {
        if dark, let image = image(named: "widget-background-dark.jpg") { return image }
        return image(named: "widget-background-light.jpg")
    }

    private static func image(named name: String) -> UIImage? {
        guard let url = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: AppWidgetConfiguration.appGroup)?
            .appendingPathComponent(name),
              let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        else { return nil }
        if let cached = cache[name], cached.modified == modified { return cached.image }
        guard let image = UIImage(contentsOfFile: url.path) else { return nil }
        cache[name] = (modified, image)
        return image
    }
}

/// The home-screen background of every widget: the style's page colour (or
/// the widget colour), under the user's photo and a veil of that colour. A
/// removable container background lets the system leave it out for StandBy
/// and the tinted and clear home screens.
@available(iOS 17.0, *)
struct ScheduleWidgetBackground: View {
    let style: WidgetStyle
    /// Off in the gallery, which shows the plain page.
    var showsPhoto = true
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let dark = colorScheme == .dark
        let canvas = style.canvasColor(dark: dark) ?? WidgetPalette.background(for: colorScheme)
        if showsPhoto, let photo = WidgetBackgroundImage.load(dark: dark) {
            ZStack {
                Image(uiImage: photo).resizable().scaledToFill()
                canvas.opacity(WidgetBackgroundImage.veil)
            }
        } else {
            canvas
        }
    }
}
