import UIKit

/// The size of the window the app is drawn in. `UIScreen.main` is one fixed
/// screen and deprecated; the iPhone Duo resizes the window when it is folded
/// or unfolded, and side-by-side multitasking makes it narrower than the screen.
@MainActor
enum WindowGeometry {
    static var size: CGSize {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first else {
            return CGSize(width: 390, height: 844)
        }
        if #available(iOS 26.0, *) {
            return scene.effectiveGeometry.coordinateSpace.bounds.size
        }
        return scene.coordinateSpace.bounds.size
    }
}

/// The largest text size the native screens use. The timetable is a dense grid
/// and its sheets are laid out around it, so text follows the system setting
/// up to the largest standard size (xxxLarge) and stops there: at the
/// accessibility sizes the layout would come apart. Set on the windows, so it
/// also reaches every sheet presented in them; web pages size their own text.
@MainActor
enum NativeTextSizeLimit {
    static let largest = UIContentSizeCategory.extraExtraExtraLarge
    private static var observer: NSObjectProtocol?

    static func install() {
        apply()
        guard observer == nil else { return }
        observer = NotificationCenter.default.addObserver(
            forName: UIContentSizeCategory.didChangeNotification, object: nil, queue: .main
        ) { _ in
            MainActor.assumeIsolated { apply() }
        }
    }

    static func apply() {
        guard #available(iOS 17.0, *) else { return }
        // The application's category is the system setting, before any override.
        let system = UIApplication.shared.preferredContentSizeCategory
        let limited: UIContentSizeCategory = system > largest ? largest : system
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            for window in scene.windows {
                window.traitOverrides.preferredContentSizeCategory = limited
            }
        }
    }
}
