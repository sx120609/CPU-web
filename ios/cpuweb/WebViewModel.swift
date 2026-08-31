import Combine
import Foundation
import WebKit

@MainActor
final class WebViewModel: ObservableObject {
    enum Phase: Equatable {
        case loading
        case content
        case failed
    }

    @Published var phase: Phase = .loading
    weak var webView: WKWebView?
    private var requestedURL = AppConfiguration.appURL

    func attach(_ webView: WKWebView) -> URL {
        self.webView = webView
        return requestedURL
    }

    func open(_ deepLink: URL) {
        guard let destination = AppConfiguration.destinationURL(for: deepLink) else { return }
        requestedURL = destination
        if phase == .failed {
            phase = .loading
        }
        webView?.load(URLRequest(url: destination))
    }

    func showContent() {
        phase = .content
    }

    func showError() {
        phase = .failed
    }

    func retry() {
        phase = .loading
        webView?.load(URLRequest(url: requestedURL, cachePolicy: .reloadRevalidatingCacheData))
    }
}
