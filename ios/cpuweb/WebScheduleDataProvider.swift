import Foundation
import WebKit

@MainActor
final class WebScheduleDataProvider: ScheduleDataProvider {
    weak var webView: WKWebView?
    var onSnapshot: ((Data) -> Void)?
    var onFailure: ((ScheduleFailure) -> Void)?

    var script: WKUserScript? {
        guard let url = Bundle.main.url(forResource: "WatchScheduleBridge", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        // Prevent resource execution on external login and third-party navigation pages.
        let host = AppConfiguration.appHost
        let guardSource = "if (location.protocol === 'https:' && location.hostname === \"\(host)\") {\n\(source)\n}"
        return WKUserScript(source: guardSource, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
    }

    func refresh() {
        guard let webView, webView.url?.scheme == "https", webView.url?.host == AppConfiguration.appHost else {
            onFailure?(.sourceUnavailable)
            return
        }
        webView.evaluateJavaScript("typeof window.CPUWatchRefresh === 'function' && (window.CPUWatchRefresh(), true)") { [weak self] result, error in
            Task { @MainActor in
                if error != nil || result as? Bool != true { self?.onFailure?(.sourceUnavailable) }
            }
        }
    }

    func receive(_ body: [String: Any]) {
        guard body["version"] as? Int == 1 else { onFailure?(.unsupportedVersion); return }
        if let status = body["status"] as? String {
            onFailure?(status == "loginRequired" ? .loginRequired : .sourceUnavailable)
            return
        }
        guard let text = body["payload"] as? String,
              text.utf8.count <= ScheduleEnvelope.maximumBytes,
              let data = text.data(using: .utf8) else { onFailure?(.invalidData); return }
        onSnapshot?(data)
    }
}
