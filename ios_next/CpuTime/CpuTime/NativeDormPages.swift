import SwiftUI

/// A cell of the week grid the user tapped.
@available(iOS 17.0, *)
struct DormCellPick: Identifiable, Hashable {
    let date: String
    let period: Int
    var id: String { "\(date)#\(period)" }
}

// MARK: 一周

/// One row per period, one column per day: full-free cells solid, partly free
/// ones shaded by how many are free with a dot for each, no data hatched.
@available(iOS 17.0, *)
struct DormWeekPage: View {
    @ObservedObject var dorm: NativeDormService
    @Binding var monday: String
    @Binding var selection: DormCellPick?
    let today: String

    var body: some View {
        let grid = DormRules.weekGrid(dorm.people, monday: monday, preferredId: dorm.meId)
        VStack(alignment: .leading, spacing: 14) {
            navigator(grid)
            DormWeekGridView(dorm: dorm, grid: grid, today: today, selection: $selection)
            legend
            DormNote(text: "点一格，看那一节谁有空、谁在上什么课。", symbol: "hand.tap")
            if let names = unknownNames(grid) {
                DormNote(text: "\(names) 这周有几天没有可用课表（没同步或不在学期内），那几天的格子只算了其他人。",
                         symbol: "exclamationmark.triangle.fill", tint: .orange)
            }
        }
    }

    private func navigator(_ grid: DormWeekGrid) -> some View {
        let thisWeek = DormRules.monday(today)
        let title: String = {
            let label = monday == thisWeek ? "本周" : (monday == DormRules.addDays(thisWeek, 7) ? "下周" : (monday == DormRules.addDays(thisWeek, -7) ? "上周" : ""))
            let week = grid.teachingWeek.map { "第 \($0) 周" } ?? "不在学期内"
            return label.isEmpty ? week : "\(label) · \(week)"
        }()
        return DormPager(
            title: title,
            subtitle: "\(DormText.monthDay(grid.dates.first ?? monday)) – \(DormText.monthDay(grid.dates.last ?? monday))",
            compactSubtitle: "\(DormText.short(grid.dates.first ?? monday))–\(DormText.short(grid.dates.last ?? monday))",
            previous: "上一周", next: "下一周",
            back: monday == thisWeek ? nil : "回到本周",
            onPrevious: { monday = DormRules.addDays(monday, -7) },
            onNext: { monday = DormRules.addDays(monday, 7) },
            onBack: { monday = thisWeek }
        )
    }

    private var legend: some View {
        DormFlowLayout(spacing: 12, lineSpacing: 8) {
            legendItem("全员有空") {
                RoundedRectangle(cornerRadius: 4, style: .continuous).fill(Color.cpuBrand)
            }
            legendItem("部分有空，圆点是有空的人") {
                RoundedRectangle(cornerRadius: 4, style: .continuous).fill(Color.cpuBrand.opacity(0.35))
            }
            legendItem("都在上课") {
                RoundedRectangle(cornerRadius: 4, style: .continuous).fill(Color(uiColor: .tertiarySystemFill))
            }
            legendItem("没有数据") {
                DormHatch(spacing: 4).clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 4)
    }

    private func legendItem<Swatch: View>(_ title: String, @ViewBuilder swatch: () -> Swatch) -> some View {
        HStack(spacing: 6) {
            swatch().frame(width: 16, height: 12)
            Text(title)
        }
    }

    private func unknownNames(_ grid: DormWeekGrid) -> String? {
        let ids = Set(grid.rows.first?.cells.flatMap(\.unknownIds) ?? [])
        // Only people who have a timetable somewhere: those without any are flagged in the header.
        let names = dorm.people.filter { ids.contains($0.id) && $0.hasData }.map { dorm.name($0.id) }
        return names.isEmpty ? nil : names.joined(separator: "、")
    }
}

/// ‹ title › with an optional way back to now.
@available(iOS 17.0, *)
struct DormPager: View {
    let title: String
    let subtitle: String
    /// A shorter subtitle for when the long one does not fit on a line.
    var compactSubtitle: String? = nil
    let previous: String
    let next: String
    let back: String?
    let onPrevious: () -> Void
    let onNext: () -> Void
    let onBack: () -> Void

    var body: some View {
        DormCard(spacing: 10) {
            HStack(spacing: 10) {
                arrow("chevron.left", label: previous, action: onPrevious)
                VStack(spacing: 2) {
                    Text(title).font(.headline).multilineTextAlignment(.center)
                    ViewThatFits(in: .horizontal) {
                        Text(subtitle).fixedSize()
                        Text(compactSubtitle ?? subtitle).multilineTextAlignment(.center)
                    }
                    .font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.updatesFrequently)
                arrow("chevron.right", label: next, action: onNext)
            }
            if let back {
                Button(action: { withAnimation(.snappy(duration: 0.2)) { onBack() } }) {
                    Label(back, systemImage: "arrow.uturn.backward")
                        .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func arrow(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: { withAnimation(.snappy(duration: 0.2)) { action() } }) {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .frame(width: 40, height: 40)
                .background(Color(uiColor: .tertiarySystemFill), in: Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.cpuBrand)
        .accessibilityLabel(label)
    }
}

@available(iOS 17.0, *)
struct DormWeekGridView: View {
    @ObservedObject var dorm: NativeDormService
    let grid: DormWeekGrid
    let today: String
    @Binding var selection: DormCellPick?
    @ScaledMetric(relativeTo: .caption2) private var rowHeight: CGFloat = 34
    @ScaledMetric(relativeTo: .caption2) private var labelWidth: CGFloat = 34

    var body: some View {
        DormCard(spacing: 3) {
            HStack(spacing: 3) {
                Color.clear.frame(width: labelWidth, height: 1)
                ForEach(Array(grid.dates.enumerated()), id: \.offset) { index, date in
                    dayHeader(index: index, date: date)
                }
            }
            .padding(.bottom, 3)
            ForEach(grid.rows, id: \.period.number) { row in
                HStack(spacing: 3) {
                    VStack(spacing: 0) {
                        Text("\(row.period.number)").font(.caption.weight(.semibold)).monospacedDigit()
                        Text(DormRules.clock(row.period.start)).font(.system(size: 9).monospacedDigit()).foregroundStyle(.secondary)
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(width: labelWidth, height: rowHeight)
                    .accessibilityHidden(true)
                    ForEach(row.cells, id: \.date) { cell in
                        cellButton(cell)
                    }
                }
                .padding(.top, row.breakBefore ? 7 : 0)
            }
        }
        // A grid of 7 columns cannot grow with the text; the details sheet does.
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
    }

    private func dayHeader(index: Int, date: String) -> some View {
        let isToday = date == today
        return VStack(spacing: 1) {
            Text(DormRules.weekdays[index]).font(.caption2.weight(.semibold))
            Text(isToday ? "今天" : DormText.short(date)).font(.system(size: 9.5).monospacedDigit())
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .foregroundStyle(isToday ? Color.white : Color.secondary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
        .background(isToday ? AnyShapeStyle(Color.cpuBrand) : AnyShapeStyle(Color.clear), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func cellButton(_ cell: DormWeekCell) -> some View {
        let pick = DormCellPick(date: cell.date, period: cell.period.number)
        let selected = selection == pick
        return Button {
            selection = pick
        } label: {
            DormWeekCellView(dorm: dorm, cell: cell)
                .frame(maxWidth: .infinity)
                .frame(height: rowHeight)
                .overlay {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .strokeBorder(Color.primary.opacity(selected ? 0.9 : 0), lineWidth: 2)
                }
                .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(DormPressStyle())
        .accessibilityLabel(accessibilityLabel(cell))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func accessibilityLabel(_ cell: DormWeekCell) -> String {
        let day = DormRules.weekday(cell.date)
        var text = "\(day > 0 ? DormRules.weekdays[day - 1] : "") 第 \(cell.period.number) 节，\(DormRules.cellSummary(cell))"
        if cell.level == .some { text += "：" + cell.freeIds.map(dorm.name).joined(separator: "、") }
        return text
    }
}

@available(iOS 17.0, *)
struct DormPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

@available(iOS 17.0, *)
struct DormWeekCellView: View {
    @ObservedObject var dorm: NativeDormService
    let cell: DormWeekCell
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 7, style: .continuous)
        ZStack {
            switch cell.level {
            case .unknown:
                DormHatch().clipShape(shape)
                Text("?").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
            case .none:
                shape.fill(Color(uiColor: .tertiarySystemFill))
            case .all:
                shape.fill(Color.cpuBrand.gradient)
                Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white.opacity(0.95))
            case .some:
                // Darker for more people free; dark mode needs a wider range to tell them apart.
                shape.fill(Color.cpuBrand.opacity(colorScheme == .dark ? 0.16 + 0.6 * cell.freeRatio : 0.14 + 0.46 * cell.freeRatio))
                dots
            }
        }
    }

    /// One dot per free roommate, four to a row.
    private var dots: some View {
        let rows = stride(from: 0, to: cell.freeIds.count, by: 4).map { Array(cell.freeIds[$0..<min($0 + 4, cell.freeIds.count)]) }
        return VStack(spacing: 2) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, ids in
                HStack(spacing: 2) {
                    ForEach(ids, id: \.self) { DormDot(color: dorm.color($0), size: 7) }
                }
            }
        }
    }
}

/// What a tapped cell holds: who is free, who is in which class, who has no data.
@available(iOS 17.0, *)
struct DormCellDetail: View {
    @ObservedObject var dorm: NativeDormService
    let cell: DormWeekCell
    let today: String
    let openDay: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    verdict
                    if !cell.freeIds.isEmpty {
                        DormSectionTitle(title: "有空", trailing: "\(cell.freeIds.count) 人")
                        DormCard {
                            DormFlowLayout(spacing: 8, lineSpacing: 8) {
                                ForEach(cell.freeIds, id: \.self) { DormNameChip(name: dorm.name($0), color: dorm.color($0)) }
                            }
                        }
                    }
                    if !cell.busy.isEmpty {
                        DormSectionTitle(title: "在上课", trailing: "\(cell.busy.count) 人")
                        DormCard(spacing: 10) {
                            ForEach(cell.busy, id: \.id) { item in
                                HStack(alignment: .firstTextBaseline, spacing: 10) {
                                    DormDot(color: dorm.color(item.id), size: 9)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(dorm.name(item.id)).font(.subheadline.weight(.semibold))
                                        Text(item.courses.joined(separator: "、")).font(.subheadline).foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 0)
                                }
                                .accessibilityElement(children: .combine)
                            }
                        }
                    }
                    if !cell.unknownIds.isEmpty {
                        DormSectionTitle(title: "没有数据")
                        DormCard {
                            Text("\(cell.unknownIds.map(dorm.name).joined(separator: "、"))（没同步或不在学期内）")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(16)
            }
            .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
            .safeAreaInset(edge: .bottom) {
                Button {
                    dismiss()
                    openDay(cell.date)
                } label: {
                    Label("看这天连续的空闲时段", systemImage: "clock.badge.checkmark")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: 14))
                .padding(.horizontal, 16)
                .padding(.top, 10)
                .padding(.bottom, 6)
                .background(.bar)
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } }
            }
        }
        .tint(.cpuBrand)
    }

    private var title: String {
        "\(DormRules.dateLabel(cell.date, today: today)) · 第 \(cell.period.number) 节"
    }

    private var verdict: some View {
        let (symbol, tint): (String, Color) = {
            switch cell.level {
            case .all: return ("checkmark.circle.fill", .cpuBrand)
            case .some: return ("circle.lefthalf.filled", .cpuBrand)
            case .none: return ("books.vertical.fill", .secondary)
            case .unknown: return ("questionmark.circle.fill", .secondary)
            }
        }()
        return HStack(spacing: 12) {
            Image(systemName: symbol).font(.title2).foregroundStyle(tint).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(DormRules.cellSummary(cell)).font(.title3.weight(.semibold))
                Text("\(DormRules.spanText(cell.period.start, cell.period.end))").font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: 空闲

/// The continuous free blocks of one day, with who is in class when.
@available(iOS 17.0, *)
struct DormFreePage: View {
    @ObservedObject var dorm: NativeDormService
    @Binding var date: String
    @Binding var minFree: Int?
    let today: String
    @Environment(\.dynamicTypeSize) private var typeSize

    static let windowsAnchor = "dorm-windows"

    var body: some View {
        let day = DormRules.availability(dorm.people, date: date, minFree: minFree)
        VStack(alignment: .leading, spacing: 14) {
            DormPager(
                title: DormRules.dateLabel(date, today: today),
                subtitle: DormText.monthDay(date),
                previous: "前一天", next: "后一天",
                back: date == today ? nil : "回到今天",
                onPrevious: { date = DormRules.addDays(date, -1) },
                onNext: { date = DormRules.addDays(date, 1) },
                onBack: { date = today }
            )
            weekStrip
            filter(day)
            DormSectionTitle(title: "当天时间轴", trailing: DormRules.spanText(day.window.start, day.window.end))
            DormDayLanes(dorm: dorm, day: day)
            DormSectionTitle(title: "空闲时段", trailing: day.windows.isEmpty ? nil : "\(day.windows.count) 段")
                .id(Self.windowsAnchor)
            if day.windows.isEmpty {
                DormStateCard(symbol: day.knownIds.isEmpty ? "questionmark.circle" : "moon.zzz",
                              title: day.knownIds.isEmpty ? "没法判断" : "没有凑得齐的空闲",
                              message: DormRules.freeEmptyText(day, explicitMinFree: minFree != nil))
            } else {
                DormCard(spacing: 0) {
                    ForEach(Array(day.windows.enumerated()), id: \.offset) { index, window in
                        if index > 0 { Divider().padding(.vertical, 10) }
                        windowRow(window, day: day)
                    }
                }
            }
            if !day.unknownIds.isEmpty {
                DormNote(text: "\(day.unknownIds.map(dorm.name).joined(separator: "、")) 这天没有可用课表（没同步或不在学期内），"
                         + (day.knownIds.isEmpty ? "这天的空闲时间没法判断。" : "上面只算了已同步的 \(day.knownIds.count) 人，不能代表全宿舍。"),
                         symbol: "exclamationmark.triangle.fill", tint: .orange)
            }
            DormSectionTitle(title: "每个人的课")
            DormCard(spacing: 0) {
                ForEach(Array(dorm.people.enumerated()), id: \.element.id) { index, person in
                    if index > 0 { Divider().padding(.vertical, 10) }
                    courseRow(person)
                }
            }
            DormNote(text: "按各自的课表算（含停课、调课、调休和自己改过的上课时间），不包括日程等个人安排；少于 \(DormRules.minimumWindow) 分钟的空档不显示。")
        }
    }

    /// The seven days of the week shown, to jump between them.
    private var weekStrip: some View {
        let monday = DormRules.monday(date)
        return HStack(spacing: 4) {
            ForEach(0..<7, id: \.self) { offset in
                let value = DormRules.addDays(monday, offset)
                let selected = value == date
                Button {
                    withAnimation(.snappy(duration: 0.2)) { date = value }
                } label: {
                    VStack(spacing: 3) {
                        Text(DormRules.weekdays[offset].dropFirst()).font(.caption2.weight(.semibold))
                            .foregroundStyle(selected ? Color.white.opacity(0.85) : Color.secondary)
                        Text(String(Int(value.suffix(2)) ?? 0)).font(.subheadline.weight(.semibold)).monospacedDigit()
                            .foregroundStyle(selected ? Color.white : Color.primary)
                        Circle().fill(value == today ? (selected ? Color.white : Color.cpuBrand) : Color.clear).frame(width: 4, height: 4)
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7)
                    .background(selected ? AnyShapeStyle(Color.cpuBrand.gradient) : AnyShapeStyle(Color(uiColor: .secondarySystemGroupedBackground)),
                                in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(DormRules.dateLabel(value, today: today))
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    private func filter(_ day: DormDayAvailability) -> some View {
        let total = max(1, dorm.people.count)
        return VStack(alignment: .leading, spacing: 8) {
            DormSectionTitle(title: "需要几个人有空")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(DormRules.minFreeChoices(memberCount: total), id: \.self) { choice in
                        let label = choice.map { "至少 \($0) 人" }
                            ?? (day.unknownIds.isEmpty ? "全员（\(total) 人）" : "已同步的人（\(day.knownIds.count) 人）")
                        let selected = choice == minFree
                        Button {
                            withAnimation(.snappy(duration: 0.2)) { minFree = choice }
                        } label: {
                            Text(label)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(selected ? Color.white : Color.primary)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(selected ? AnyShapeStyle(Color.cpuBrand.gradient) : AnyShapeStyle(Color(uiColor: .secondarySystemGroupedBackground)), in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 2)
            }
        }
    }

    private func windowRow(_ window: DormFreeWindow, day: DormDayAvailability) -> some View {
        let partial = window.freeIds.count < day.knownIds.count
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
        return layout {
            HStack(alignment: .top, spacing: 12) {
                RoundedRectangle(cornerRadius: 2).fill(Color.cpuBrand.gradient).frame(width: 4).frame(minHeight: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(DormRules.spanText(window.start, window.end)).font(.body.weight(.semibold).monospacedDigit())
                    Text(DormRules.durationText(window.minutes)).font(.caption).foregroundStyle(.secondary)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            if !typeSize.isAccessibilitySize { Spacer(minLength: 4) }
            VStack(alignment: typeSize.isAccessibilitySize ? .leading : .trailing, spacing: 6) {
                Text(DormRules.windowLabel(window, day: day))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.cpuBrand)
                if partial {
                    DormFlowLayout(spacing: 4, lineSpacing: 4) {
                        ForEach(window.freeIds, id: \.self) { id in
                            HStack(spacing: 4) {
                                DormDot(color: dorm.color(id), size: 7)
                                Text(dorm.name(id)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func courseRow(_ person: DormPerson) -> some View {
        let courses = person.courses(on: date)
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6)) : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 10))
        return layout {
            DormPersonName(dorm: dorm, id: person.id)
                .frame(minWidth: typeSize.isAccessibilitySize ? nil : 64, alignment: .leading)
            if let courses, !courses.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(courses.enumerated()), id: \.offset) { _, course in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(DormRules.spanText(course.start, course.end)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            Text(course.name).font(.subheadline)
                        }
                    }
                }
            } else {
                Text(courses == nil ? "没有数据" : "这天没课")
                    .font(.subheadline)
                    .foregroundStyle(courses == nil ? Color.orange : Color.secondary)
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: 0) }
        }
        .accessibilityElement(children: .combine)
    }
}

/// A roommate's name in their colour, readable on the card.
@available(iOS 17.0, *)
struct DormPersonName: View {
    @ObservedObject var dorm: NativeDormService
    let id: Int
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(spacing: 6) {
            DormDot(color: dorm.color(id), size: 8)
            Text(dorm.name(id))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(DormRules.tone(color: dorm.color(id), dark: colorScheme == .dark).name.color)
                .lineLimit(1)
        }
    }
}

/// The day from the dorm's first bell to its last: a lane per roommate with
/// their classes in their colour, the free blocks as bands across all of them.
@available(iOS 17.0, *)
struct DormDayLanes: View {
    @ObservedObject var dorm: NativeDormService
    let day: DormDayAvailability
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .caption) private var nameWidth: CGFloat = 52

    var body: some View {
        DormCard(spacing: 8) {
            lane(title: "有空", titleColor: .cpuBrand, dot: nil) { width in
                ForEach(Array(day.windows.enumerated()), id: \.offset) { _, window in
                    band(window.start, window.end, width: width).fill(Color.cpuBrand.gradient)
                }
            }
            ForEach(dorm.people) { person in
                let spans = DormRules.busySpans(person, date: day.date)
                lane(title: dorm.name(person.id), titleColor: .primary, dot: person.color) { width in
                    if let spans {
                        ForEach(Array(day.windows.enumerated()), id: \.offset) { _, window in
                            band(window.start, window.end, width: width).fill(Color.cpuBrand.opacity(0.12))
                        }
                        ForEach(Array(spans.enumerated()), id: \.offset) { _, span in
                            band(span.start, span.end, width: width).fill(DormRules.swatch(person.color).color.gradient)
                        }
                    } else {
                        DormHatch(spacing: 4)
                    }
                }
            }
            if !typeSize.isAccessibilitySize {
                HStack {
                    Text(DormRules.clock(day.window.start))
                    Spacer()
                    Text(DormRules.clock((day.window.start + day.window.end) / 2 / 30 * 30))
                    Spacer()
                    Text(DormRules.clock(day.window.end))
                }
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.tertiary)
                .padding(.leading, nameWidth + 8)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var scale: Double { Double(max(1, day.window.end - day.window.start)) }

    /// A stretch of the day as a bar in a lane `width` wide.
    private func band(_ start: Int, _ end: Int, width: CGFloat) -> Path {
        let from = max(start, day.window.start), to = min(end, day.window.end)
        let x = CGFloat(Double(from - day.window.start) / scale) * width
        let w = max(2, CGFloat(Double(max(0, to - from)) / scale) * width)
        return Path(roundedRect: CGRect(x: x, y: 0, width: w, height: 12), cornerRadius: 2)
    }

    @ViewBuilder
    private func lane<Marks: View>(title: String, titleColor: Color, dot: String?, @ViewBuilder marks: @escaping (CGFloat) -> Marks) -> some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout(spacing: 8))
        layout {
            HStack(spacing: 5) {
                if let dot { DormDot(color: dot, size: 7) }
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(titleColor).lineLimit(1).minimumScaleFactor(0.75)
            }
            .frame(width: typeSize.isAccessibilitySize ? nil : nameWidth, alignment: .leading)
            GeometryReader { proxy in
                ZStack(alignment: .topLeading) {
                    Color(uiColor: .tertiarySystemFill)
                    marks(proxy.size.width)
                }
            }
            .frame(height: 12)
            .clipShape(Capsule())
        }
    }

    private var accessibilityText: String {
        if day.windows.isEmpty { return "当天时间轴：没有满足条件的空闲时段" }
        return "当天时间轴：" + day.windows.map { DormRules.spanText($0.start, $0.end) }.joined(separator: "，") + " 有空"
    }
}

// MARK: 早八

/// The next seven days: who has period 1, with today's or tomorrow's line on top.
@available(iOS 17.0, *)
struct DormMorningPage: View {
    @ObservedObject var dorm: NativeDormService
    let today: String
    let minute: Int
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let days = DormRules.morningDays(dorm.people, dates: DormRules.dateRange(today, count: 7))
        let next = DormRules.nextMorning(days, today: today, minute: minute)
        // The same people missing every day are said once, not on every row.
        let steady = Set(days.map(\.unknownCount)).count == 1 && (days.first?.unknownCount ?? 0) > 0
        VStack(alignment: .leading, spacing: 14) {
            banner(next, days: days)
            if steady, let missing = missingNames(days) {
                DormNote(text: "\(missing) 还没有可用课表，名单可能不全。", symbol: "exclamationmark.triangle.fill", tint: .orange)
            }
            DormSectionTitle(title: "未来 7 天", trailing: "\(days.filter { !$0.duties.isEmpty }.count) 天有早八")
            DormCard(spacing: 0) {
                ForEach(Array(days.enumerated()), id: \.element.date) { index, day in
                    if index > 0 { Divider().padding(.vertical, 10) }
                    row(day, flagsMissing: !steady)
                }
            }
            DormNote(text: "早八按「占用第 1 节」判断：自己把课改到 07:40 的第 3 节不算。课表没同步的室友不会出现在名单里。")
        }
    }

    private func banner(_ next: (day: DormMorningDay, isToday: Bool)?, days: [DormMorningDay]) -> some View {
        let warm = Color.orange
        return HStack(alignment: .top, spacing: 14) {
            Image(systemName: next == nil ? "moon.stars.fill" : "alarm.fill")
                .font(.title2)
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .background((next == nil ? Color.indigo : warm).gradient, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 8) {
                if let next {
                    Text(next.isToday ? "今天还有早八" : "\(DormRules.dayName(next.day.date, today: today))早八")
                        .font(.headline)
                    DormFlowLayout(spacing: 6, lineSpacing: 6) {
                        ForEach(next.day.duties, id: \.id) { duty in
                            DormNameChip(name: dorm.name(duty.id), color: dorm.color(duty.id), detail: DormRules.clock(duty.start))
                        }
                    }
                } else {
                    Text("最近没有早八").font(.headline)
                    Text(DormRules.morningSummaryText(days)).font(.subheadline).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background((next == nil ? Color.indigo : warm).opacity(colorScheme == .dark ? 0.2 : 0.1),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func missingNames(_ days: [DormMorningDay]) -> String? {
        guard let first = days.first else { return nil }
        let names = dorm.people.filter { $0.courses(on: first.date) == nil }.map { dorm.name($0.id) }
        return names.isEmpty ? nil : names.joined(separator: "、")
    }

    private func row(_ day: DormMorningDay, flagsMissing: Bool) -> some View {
        let isToday = day.date == today
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
        return layout {
            VStack(alignment: .leading, spacing: 1) {
                Text(DormRules.dayName(day.date, today: today))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(isToday ? Color.cpuBrand : Color.primary)
                Text(DormText.short(day.date)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            .frame(minWidth: typeSize.isAccessibilitySize ? nil : 48, alignment: .leading)
            VStack(alignment: .leading, spacing: 6) {
                if day.duties.isEmpty {
                    Text(DormRules.morningNoneText(day)).font(.subheadline).foregroundStyle(.secondary)
                } else {
                    DormFlowLayout(spacing: 6, lineSpacing: 6) {
                        ForEach(day.duties, id: \.id) { duty in
                            DormNameChip(name: dorm.name(duty.id), color: dorm.color(duty.id), detail: duty.course)
                        }
                    }
                }
                if flagsMissing, day.unknownCount > 0 {
                    Text("\(day.unknownCount) 人未同步")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(Color.orange.opacity(0.14), in: Capsule())
                }
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: 0) }
        }
        .accessibilityElement(children: .combine)
    }
}
