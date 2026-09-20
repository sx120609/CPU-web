import PhotosUI
import SwiftUI

private struct ScheduleHasBackgroundKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var scheduleHasBackground: Bool {
        get { self[ScheduleHasBackgroundKey.self] }
        set { self[ScheduleHasBackgroundKey.self] = newValue }
    }
}

/// The page and the editor share this renderer. The photo uses Web's centered
/// `cover` layout with one overlay, rather than multiplying two opacities.
struct NativeScheduleBackground: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    let image: UIImage?
    var visibility: Double = 0.76
    var blur: Double = 0

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color(uiColor: .systemGroupedBackground)
                if let image {
                    let radius = NativeSchedulePreferences.normalizedBlur(blur)
                    // Overscan prevents blurred edges from revealing an empty
                    // strip when using a portrait, square, or landscape photo.
                    let extra = max(8, radius * 2)
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: proxy.size.width + extra * 2, height: proxy.size.height + extra * 2)
                        .clipped()
                        .blur(radius: radius)
                        .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
                    overlayColor.opacity(overlayOpacity)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipped()
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private var overlayColor: Color {
        colorScheme == .dark
            ? Color(red: 11 / 255, green: 27 / 255, blue: 24 / 255)
            : Color(red: 248 / 255, green: 251 / 255, blue: 255 / 255)
    }

    private var overlayOpacity: Double {
        let opacity = 1 - NativeSchedulePreferences.normalizedVisibility(visibility)
        if reduceTransparency { return colorScheme == .dark ? 0.82 : 0.88 }
        return colorScheme == .dark ? max(0.22, opacity * 0.58) : opacity
    }
}

/// Match Web's translucent empty cells and readable header/axis surfaces.
struct NativeScheduleBackgroundSurface: View {
    enum Strength { case cell, soft }
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scheduleHasBackground) private var hasBackground
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    var strength: Strength = .soft

    var body: some View {
        if hasBackground && !reduceTransparency {
            (colorScheme == .dark
                ? Color(red: 26 / 255, green: 41 / 255, blue: 37 / 255)
                : .white)
                .opacity(strength == .cell ? (colorScheme == .dark ? 0.52 : 0.36) : 0.72)
        } else {
            Color(uiColor: .secondarySystemGroupedBackground)
        }
    }
}

struct NativeScheduleBackgroundEditor: View {
    @ObservedObject var preferences: NativeSchedulePreferences
    var scheduleStore: NativeScheduleStore? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var isSaving = false
    @State private var errorMessage = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                preview

                HStack(spacing: 12) {
                    PhotosPicker(selection: $selectedPhoto, matching: .images) {
                        Label(isSaving ? "正在读取…" : preferences.backgroundImage == nil ? "选择图片" : "更换图片", systemImage: "photo")
                            .frame(maxWidth: .infinity, minHeight: 36)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isSaving)

                    Button("清除", role: .destructive) {
                        do { try preferences.setBackgroundData(nil) }
                        catch { errorMessage = "清除背景失败，请重试。" }
                    }
                    .buttonStyle(.bordered)
                    .disabled(isSaving || preferences.backgroundImage == nil)
                }

                VStack(spacing: 22) {
                    adjustment("背景显现", value: $preferences.backgroundVisibility,
                               range: 0.22...0.88, step: 0.01,
                               display: "\(Int((preferences.backgroundVisibility * 100).rounded()))%")
                    adjustment("柔化程度", value: $preferences.backgroundBlur,
                               range: 0...18, step: 1,
                               display: "\(Int(preferences.backgroundBlur))")
                }
                .disabled(preferences.backgroundImage == nil || isSaving)
                .padding(18)
                .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))

                Text("图片居中铺满课表，调整会立即生效。浅色插画或照片更容易看清课程；背景只保存在本机。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(20)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("背景自定义")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("完成") { dismiss() }
            }
        }
        .tint(.cpuBrand)
        .onChange(of: selectedPhoto) { _, item in
            guard let item else { return }
            isSaving = true
            Task {
                do {
                    guard let data = try await item.loadTransferable(type: Data.self) else {
                        throw CocoaError(.fileReadCorruptFile)
                    }
                    try preferences.setBackgroundData(data)
                } catch {
                    errorMessage = "背景读取失败，请换一张图片重试。"
                }
                isSaving = false
                selectedPhoto = nil
            }
        }
        .alert("课表背景", isPresented: Binding(
            get: { !errorMessage.isEmpty },
            set: { if !$0 { errorMessage = "" } }
        )) {
            Button("知道了", role: .cancel) { errorMessage = "" }
        } message: {
            Text(errorMessage)
        }
    }

    private var preview: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("效果预览").font(.subheadline.weight(.semibold))
                Spacer()
                Text(preferences.backgroundImage == nil ? "默认背景" : "实时更新")
                    .font(.caption).foregroundStyle(.secondary)
            }
            GeometryReader { proxy in
                if let scheduleStore {
                    // Render the actual timetable, including the same crop and
                    // surfaces, at the device aspect ratio. No sample courses.
                    let size = UIScreen.main.bounds.size
                    NativeScheduleView(store: scheduleStore, isBackgroundPreview: true)
                        .frame(width: size.width, height: size.height - 100)
                        .scaleEffect(proxy.size.width / size.width, anchor: .topLeading)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                } else {
                    NativeScheduleBackground(image: preferences.backgroundImage,
                                             visibility: preferences.backgroundVisibility,
                                             blur: preferences.backgroundBlur)
                    if preferences.backgroundImage == nil {
                        ContentUnavailableView("还没有设置背景图", systemImage: "photo")
                    }
                }
            }
            .frame(height: scheduleStore == nil ? 220 : 300)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(Color(uiColor: .separator).opacity(0.25), lineWidth: 0.7)
            }
        }
    }

    private func adjustment(_ title: String, value: Binding<Double>, range: ClosedRange<Double>, step: Double, display: String) -> some View {
        VStack(spacing: 10) {
            HStack {
                Text(title).font(.subheadline.weight(.medium))
                Spacer()
                Text(display).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
            Slider(value: value, in: range, step: step)
                .accessibilityLabel(title)
                .accessibilityValue(display)
        }
    }
}
