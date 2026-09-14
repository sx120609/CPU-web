import Combine
import Foundation

/// Display-only timetable preferences shared by the native schedule and its
/// device settings page. The Web timetable remains the source of course data;
/// these values only control how the native cards are presented.
final class NativeSchedulePreferences: ObservableObject {
    static let shared = NativeSchedulePreferences()

    @Published var showLocation: Bool { didSet { persist() } }
    @Published var showTeacher: Bool { didSet { persist() } }
    @Published var showPeriod: Bool { didSet { persist() } }
    @Published var showWeeks: Bool { didSet { persist() } }
    @Published var defaultView: String { didSet { persist() } }
    @Published var palette: String { didSet { persist() } }

    private let defaults: UserDefaults
    private var ready = false

    private enum Key {
        static let showLocation = "nativeSchedule.showLocation"
        static let showTeacher = "nativeSchedule.showTeacher"
        static let showPeriod = "nativeSchedule.showPeriod"
        static let showWeeks = "nativeSchedule.showWeeks"
        static let defaultView = "nativeSchedule.defaultView"
        static let palette = "nativeSchedule.palette"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        showLocation = defaults.object(forKey: Key.showLocation) as? Bool ?? true
        showTeacher = defaults.object(forKey: Key.showTeacher) as? Bool ?? true
        showPeriod = defaults.object(forKey: Key.showPeriod) as? Bool ?? true
        showWeeks = defaults.object(forKey: Key.showWeeks) as? Bool ?? true
        defaultView = defaults.string(forKey: Key.defaultView) == "day" ? "day" : "week"
        let savedPalette = defaults.string(forKey: Key.palette) ?? "color-glass"
        palette = Self.paletteOptions.contains(savedPalette) ? savedPalette : "color-glass"
        ready = true
    }

    static let paletteOptions = ["color-glass", "green", "blue", "teal", "indigo", "violet", "orange", "rose", "slate"]

    func reset() {
        showLocation = true
        showTeacher = true
        showPeriod = true
        showWeeks = true
        defaultView = "week"
        palette = "color-glass"
    }

    private func persist() {
        guard ready else { return }
        defaults.set(showLocation, forKey: Key.showLocation)
        defaults.set(showTeacher, forKey: Key.showTeacher)
        defaults.set(showPeriod, forKey: Key.showPeriod)
        defaults.set(showWeeks, forKey: Key.showWeeks)
        defaults.set(defaultView == "day" ? "day" : "week", forKey: Key.defaultView)
        defaults.set(Self.paletteOptions.contains(palette) ? palette : "color-glass", forKey: Key.palette)
    }
}
