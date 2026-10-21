import SwiftUI

/// The user's 日程 while the timetable draws them; nil for somebody else's timetable and for
/// static renderings (the shared image).
@available(iOS 17.0, *)
struct ScheduleAgendaContext {
    let items: [NativeAgendaItem]
    let open: (NativeAgendaOccurrence) -> Void
    let toggle: (NativeAgendaOccurrence) -> Void

    /// The timed items of a week column, beside the classes in `blocks`.
    func chips(date: String?, rowHeight: CGFloat, gap: CGFloat, blocks: [NativeScheduleCourseBlock]) -> [NativeAgendaChip] {
        guard let date, !items.isEmpty else { return [] }
        return NativeAgendaRules.chips(items, date: date, rows: NativeSchedulePeriod.bundledTimetable, rowHeight: rowHeight, gap: gap,
                                       courses: blocks.map { $0.startSlot...max($0.startSlot, $0.endSlot) })
    }

    func headerDot(date: String?) -> Bool {
        guard let date else { return false }
        return NativeAgendaRules.headerDot(items, date: date)
    }
}

@available(iOS 17.0, *)
private struct ScheduleAgendaKey: EnvironmentKey {
    static let defaultValue: ScheduleAgendaContext? = nil
}

@available(iOS 17.0, *)
extension EnvironmentValues {
    var scheduleAgenda: ScheduleAgendaContext? {
        get { self[ScheduleAgendaKey.self] }
        set { self[ScheduleAgendaKey.self] = newValue }
    }
}

/// The timed items of one week column, at their clock time. Taps are resolved by the column's
/// own gesture (see `NativeAgendaChip.frame`), so the chips take none themselves.
@available(iOS 17.0, *)
struct ScheduleAgendaChipLayer: View {
    let chips: [NativeAgendaChip]
    let columnWidth: CGFloat

    var body: some View {
        ForEach(chips) { chip in
            let frame = chip.frame(columnWidth: columnWidth)
            ScheduleAgendaChip(entry: chip.entry, narrow: chip.beside || frame.width < 28)
                .frame(width: frame.width, height: frame.height)
                .offset(x: frame.minX, y: frame.minY)
        }
        .allowsHitTesting(false)
    }
}

@available(iOS 17.0, *)
private struct ScheduleAgendaChip: View {
    let entry: NativeAgendaOccurrence
    let narrow: Bool

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        Text((entry.done ? "✓ " : "") + entry.item.title)
            .font(.system(size: narrow ? 10 : 11, weight: .semibold))
            .strikethrough(entry.done)
            .foregroundStyle(.themeText)
            .multilineTextAlignment(.center)
            .lineLimit(nil)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, narrow ? 1 : 3)
            .padding(.vertical, 2)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background { shape.fill(ScheduleThemeTintStyle(amount: 0.16)) }
            .overlay { shape.strokeBorder(.themeText, style: StrokeStyle(lineWidth: 1, dash: [3, 2])) }
            .clipShape(shape)
            .opacity(entry.done ? 0.55 : 1)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("日程，\(entry.timeText)，\(entry.item.title)\(entry.done ? "，已完成" : "")")
            .accessibilityAddTraits(.isButton)
    }
}

/// The dot under a date that has all-day items or to-dos still open.
@available(iOS 17.0, *)
struct ScheduleAgendaHeaderDot: View {
    var body: some View {
        Circle()
            .fill(.themeText)
            .frame(width: 4, height: 4)
            .accessibilityHidden(true)
    }
}

/// The day's 日程 above the day view: tick one off, open it on the Web page, or add one.
@available(iOS 17.0, *)
struct ScheduleAgendaDayList: View {
    let entries: [NativeAgendaOccurrence]
    let onToggle: (NativeAgendaOccurrence) -> Void
    let onOpen: (NativeAgendaOccurrence) -> Void
    let onAdd: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text("日程")
                    .font(.subheadline.weight(.semibold))
                Spacer(minLength: 8)
                Button(action: onAdd) {
                    Label("添加", systemImage: "plus")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 8)
                        .frame(minHeight: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.cpuBrand)
                .accessibilityLabel("添加日程")
            }
            .padding(.leading, 12)
            .padding(.trailing, 4)
            .padding(.top, 6)

            ForEach(entries) { entry in
                HStack(spacing: 4) {
                    Button { onToggle(entry) } label: {
                        Image(systemName: entry.done ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 19))
                            .foregroundStyle(entry.done ? Color.cpuBrand : Color.secondary)
                            .frame(width: 36, height: 36)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(entry.done ? "\(entry.item.title)，已完成" : "完成\(entry.item.title)")

                    Button { onOpen(entry) } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(entry.timeText)
                                .font(.caption.weight(.medium).monospacedDigit())
                                .foregroundStyle(.secondary)
                                .frame(minWidth: 76, alignment: .leading)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(entry.item.title)
                                    .font(.subheadline.weight(.medium))
                                    .strikethrough(entry.done)
                                    .foregroundStyle(entry.done ? Color.secondary : Color.primary)
                                    .lineLimit(2)
                                if !entry.item.location.isEmpty {
                                    Text(entry.item.location)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 6)
                        .padding(.trailing, 10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("在日程页打开")
                }
                .padding(.leading, 2)
            }
        }
        .padding(.bottom, 4)
        .background {
            let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
            NativeScheduleBackgroundSurface()
                .clipShape(shape)
                .overlay { shape.strokeBorder(Color.primary.opacity(0.08), lineWidth: 1) }
        }
    }
}
