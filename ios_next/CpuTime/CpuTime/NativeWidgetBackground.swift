import UIKit
import WidgetKit

/// 小组件背景: a photo behind the home-screen widgets, one for light and
/// optionally one for dark appearance, with a veil of the widget's own colour
/// so the text stays readable. Kept in the App Group, small enough for a
/// widget to load, and read by `WidgetBackgroundImage` in the extension.
enum NativeWidgetBackground {
    static let veilKey = "widgetBackgroundVeil"
    static let lightFileName = "widget-background-light.jpg"
    static let darkFileName = "widget-background-dark.jpg"
    /// Widgets have little memory; the longest side is kept to this.
    private static let maximumPixels: CGFloat = 900

    private static var directory: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: NextWidgetConfiguration.appGroup)
    }

    private static func url(dark: Bool) -> URL? {
        directory?.appendingPathComponent(dark ? darkFileName : lightFileName)
    }

    /// How much of the widget's colour lies over the photo, 0.15 to 0.85.
    static var veil: Double {
        get {
            let value = UserDefaults(suiteName: NextWidgetConfiguration.appGroup)?.object(forKey: veilKey) as? Double ?? 0.5
            return min(0.85, max(0.15, value))
        }
        set {
            UserDefaults(suiteName: NextWidgetConfiguration.appGroup)?.set(min(0.85, max(0.15, newValue)), forKey: veilKey)
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    static func image(dark: Bool) -> UIImage? {
        guard let url = url(dark: dark), let data = try? Data(contentsOf: url) else { return nil }
        return UIImage(data: data)
    }

    /// Saves a photo for one appearance, scaled down; nil removes it.
    static func set(_ data: Data?, dark: Bool) throws {
        guard let url = url(dark: dark) else { throw CocoaError(.fileNoSuchFile) }
        if let data {
            guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                  let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceThumbnailMaxPixelSize: maximumPixels,
                  ] as CFDictionary),
                  let jpeg = UIImage(cgImage: image).jpegData(compressionQuality: 0.82) else {
                throw CocoaError(.fileReadCorruptFile)
            }
            try jpeg.write(to: url, options: .atomic)
        } else if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
        WidgetCenter.shared.reloadAllTimelines()
    }
}
