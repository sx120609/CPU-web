import SwiftUI
import UIKit
import WebKit

struct WebViewContainer: UIViewRepresentable {
    @ObservedObject var model: WebViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    func makeUIView(context: Context) -> WebViewHostView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.applicationNameForUserAgent = "CPUWebIOSApp/\(AppConfiguration.versionCode) CPUWebIOSAppVersion/\(AppConfiguration.versionName)"

        let bridge = CPUIOSBridge(
            presenter: context.coordinator,
            historyObserver: context.coordinator
        )
        context.coordinator.bridge = bridge
        configuration.userContentController.add(bridge, name: CPUIOSBridge.handlerName)
        configuration.userContentController.addUserScript(bridge.webLaunchScreenSuppressionScript)
        configuration.userContentController.addUserScript(bridge.bridgeScript)
        configuration.userContentController.addUserScript(bridge.webHistoryObservationScript)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        bridge.webView = webView
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        // Vue Router uses same-document history entries. WebKit can navigate
        // those entries, but it does not consistently keep a usable visual
        // snapshot for the system gesture, so the previous page can be blank.
        // The host view below owns an interactive edge gesture backed by the
        // snapshots captured after each settled route instead.
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 248 / 255, green: 250 / 255, blue: 252 / 255, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.scrollView.bounces = false
        // The web client already handles both safe areas with CSS env() insets.
        // Letting UIKit adjust them again keeps the initial scroll position below
        // the status bar and only reveals the edge-to-edge background while scrolling.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 26.0, *) {
            // iOS 26 adds a scroll-dependent fade/blur at scroll-view edges. The
            // web UI owns these bars, so keep their appearance stable at offset 0.
            webView.scrollView.topEdgeEffect.isHidden = true
            webView.scrollView.bottomEdgeEffect.isHidden = true
        }

#if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
#endif

        let hostView = WebViewHostView(webView: webView)
        context.coordinator.attach(hostView: hostView, webView: webView)

        let initialURL = model.attach(webView)
        webView.load(URLRequest(url: initialURL))
        return hostView
    }

    func updateUIView(_ hostView: WebViewHostView, context: Context) {}

    static func dismantleUIView(_ hostView: WebViewHostView, coordinator: Coordinator) {
        let webView = hostView.webView
        coordinator.detach()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: CPUIOSBridge.handlerName)
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, UIGestureRecognizerDelegate,
        NativePresentationProviding, NativeWebHistoryObserving {
        private static let inAppPaymentHosts: Set<String> = ["pay.kaipay.cn"]
        private let model: WebViewModel
        private var mainFrameLoadFailed = false
        private weak var hostView: WebViewHostView?
        private weak var webView: WKWebView?
        private var edgePanGesture: UIScreenEdgePanGestureRecognizer?
        private var currentHistoryPosition: Int?
        private var interactiveBackSourcePosition: Int?
        private var interactiveBackFallback: DispatchWorkItem?
        private var customHistoryGestureEnabled = true
        private var captureGeneration = 0
        private let historySnapshots = NSCache<NSNumber, UIImage>()
        var bridge: CPUIOSBridge?

        init(model: WebViewModel) {
            self.model = model
            historySnapshots.countLimit = 8
            historySnapshots.totalCostLimit = 48 * 1024 * 1024
        }

        func attach(hostView: WebViewHostView, webView: WKWebView) {
            self.hostView = hostView
            self.webView = webView

            let edgePanGesture = UIScreenEdgePanGestureRecognizer(
                target: self,
                action: #selector(handleEdgePan(_:))
            )
            edgePanGesture.edges = .left
            edgePanGesture.delegate = self
            hostView.addGestureRecognizer(edgePanGesture)
            self.edgePanGesture = edgePanGesture
        }

        func detach() {
            interactiveBackFallback?.cancel()
            interactiveBackFallback = nil
            if let edgePanGesture {
                hostView?.removeGestureRecognizer(edgePanGesture)
            }
            edgePanGesture = nil
            hostView?.hideHistorySnapshot()
            hostView = nil
            webView = nil
            bridge = nil
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            mainFrameLoadFailed = false
        }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            updateHistoryGestureMode(for: webView.url)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard !mainFrameLoadFailed else { return }
            model.showContent()
            updateHistoryGestureMode(for: webView.url)
            synchronizeHistoryPositionAndCapture(in: webView)
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: any Error
        ) {
            guard !isCancelled(error) else { return }
            mainFrameLoadFailed = true
            model.showError()
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: any Error
        ) {
            guard !isCancelled(error) else { return }
            mainFrameLoadFailed = true
            model.showError()
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if navigationAction.targetFrame == nil {
                openExternal(url)
                decisionHandler(.cancel)
                return
            }

            let scheme = url.scheme?.lowercased() ?? ""
            if scheme == "http" || scheme == "https" {
                let host = url.host?.lowercased() ?? ""
                if host == AppConfiguration.appHost || Self.inAppPaymentHosts.contains(host) {
                    decisionHandler(.allow)
                } else {
                    openExternal(url)
                    decisionHandler(.cancel)
                }
                return
            }

            if ["about", "blob", "data"].contains(scheme) {
                decisionHandler(.allow)
                return
            }

            if ["tel", "mailto", "sms"].contains(scheme) {
                openExternal(url)
            }
            decisionHandler(.cancel)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            let disposition = (navigationResponse.response as? HTTPURLResponse)?
                .value(forHTTPHeaderField: "Content-Disposition")?
                .lowercased() ?? ""
            if !navigationResponse.canShowMIMEType || disposition.contains("attachment") {
                if let url = navigationResponse.response.url {
                    openExternal(url)
                }
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = navigationAction.request.url {
                openExternal(url)
            }
            return nil
        }

        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            decisionHandler(origin.host.lowercased() == AppConfiguration.appHost ? .prompt : .deny)
        }

        func topViewController() -> UIViewController? {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let root = scenes
                .flatMap(\.windows)
                .first(where: { $0.isKeyWindow })?
                .rootViewController
            return Self.topViewController(from: root)
        }

        private static func topViewController(from root: UIViewController?) -> UIViewController? {
            if let presented = root?.presentedViewController {
                return topViewController(from: presented)
            }
            if let navigation = root as? UINavigationController {
                return topViewController(from: navigation.visibleViewController)
            }
            if let tabs = root as? UITabBarController {
                return topViewController(from: tabs.selectedViewController)
            }
            return root
        }

        func webHistoryDidChange(position: Int, phase: String, kind: String) {
            currentHistoryPosition = position

            switch phase {
            case "settled":
                if let sourcePosition = interactiveBackSourcePosition,
                   position < sourcePosition {
                    finishInteractiveBack()
                }
                captureCurrentPage(position: position, afterScreenUpdates: true)
            case "snapshot":
                captureCurrentPage(position: position, afterScreenUpdates: false)
            default:
                break
            }
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard gestureRecognizer === edgePanGesture,
                  customHistoryGestureEnabled,
                  interactiveBackSourcePosition == nil,
                  let webView,
                  webView.canGoBack,
                  let position = currentHistoryPosition,
                  position > 0,
                  historySnapshots.object(forKey: NSNumber(value: position - 1)) != nil else {
                return false
            }

            let velocity = (gestureRecognizer as? UIPanGestureRecognizer)?.velocity(in: hostView) ?? .zero
            return velocity.x > 0 && abs(velocity.x) > abs(velocity.y)
        }

        @objc
        private func handleEdgePan(_ gesture: UIScreenEdgePanGestureRecognizer) {
            guard let hostView, let webView else { return }
            let width = max(hostView.bounds.width, 1)
            let translation = max(0, min(width, gesture.translation(in: hostView).x))
            let progress = translation / width

            switch gesture.state {
            case .began:
                guard let position = currentHistoryPosition,
                      let snapshot = historySnapshots.object(forKey: NSNumber(value: position - 1)) else {
                    gesture.isEnabled = false
                    gesture.isEnabled = true
                    return
                }
                interactiveBackSourcePosition = position
                hostView.showHistorySnapshot(snapshot)
                hostView.setInteractiveBackProgress(0)
            case .changed:
                hostView.setInteractiveBackProgress(progress)
            case .ended:
                let velocity = gesture.velocity(in: hostView).x
                if progress >= 0.34 || velocity >= 720 {
                    completeInteractiveBack(from: progress, velocity: velocity, width: width, webView: webView)
                } else {
                    cancelInteractiveBack(from: progress)
                }
            case .cancelled, .failed:
                cancelInteractiveBack(from: progress)
            default:
                break
            }
        }

        private func completeInteractiveBack(
            from progress: CGFloat,
            velocity: CGFloat,
            width: CGFloat,
            webView: WKWebView
        ) {
            guard let hostView, let sourcePosition = interactiveBackSourcePosition else { return }
            let remaining = max(0, 1 - progress)
            let velocityDuration = velocity > 0 ? Double((remaining * width) / velocity) : 0.22
            let duration = min(0.24, max(0.12, velocityDuration))

            UIView.animate(
                withDuration: duration,
                delay: 0,
                options: [.curveEaseOut, .beginFromCurrentState, .allowUserInteraction]
            ) {
                hostView.setInteractiveBackProgress(1)
            } completion: { [weak self, weak webView] _ in
                guard let self, let webView else { return }
                guard webView.goBack() != nil else {
                    self.cancelInteractiveBack(from: 1)
                    return
                }

                let fallback = DispatchWorkItem { [weak self] in
                    guard let self, self.interactiveBackSourcePosition == sourcePosition else { return }
                    if let position = self.currentHistoryPosition, position < sourcePosition {
                        self.finishInteractiveBack()
                    } else {
                        self.cancelInteractiveBack(from: 1)
                    }
                }
                self.interactiveBackFallback?.cancel()
                self.interactiveBackFallback = fallback
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2, execute: fallback)
            }
        }

        private func cancelInteractiveBack(from progress: CGFloat) {
            guard let hostView else {
                interactiveBackSourcePosition = nil
                return
            }
            let duration = min(0.22, max(0.1, Double(progress) * 0.2))
            UIView.animate(
                withDuration: duration,
                delay: 0,
                options: [.curveEaseOut, .beginFromCurrentState, .allowUserInteraction]
            ) {
                hostView.setInteractiveBackProgress(0)
            } completion: { [weak self] _ in
                self?.interactiveBackFallback?.cancel()
                self?.interactiveBackFallback = nil
                self?.interactiveBackSourcePosition = nil
                hostView.hideHistorySnapshot()
            }
        }

        private func finishInteractiveBack() {
            interactiveBackFallback?.cancel()
            interactiveBackFallback = nil
            interactiveBackSourcePosition = nil
            hostView?.finishInteractiveBack()
        }

        private func updateHistoryGestureMode(for url: URL?) {
            let host = url?.host?.lowercased()
            customHistoryGestureEnabled = host == nil || host == AppConfiguration.appHost
            webView?.allowsBackForwardNavigationGestures = !customHistoryGestureEnabled
        }

        private func synchronizeHistoryPositionAndCapture(in webView: WKWebView) {
            webView.evaluateJavaScript("history.state && Number.isFinite(history.state.position) ? history.state.position : null") {
                [weak self] value, _ in
                guard let self, let position = (value as? NSNumber)?.intValue else { return }
                self.currentHistoryPosition = position
                self.captureCurrentPage(position: position, afterScreenUpdates: true)
            }
        }

        private func captureCurrentPage(position: Int, afterScreenUpdates: Bool) {
            guard interactiveBackSourcePosition == nil,
                  let webView,
                  let hostView,
                  webView.window != nil,
                  !webView.bounds.isEmpty,
                  webView.transform == .identity else {
                return
            }

            captureGeneration += 1
            let generation = captureGeneration
            let configuration = WKSnapshotConfiguration()
            configuration.rect = webView.bounds
            configuration.snapshotWidth = NSNumber(value: Double(webView.bounds.width))
            configuration.afterScreenUpdates = afterScreenUpdates

            webView.takeSnapshot(with: configuration) { [weak self, weak hostView] image, error in
                guard let self,
                      let hostView,
                      error == nil,
                      let image,
                      generation == self.captureGeneration,
                      self.currentHistoryPosition == position,
                      self.interactiveBackSourcePosition == nil,
                      abs(image.size.width - hostView.bounds.width) < 2,
                      abs(image.size.height - hostView.bounds.height) < 2 else {
                    return
                }
                let cost = image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0
                self.historySnapshots.setObject(image, forKey: NSNumber(value: position), cost: cost)
            }
        }

        private func openExternal(_ url: URL) {
            guard UIApplication.shared.canOpenURL(url) else { return }
            UIApplication.shared.open(url)
        }

        private func isCancelled(_ error: any Error) -> Bool {
            let value = error as NSError
            return value.domain == NSURLErrorDomain && value.code == NSURLErrorCancelled
        }
    }
}

@MainActor
final class WebViewHostView: UIView {
    let webView: WKWebView
    private let historySnapshotView = UIImageView()
    private let historySnapshotShade = UIView()
    private let restingParallax: CGFloat = 0.18

    init(webView: WKWebView) {
        self.webView = webView
        super.init(frame: .zero)

        backgroundColor = webView.backgroundColor
        clipsToBounds = true

        historySnapshotView.contentMode = .scaleAspectFill
        historySnapshotView.clipsToBounds = true
        historySnapshotView.isHidden = true
        historySnapshotView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(historySnapshotView)

        historySnapshotShade.backgroundColor = UIColor.black.withAlphaComponent(0.1)
        historySnapshotShade.isHidden = true
        historySnapshotShade.translatesAutoresizingMaskIntoConstraints = false
        addSubview(historySnapshotShade)

        webView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(webView)

        NSLayoutConstraint.activate([
            historySnapshotView.topAnchor.constraint(equalTo: topAnchor),
            historySnapshotView.leadingAnchor.constraint(equalTo: leadingAnchor),
            historySnapshotView.trailingAnchor.constraint(equalTo: trailingAnchor),
            historySnapshotView.bottomAnchor.constraint(equalTo: bottomAnchor),
            historySnapshotShade.topAnchor.constraint(equalTo: topAnchor),
            historySnapshotShade.leadingAnchor.constraint(equalTo: leadingAnchor),
            historySnapshotShade.trailingAnchor.constraint(equalTo: trailingAnchor),
            historySnapshotShade.bottomAnchor.constraint(equalTo: bottomAnchor),
            webView.topAnchor.constraint(equalTo: topAnchor),
            webView.leadingAnchor.constraint(equalTo: leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func showHistorySnapshot(_ image: UIImage) {
        historySnapshotView.image = image
        historySnapshotView.isHidden = false
        historySnapshotShade.isHidden = false
        historySnapshotShade.alpha = 1
        historySnapshotView.transform = CGAffineTransform(
            translationX: -bounds.width * restingParallax,
            y: 0
        )
        webView.layer.shadowColor = UIColor.black.cgColor
        webView.layer.shadowOpacity = 0.18
        webView.layer.shadowRadius = 10
        webView.layer.shadowOffset = CGSize(width: -2, height: 0)
    }

    func setInteractiveBackProgress(_ progress: CGFloat) {
        let value = max(0, min(1, progress))
        webView.transform = CGAffineTransform(translationX: bounds.width * value, y: 0)
        historySnapshotView.transform = CGAffineTransform(
            translationX: -bounds.width * restingParallax * (1 - value),
            y: 0
        )
        historySnapshotShade.alpha = 1 - value
    }

    func finishInteractiveBack() {
        UIView.performWithoutAnimation {
            webView.transform = .identity
            hideHistorySnapshot()
        }
    }

    func hideHistorySnapshot() {
        webView.transform = .identity
        webView.layer.shadowOpacity = 0
        historySnapshotView.transform = .identity
        historySnapshotView.image = nil
        historySnapshotView.isHidden = true
        historySnapshotShade.isHidden = true
        historySnapshotShade.alpha = 1
    }
}
