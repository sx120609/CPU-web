import SwiftUI

/// Picks the part of a photo the timetable shows, at the screen's shape: drag
/// to move it, pinch to zoom. Like setting a wallpaper. The result is a
/// rectangle in fractions of the image; nil means the default (the whole
/// photo filling the screen, centred).
@available(iOS 17.0, *)
struct NativeBackgroundCropEditor: View {
    let image: UIImage
    /// Width over height of the area the background fills.
    let aspect: CGFloat
    let initial: CGRect?
    let onDone: (CGRect?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var pinch: CGFloat = 1
    @State private var drag: CGSize = .zero
    @State private var frame: CGRect = .zero
    @State private var placed = false

    private static let maximumScale: CGFloat = 5

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                let crop = cropFrame(in: proxy.size)
                let shown = displayedSize(for: crop, scale: scale * pinch)
                let center = clamped(offset: CGSize(width: offset.width + drag.width, height: offset.height + drag.height),
                                     crop: crop, shown: shown)
                ZStack {
                    Color.black.ignoresSafeArea()
                    Image(uiImage: image)
                        .resizable()
                        .frame(width: shown.width, height: shown.height)
                        .position(x: crop.midX + center.width, y: crop.midY + center.height)
                    // Everything outside the frame dimmed, the frame itself outlined.
                    Rectangle()
                        .fill(Color.black.opacity(0.55))
                        .mask {
                            Rectangle()
                                .overlay {
                                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                                        .frame(width: crop.width, height: crop.height)
                                        .position(x: crop.midX, y: crop.midY)
                                        .blendMode(.destinationOut)
                                }
                                .compositingGroup()
                        }
                        .allowsHitTesting(false)
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(.white.opacity(0.9), lineWidth: 1.5)
                        .frame(width: crop.width, height: crop.height)
                        .position(x: crop.midX, y: crop.midY)
                        .allowsHitTesting(false)
                    thirds(crop)
                }
                .contentShape(Rectangle())
                .gesture(
                    SimultaneousGesture(
                        DragGesture()
                            .onChanged { drag = $0.translation }
                            .onEnded { value in
                                offset = clamped(offset: CGSize(width: offset.width + value.translation.width,
                                                                height: offset.height + value.translation.height),
                                                 crop: crop, shown: shown)
                                drag = .zero
                            },
                        MagnifyGesture()
                            .onChanged { pinch = $0.magnification }
                            .onEnded { value in
                                scale = min(Self.maximumScale, max(1, scale * value.magnification))
                                pinch = 1
                                offset = clamped(offset: offset, crop: crop, shown: displayedSize(for: crop, scale: scale))
                            }
                    )
                )
                .onAppear {
                    frame = crop
                    guard !placed else { return }
                    placed = true
                    place(initial, crop: crop)
                }
                .onChange(of: proxy.size) { _, size in frame = cropFrame(in: size) }
            }
            .navigationTitle("调整背景范围")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.black, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .principal) {
                    Button("还原") {
                        withAnimation(.snappy) { scale = 1; offset = .zero }
                    }
                    .disabled(scale == 1 && offset == .zero)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") {
                        onDone(result())
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Text("拖动移动，双指缩放")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.7))
                    .padding(.bottom, 12)
            }
        }
        .tint(.white)
    }

    private func thirds(_ crop: CGRect) -> some View {
        Path { path in
            for index in 1...2 {
                let x = crop.minX + crop.width * CGFloat(index) / 3
                let y = crop.minY + crop.height * CGFloat(index) / 3
                path.move(to: CGPoint(x: x, y: crop.minY)); path.addLine(to: CGPoint(x: x, y: crop.maxY))
                path.move(to: CGPoint(x: crop.minX, y: y)); path.addLine(to: CGPoint(x: crop.maxX, y: y))
            }
        }
        .stroke(.white.opacity(0.22), lineWidth: 0.6)
        .allowsHitTesting(false)
    }

    /// The largest rectangle of the screen's shape that fits with a margin.
    private func cropFrame(in size: CGSize) -> CGRect {
        let available = CGSize(width: max(1, size.width - 48), height: max(1, size.height - 70))
        let width = min(available.width, available.height * aspect)
        let height = width / aspect
        return CGRect(x: (size.width - width) / 2, y: (size.height - height) / 2 - 10, width: width, height: height)
    }

    /// The image at `scale` times the size that just fills the frame.
    private func displayedSize(for crop: CGRect, scale: CGFloat) -> CGSize {
        let fill = max(crop.width / image.size.width, crop.height / image.size.height)
        return CGSize(width: image.size.width * fill * scale, height: image.size.height * fill * scale)
    }

    /// An offset of the image's centre from the frame's that keeps the frame covered.
    private func clamped(offset: CGSize, crop: CGRect, shown: CGSize) -> CGSize {
        let maxX = max(0, (shown.width - crop.width) / 2)
        let maxY = max(0, (shown.height - crop.height) / 2)
        return CGSize(width: min(maxX, max(-maxX, offset.width)), height: min(maxY, max(-maxY, offset.height)))
    }

    private func place(_ rect: CGRect?, crop: CGRect) {
        guard let rect, rect.width > 0, rect.height > 0 else { return }
        let fill = max(crop.width / image.size.width, crop.height / image.size.height)
        let target = crop.width / (rect.width * image.size.width * fill)
        scale = min(Self.maximumScale, max(1, target))
        let shown = displayedSize(for: crop, scale: scale)
        let originX = crop.minX - rect.minX * shown.width
        let originY = crop.minY - rect.minY * shown.height
        offset = clamped(offset: CGSize(width: originX + shown.width / 2 - crop.midX,
                                        height: originY + shown.height / 2 - crop.midY),
                         crop: crop, shown: shown)
    }

    private func result() -> CGRect? {
        guard scale > 1.001 || abs(offset.width) > 0.5 || abs(offset.height) > 0.5, frame.width > 0 else { return nil }
        let shown = displayedSize(for: frame, scale: scale)
        let originX = frame.midX + offset.width - shown.width / 2
        let originY = frame.midY + offset.height - shown.height / 2
        return NativeSchedulePreferences.normalizedCrop(CGRect(
            x: (frame.minX - originX) / shown.width, y: (frame.minY - originY) / shown.height,
            width: frame.width / shown.width, height: frame.height / shown.height
        ))
    }
}
