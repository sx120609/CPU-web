import Combine
import Foundation
import UIKit

/// Display-only timetable preferences shared by the native schedule and its
/// device settings page. The Web timetable remains the source of course data;
/// these values only control how the native cards are presented.
final class NativeSchedulePreferences: ObservableObject {
    static let shared = NativeSchedulePreferences()

    @Published var showLocation: Bool { didSet { persist() } }
    @Published var showTeacher: Bool { didSet { persist() } }
    @Published var showPeriod: Bool { didSet { persist() } }
    @Published var showWeeks: Bool { didSet { persist() } }
    @Published var showDateHeader: Bool { didSet { persist() } }
    @Published var defaultView: String { didSet { persist() } }
    @Published var palette: String { didSet { persist() } }
    @Published var density: String { didSet { persist() } }
    @Published var backgroundPath: String { didSet { loadBackgroundImage(); persist() } }
    @Published var backgroundOpacity: Double { didSet { persist() } }
    @Published private(set) var backgroundImage: UIImage?

    private let defaults: UserDefaults
    private var ready = false

    private enum Key {
        static let showLocation = "nativeSchedule.showLocation"
        static let showTeacher = "nativeSchedule.showTeacher"
        static let showPeriod = "nativeSchedule.showPeriod"
        static let showWeeks = "nativeSchedule.showWeeks"
        static let showDateHeader = "nativeSchedule.showDateHeader"
        static let defaultView = "nativeSchedule.defaultView"
        static let palette = "nativeSchedule.palette"
        static let density = "nativeSchedule.density"
        static let backgroundPath = "nativeSchedule.backgroundPath"
        static let backgroundOpacity = "nativeSchedule.backgroundOpacity"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        showLocation = defaults.object(forKey: Key.showLocation) as? Bool ?? true
        showTeacher = defaults.object(forKey: Key.showTeacher) as? Bool ?? true
        showPeriod = defaults.object(forKey: Key.showPeriod) as? Bool ?? true
        showWeeks = defaults.object(forKey: Key.showWeeks) as? Bool ?? true
        showDateHeader = defaults.object(forKey: Key.showDateHeader) as? Bool ?? true
        defaultView = defaults.string(forKey: Key.defaultView) == "day" ? "day" : "week"
        let savedPalette = defaults.string(forKey: Key.palette) ?? "color-glass"
        palette = Self.paletteOptions.contains(savedPalette) ? savedPalette : "color-glass"
        let savedDensity = defaults.string(forKey: Key.density) ?? "comfortable"
        density = savedDensity == "compact" ? "compact" : "comfortable"
        backgroundPath = defaults.string(forKey: Key.backgroundPath) ?? ""
        let opacity = defaults.object(forKey: Key.backgroundOpacity) as? Double ?? 0.18
        backgroundOpacity = min(0.5, max(0.05, opacity))
        backgroundImage = nil
        loadBackgroundImage()
        ready = true
    }

    static let paletteOptions = ["color-glass", "green", "blue", "teal", "indigo", "violet", "orange", "rose", "slate"]
    static let densityOptions = ["comfortable", "compact"]

    static var backgroundFileURL: URL {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("CPUTime", isDirectory: true)
        return directory.appendingPathComponent("schedule-background.jpg")
    }

    func reset() {
        showLocation = true
        showTeacher = true
        showPeriod = true
        showWeeks = true
        showDateHeader = true
        defaultView = "week"
        palette = "color-glass"
        density = "comfortable"
        backgroundPath = ""
        backgroundOpacity = 0.18
        backgroundImage = nil
    }

    func setBackgroundData(_ data: Data?) throws {
        let url = Self.backgroundFileURL
        if let data {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
            backgroundPath = url.path
        } else {
            try? FileManager.default.removeItem(at: url)
            backgroundPath = ""
        }
    }

    private func loadBackgroundImage() {
        guard !backgroundPath.isEmpty else {
            backgroundImage = nil
            return
        }
        backgroundImage = UIImage(contentsOfFile: backgroundPath)
    }

    private func persist() {
        guard ready else { return }
        defaults.set(showLocation, forKey: Key.showLocation)
        defaults.set(showTeacher, forKey: Key.showTeacher)
        defaults.set(showPeriod, forKey: Key.showPeriod)
        defaults.set(showWeeks, forKey: Key.showWeeks)
        defaults.set(showDateHeader, forKey: Key.showDateHeader)
        defaults.set(defaultView == "day" ? "day" : "week", forKey: Key.defaultView)
        defaults.set(Self.paletteOptions.contains(palette) ? palette : "color-glass", forKey: Key.palette)
        defaults.set(Self.densityOptions.contains(density) ? density : "comfortable", forKey: Key.density)
        defaults.set(backgroundPath, forKey: Key.backgroundPath)
        defaults.set(min(0.5, max(0.05, backgroundOpacity)), forKey: Key.backgroundOpacity)
    }
}
