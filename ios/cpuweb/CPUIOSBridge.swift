import Foundation
import Photos
import SwiftUI
import UIKit
import WebKit
import WidgetKit

@MainActor
protocol NativePresentationProviding: AnyObject {
    func topViewController() -> UIViewController?
}

@MainActor
final class CPUIOSBridge: NSObject, WKScriptMessageHandler {
    static let handlerName = "cpuIOS"

    weak var presenter: NativePresentationProviding?
    weak var webView: WKWebView?

    init(presenter: NativePresentationProviding) {
        self.presenter = presenter
    }

    var bridgeScript: WKUserScript {
        let source = """
        (() => {
          const send = (action, payload = {}) => {
            try { window.webkit.messageHandlers.\(Self.handlerName).postMessage({ action, ...payload }); }
            catch (_) { return false; }
            return true;
          };
          const bridge = {
            getVersionCode: () => \(AppConfiguration.versionCode),
            getVersionName: () => \(Self.javascriptString(AppConfiguration.versionName)),
            supportsScheduleWidget: () => true,
            supportsInAppApkDownload: () => false,
            copyText: (text) => send('copyText', { text: String(text ?? '') }),
            openExternalUrl: (url) => { send('openExternalUrl', { url: String(url ?? '') }); },
            previewImages: (payload) => send('previewImages', { payload: String(payload ?? '') }),
            saveImage: (dataURL, fileName = 'image.png') => send('saveImage', {
              dataURL: String(dataURL ?? ''), fileName: String(fileName ?? 'image.png')
            }),
            saveImageUrl: (url, fileName = 'image.png') => send('saveImageURL', {
              url: String(url ?? ''), fileName: String(fileName ?? 'image.png')
            }),
            installScheduleWidget: (payload) => { send('installScheduleWidget', { payload: String(payload ?? '') }); }
          };
          Object.defineProperty(window, 'CPUIOS', { value: bridge, configurable: true });
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.handlerName,
              message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host.lowercased() == AppConfiguration.appHost,
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            return
        }

        switch action {
        case "copyText":
            UIPasteboard.general.string = body["text"] as? String ?? ""
        case "openExternalUrl":
            openExternal(body["url"] as? String)
        case "previewImages":
            presentImageGallery(payload: body["payload"] as? String)
        case "saveImage":
            saveDataURL(body["dataURL"] as? String)
        case "saveImageURL":
            saveRemoteImage(body["url"] as? String)
        case "installScheduleWidget":
            installScheduleWidget(payload: body["payload"] as? String)
        default:
            break
        }
    }

    private func openExternal(_ rawValue: String?) {
        guard let rawValue,
              let url = URL(string: rawValue.trimmingCharacters(in: .whitespacesAndNewlines)),
              UIApplication.shared.canOpenURL(url) else {
            showMessage(title: "无法打开", message: "这个链接暂时无法交给系统处理。")
            return
        }
        UIApplication.shared.open(url)
    }

    private func presentImageGallery(payload: String?) {
        guard let data = payload?.data(using: .utf8),
              let value = try? JSONDecoder().decode(NativeImagePreviewPayload.self, from: data),
              !value.images.isEmpty else {
            return
        }
        let startIndex = min(max(value.index ?? 0, 0), value.images.count - 1)
        let view = NativeImageGallery(items: value.images, startIndex: startIndex)
        let controller = UIHostingController(rootView: view)
        controller.modalPresentationStyle = .fullScreen
        presenter?.topViewController()?.present(controller, animated: true)
    }

    private func saveDataURL(_ value: String?) {
        guard let image = ImageStore.image(fromDataURL: value ?? "") else {
            showMessage(title: "保存失败", message: "图片数据无法读取。")
            return
        }
        save(image)
    }

    private func saveRemoteImage(_ value: String?) {
        guard let value, let url = URL(string: value) else {
            showMessage(title: "保存失败", message: "图片地址无效。")
            return
        }
        Task {
            do {
                var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
                if let cookieStore = webView?.configuration.websiteDataStore.httpCookieStore {
                    let cookies = await cookieStore.allCookies()
                    let fields = HTTPCookie.requestHeaderFields(with: cookies)
                    fields.forEach { request.setValue($1, forHTTPHeaderField: $0) }
                }
                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse,
                      (200..<300).contains(http.statusCode),
                      let image = UIImage(data: data) else {
                    throw ImageStoreError.invalidImage
                }
                save(image)
            } catch {
                showMessage(title: "保存失败", message: "图片下载失败，请稍后重试。")
            }
        }
    }

    private func save(_ image: UIImage) {
        ImageStore.saveToPhotos(image: image) { [weak self] result in
            Task { @MainActor in
                switch result {
                case .success:
                    self?.showMessage(title: "保存成功", message: "图片已保存到系统相册。")
                case .failure:
                    self?.showMessage(title: "保存失败", message: "请允许“药大拾间”添加照片后重试。")
                }
            }
        }
    }

    private func installScheduleWidget(payload: String?) {
        guard let endpoint = Self.widgetEndpoint(from: payload),
              let defaults = UserDefaults(suiteName: AppConfiguration.appGroup) else {
            showMessage(title: "配置失败", message: "小组件配置无效，请重新添加。")
            return
        }
        defaults.set(Self.normalizeEndpoint(endpoint), forKey: AppConfiguration.widgetEndpointKey)
        WidgetCenter.shared.reloadAllTimelines()
        showMessage(
            title: "小组件配置已保存",
            message: "请长按主屏幕，点左上角“+”，搜索“药大拾间”并选择课表样式。"
        )
    }

    private func showMessage(title: String, message: String) {
        guard let controller = presenter?.topViewController() else { return }
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default))
        controller.present(alert, animated: true)
    }

    private static func widgetEndpoint(from payload: String?) -> String? {
        let rawValue = payload?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if rawValue.hasPrefix("https://") || rawValue.hasPrefix("http://") {
            return rawValue
        }
        guard let data = rawValue.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let endpoint = object["endpoint"] as? String,
              !endpoint.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func normalizeEndpoint(_ value: String) -> String {
        guard var components = URLComponents(string: value),
              let host = components.host?.lowercased(),
              host == "cputime.cn" || host == "cpu.lizmt.cn" else {
            return value
        }
        components.scheme = "https"
        components.host = "cputime.cn"
        return components.string ?? value
    }

    private static func javascriptString(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [value]),
              let array = String(data: data, encoding: .utf8) else {
            return "\"\""
        }
        return String(array.dropFirst().dropLast())
    }
}

private enum ImageStoreError: Error {
    case invalidImage
}

enum ImageStore {
    static func image(fromDataURL value: String) -> UIImage? {
        let payload = value.split(separator: ",", maxSplits: 1).last.map(String.init) ?? value
        guard let data = Data(base64Encoded: payload, options: .ignoreUnknownCharacters) else {
            return nil
        }
        return UIImage(data: data)
    }

    static func saveToPhotos(image: UIImage, completion: @escaping (Result<Void, Error>) -> Void) {
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                completion(.failure(ImageStoreError.invalidImage))
                return
            }
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            }) { success, error in
                if success {
                    completion(.success(()))
                } else {
                    completion(.failure(error ?? ImageStoreError.invalidImage))
                }
            }
        }
    }
}
