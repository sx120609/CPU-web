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

    func attach(_ webView: WKWebView) {
        self.webView = webView
    }

    func showContent() {
        phase = .content
    }

    func showError() {
        phase = .failed
    }

    func retry() {
        phase = .loading
        webView?.load(URLRequest(url: AppConfiguration.appURL, cachePolicy: .reloadRevalidatingCacheData))
    }
}
