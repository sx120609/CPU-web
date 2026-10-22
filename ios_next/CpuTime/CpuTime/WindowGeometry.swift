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
