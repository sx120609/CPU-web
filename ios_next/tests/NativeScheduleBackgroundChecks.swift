import Foundation
import UIKit

/// Run against UIKit in an iOS Simulator, without an account or photo-library
/// permissions. Each check owns its defaults suite and temporary asset folder.
@main
struct NativeScheduleBackgroundChecks {
    static func main() throws {
        let suite = "NativeScheduleBackgroundChecks.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(suite)
        let imageURL = directory.appendingPathComponent("schedule-background.jpg")
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }

        let preferences = NativeSchedulePreferences(defaults: defaults, imageURL: imageURL)
        precondition(preferences.backgroundImage == nil)
        precondition(preferences.backgroundVisibility == 0.76 && preferences.backgroundBlur == 0)

        let portrait = makeImage(size: CGSize(width: 900, height: 1600))
        try preferences.setBackgroundData(portrait)
        precondition(preferences.backgroundImage?.size == CGSize(width: 900, height: 1600))
        let storedPortrait = try Data(contentsOf: imageURL)
        precondition(storedPortrait == portrait, "Store the original image bytes")
        preferences.backgroundVisibility = 0.57
        preferences.backgroundBlur = 8

        let restored = NativeSchedulePreferences(defaults: defaults, imageURL: imageURL)
        precondition(restored.backgroundImage != nil)
        precondition(restored.backgroundVisibility == 0.57 && restored.backgroundBlur == 8)

        // An update may move the app container. The old absolute path must not
        // make a still-present background disappear after installing the update.
        defaults.set("/old-container/Library/Application Support/CPUTime/schedule-background.jpg", forKey: "nativeSchedule.backgroundPath")
        let migrated = NativeSchedulePreferences(defaults: defaults, imageURL: imageURL)
        precondition(migrated.backgroundImage != nil)
        precondition(migrated.backgroundPath == "schedule-background.jpg")

        let landscape = makeImage(size: CGSize(width: 3600, height: 1800))
        try preferences.setBackgroundData(landscape)
        precondition(preferences.backgroundImage?.size == CGSize(width: 2560, height: 1280), "Large photos must be downsampled for display")
        precondition(preferences.backgroundVisibility == 0.57 && preferences.backgroundBlur == 8, "Replacing a photo retains its adjustments")

        do {
            try preferences.setBackgroundData(Data("not an image".utf8))
            preconditionFailure("Invalid images must be rejected")
        } catch {}
        let storedLandscape = try Data(contentsOf: imageURL)
        precondition(storedLandscape == landscape, "Invalid selection must preserve the previous file")
        precondition(preferences.backgroundImage?.size.width == 2560)

        precondition(NativeSchedulePreferences.normalizedVisibility(.nan) == 0.76)
        precondition(NativeSchedulePreferences.normalizedVisibility(0.05) == 0.22)
        precondition(NativeSchedulePreferences.normalizedVisibility(1) == 0.88)
        precondition(NativeSchedulePreferences.normalizedBlur(.infinity) == 0)
        precondition(NativeSchedulePreferences.normalizedBlur(8.6) == 9)
        precondition(NativeSchedulePreferences.normalizedBlur(99) == 18)
        preferences.backgroundVisibility = 5
        preferences.backgroundBlur = -9
        let bounded = NativeSchedulePreferences(defaults: defaults, imageURL: imageURL)
        precondition(bounded.backgroundVisibility == 0.88 && bounded.backgroundBlur == 0)

        try preferences.setBackgroundData(nil)
        precondition(!FileManager.default.fileExists(atPath: imageURL.path))
        precondition(preferences.backgroundImage == nil && preferences.backgroundPath.isEmpty)
        precondition(preferences.backgroundVisibility == 0.76 && preferences.backgroundBlur == 0)
        precondition(NativeSchedulePreferences(defaults: defaults, imageURL: imageURL).backgroundImage == nil)

        try preferences.setBackgroundData(portrait)
        preferences.palette = "rose"
        preferences.showTeacher = false
        try preferences.reset()
        precondition(preferences.palette == "color-glass" && preferences.showTeacher)
        precondition(!FileManager.default.fileExists(atPath: imageURL.path), "Reset must actually remove the photo")

        if CommandLine.arguments.count > 1 {
            let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
            try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
            try portrait.write(to: output.appendingPathComponent("portrait.jpg"))
            try landscape.write(to: output.appendingPathComponent("landscape.jpg"))
            try makeImage(size: CGSize(width: 1200, height: 1200)).write(to: output.appendingPathComponent("square.jpg"))
        }
        print("PASS: background defaults, photo validation/replacement, bounded decoding, persistence, container migration, normalization, clear and reset")
    }

    private static func makeImage(size: CGSize) -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            let colors = [
                UIColor(red: 0.33, green: 0.64, blue: 0.87, alpha: 1).cgColor,
                UIColor(red: 0.91, green: 0.86, blue: 0.64, alpha: 1).cgColor,
                UIColor(red: 0.16, green: 0.42, blue: 0.35, alpha: 1).cgColor,
            ] as CFArray
            let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 0.55, 1])!
            context.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
            UIColor.white.withAlphaComponent(0.72).setFill()
            context.cgContext.fillEllipse(in: CGRect(x: size.width * 0.18, y: size.height * 0.19, width: size.width * 0.22, height: size.width * 0.22))
            for index in 0..<6 {
                let y = size.height * (0.48 + Double(index) * 0.11)
                UIColor(red: 0.1, green: 0.28, blue: 0.26, alpha: 0.12 + Double(index) * 0.07).setFill()
                let path = UIBezierPath()
                path.move(to: CGPoint(x: 0, y: y))
                path.addCurve(to: CGPoint(x: size.width, y: y - size.height * 0.1),
                              controlPoint1: CGPoint(x: size.width * 0.35, y: y - size.height * 0.22),
                              controlPoint2: CGPoint(x: size.width * 0.65, y: y + size.height * 0.12))
                path.addLine(to: CGPoint(x: size.width, y: size.height))
                path.addLine(to: CGPoint(x: 0, y: size.height))
                path.close()
                path.fill()
            }
        }
        return image.jpegData(compressionQuality: 0.9)!
    }
}
