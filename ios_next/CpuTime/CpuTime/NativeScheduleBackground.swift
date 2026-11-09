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

/// What the week view's cards and period labels read from the display
/// settings. The defaults are the standard look, so the day view, the share
/// picture and the style thumbnails are unchanged.
struct ScheduleWeekDisplay: Equatable {
    var textScale: CGFloat = 1
    var showTeacher = false
    var showSlotTime = true
}

private struct ScheduleWeekDisplayKey: EnvironmentKey {
    static let defaultValue = ScheduleWeekDisplay()
}

extension EnvironmentValues {
    var scheduleWeekDisplay: ScheduleWeekDisplay {
        get { self[ScheduleWeekDisplayKey.self] }
        set { self[ScheduleWeekDisplayKey.self] = newValue }
    }
}

/// The small outlined label on a course that does not run this week.
struct ScheduleOffWeekTag: View {
    var body: some View {
        Text("非本周")
            .font(.system(size: 8, weight: .semibold))
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 3)
            .padding(.vertical, 1)
            .overlay { RoundedRectangle(cornerRadius: 3).strokeBorder(lineWidth: 0.5) }
            .foregroundStyle(.secondary)
            .padding(.bottom, 2)
            .accessibilityHidden(true)
    }
}

/// The page and the editor share this renderer. The photo uses Web's centered
/// `cover` layout with one overlay, rather than multiplying two opacities.
@available(iOS 17.0, *)
struct NativeScheduleBackground: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    let image: UIImage?
    var visibility: Double = 0.76
    var blur: Double = 0

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                LinearGradient(
                    colors: colorScheme == .dark
                        // Neutral, ending on the site's dark page colour (`--cpu-bg`).
                        ? [NativeSchedulePalette.RGBA(0x15181c).color, NativeSchedulePalette.RGBA(0x0e1012).color]
                        : [NativeSchedulePalette.RGBA(0xedf4ff).color, NativeSchedulePalette.RGBA(0xf7fbff).color,
                           NativeSchedulePalette.RGBA(0xf8fafc).color],
                    startPoint: .top, endPoint: .bottom
                )
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
@available(iOS 17.0, *)
struct NativeScheduleBackgroundSurface: View {
    enum Strength { case cell, soft }
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scheduleHasBackground) private var hasBackground
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    var strength: Strength = .soft

    var body: some View {
        if reduceTransparency {
            NativeSchedulePalette.RGBA(colorScheme == .dark ? 0x23272c : 0xf8fafc).color
        } else {
            NativeSchedulePalette.RGBA(
                colorScheme == .dark ? (strength == .cell ? 0x1e2226 : 0x2a2f35) : 0xffffff,
                alpha: strength == .cell ? (colorScheme == .dark ? 0.52 : 0.36)
                    : (hasBackground ? 0.72 : (colorScheme == .dark ? 0.68 : 0.56))
            ).color
        }
    }
}

@available(iOS 17.0, *)
struct NativeScheduleBackgroundEditor: View {
    @ObservedObject var preferences: NativeSchedulePreferences
    var scheduleStore: NativeScheduleStore? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var systemScheme
    @State private var appearance: Appearance = .light
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var widgetPhoto: PhotosPickerItem?
    @State private var widgetDark = false
    @State private var widgetImages: [Bool: UIImage] = [:]
    @State private var widgetVeil = NativeWidgetBackground.veil
    @State private var cropping: CropTarget?
    @State private var isSaving = false
    @State private var errorMessage = ""

    enum Appearance: String, CaseIterable, Identifiable {
        case light = "浅色模式", dark = "深色模式"
        var id: String { rawValue }
        var isDark: Bool { self == .dark }
    }

    struct CropTarget: Identifiable {
        let image: UIImage
        let dark: Bool
        var id: Bool { dark }
    }

    /// This appearance's own image: the dark tab shows only a dark-only one.
    private var ownImage: UIImage? {
        appearance.isDark ? preferences.darkBackgroundImage : preferences.backgroundImage
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Picker("外观", selection: $appearance) {
                    ForEach(Appearance.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)

                preview

                photoButtons

                if appearance.isDark && preferences.darkBackgroundImage == nil {
                    Label(preferences.backgroundImage == nil ? "深色模式下没有背景图。"
                          : "深色模式沿用浅色的背景图；可以另选一张更暗的。", systemImage: "moon")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                VStack(spacing: 22) {
                    adjustment("背景显现", value: $preferences.backgroundVisibility,
                               range: 0.22...0.88, step: 0.01,
                               display: "\(Int((preferences.backgroundVisibility * 100).rounded()))%")
                    adjustment("柔化程度", value: $preferences.backgroundBlur,
                               range: 0...18, step: 1,
                               display: "\(Int(preferences.backgroundBlur))")
                }
                .disabled(!preferences.hasBackground || isSaving)
                .padding(18)
                .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))

                Text("可以为浅色和深色模式各选一张，用「调整范围」决定显示照片的哪一部分。浅色插画或照片更容易看清课程；背景只保存在本机。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                widgetSection
            }
            .padding(20)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("背景")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("完成") { dismiss() }
            }
        }
        .tint(.cpuBrand)
        .onAppear {
            appearance = systemScheme == .dark ? .dark : .light
#if DEBUG
            // `CPU_DEBUG_BACKGROUND_IMAGE=/path.jpg` sets that photo; with
            // `CPU_DEBUG_BACKGROUND_EDITOR=crop` its framing opens at once.
            let environment = ProcessInfo.processInfo.environment
            if let path = environment["CPU_DEBUG_BACKGROUND_IMAGE"], let data = FileManager.default.contents(atPath: path) {
                try? preferences.setBackgroundData(data)
                if environment["CPU_DEBUG_WIDGET_BACKGROUND"] == "1" { try? NativeWidgetBackground.set(data, dark: false) }
                if environment["CPU_DEBUG_BACKGROUND_EDITOR"] == "crop", let image = preferences.originalBackground(dark: false) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { cropping = CropTarget(image: image, dark: false) }
                }
            }
#endif
            widgetImages = [false: NativeWidgetBackground.image(dark: false), true: NativeWidgetBackground.image(dark: true)]
                .compactMapValues { $0 }
        }
        .onChange(of: selectedPhoto) { _, item in
            guard let item else { return }
            let dark = appearance.isDark
            load(item) { data in
                if dark { try preferences.setDarkBackgroundData(data) } else { try preferences.setBackgroundData(data) }
                // Straight on to the framing of the new photo.
                if let image = preferences.originalBackground(dark: dark) {
                    cropping = CropTarget(image: image, dark: dark)
                }
            }
            selectedPhoto = nil
        }
        .onChange(of: widgetPhoto) { _, item in
            guard let item else { return }
            let dark = widgetDark
            load(item) { data in
                try NativeWidgetBackground.set(data, dark: dark)
                widgetImages[dark] = NativeWidgetBackground.image(dark: dark)
            }
            widgetPhoto = nil
        }
        .fullScreenCover(item: $cropping) { target in
            NativeBackgroundCropEditor(
                image: target.image,
                aspect: WindowGeometry.size.width / max(1, WindowGeometry.size.height),
                initial: target.dark ? preferences.darkBackgroundCrop : preferences.backgroundCrop
            ) { rect in
                preferences.setBackgroundCrop(rect, dark: target.dark)
            }
        }
        .alert("背景", isPresented: Binding(
            get: { !errorMessage.isEmpty },
            set: { if !$0 { errorMessage = "" } }
        )) {
            Button("知道了", role: .cancel) { errorMessage = "" }
        } message: {
            Text(errorMessage)
        }
    }

    private func load(_ item: PhotosPickerItem, apply: @escaping (Data) throws -> Void) {
        isSaving = true
        Task {
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    throw CocoaError(.fileReadCorruptFile)
                }
                try apply(data)
            } catch {
                errorMessage = "图片读取失败，请换一张重试。"
            }
            isSaving = false
        }
    }

    private var photoButtons: some View {
        HStack(spacing: 10) {
            PhotosPicker(selection: $selectedPhoto, matching: .images) {
                Label(isSaving ? "正在读取…" : ownImage == nil ? "选择图片" : "更换", systemImage: "photo")
                    .frame(maxWidth: .infinity, minHeight: 36)
            }
            .buttonStyle(.borderedProminent)
            .disabled(isSaving)

            Button {
                if let image = preferences.originalBackground(dark: appearance.isDark) {
                    cropping = CropTarget(image: image, dark: appearance.isDark)
                }
            } label: {
                Label("调整范围", systemImage: "crop")
                    .frame(minHeight: 36)
            }
            .buttonStyle(.bordered)
            .disabled(isSaving || ownImage == nil)

            Button(role: .destructive) {
                do {
                    if appearance.isDark { try preferences.setDarkBackgroundData(nil) } else { try preferences.setBackgroundData(nil) }
                } catch { errorMessage = "清除背景失败，请重试。" }
            } label: {
                Image(systemName: "trash")
                    .frame(minHeight: 36)
            }
            .buttonStyle(.bordered)
            .disabled(isSaving || ownImage == nil)
            .accessibilityLabel("清除\(appearance.rawValue)背景")
        }
    }

    private var widgetSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("小组件背景", systemImage: "square.grid.2x2")
                    .font(.headline)
                Spacer()
                Picker("外观", selection: $widgetDark) {
                    Text("浅色").tag(false)
                    Text("深色").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(width: 120)
            }
            HStack(alignment: .center, spacing: 14) {
                widgetPreview
                VStack(alignment: .leading, spacing: 10) {
                    PhotosPicker(selection: $widgetPhoto, matching: .images) {
                        Label(widgetImages[widgetDark] == nil ? "选择图片" : "更换", systemImage: "photo")
                    }
                    .buttonStyle(.bordered)
                    if widgetImages[widgetDark] != nil {
                        Button("清除", role: .destructive) {
                            do {
                                try NativeWidgetBackground.set(nil, dark: widgetDark)
                                widgetImages[widgetDark] = nil
                            } catch { errorMessage = "清除失败，请重试。" }
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
            adjustment("文字底色", value: Binding(get: { widgetVeil }, set: { widgetVeil = $0 }),
                       range: 0.15...0.85, step: 0.05, display: "\(Int((widgetVeil * 100).rounded()))%")
                .disabled(widgetImages.isEmpty)
                .onChange(of: widgetVeil) { _, value in NativeWidgetBackground.veil = value }
            Text(widgetDark && widgetImages[true] == nil && widgetImages[false] != nil
                 ? "深色模式沿用浅色的图片。" : "主屏幕上的课表小组件会换上这张图；底色越浓，文字越清楚。")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(18)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
    }

    /// A small square widget with the chosen photo and veil.
    private var widgetPreview: some View {
        let image = widgetImages[widgetDark] ?? (widgetDark ? widgetImages[false] : nil)
        return ZStack(alignment: .topLeading) {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
                (widgetDark ? Color.black : Color.white).opacity(widgetVeil)
            } else {
                (widgetDark ? Color(white: 0.12) : Color.white)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("下一节").font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                Text("药理学").font(.system(size: 14, weight: .bold))
                Text("10:00 · 教学楼 A102").font(.system(size: 9)).foregroundStyle(.secondary)
            }
            .padding(10)
            .environment(\.colorScheme, widgetDark ? .dark : .light)
        }
        .frame(width: 104, height: 104)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
    }

    private var preview: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("效果预览").font(.subheadline.weight(.semibold))
                Spacer()
                Text(preferences.backgroundImage(dark: appearance.isDark) == nil ? "默认背景" : "实时更新")
                    .font(.caption).foregroundStyle(.secondary)
            }
            GeometryReader { proxy in
                if let scheduleStore {
                    // Render the actual timetable, including the same crop and
                    // surfaces, at the window's aspect ratio. No sample courses.
                    let size = WindowGeometry.size
                    NativeScheduleView(store: scheduleStore, isBackgroundPreview: true)
                        .frame(width: size.width, height: size.height - 100)
                        .scaleEffect(proxy.size.width / size.width, anchor: .topLeading)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                } else {
                    NativeScheduleBackground(image: preferences.backgroundImage(dark: appearance.isDark),
                                             visibility: preferences.backgroundVisibility,
                                             blur: preferences.backgroundBlur)
                    if preferences.backgroundImage(dark: appearance.isDark) == nil {
                        ContentUnavailableView("还没有设置背景图", systemImage: "photo")
                    }
                }
            }
            .environment(\.colorScheme, appearance.isDark ? .dark : .light)
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
