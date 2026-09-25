import Combine
import Foundation
import ImageIO
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
    @Published var showWeekend: Bool { didSet { persist() } }
    @Published var showDateHeader: Bool { didSet { persist() } }
    @Published var defaultView: String { didSet { persist() } }
    @Published var palette: String { didSet { persist() } }
    @Published var density: String { didSet { persist() } }
    @Published private(set) var backgroundPath: String
    @Published var backgroundVisibility: Double { didSet { persist() } }
    @Published var backgroundBlur: Double { didSet { persist() } }
    @Published private(set) var backgroundImage: UIImage?

    private let defaults: UserDefaults
    private let imageURL: URL
    private var ready = false

    private enum Key {
        static let showLocation = "nativeSchedule.showLocation"
        static let showTeacher = "nativeSchedule.showTeacher"
        static let showPeriod = "nativeSchedule.showPeriod"
        static let showWeeks = "nativeSchedule.showWeeks"
        static let showWeekend = "nativeSchedule.showWeekend"
        static let showDateHeader = "nativeSchedule.showDateHeader"
        static let defaultView = "nativeSchedule.defaultView"
        static let palette = "nativeSchedule.palette"
        static let density = "nativeSchedule.density"
        static let backgroundPath = "nativeSchedule.backgroundPath"
        static let backgroundVisibility = "nativeSchedule.backgroundVisibility"
        static let backgroundBlur = "nativeSchedule.backgroundBlur"
    }

    init(defaults: UserDefaults = .standard, imageURL: URL = NativeSchedulePreferences.backgroundFileURL) {
        self.defaults = defaults
        self.imageURL = imageURL
        showLocation = defaults.object(forKey: Key.showLocation) as? Bool ?? true
        showTeacher = defaults.object(forKey: Key.showTeacher) as? Bool ?? true
        showPeriod = defaults.object(forKey: Key.showPeriod) as? Bool ?? true
        showWeeks = defaults.object(forKey: Key.showWeeks) as? Bool ?? true
        showWeekend = defaults.object(forKey: Key.showWeekend) as? Bool ?? true
        showDateHeader = defaults.object(forKey: Key.showDateHeader) as? Bool ?? true
        let savedView = defaults.string(forKey: Key.defaultView) ?? "week"
        defaultView = Self.viewOptions.contains(savedView) ? savedView : "week"
        let savedPalette = defaults.string(forKey: Key.palette) ?? "color-glass"
        palette = Self.paletteOptions.contains(savedPalette) ? savedPalette : "color-glass"
        let savedDensity = defaults.string(forKey: Key.density) ?? "comfortable"
        density = savedDensity == "compact" ? "compact" : "comfortable"
        backgroundPath = defaults.string(forKey: Key.backgroundPath) ?? ""
        // The previous image-opacity value was multiplied by an opaque page
        // surface. Start existing photos at Web's default when migrating.
        backgroundVisibility = Self.normalizedVisibility(defaults.object(forKey: Key.backgroundVisibility) as? Double ?? 0.76)
        backgroundBlur = Self.normalizedBlur(defaults.object(forKey: Key.backgroundBlur) as? Double ?? 0)
        backgroundImage = nil
        loadBackgroundImage()
        ready = true
        persist()
    }

    static let paletteOptions = ["color-glass", "green", "blue", "teal", "indigo", "violet", "orange", "rose", "slate"]
    static let viewOptions = ["week", "day", "month"]
    static let densityOptions = ["comfortable", "compact"]

    func visibleDays(adjustedDays: Set<Int>) -> [Int] {
        (1...7).filter { showWeekend || $0 <= 5 || adjustedDays.contains($0) }
    }

    static var backgroundFileURL: URL {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("CPUTime", isDirectory: true)
        return directory.appendingPathComponent("schedule-background.jpg")
    }

    static func normalizedVisibility(_ value: Double) -> Double {
        value.isFinite ? min(0.88, max(0.22, value)) : 0.76
    }

    static func normalizedBlur(_ value: Double) -> Double {
        value.isFinite ? min(18, max(0, value.rounded())) : 0
    }

    func reset() throws {
        try setBackgroundData(nil)
        showLocation = true
        showTeacher = true
        showPeriod = true
        showWeeks = true
        showWeekend = true
        showDateHeader = true
        defaultView = "week"
        palette = "color-glass"
        density = "comfortable"
    }

    func setBackgroundData(_ data: Data?) throws {
        if let data {
            guard let image = Self.previewImage(data: data) else { throw BackgroundError.invalidData }
            try FileManager.default.createDirectory(at: imageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            // Keep the original asset; downsample only the in-memory rendering
            // so a large photo cannot allocate its full-resolution bitmap.
            try data.write(to: imageURL, options: .atomic)
            var excludedURL = imageURL
            var resourceValues = URLResourceValues()
            resourceValues.isExcludedFromBackup = true
            try? excludedURL.setResourceValues(resourceValues)
            backgroundImage = image
            backgroundPath = imageURL.lastPathComponent
        } else {
            if FileManager.default.fileExists(atPath: imageURL.path) {
                try FileManager.default.removeItem(at: imageURL)
            }
            backgroundPath = ""
            backgroundImage = nil
            backgroundVisibility = 0.76
            backgroundBlur = 0
        }
        persist()
    }

    private func loadBackgroundImage() {
        guard !backgroundPath.isEmpty else {
            backgroundImage = nil
            return
        }
        // App container paths change after an update/restore. The asset always
        // lives in Application Support; an old absolute preference is a marker.
        if let data = try? Data(contentsOf: imageURL) {
            backgroundImage = Self.previewImage(data: data)
        } else {
            backgroundImage = nil
        }
        backgroundPath = backgroundImage == nil ? "" : imageURL.lastPathComponent
    }

    private static func previewImage(data: Data) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: 2560,
              ] as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }

    private func persist() {
        guard ready else { return }
        defaults.set(showLocation, forKey: Key.showLocation)
        defaults.set(showTeacher, forKey: Key.showTeacher)
        defaults.set(showPeriod, forKey: Key.showPeriod)
        defaults.set(showWeeks, forKey: Key.showWeeks)
        defaults.set(showWeekend, forKey: Key.showWeekend)
        defaults.set(showDateHeader, forKey: Key.showDateHeader)
        defaults.set(Self.viewOptions.contains(defaultView) ? defaultView : "week", forKey: Key.defaultView)
        defaults.set(Self.paletteOptions.contains(palette) ? palette : "color-glass", forKey: Key.palette)
        defaults.set(Self.densityOptions.contains(density) ? density : "comfortable", forKey: Key.density)
        defaults.set(backgroundPath, forKey: Key.backgroundPath)
        defaults.set(Self.normalizedVisibility(backgroundVisibility), forKey: Key.backgroundVisibility)
        defaults.set(Self.normalizedBlur(backgroundBlur), forKey: Key.backgroundBlur)
    }

    private enum BackgroundError: Error { case invalidData }
}
