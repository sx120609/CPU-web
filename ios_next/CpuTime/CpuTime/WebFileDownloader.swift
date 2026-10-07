import UIKit
import WebKit

/// Files a page asks to save. WebKit hands the app the download; the finished
/// file goes to the share sheet, where it can be saved to Files, kept as a
/// photo or opened in another app.
///
/// Without this a link with a `download` attribute replaced the page with the
/// file when the web view could display it, and did nothing when it could not.
final class WebFileDownloader: NSObject, WKDownloadDelegate {
    static let shared = WebFileDownloader()

    private var files: [ObjectIdentifier: URL] = [:]

    private static var folder: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("web-downloads", isDirectory: true)
    }

    override init() {
        super.init()
        // A share extension may still be reading a file after the sheet has
        // closed, so files are not removed then. What an earlier run left
        // behind goes now.
        try? FileManager.default.removeItem(at: Self.folder)
    }

    // MARK: What is downloaded here

    /// A click on `<a download>`: the page wants a file, not a navigation.
    static func takes(_ action: WKNavigationAction) -> Bool {
        guard action.shouldPerformDownload, let url = action.request.url else { return false }
        return isOwn(url)
    }

    /// A response the web view cannot display, or one sent as an attachment.
    static func takes(_ response: WKNavigationResponse) -> Bool {
        guard let url = response.response.url, isOwn(url) else { return false }
        let disposition = (response.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
        return !response.canShowMIMEType || disposition.contains("attachment")
    }

    /// The site's own addresses, and the blobs and data URLs its pages build.
    /// A file on any other host keeps going to Safari, as it did before.
    private static func isOwn(_ url: URL) -> Bool {
        switch url.scheme?.lowercased() {
        case "data":
            return true
        case "blob":
            // blob:https://host/uuid — the origin is the part after the scheme.
            guard let origin = URL(string: String(url.absoluteString.dropFirst("blob:".count))) else { return false }
            return IOSNextWebConfiguration.isTrusted(origin)
        default:
            return IOSNextWebConfiguration.isTrusted(url)
        }
    }

    func adopt(_ download: WKDownload) {
        download.delegate = self
    }

    // MARK: WKDownloadDelegate

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        // A folder per download, so two files of one name never collide and
        // the file keeps the name the page gave it.
        let directory = Self.folder.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            completionHandler(nil)
            return
        }
        let file = directory.appendingPathComponent(Self.fileName(suggestedFilename))
        files[ObjectIdentifier(download)] = file
        completionHandler(file)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = files.removeValue(forKey: ObjectIdentifier(download)) else { return }
        share(file)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let file = files.removeValue(forKey: ObjectIdentifier(download)) {
            try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
        }
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        let alert = UIAlertController(title: "文件没有下载下来", message: "请稍后再试一次。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "好", style: .default))
        Self.presenter()?.present(alert, animated: true)
    }

    // MARK: Handing the file over

    /// The name WebKit suggests comes from the page or the server; keep it to
    /// one path component of a sane length.
    static func fileName(_ suggested: String) -> String {
        var name = suggested
            .components(separatedBy: CharacterSet(charactersIn: "/\\:\0").union(.newlines).union(.controlCharacters))
            .joined(separator: "_")
            .trimmingCharacters(in: .whitespaces)
        while name.hasPrefix(".") { name.removeFirst() }
        if name.isEmpty { return "下载的文件" }
        // Trim the stem, never the extension: the share sheet picks its
        // actions from the file type.
        let limit = 120
        guard name.count > limit else { return name }
        let pieces = name.split(separator: ".", omittingEmptySubsequences: false)
        guard pieces.count > 1, let last = pieces.last, last.count <= 10 else { return String(name.prefix(limit)) }
        let stem = pieces.dropLast().joined(separator: ".")
        return String(stem.prefix(limit - last.count - 1)) + "." + last
    }

    private func share(_ file: URL) {
        guard let presenter = Self.presenter() else { return }
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        // An iPad shows the sheet as a popover. UIKit raises an exception when
        // a popover is not told where it comes from.
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
            popover.permittedArrowDirections = []
        }
        presenter.present(sheet, animated: true)
    }

    /// The controller on top of the active window, past any sheet that is up.
    private static func presenter() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let active = scenes.filter { $0.activationState == .foregroundActive }
        let windows = (active.isEmpty ? scenes : active).flatMap(\.windows)
        var top = (windows.first(where: \.isKeyWindow) ?? windows.first)?.rootViewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed {
            top = presented
        }
        return top
    }
}
