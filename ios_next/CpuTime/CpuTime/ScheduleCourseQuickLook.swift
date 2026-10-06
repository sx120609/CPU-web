import SwiftUI

/// The course quick look: the name, "weekday · periods · times", then room,
/// teacher, weeks and note. Tapping a course anywhere on the timetable opens
/// it; "编辑" swaps the same sheet to the editor.
@available(iOS 17.0, *)
struct ScheduleCourseQuickLook: View {
    let course: NativeScheduleCourse
    /// "周一 · 第 1–2 节 · 08:00–09:40".
    var schedule: String? = nil
    /// nil hides the edit button.
    var onEdit: (() -> Void)? = nil
    var onHeightChange: (CGFloat) -> Void = { _ in }

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.schedulePalette) private var palette

    private struct Detail: Identifiable {
        let title: String
        let symbol: String
        let value: String
        var id: String { title }
    }

    private static func clean(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }

    /// Rows without a value take no space.
    private var details: [Detail] {
        [("教室", "mappin.and.ellipse", ScheduleStyleTime.location(course.location)),
         ("老师", "person", Self.clean(course.teacher)),
         ("周次", "calendar", Self.clean(course.weeks)),
         ("备注", "text.alignleft", Self.clean(course.slotNote))]
            .compactMap { title, symbol, value in value.map { Detail(title: title, symbol: symbol, value: $0) } }
    }

    private var accent: Color {
        NativeScheduleThemeColor.accent(for: course.name, palette: palette, scheme: colorScheme)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header

                // The four titles are two characters each, so the values line up in a column.
                let rows = details
                if !rows.isEmpty {
                    Divider()
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(rows) { detail in
                            HStack(alignment: .firstTextBaseline, spacing: 16) {
                                Label {
                                    Text(detail.title)
                                } icon: {
                                    Image(systemName: detail.symbol)
                                        .foregroundStyle(accent)
                                        .frame(width: 18)
                                }
                                .font(.subheadline)
                                .foregroundStyle(.scheduleMeta)
                                .fixedSize()
                                Text(detail.value)
                                    .font(.body)
                                    .foregroundStyle(.primary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }

                if course.orphaned {
                    Label("教务课表里已找不到这门课，请核对后保留或删除。", systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                } else if course.custom {
                    Label("自己添加或修改过的课程", systemImage: "pencil.line")
                        .font(.footnote)
                        .foregroundStyle(.scheduleMeta)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 24)
            .padding(.bottom, 16)
            .background(GeometryReader { proxy in
                Color.clear.preference(key: ScheduleQuickLookHeightKey.self, value: proxy.size.height)
            })
            .onPreferenceChange(ScheduleQuickLookHeightKey.self) { onHeightChange($0) }
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            // The course-colour bar matches the card on the timetable.
            Capsule()
                .fill(accent)
                .frame(width: 4)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 6) {
                Text(course.name)
                    .font(.title2.weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if let schedule {
                    Label(schedule, systemImage: "clock")
                        .font(.subheadline)
                        .monospacedDigit()
                        .foregroundStyle(.scheduleMeta)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let onEdit {
                Button(action: onEdit) {
                    Text("编辑")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(.themeTint(colorScheme == .dark ? 0.2 : 0.1), in: Capsule())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.themeText)
                .accessibilityLabel("编辑课程")
            }
        }
        // The bar is as tall as the name and time lines beside it.
        .fixedSize(horizontal: false, vertical: true)
    }
}

private struct ScheduleQuickLookHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}
