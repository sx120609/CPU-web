import UIKit

/// 截图识别: the screenshot the user picks, shrunk to a JPEG `data:` URL small enough to send to
/// 拾间AI through the page. Long screenshots keep their width and shrink by height; the server
/// also caps at 4096.
enum NativeAgendaImage {
    /// The picture in `data` as a JPEG `data:` URL; nil when it is not an image. Runs off the main
    /// actor (the app target defaults to MainActor), so the limits are local.
    nonisolated static func dataURL(from data: Data) -> String? {
        let maxWidth: CGFloat = 1_280
        let maxHeight: CGFloat = 4_096
        let maxBytes = 2_500_000
        guard let image = UIImage(data: data), image.size.width > 0, image.size.height > 0 else { return nil }
        let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let ratio = min(1, maxWidth / pixels.width, maxHeight / pixels.height)
        let target = CGSize(width: max(1, (pixels.width * ratio).rounded()), height: max(1, (pixels.height * ratio).rounded()))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        // A white backdrop: transparent screenshots would otherwise turn black in JPEG.
        let flat = UIGraphicsImageRenderer(size: target, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: target))
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        var quality: CGFloat = 0.88
        var jpeg = flat.jpegData(compressionQuality: quality)
        while let current = jpeg, current.count > maxBytes, quality > 0.5 {
            quality -= 0.1
            jpeg = flat.jpegData(compressionQuality: quality)
        }
        return jpeg.map { "data:image/jpeg;base64," + $0.base64EncodedString() }
    }
}
