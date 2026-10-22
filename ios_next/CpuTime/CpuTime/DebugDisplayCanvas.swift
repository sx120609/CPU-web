#if DEBUG
import SwiftUI
import UIKit

/// Lays the app out in a window of a chosen size on a larger simulator, so the
/// iPhone Duo's displays can be checked without its simulator runtime.
///
/// `CPU_DEBUG_CANVAS=466x678+84/CR` is the closed display: 466×678 points with
/// an 84-point trailing strip standing in for the status column, compact width
/// and regular height. `951x669/RR` is the open display. Several canvases
/// separated by commas take turns every `CPU_DEBUG_CANVAS_INTERVAL` seconds
/// (default 5), which is the resize that folding and unfolding cause. Run it on
/// the largest iPad simulator so every canvas fits on screen.
///
/// The strip and the size classes are set on a UIKit hosting controller rather
/// than through SwiftUI modifiers: the tab bar and its pages are UIKit view
/// controllers, which only see `additionalSafeAreaInsets` and trait overrides.
@available(iOS 17.0, *)
struct DebugDisplayCanvas<Content: View>: View {
    struct Canvas: Equatable {
        var size: CGSize
        var trailingStrip: CGFloat
        var horizontal: UIUserInterfaceSizeClass
        var vertical: UIUserInterfaceSizeClass
    }

    static var canvases: [Canvas] {
        let raw = ProcessInfo.processInfo.environment["CPU_DEBUG_CANVAS"] ?? ""
        return raw.split(separator: ",").compactMap { parse(String($0)) }
    }

    let canvases: [Canvas]
    @ViewBuilder let content: () -> Content
    @State private var index = 0

    var body: some View {
        let canvas = canvases[index % canvases.count]
        ZStack {
            Color(white: 0.45).ignoresSafeArea()
            DebugCanvasHost(canvas: canvas, content: content())
                .frame(width: canvas.size.width, height: canvas.size.height)
                .overlay(alignment: .trailing) {
                    if canvas.trailingStrip > 0 {
                        Color.black.frame(width: canvas.trailingStrip).allowsHitTesting(false)
                    }
                }
                .clipped()
        }
        .ignoresSafeArea()
        .task {
            guard canvases.count > 1 else { return }
            let interval = Double(ProcessInfo.processInfo.environment["CPU_DEBUG_CANVAS_INTERVAL"] ?? "") ?? 5
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(interval))
                index += 1
                NSLog("CPUDEBUG canvas %@", Self.describe(canvases[index % canvases.count]))
            }
        }
    }

    private static func parse(_ text: String) -> Canvas? {
        var rest = Substring(text.trimmingCharacters(in: .whitespaces))
        var classes: Substring = ""
        if let slash = rest.firstIndex(of: "/") {
            classes = rest[rest.index(after: slash)...]
            rest = rest[..<slash]
        }
        var strip: CGFloat = 0
        if let plus = rest.firstIndex(of: "+") {
            strip = CGFloat(Double(rest[rest.index(after: plus)...]) ?? 0)
            rest = rest[..<plus]
        }
        let parts = rest.split(separator: "x").compactMap { Double($0) }
        guard parts.count == 2, parts[0] > 0, parts[1] > 0 else { return nil }
        func sizeClass(_ letter: Character?) -> UIUserInterfaceSizeClass {
            switch letter {
            case "C", "c": return .compact
            case "R", "r": return .regular
            default: return .unspecified
            }
        }
        return Canvas(
            size: CGSize(width: parts[0], height: parts[1]),
            trailingStrip: strip,
            horizontal: sizeClass(classes.first),
            vertical: sizeClass(classes.dropFirst().first)
        )
    }

    private static func describe(_ canvas: Canvas) -> String {
        "\(Int(canvas.size.width))x\(Int(canvas.size.height))+\(Int(canvas.trailingStrip))"
    }
}

@available(iOS 17.0, *)
private struct DebugCanvasHost<Content: View>: UIViewControllerRepresentable {
    let canvas: DebugDisplayCanvas<Content>.Canvas
    let content: Content

    func makeUIViewController(context: Context) -> UIHostingController<Content> {
        let controller = UIHostingController(rootView: content)
        controller.view.backgroundColor = .clear
        apply(to: controller)
        return controller
    }

    func updateUIViewController(_ controller: UIHostingController<Content>, context: Context) {
        apply(to: controller)
    }

    private func apply(to controller: UIHostingController<Content>) {
        // The canvas sits away from the device's own safe area, so the strip is
        // the only inset the content gets, like the Duo's status column.
        controller.additionalSafeAreaInsets = UIEdgeInsets(top: 0, left: 0, bottom: 0, right: canvas.trailingStrip)
        if canvas.horizontal != .unspecified {
            controller.traitOverrides.horizontalSizeClass = canvas.horizontal
        } else if controller.traitOverrides.contains(UITraitHorizontalSizeClass.self) {
            controller.traitOverrides.remove(UITraitHorizontalSizeClass.self)
        }
        if canvas.vertical != .unspecified {
            controller.traitOverrides.verticalSizeClass = canvas.vertical
        } else if controller.traitOverrides.contains(UITraitVerticalSizeClass.self) {
            controller.traitOverrides.remove(UITraitVerticalSizeClass.self)
        }
    }
}
#endif
