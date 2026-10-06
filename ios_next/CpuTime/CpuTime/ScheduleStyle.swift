import Combine
import Foundation

/// The timetable's visual style. It is independent of the course palette and
/// of the light/dark appearance: switching it never touches course data, the
/// selected week or editing rights.
///
/// `classic` is the appearance this client shipped with and stays the default,
/// so an upgrade changes nothing until the user picks another style. The other
/// five come from NapTable. Persisted as stable English identifiers; a missing
/// or unknown value falls back to `classic`.
nonisolated enum ScheduleStyle: String, CaseIterable, Codable, Identifiable, Sendable {
    case classic, minimal, grid, table, paper, board

    var id: String { rawValue }
    static let storageKey = "scheduleVisualStyle"

    static func load(from defaults: UserDefaults?) -> Self {
        defaults?.string(forKey: storageKey).flatMap(Self.init(rawValue:)) ?? .classic
    }

    var title: String {
        switch self {
        case .classic: "经典"
        case .minimal: "简约"
        case .grid: "格子"
        case .table: "表格"
        case .paper: "素笺"
        case .board: "站牌"
        }
    }

    var subtitle: String {
        switch self {
        case .classic: "玻璃格子与彩色卡片，沿用原来的样子"
        case .minimal: "淡彩卡片，轻松查课"
        case .grid: "独立方格，空闲一目了然"
        case .table: "整齐行列，集中呈现课程"
        case .paper: "纸墨色调，安静阅读"
        case .board: "时间优先，关注下一节"
        }
    }

    var layout: ScheduleStyleLayout {
        switch self {
        case .classic: .init(grid: .cells, course: .card, cornerRadius: 9, borderWidth: 1.5, centered: true, font: .standard)
        case .minimal: .init(grid: .rows, course: .card, cornerRadius: 9, borderWidth: 0, centered: false, font: .rounded)
        case .grid: .init(grid: .cells, course: .card, cornerRadius: 8, borderWidth: 1.5, centered: true, font: .rounded)
        case .table: .init(grid: .table, course: .stripe, cornerRadius: 0, borderWidth: 0, centered: false, font: .standard)
        case .paper: .init(grid: .rows, course: .ink, cornerRadius: 2, borderWidth: 0, centered: false, font: .serif)
        case .board: .init(grid: .sessions, course: .departure, cornerRadius: 2, borderWidth: 0, centered: false, font: .monospaced)
        }
    }

    /// Only minimal and grid keep a gap between day columns; the ruled styles
    /// need their columns to touch so the lines run through.
    var columnGap: Double { self == .minimal || self == .grid ? 4 : 0 }

    /// Whether the week and day panel is outlined. The table draws its own
    /// frame with its rules, and the board is divided by rules alone.
    var framesPanel: Bool { self != .table && self != .board }
}

nonisolated struct ScheduleStyleLayout: Equatable, Sendable {
    enum Grid: Equatable, Sendable { case rows, cells, table, sessions }
    enum Course: Equatable, Sendable { case card, stripe, ink, departure }
    enum Typography: Equatable, Sendable { case standard, rounded, serif, monospaced }
    let grid: Grid
    let course: Course
    let cornerRadius: Double
    let borderWidth: Double
    let centered: Bool
    let font: Typography
}

/// The selected style, kept in the App Group so the widget extension can read
/// the same value.
@MainActor
final class NativeScheduleStyleSettings: ObservableObject {
    static let shared = NativeScheduleStyleSettings()

    @Published private(set) var style: ScheduleStyle

    private let defaults: UserDefaults?

    init(defaults: UserDefaults? = UserDefaults(suiteName: AppGroupIdentifier.resolved())) {
        self.defaults = defaults
        style = ScheduleStyle.load(from: defaults)
#if DEBUG
        // `CPU_DEBUG_SCHEDULE_STYLE=paper` shows a style for one launch without saving it.
        if let override = ProcessInfo.processInfo.environment["CPU_DEBUG_SCHEDULE_STYLE"]
            .flatMap(ScheduleStyle.init(rawValue:)) {
            style = override
        }
#endif
    }

    func setStyle(_ value: ScheduleStyle) {
        guard style != value else { return }
        style = value
        defaults?.set(value.rawValue, forKey: ScheduleStyle.storageKey)
    }
}
