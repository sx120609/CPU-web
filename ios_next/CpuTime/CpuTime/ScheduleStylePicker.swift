import SwiftUI

/// Picks the timetable style. Every style shares the same course data and the
/// same tap-to-edit behaviour; a choice takes effect at once.
@available(iOS 17.0, *)
struct ScheduleStylePicker: View {
    @ObservedObject private var settings = NativeScheduleStyleSettings.shared
    /// The course palette, so the thumbnails use the colours the timetable will.
    var palette: String = "color-glass"

    var body: some View {
        List {
            Section {
                ForEach(ScheduleStyle.allCases) { style in
                    Button {
                        settings.setStyle(style)
                    } label: {
                        HStack(spacing: 14) {
                            ScheduleStylePreview(style: style)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(style.title)
                                    .font(.headline)
                                    .foregroundStyle(.primary)
                                Text(style.subtitle)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            if settings.style == style {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(Color.cpuBrand)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(settings.style == style ? [.isSelected] : [])
                }
            } footer: {
                Text("课表风格不改变课程数据、课程配色或背景图片。")
            }
        }
        .environment(\.schedulePalette, palette)
        .environment(\.scheduleThemeBrand, ScheduleStyle.themeBrand(palette: palette))
        .navigationTitle("课表风格")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// A thumbnail drawn with the real week components at full size, then scaled.
@available(iOS 17.0, *)
private struct ScheduleStylePreview: View {
    @Environment(\.colorScheme) private var colorScheme
    let style: ScheduleStyle

    private static let rowHeight: CGFloat = 32
    private static let slotCount = 4
    private static let padding: CGFloat = 8
    private static let headerHeight = NativeScheduleStyledDayColumn.dateHeaderHeight
    private static let slotGap = NativeScheduleStyledDayColumn.slotGap
    /// Three day columns inside the week panel.
    private static let canvas = CGSize(
        width: 264,
        height: headerHeight + CGFloat(slotCount) * rowHeight + CGFloat(slotCount - 1) * slotGap + 2 * padding
    )
    /// The whole canvas at one scale, so no edge of the panel is cut off.
    private static let width: CGFloat = 82
    private static var scale: CGFloat { width / canvas.width }

    private var gap: CGFloat { style == .classic ? 4 : CGFloat(style.columnGap) }
    private var columnWidth: CGFloat { (Self.canvas.width - 2 * Self.padding - 2 * gap) / 3 }

    var body: some View {
        Group {
            if style == .classic { classic } else { styled }
        }
        .environment(\.scheduleStyle, style)
        .environment(\.scheduleStaticRendering, true)
        .environment(\.dynamicTypeSize, .medium)
        .frame(width: Self.canvas.width, height: Self.canvas.height, alignment: .top)
        .scaleEffect(Self.scale, anchor: .topLeading)
        .frame(width: Self.width, height: (Self.canvas.height * Self.scale).rounded(.up), alignment: .topLeading)
        .clipped()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private var styled: some View {
        HStack(alignment: .top, spacing: gap) {
            ForEach(1...3, id: \.self) { day in
                NativeScheduleStyledDayColumn(
                    day: day, dateText: "\(day + 5)", isToday: false,
                    columnWidth: columnWidth, rowHeight: Self.rowHeight, slotCount: Self.slotCount,
                    compactCards: true, showsDateHeader: true, blocks: [sample(day)],
                    onCourseSelected: { _ in }, onEmptySlot: { _ in }
                )
            }
        }
        .background(alignment: .topLeading) {
            if style == .table {
                ScheduleTableRules(headerHeight: Self.headerHeight, rowHeight: Self.rowHeight,
                                   slotCount: Self.slotCount, axisWidth: 0, columnWidth: columnWidth, dayCount: 3,
                                   joined: { column, row in row == sampleStart(column + 1) })
            }
        }
        .padding(Self.padding)
        .background { ScheduleSurface(cornerRadius: 12, isPanel: true, showsBorder: style.framesPanel) }
    }

    /// The classic look in miniature: glass cells and gradient cards with a coloured edge.
    private var classic: some View {
        let dark = colorScheme == .dark
        let border = NativeScheduleThemeColor.cellBorder(colorScheme)
        return HStack(alignment: .top, spacing: gap) {
            ForEach(1...3, id: \.self) { day in
                let start = sampleStart(day)
                let tone = NativeSchedulePalette.tone(name: sampleName(day), palette: "color-glass", dark: dark)
                VStack(spacing: 0) {
                    VStack(spacing: 3) {
                        Text(ScheduleStyleTime.weekday(day)).font(.system(size: 13, weight: .bold))
                        Text("\(day + 5)").font(.system(size: 11, weight: .semibold).monospacedDigit())
                    }
                    .foregroundStyle(NativeScheduleThemeColor.secondary(colorScheme))
                    .frame(width: columnWidth, height: Self.headerHeight - 8)
                    .background {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.white.opacity(dark ? 0.08 : 0.56))
                            .overlay { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(border, lineWidth: 1) }
                    }
                    .padding(.bottom, 8)
                    ZStack(alignment: .topLeading) {
                        VStack(spacing: Self.slotGap) {
                            ForEach(1...Self.slotCount, id: \.self) { _ in
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(Color.white.opacity(dark ? 0.06 : 0.36))
                                    .overlay {
                                        RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(border, lineWidth: 0.7)
                                    }
                                    .frame(width: columnWidth - 2, height: Self.rowHeight - 2)
                                    .frame(width: columnWidth, height: Self.rowHeight)
                            }
                        }
                        Text(sampleName(day))
                            .font(.system(size: 10, weight: .bold))
                            .multilineTextAlignment(.center)
                            .foregroundStyle(tone.text.color)
                            .frame(width: columnWidth - 2, height: 2 * Self.rowHeight + Self.slotGap - 2)
                            .background {
                                RoundedRectangle(cornerRadius: 9, style: .continuous)
                                    .fill(LinearGradient(colors: [tone.top.color, tone.bottom.color],
                                                         startPoint: .top, endPoint: .bottom))
                                    .overlay {
                                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                                            .strokeBorder(tone.border.color, lineWidth: 1.5)
                                    }
                            }
                            .offset(x: 1, y: CGFloat(start - 1) * (Self.rowHeight + Self.slotGap) + 1)
                    }
                    .frame(width: columnWidth,
                           height: CGFloat(Self.slotCount) * Self.rowHeight + CGFloat(Self.slotCount - 1) * Self.slotGap,
                           alignment: .topLeading)
                }
            }
        }
        .padding(Self.padding)
    }

    /// Each sample course covers two periods, starting here.
    private func sampleStart(_ day: Int) -> Int { day == 2 ? 3 : 1 }

    private func sampleName(_ day: Int) -> String { ["高等数学", "大学英语", "药物化学"][day - 1] }

    private func sample(_ day: Int) -> NativeScheduleCourseBlock {
        let start = sampleStart(day)
        let course = NativeScheduleCourse(
            name: sampleName(day), location: "A10\(day)", startSlot: start, endSlot: start + 1
        )
        return NativeScheduleCourseBlock(id: "preview-\(day)", course: course,
                                        bigSlot: 1, startSlot: start, endSlot: start + 1)
    }
}
