import SwiftUI

/// 找共同空闲: pick whose timetables to compare, the dates, the shortest window
/// worth having and the part of the day; the free times come out by date,
/// each day drawn as a bar of classes and gaps. A window can become a 日程.
@available(iOS 17.0, *)
struct NativeCommonFreeView: View {
    @ObservedObject var store: NativeScheduleStore
    /// Opens a new 日程 at that date and time, after this page has closed.
    var createAgenda: ((_ date: String, _ start: String) -> Void)?

    @ObservedObject private var couple = NativeCoupleService.shared
    @ObservedObject private var sharing = NativeScheduleSharingService.shared
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var mine: NativeScheduleSnapshot?
    @State private var includesPartner = true
    @State private var chosenShares: Set<String> = []
    @State private var from: Date = .now
    @State private var to: Date = Calendar.current.date(byAdding: .day, value: 6, to: .now) ?? .now
    @State private var minimum = 60
    @State private var span: Span = .all
    @State private var days: [ScheduleCommonFree.Day] = []
    @State private var loading = true

    enum Span: String, CaseIterable, Identifiable {
        case day = "白天", evening = "晚上", all = "全天"
        var id: String { rawValue }
        var range: (Int, Int) {
            switch self {
            case .day: return (8 * 60, 18 * 60)
            case .evening: return (18 * 60, 22 * 60 + 30)
            case .all: return (8 * 60, 22 * 60 + 30)
            }
        }
    }

    private static let durations = [30, 60, 120, 180]

    private var partnerSnapshot: NativeScheduleSnapshot? {
        guard couple.isActive else { return nil }
        return couple.partner?.snapshot()
    }

    private var participants: [NativeScheduleSnapshot] {
        var list: [NativeScheduleSnapshot] = mine.map { [$0] } ?? []
        if includesPartner, let partnerSnapshot { list.append(partnerSnapshot) }
        for schedule in sharing.library.schedules where chosenShares.contains(schedule.meta.code) {
            list.append(schedule.snapshot())
        }
        return list
    }

    private var otherCount: Int {
        (includesPartner && partnerSnapshot != nil ? 1 : 0) + chosenShares.count
    }

    private var inputKey: String {
        [String(includesPartner), chosenShares.sorted().joined(separator: ","), NativeOccurrenceDates.string(from),
         NativeOccurrenceDates.string(to), String(minimum), span.rawValue, String(mine != nil)].joined(separator: "|")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    peopleSection
                    conditionsSection
                    resultsSection
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
            .navigationTitle("找共同空闲")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .tint(.cpuBrand)
        .task {
            if chosenShares.isEmpty, partnerSnapshot == nil,
               let code = sharing.library.cared?.meta.code ?? sharing.library.schedules.first?.meta.code {
                chosenShares = [code]
            }
            mine = await store.snapshotForCalendarImport()
        }
        .task(id: inputKey) { compute() }
    }

    // MARK: People

    private var peopleSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("和谁比", trailing: otherCount == 0 ? "只看自己的空闲" : "共 \(otherCount + 1) 人")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    person(name: "我", detail: "我的课表", tint: .cpuBrand, symbol: "person.fill", selected: true, action: nil)
                    if couple.isActive {
                        let name = couple.partnerMember?.nickname.trimmedNonEmpty ?? "TA"
                        person(name: name, detail: partnerSnapshot == nil ? "还没同步" : "情侣课表", tint: .pink,
                               symbol: "heart.fill", selected: includesPartner && partnerSnapshot != nil) {
                            includesPartner.toggle()
                        }
                        .disabled(partnerSnapshot == nil)
                    }
                    ForEach(sharing.library.schedules) { schedule in
                        let code = schedule.meta.code
                        person(name: schedule.name, detail: schedule.calendar.school.trimmedNonEmpty ?? "分享课表",
                               tint: .teal, symbol: nil, selected: chosenShares.contains(code)) {
                            if chosenShares.contains(code) { chosenShares.remove(code) } else { chosenShares.insert(code) }
                        }
                    }
                }
                .padding(.vertical, 2)
            }
            if !couple.isActive && sharing.library.schedules.isEmpty {
                Text("保存同学的分享码或绑定情侣课表后，就能在这里一起比较。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func person(name: String, detail: String, tint: Color, symbol: String?, selected: Bool,
                        action: (() -> Void)?) -> some View {
        Button {
            withAnimation(.snappy(duration: 0.2)) { action?() }
        } label: {
            VStack(spacing: 6) {
                ZStack(alignment: .bottomTrailing) {
                    Group {
                        if let symbol {
                            Image(systemName: symbol).font(.system(size: 17, weight: .semibold))
                        } else {
                            Text(String(name.prefix(1))).font(.system(size: 18, weight: .semibold, design: .rounded))
                        }
                    }
                    .foregroundStyle(selected ? .white : tint)
                    .frame(width: 48, height: 48)
                    .background(selected ? AnyShapeStyle(tint.gradient) : AnyShapeStyle(tint.opacity(0.14)), in: Circle())
                    if selected, action != nil {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(.white, tint)
                            .offset(x: 3, y: 3)
                    }
                }
                Text(name).font(.caption.weight(.semibold)).lineLimit(1)
                Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                    .multilineTextAlignment(.center)
            }
            // Wider at large text sizes, so the name and its line still fit.
            .frame(width: dynamicTypeSize.isAccessibilitySize ? 128 : dynamicTypeSize >= .xLarge ? 92 : 80)
            .padding(.vertical, 10)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(selected && action != nil ? tint.opacity(0.6) : .clear, lineWidth: 1.5)
            }
        }
        .buttonStyle(.plain)
        .allowsHitTesting(action != nil)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: Conditions

    private var conditionsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("条件", trailing: nil)
            VStack(spacing: 0) {
                Group {
                    DatePicker("开始日期", selection: $from, displayedComponents: .date)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                    Divider().padding(.leading, 14)
                    DatePicker("结束日期", selection: $to, in: from..., displayedComponents: .date)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                }
                .environment(\.locale, Locale(identifier: "zh_CN"))
                Divider().padding(.leading, 14)
                VStack(alignment: .leading, spacing: 8) {
                    Text("至少空出").font(.subheadline).foregroundStyle(.secondary)
                    Picker("至少空出", selection: $minimum) {
                        ForEach(Self.durations, id: \.self) { Text($0 < 60 ? "\($0) 分钟" : "\($0 / 60) 小时").tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                Divider().padding(.leading, 14)
                VStack(alignment: .leading, spacing: 8) {
                    Text("时段").font(.subheadline).foregroundStyle(.secondary)
                    Picker("时段", selection: $span) {
                        ForEach(Span.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .onChange(of: from) { _, value in if to < value { to = value } }
    }

    // MARK: Results

    @ViewBuilder
    private var resultsSection: some View {
        let total = days.reduce(0) { $0 + $1.windows.count }
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("空闲时段", trailing: loading ? nil : total == 0 ? nil : "\(total) 段")
            if loading {
                HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 30)
            } else if days.isEmpty {
                emptyCard("所选日期不在大家都有课表的学期内", symbol: "calendar.badge.exclamationmark")
            } else if total == 0 {
                emptyCard("这些天没有满足条件的共同空闲，试试缩短时长或换个时段", symbol: "moon.zzz")
            } else {
                ForEach(days.filter { !$0.windows.isEmpty }) { day in dayCard(day) }
            }
            Text("比较的是各自的课表（含停课、调课和调休），不包括日程等个人安排。")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .padding(.horizontal, 4)
        }
    }

    private func dayCard(_ day: ScheduleCommonFree.Day) -> some View {
        let (earliest, latest) = span.range
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(NativeOccurrenceText.date(day.date)).font(.headline)
                if let label = relativeLabel(day.date) {
                    Text(label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.cpuBrand)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Color.cpuBrand.opacity(0.12), in: Capsule())
                }
                Spacer()
                Text("\(day.windows.count) 段").font(.caption).foregroundStyle(.secondary)
            }
            ScheduleFreeDayBar(day: day, earliest: earliest, latest: latest)
            VStack(spacing: 8) {
                ForEach(day.windows) { window in windowRow(window) }
            }
        }
        .padding(14)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func windowRow(_ window: ScheduleCommonFree.Window) -> some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2).fill(Color.cpuBrand.gradient).frame(width: 4, height: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(ScheduleCommonFree.clock(window.start)) – \(ScheduleCommonFree.clock(window.end))")
                    .font(.body.weight(.semibold).monospacedDigit())
                Text(ScheduleCommonFree.durationText(window.minutes)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if let createAgenda {
                Button {
                    dismiss()
                    let date = window.date, start = ScheduleCommonFree.clock(window.start)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { createAgenda(date, start) }
                } label: {
                    Label("建日程", systemImage: "calendar.badge.plus")
                        .font(.subheadline.weight(.semibold))
                        .labelStyle(.titleAndIcon)
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
            }
        }
    }

    private func emptyCard(_ text: String, symbol: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: symbol).font(.system(size: 30)).foregroundStyle(.tertiary)
            Text(text).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 20)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func sectionTitle(_ title: String, trailing: String?) -> some View {
        HStack {
            Text(title).font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            Spacer()
            if let trailing { Text(trailing).font(.footnote).foregroundStyle(.secondary) }
        }
        .padding(.horizontal, 4)
    }

    private func relativeLabel(_ date: String) -> String? {
        let today = NativeOccurrenceDates.string(.now)
        if date == today { return "今天" }
        if date == NativeOccurrenceDates.adding(1, to: today) { return "明天" }
        return nil
    }

    private func compute() {
        guard mine != nil else { loading = true; return }
        let (earliest, latest) = span.range
        days = ScheduleCommonFree.days(
            participants, from: NativeOccurrenceDates.string(from), to: NativeOccurrenceDates.string(to),
            earliest: earliest, latest: latest, minimum: minimum
        )
        loading = false
    }
}

/// One day from the start to the end of the chosen time of day: classes as
/// grey blocks, the free windows in the brand colour, and a few hour marks.
@available(iOS 17.0, *)
private struct ScheduleFreeDayBar: View {
    let day: ScheduleCommonFree.Day
    let earliest: Int
    let latest: Int

    var body: some View {
        VStack(spacing: 4) {
            GeometryReader { proxy in
                let width = proxy.size.width
                let scale = width / CGFloat(max(1, latest - earliest))
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(uiColor: .tertiarySystemFill))
                    ForEach(Array(day.busy.enumerated()), id: \.offset) { _, range in
                        let start = max(range.lowerBound, earliest), end = min(range.upperBound, latest)
                        if end > start {
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Color.secondary.opacity(0.35))
                                .frame(width: CGFloat(end - start) * scale)
                                .offset(x: CGFloat(start - earliest) * scale)
                        }
                    }
                    ForEach(day.windows) { window in
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color.cpuBrand.gradient)
                            .frame(width: max(3, CGFloat(window.end - window.start) * scale))
                            .offset(x: CGFloat(window.start - earliest) * scale)
                    }
                }
                .clipShape(Capsule())
            }
            .frame(height: 10)
            HStack {
                Text(ScheduleCommonFree.clock(earliest))
                Spacer()
                Text(ScheduleCommonFree.clock((earliest + latest) / 2))
                Spacer()
                Text(ScheduleCommonFree.clock(latest))
            }
            .font(.caption2.monospacedDigit())
            .foregroundStyle(.tertiary)
        }
        .accessibilityHidden(true)
    }
}
