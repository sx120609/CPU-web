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
    /// Saturday and Sunday columns. A hidden day still shows when it has a
    /// class or is a make-up day. Both start from the old single switch.
    @Published var showSaturday: Bool { didSet { persist() } }
    @Published var showSunday: Bool { didSet { persist() } }
    /// The week view runs Sunday to Saturday: its first column is the Sunday
    /// before that Monday, which belongs to the previous teaching week.
    @Published var sundayFirst: Bool { didSet { persist() } }
    /// The week view while the partner's or a shared timetable is laid over the user's:
    /// "split" (并排, each day in two columns, the default) or "merged" (合并, both
    /// people's courses in the one week grid). Kept on the device.
    @Published var coupleWeekLayout: String { didSet { persist() } }
    var mergesCoupleWeek: Bool { coupleWeekLayout == "merged" }
    static func normalizedCoupleWeekLayout(_ value: String?) -> String { value == "merged" ? "merged" : "split" }
    /// Week-view row height in percent of the standard row.
    @Published var rowHeight: Double { didSet { persist() } }
    /// "small", "standard" or "large": the text of the week view's cards.
    @Published var textSize: String { didSet { persist() } }
    /// The teacher's name on week-view cards, under the classroom.
    @Published var showTeacherInWeek: Bool { didSet { persist() } }
    /// Courses that do not run this week, faded in the periods this week leaves free.
    @Published var showOffWeek: Bool { didSet { persist() } }
    /// Start and end times on the week view's period axis.
    @Published var showSlotTime: Bool { didSet { persist() } }
    /// The back-to-this-week button in the header.
    @Published var showBackToWeek: Bool { didSet { persist() } }
    @Published var showDateHeader: Bool { didSet { persist() } }
    /// Marks the current time on today's column and the in-class / next-up
    /// states of the day view.
    @Published var showNowIndicator: Bool { didSet { persist() } }
    @Published var defaultView: String { didSet { persist() } }
    @Published var palette: String { didSet { persist() } }
    @Published var density: String { didSet { persist() } }
    @Published private(set) var backgroundPath: String
    @Published var backgroundVisibility: Double { didSet { persist() } }
    @Published var backgroundBlur: Double { didSet { persist() } }
    /// The background in light appearance, cropped as chosen.
    @Published private(set) var backgroundImage: UIImage?
    /// The background in dark appearance; nil uses the light one.
    @Published private(set) var darkBackgroundImage: UIImage?
    /// The part of each image shown, as fractions of its width and height;
    /// nil shows the whole image filled to the screen.
    @Published private(set) var backgroundCrop: CGRect?
    @Published private(set) var darkBackgroundCrop: CGRect?

    private let defaults: UserDefaults
    private let imageURL: URL
    private var ready = false

    private enum Key {
        static let showLocation = "nativeSchedule.showLocation"
        static let showTeacher = "nativeSchedule.showTeacher"
        static let showPeriod = "nativeSchedule.showPeriod"
        static let showWeeks = "nativeSchedule.showWeeks"
        static let showWeekend = "nativeSchedule.showWeekend"
        static let showSaturday = "nativeSchedule.showSaturday"
        static let showSunday = "nativeSchedule.showSunday"
        static let sundayFirst = "nativeSchedule.sundayFirst"
        static let coupleWeekLayout = "nativeSchedule.coupleWeekLayout"
        static let rowHeight = "nativeSchedule.rowHeight"
        static let textSize = "nativeSchedule.textSize"
        static let showTeacherInWeek = "nativeSchedule.showTeacherInWeek"
        static let showOffWeek = "nativeSchedule.showOffWeek"
        static let showSlotTime = "nativeSchedule.showSlotTime"
        static let showBackToWeek = "nativeSchedule.showBackToWeek"
        static let showDateHeader = "nativeSchedule.showDateHeader"
        static let showNowIndicator = "nativeSchedule.showNowIndicator"
        static let defaultView = "nativeSchedule.defaultView"
        static let palette = "nativeSchedule.palette"
        static let density = "nativeSchedule.density"
        static let backgroundPath = "nativeSchedule.backgroundPath"
        static let backgroundVisibility = "nativeSchedule.backgroundVisibility"
        static let backgroundBlur = "nativeSchedule.backgroundBlur"
        static let darkBackgroundPath = "nativeSchedule.darkBackgroundPath"
        static let backgroundCrop = "nativeSchedule.backgroundCrop"
        static let darkBackgroundCrop = "nativeSchedule.darkBackgroundCrop"
    }

    init(defaults: UserDefaults = .standard, imageURL: URL = NativeSchedulePreferences.backgroundFileURL) {
        self.defaults = defaults
        self.imageURL = imageURL
        showLocation = defaults.object(forKey: Key.showLocation) as? Bool ?? true
        showTeacher = defaults.object(forKey: Key.showTeacher) as? Bool ?? true
        showPeriod = defaults.object(forKey: Key.showPeriod) as? Bool ?? true
        showWeeks = defaults.object(forKey: Key.showWeeks) as? Bool ?? true
        let weekend = defaults.object(forKey: Key.showWeekend) as? Bool ?? true
        showSaturday = defaults.object(forKey: Key.showSaturday) as? Bool ?? weekend
        showSunday = defaults.object(forKey: Key.showSunday) as? Bool ?? weekend
        sundayFirst = defaults.object(forKey: Key.sundayFirst) as? Bool ?? false
        coupleWeekLayout = Self.normalizedCoupleWeekLayout(defaults.string(forKey: Key.coupleWeekLayout))
        rowHeight = Self.normalizedRowHeight(defaults.object(forKey: Key.rowHeight) as? Double ?? 100)
        textSize = Self.normalizedTextSize(defaults.string(forKey: Key.textSize))
        showTeacherInWeek = defaults.object(forKey: Key.showTeacherInWeek) as? Bool ?? false
        showOffWeek = defaults.object(forKey: Key.showOffWeek) as? Bool ?? false
        showSlotTime = defaults.object(forKey: Key.showSlotTime) as? Bool ?? true
        showBackToWeek = defaults.object(forKey: Key.showBackToWeek) as? Bool ?? true
        showDateHeader = defaults.object(forKey: Key.showDateHeader) as? Bool ?? true
        showNowIndicator = defaults.object(forKey: Key.showNowIndicator) as? Bool ?? true
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
        backgroundCrop = Self.crop(defaults.string(forKey: Key.backgroundCrop))
        darkBackgroundCrop = Self.crop(defaults.string(forKey: Key.darkBackgroundCrop))
        loadBackgroundImage()
        loadDarkBackgroundImage()
        ready = true
        persist()
    }

    /// The background for an appearance: the dark one in dark mode when there is one.
    func backgroundImage(dark: Bool) -> UIImage? {
        dark ? (darkBackgroundImage ?? backgroundImage) : backgroundImage
    }

    var hasBackground: Bool { backgroundImage != nil || darkBackgroundImage != nil }

    static var darkBackgroundFileURL: URL {
        backgroundFileURL.deletingLastPathComponent().appendingPathComponent("schedule-background-dark.jpg")
    }

    private var darkImageURL: URL {
        imageURL.deletingLastPathComponent().appendingPathComponent("schedule-background-dark.jpg")
    }

    /// The whole image as chosen, for the crop editor.
    func originalBackground(dark: Bool) -> UIImage? {
        guard let data = try? Data(contentsOf: dark ? darkImageURL : imageURL) else { return nil }
        return Self.previewImage(data: data, crop: nil)
    }

    /// Sets the dark-appearance image; nil goes back to the light one.
    func setDarkBackgroundData(_ data: Data?) throws {
        if let data {
            guard Self.previewImage(data: data, crop: nil) != nil else { throw BackgroundError.invalidData }
            try FileManager.default.createDirectory(at: darkImageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: darkImageURL, options: .atomic)
            var excludedURL = darkImageURL
            var resourceValues = URLResourceValues()
            resourceValues.isExcludedFromBackup = true
            try? excludedURL.setResourceValues(resourceValues)
        } else if FileManager.default.fileExists(atPath: darkImageURL.path) {
            try FileManager.default.removeItem(at: darkImageURL)
        }
        darkBackgroundCrop = nil
        loadDarkBackgroundImage()
        persist()
    }

    /// The part of an image to show; nil for all of it.
    func setBackgroundCrop(_ crop: CGRect?, dark: Bool) {
        let value = crop.flatMap(Self.normalizedCrop)
        if dark {
            darkBackgroundCrop = value
            loadDarkBackgroundImage()
        } else {
            backgroundCrop = value
            loadBackgroundImage()
        }
        persist()
    }

    private func loadDarkBackgroundImage() {
        darkBackgroundImage = (try? Data(contentsOf: darkImageURL)).flatMap { Self.previewImage(data: $0, crop: darkBackgroundCrop) }
    }

    static func normalizedCrop(_ rect: CGRect) -> CGRect? {
        let clipped = rect.standardized.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        guard !clipped.isNull, clipped.width > 0.02, clipped.height > 0.02 else { return nil }
        return clipped.width > 0.995 && clipped.height > 0.995 ? nil : clipped
    }

    private static func crop(_ text: String?) -> CGRect? {
        let parts = (text ?? "").split(separator: ",").compactMap { Double($0) }
        guard parts.count == 4 else { return nil }
        return normalizedCrop(CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3]))
    }

    private static func cropText(_ rect: CGRect?) -> String {
        guard let rect else { return "" }
        return [rect.minX, rect.minY, rect.width, rect.height].map { String(format: "%.5f", $0) }.joined(separator: ",")
    }

    static let paletteOptions = ["color-glass", "green", "blue", "teal", "indigo", "violet", "orange", "rose", "slate"]
    static let viewOptions = ["week", "day", "month"]
    static let densityOptions = ["comfortable", "compact"]

    static let textSizeOptions = ["small", "standard", "large"]
    static let rowHeightRange: ClosedRange<Double> = 70...180
    static let rowHeightStep: Double = 5

    /// Both weekend days at once, as the single switch used to work.
    var showWeekend: Bool {
        get { showSaturday && showSunday }
        set {
            showSaturday = newValue
            showSunday = newValue
        }
    }

    /// Monday-first days, for the day view's strip and pager.
    func visibleDays(adjustedDays: Set<Int>) -> [Int] {
        (1...7).filter { $0 <= 5 || ($0 == 6 ? showSaturday : showSunday) || adjustedDays.contains($0) }
    }

    /// The week view's columns, left to right. `adjustedDays` are the weekend
    /// days that must stay because they carry a class or a make-up day.
    func weekColumns(adjustedDays: Set<Int>) -> [Int] {
        var days = Array(1...5)
        if showSaturday || adjustedDays.contains(6) { days.append(6) }
        if showSunday || adjustedDays.contains(7) {
            if sundayFirst { days.insert(7, at: 0) } else { days.append(7) }
        }
        return days
    }

    /// Compact density tightens the card text a little more.
    var weekTextScale: Double {
        let base: Double = textSize == "small" ? 0.88 : (textSize == "large" ? 1.16 : 1)
        return base * (density == "compact" ? 0.92 : 1)
    }

    static func normalizedRowHeight(_ value: Double) -> Double {
        guard value.isFinite else { return 100 }
        let stepped = (value / rowHeightStep).rounded() * rowHeightStep
        return min(rowHeightRange.upperBound, max(rowHeightRange.lowerBound, stepped))
    }

    static func normalizedTextSize(_ value: String?) -> String {
        guard let value, textSizeOptions.contains(value) else { return "standard" }
        return value
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
        try setDarkBackgroundData(nil)
        showLocation = true
        showTeacher = true
        showPeriod = true
        showWeeks = true
        showSaturday = true
        showSunday = true
        sundayFirst = false
        coupleWeekLayout = "split"
        rowHeight = 100
        textSize = "standard"
        showTeacherInWeek = false
        showOffWeek = false
        showSlotTime = true
        showBackToWeek = true
        showDateHeader = true
        showNowIndicator = true
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
            backgroundCrop = nil
            backgroundImage = image
            backgroundPath = imageURL.lastPathComponent
        } else {
            if FileManager.default.fileExists(atPath: imageURL.path) {
                try FileManager.default.removeItem(at: imageURL)
            }
            backgroundPath = ""
            backgroundImage = nil
            backgroundCrop = nil
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
            backgroundImage = Self.previewImage(data: data, crop: backgroundCrop)
        } else {
            backgroundImage = nil
        }
        backgroundPath = backgroundImage == nil ? "" : imageURL.lastPathComponent
    }

    private static func previewImage(data: Data, crop: CGRect? = nil) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: 2560,
              ] as CFDictionary) else { return nil }
        guard let crop else { return UIImage(cgImage: image) }
        let width = CGFloat(image.width), height = CGFloat(image.height)
        let rect = CGRect(x: crop.minX * width, y: crop.minY * height, width: crop.width * width, height: crop.height * height).integral
        return image.cropping(to: rect).map { UIImage(cgImage: $0) } ?? UIImage(cgImage: image)
    }

    private func persist() {
        guard ready else { return }
        defaults.set(showLocation, forKey: Key.showLocation)
        defaults.set(showTeacher, forKey: Key.showTeacher)
        defaults.set(showPeriod, forKey: Key.showPeriod)
        defaults.set(showWeeks, forKey: Key.showWeeks)
        defaults.set(showWeekend, forKey: Key.showWeekend)
        defaults.set(showSaturday, forKey: Key.showSaturday)
        defaults.set(showSunday, forKey: Key.showSunday)
        defaults.set(sundayFirst, forKey: Key.sundayFirst)
        defaults.set(Self.normalizedCoupleWeekLayout(coupleWeekLayout), forKey: Key.coupleWeekLayout)
        defaults.set(Self.normalizedRowHeight(rowHeight), forKey: Key.rowHeight)
        defaults.set(Self.normalizedTextSize(textSize), forKey: Key.textSize)
        defaults.set(showTeacherInWeek, forKey: Key.showTeacherInWeek)
        defaults.set(showOffWeek, forKey: Key.showOffWeek)
        defaults.set(showSlotTime, forKey: Key.showSlotTime)
        defaults.set(showBackToWeek, forKey: Key.showBackToWeek)
        defaults.set(showDateHeader, forKey: Key.showDateHeader)
        defaults.set(showNowIndicator, forKey: Key.showNowIndicator)
        defaults.set(Self.viewOptions.contains(defaultView) ? defaultView : "week", forKey: Key.defaultView)
        defaults.set(Self.paletteOptions.contains(palette) ? palette : "color-glass", forKey: Key.palette)
        defaults.set(Self.densityOptions.contains(density) ? density : "comfortable", forKey: Key.density)
        defaults.set(backgroundPath, forKey: Key.backgroundPath)
        defaults.set(Self.normalizedVisibility(backgroundVisibility), forKey: Key.backgroundVisibility)
        defaults.set(Self.normalizedBlur(backgroundBlur), forKey: Key.backgroundBlur)
        defaults.set(darkBackgroundImage == nil ? "" : darkImageURL.lastPathComponent, forKey: Key.darkBackgroundPath)
        defaults.set(Self.cropText(backgroundCrop), forKey: Key.backgroundCrop)
        defaults.set(Self.cropText(darkBackgroundCrop), forKey: Key.darkBackgroundCrop)
    }

    private enum BackgroundError: Error { case invalidData }
}
