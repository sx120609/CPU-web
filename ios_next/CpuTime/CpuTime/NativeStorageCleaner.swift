import Foundation
import WebKit

/// Storage report and cleanup behind the Web "存储与缓存" page.
///
/// The page clears what JavaScript can reach on its own (Cache Storage and the
/// cached page data in localStorage). This handler covers the rest: WebKit's
/// network cache and the temporary directory. Cookies, localStorage and
/// IndexedDB hold the login and the user's settings, so no category here
/// removes them.
///
/// Web calls `window.webkit.messageHandlers.cpuTimeStorage.postMessage(...)`
/// with `{ action: "usage" }` or `{ action: "clear", categories: [...] }` and
/// awaits the usage report that both actions resolve with.
final class NativeStorageCleaner: NSObject, WKScriptMessageHandlerWithReply {
    static let handlerName = "cpuTimeStorage"
    static let shared = NativeStorageCleaner()

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) async -> (Any?, String?) {
        guard message.frameInfo.isMainFrame,
              let frameURL = message.frameInfo.request.url, IOSNextWebConfiguration.isTrusted(frameURL),
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            return (nil, "unsupported")
        }

        switch action {
        case "usage":
            return (await Self.usage(), nil)
        case "clear":
            await Self.clear(Set(body["categories"] as? [String] ?? []))
            return (await Self.usage(), nil)
        default:
            return (nil, "unsupported")
        }
    }

    private static func usage() async -> [String: Any] {
        // Walking the sandbox touches thousands of files; keep it off the main actor.
        let measured = await Task.detached(priority: .userInitiated) {
            NativeStorageMeasurement.current()
        }.value
        return [
            "categories": [
                ["id": "network", "bytes": NSNumber(value: measured.network)],
                ["id": "temp", "bytes": NSNumber(value: measured.temporary)],
            ],
            "totalBytes": NSNumber(value: measured.total),
        ]
    }

    private static func clear(_ categories: Set<String>) async {
        if categories.contains("network") {
            // Only the HTTP caches. Website data that keeps the user signed in
            // (cookies, localStorage, IndexedDB) is deliberately left alone.
            await WKWebsiteDataStore.default().removeData(
                ofTypes: [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache],
                modifiedSince: .distantPast
            )
            URLCache.shared.removeAllCachedResponses()
        }
        if categories.contains("temp") {
            await Task.detached(priority: .utility) {
                NativeStorageMeasurement.removeContents(of: FileManager.default.temporaryDirectory)
            }.value
        }
    }
}

/// File-system side of the storage report. Synchronous on purpose: directory
/// enumeration is not available from asynchronous contexts.
nonisolated struct NativeStorageMeasurement: Sendable {
    /// `Library/Caches`, where WebKit and URLSession keep their network caches.
    let network: Int64
    /// The app's temporary directory (shared images, upload copies).
    let temporary: Int64
    /// The whole sandbox, the figure iOS Settings shows as "文稿与数据".
    let total: Int64

    static func current() -> NativeStorageMeasurement {
        let fileManager = FileManager.default
        let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first
        return NativeStorageMeasurement(
            network: caches.map { size(of: $0) } ?? 0,
            temporary: size(of: fileManager.temporaryDirectory),
            total: size(of: URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true))
        )
    }

    static func size(of directory: URL) -> Int64 {
        let keys: [URLResourceKey] = [.isRegularFileKey, .totalFileAllocatedSizeKey, .fileAllocatedSizeKey]
        guard let enumerator = FileManager.default.enumerator(
            at: directory,
            includingPropertiesForKeys: keys,
            options: [],
            errorHandler: { _, _ in true }
        ) else { return 0 }

        var total: Int64 = 0
        while let item = enumerator.nextObject() as? URL {
            guard let values = try? item.resourceValues(forKeys: Set(keys)),
                  values.isRegularFile == true else { continue }
            total += Int64(values.totalFileAllocatedSize ?? values.fileAllocatedSize ?? 0)
        }
        return total
    }

    static func removeContents(of directory: URL) {
        let fileManager = FileManager.default
        guard let items = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for item in items {
            try? fileManager.removeItem(at: item)
        }
    }
}
