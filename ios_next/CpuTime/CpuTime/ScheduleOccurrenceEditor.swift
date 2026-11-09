import SwiftUI

/// The meeting 调整这一次 works on.
struct NativeOccurrenceEditorContext: Identifiable {
    let course: NativeScheduleCourse
    /// The course's edit keys; every row of a merged course moves together.
    let keys: [String]
    /// "yyyy-MM-dd", the meeting as planned.
    let date: String
    /// Periods it is drawn on now (moved or not).
    let startSlot: Int
    let endSlot: Int
    /// The change already saved for it, when it was moved before.
    let existing: NativeScheduleOccurrenceChange?
    /// Its planned periods, before any change.
    let original: (Int, Int)?

    var id: String { "\(keys.sorted().joined(separator: ","))@\(date)" }
}

enum NativeOccurrenceText {
    static let zone = TimeZone(identifier: "Asia/Shanghai") ?? .current

    static func parse(_ value: String) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    static func string(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// "11月12日 周四".
    static func date(_ value: String) -> String {
        guard let date = parse(value) else { return value }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let parts = calendar.dateComponents([.month, .day, .weekday], from: date)
        let names = ["日", "一", "二", "三", "四", "五", "六"]
        let weekday = names[((parts.weekday ?? 1) - 1) % 7]
        return "\(parts.month ?? 0)月\(parts.day ?? 0)日 周\(weekday)"
    }

    static func slots(_ start: Int, _ end: Int) -> String {
        start == end ? "第 \(start) 节" : "第 \(start)–\(end) 节"
    }
}

/// 调整这一次: another date, other periods or another room for one meeting.
/// The rest of the semester is untouched; 恢复原安排 takes the change away.
@available(iOS 17.0, *)
struct NativeOccurrenceEditorSheet: View {
    let context: NativeOccurrenceEditorContext
    let calendar: NativeScheduleCalendar?
    let slots: [ScheduleSlot]
    /// The other courses on a date, for the clash line.
    let coursesOn: (String) -> [NativeScheduleCourseBlock]
    let save: (@escaping (String) -> NativeScheduleOccurrenceChange) async throws -> Void
    let restore: (() async throws -> Void)?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.schedulePalette) private var palette
    @State private var target: Date
    @State private var start: Int
    @State private var end: Int
    /// The first period was just picked; the next tap picks the last.
    @State private var extending = false
    @State private var location: String
    @State private var note: String
    @State private var saving = false
    @State private var error: String?

    init(context: NativeOccurrenceEditorContext, calendar: NativeScheduleCalendar?, slots: [ScheduleSlot],
         coursesOn: @escaping (String) -> [NativeScheduleCourseBlock],
         save: @escaping (@escaping (String) -> NativeScheduleOccurrenceChange) async throws -> Void,
         restore: (() async throws -> Void)?) {
        self.context = context
        self.calendar = calendar
        self.slots = slots
        self.coursesOn = coursesOn
        self.save = save
        self.restore = restore
        let existing = context.existing
        _target = State(initialValue: NativeOccurrenceText.parse(existing?.toDate ?? context.date) ?? .now)
        _start = State(initialValue: context.startSlot)
        _end = State(initialValue: context.endSlot)
        _location = State(initialValue: existing?.location ?? context.course.location ?? "")
        _note = State(initialValue: existing?.note ?? "")
    }

    private var targetDate: String { NativeOccurrenceText.string(target) }
    private var original: (Int, Int) { context.original ?? (context.startSlot, context.endSlot) }
    private var accent: Color {
        NativeScheduleThemeColor.accent(for: context.course.name, palette: palette, scheme: colorScheme)
    }

    private var termRange: ClosedRange<Date>? {
        let days = (calendar?.weeks ?? []).flatMap(\.days).compactMap(NativeOccurrenceText.parse)
        guard let first = days.min(), let last = days.max() else { return nil }
        return first...last
    }

    /// Why the chosen date cannot take the meeting, if it cannot.
    private var dateProblem: String? {
        guard let calendar else { return nil }
        guard calendar.weeks.contains(where: { $0.days.contains(targetDate) }) else { return "这一天不在本学期内" }
        if let adjustment = calendar.adjustments.first(where: { $0.date == targetDate }) {
            return adjustment.kind == "off" ? "这一天放假，课表上不会显示这节课" : "这一天是调休补课日，暂时不能把课调到这天"
        }
        return nil
    }

    private var clashes: [String] {
        coursesOn(targetDate).filter { $0.courseStartSlot <= end && start <= $0.courseEndSlot }
            .map(\.course.name).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
    }

    private var trimmedLocation: String { location.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var changed: Bool {
        targetDate != context.date || (start, end) != original
            || trimmedLocation != (context.course.location ?? "") || !note.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section { header }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))

                Section {
                    Group {
                        if let range = termRange {
                            DatePicker("日期", selection: $target, in: range, displayedComponents: .date)
                        } else {
                            DatePicker("日期", selection: $target, displayedComponents: .date)
                        }
                    }
                    .environment(\.locale, Locale(identifier: "zh_CN"))
                    .environment(\.timeZone, NativeOccurrenceText.zone)
                    if let dateProblem {
                        Label(dateProblem, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                } header: {
                    Text("改到")
                }

                Section {
                    slotPicker
                        .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
                    if !clashes.isEmpty {
                        Label("和「\(clashes.joined(separator: "」「"))」时间重叠，仍然可以保存",
                              systemImage: "exclamationmark.circle.fill")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                } header: {
                    HStack {
                        Text("节次")
                        Spacer()
                        Text(timeText).textCase(nil).monospacedDigit()
                    }
                } footer: {
                    Text(extending ? "再点一下结束的节次；只上一节就点同一个。" : "先点开始的节次，再点结束的节次。")
                }

                Section("教室") {
                    TextField("上课地点", text: $location)
                }

                Section {
                    TextField("例如：改为线上，腾讯会议号见群", text: $note, axis: .vertical)
                        .lineLimit(1...3)
                } header: {
                    Text("备注")
                } footer: {
                    Text("只改这一次，其他周照常上课。")
                }

                if let restore {
                    Section {
                        Button(role: .destructive) {
                            run { try await restore() }
                        } label: {
                            Label("恢复原安排", systemImage: "arrow.uturn.backward")
                        }
                    }
                }

                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("调整这一次")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("保存") { saveChange() }
                            .fontWeight(.semibold)
                            .disabled(!changed || dateProblem != nil)
                    }
                }
            }
            .interactiveDismissDisabled(saving)
        }
        .tint(.cpuBrand)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 2).fill(accent).frame(width: 4, height: 26)
                Text(context.course.name)
                    .font(.title2.weight(.bold))
                    .lineLimit(2)
            }
            HStack(spacing: 6) {
                Image(systemName: "calendar")
                Text("原定 \(NativeOccurrenceText.date(context.date)) · \(NativeOccurrenceText.slots(original.0, original.1))"
                     + (context.course.location?.trimmedNonEmpty.map { " · \(ScheduleClassroom.only($0))" } ?? ""))
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: Capsule())
        }
        .padding(.horizontal, 4)
    }

    private var timeText: String {
        let first = slots.first { $0.number == start }?.start ?? ""
        let last = slots.first { $0.number == end }?.end ?? ""
        return first.isEmpty || last.isEmpty ? "" : "\(first)–\(last)"
    }

    private var slotPicker: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
            ForEach(slots, id: \.number) { slot in
                let selected = (start...end).contains(slot.number)
                let wasOriginal = (original.0...original.1).contains(slot.number)
                Button {
                    pick(slot.number)
                } label: {
                    VStack(spacing: 2) {
                        Text("\(slot.number)")
                            .font(.headline.monospacedDigit())
                        Text(slot.start)
                            .font(.caption2.monospacedDigit())
                            .opacity(0.75)
                    }
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .foregroundStyle(selected ? Color.white : Color.primary)
                    .background {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(selected ? AnyShapeStyle(accent.gradient) : AnyShapeStyle(Color(uiColor: .tertiarySystemFill)))
                    }
                    .overlay {
                        if wasOriginal && !selected {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(accent.opacity(0.6), style: StrokeStyle(lineWidth: 1.2, dash: [4, 3]))
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("第 \(slot.number) 节，\(slot.start)")
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .animation(.snappy(duration: 0.18), value: start)
        .animation(.snappy(duration: 0.18), value: end)
    }

    private func pick(_ number: Int) {
        if extending, number >= start {
            end = number
            extending = false
        } else {
            start = number
            end = number
            extending = true
        }
    }

    private func saveChange() {
        let date = context.date
        let toDate = targetDate == date ? nil : targetDate
        let moved = (start, end) != original
        let room = trimmedLocation != (context.course.location ?? "") && !trimmedLocation.isEmpty ? trimmedLocation : nil
        let remark = note.trimmingCharacters(in: .whitespacesAndNewlines)
        run {
            try await save { key in
                NativeScheduleOccurrenceChange(
                    key: key, date: date, toDate: toDate,
                    startSlot: moved || toDate != nil ? start : nil, endSlot: moved || toDate != nil ? end : nil,
                    location: room, note: remark.isEmpty ? nil : remark
                )
            }
        }
    }

    private func run(_ work: @escaping () async throws -> Void) {
        saving = true
        error = nil
        Task { @MainActor in
            do {
                try await work()
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
            saving = false
        }
    }
}
