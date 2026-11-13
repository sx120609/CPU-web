import AppIntents
import SwiftUI
import WidgetKit

// The 日程 widget, after NapTable's sticky-note widget: the open to-dos and the
// coming fortnight of 日程, ticked off right on the widget. Data and rules are
// in AgendaWidgetSnapshot.swift; the app side is NativeAgendaWidgetBridge.
// Like ScheduleWidgetViews.swift, the app's Debug build compiles this file for
// the widget gallery.

// MARK: - Configuration

@available(iOS 17.0, *)
enum AgendaWidgetScopeOption: String, AppEnum {
    case all, todos, events

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "显示范围"
    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .all: "全部日程",
        .todos: "只看待办",
        .events: "只看有时间的日程",
    ]
}

@available(iOS 17.0, *)
struct AgendaWidgetFilter: Equatable, Sendable {
    var scope: AgendaWidgetScopeOption = .all
    var showsUndated = true

    func apply(_ entries: [AgendaWidgetRules.Entry]) -> [AgendaWidgetRules.Entry] {
        entries.filter { entry in
            if !showsUndated && entry.group == .undated { return false }
            switch scope {
            case .all: return true
            case .todos: return entry.item.todo
            case .events: return !entry.item.start.isEmpty
            }
        }
    }
}

@available(iOS 17.0, *)
struct AgendaWidgetIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "日程"
    static let description = IntentDescription("选择小组件显示哪些日程。")

    @Parameter(title: "显示范围", default: .all)
    var scope: AgendaWidgetScopeOption

    @Parameter(title: "显示没有日期的待办", default: true)
    var showsUndated: Bool

    init() {}

    var filter: AgendaWidgetFilter { AgendaWidgetFilter(scope: scope, showsUndated: showsUndated) }
}

/// The check circle on the widget. It runs in the widget extension: the tick
/// is kept in the App Group and shown at once, and the app saves it through
/// its signed-in page the next time it is open (`NativeAgendaWidgetBridge`).
@available(iOS 17.0, *)
struct CompleteAgendaIntent: AppIntent {
    static let title: LocalizedStringResource = "完成日程"
    static let isDiscoverable = false

    @Parameter(title: "日程")
    var itemID: String

    @Parameter(title: "日期")
    var date: String

    init() {}

    init(itemID: String, date: String) {
        self.itemID = itemID
        self.date = date
    }

    func perform() async throws -> some IntentResult {
        AgendaWidgetStore.addPending(AgendaWidgetCompletion(itemID: itemID, date: date, done: true))
        WidgetCenter.shared.reloadTimelines(ofKind: AgendaWidgetSnapshot.widgetKind)
        return .result()
    }
}

// MARK: - Timeline

@available(iOS 17.0, *)
struct AgendaWidgetEntry: TimelineEntry {
    enum State: Equatable {
        case loaded([AgendaWidgetRules.Entry])
        case missing
        case failed
    }

    let date: Date
    var state: State

    /// A fortnight of sample 日程 around `now`, for the widget gallery and the picker.
    static func sample(at now: Date) -> Self {
        let today = AgendaWidgetClock.date(now)
        func day(_ offset: Int) -> String { AgendaWidgetClock.adding(offset, to: today) }
        let soon = AgendaWidgetClock.minutes(now) + 40
        let soonText = String(format: "%02d:%02d", min(23, soon / 60), soon % 60)
        let items: [AgendaWidgetSnapshot.Item] = [
            .init(itemID: "s1", date: day(-2), title: "交药理学实验报告", todo: true, start: "", end: "", location: "", repeats: false, done: false),
            .init(itemID: "s2", date: day(0), title: "领取实验服", todo: true, start: "", end: "", location: "", repeats: false, done: false),
            .init(itemID: "s3", date: day(0), title: "组会：课题进展汇报", todo: false, start: soonText, end: "", location: "药学楼 302", repeats: false, done: false),
            .init(itemID: "s4", date: day(0), title: "羽毛球", todo: false, start: "19:00", end: "20:30", location: "体育馆", repeats: true, done: false),
            .init(itemID: "s5", date: day(1), title: "药物分析期中复习", todo: false, start: "14:00", end: "16:00", location: "图书馆", repeats: false, done: false),
            .init(itemID: "s6", date: day(3), title: "学术讲座：AI 与新药发现", todo: false, start: "14:00", end: "16:00", location: "江宁校区 药学楼 101", repeats: false, done: false),
            .init(itemID: "s7", date: "", title: "给导员交材料", todo: true, start: "", end: "", location: "", repeats: false, done: false),
        ]
        let snapshot = AgendaWidgetSnapshot(version: AgendaWidgetSnapshot.currentVersion, today: today, items: items)
        return Self(date: now, state: .loaded(AgendaWidgetRules.entries(snapshot, pending: [], now: now)))
    }
}

@available(iOS 17.0, *)
struct AgendaWidgetProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> AgendaWidgetEntry { .sample(at: .now) }

    func snapshot(for configuration: AgendaWidgetIntent, in context: Context) async -> AgendaWidgetEntry {
        if context.isPreview { return .sample(at: .now) }
        return Self.entries(at: .now, filter: configuration.filter).first ?? .sample(at: .now)
    }

    func timeline(for configuration: AgendaWidgetIntent, in context: Context) async -> Timeline<AgendaWidgetEntry> {
        Timeline(entries: Self.entries(at: .now, filter: configuration.filter), policy: .atEnd)
    }

    static func entries(at now: Date, filter: AgendaWidgetFilter) -> [AgendaWidgetEntry] {
        switch AgendaWidgetStore.read() {
        case .loaded(let snapshot):
            let pending = AgendaWidgetStore.pending()
            return AgendaWidgetRules.timelineDates(snapshot, pending: pending, now: now).map { date in
                AgendaWidgetEntry(date: date, state: .loaded(filter.apply(AgendaWidgetRules.entries(snapshot, pending: pending, now: date))))
            }
        case .missing:
            return [AgendaWidgetEntry(date: now, state: .missing)]
        case .failed:
            return [AgendaWidgetEntry(date: now, state: .failed)]
        }
    }
}

// MARK: - Widget

@available(iOS 17.0, *)
struct AgendaWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: AgendaWidgetSnapshot.widgetKind, intent: AgendaWidgetIntent.self,
                               provider: AgendaWidgetProvider()) { entry in
            AgendaWidgetView(entry: entry)
        }
        .configurationDisplayName("日程")
        .description("列出待办和接下来两周的日程，可以直接勾选完成。")
        .supportedFamilies([
            .systemSmall, .systemMedium, .systemLarge,
            .accessoryInline, .accessoryCircular, .accessoryRectangular,
        ])
    }
}

/// Links into the app's 日程 sheets (`NativeAgendaWidgetLink` in the app).
enum AgendaWidgetLinks {
    static let list = URL(string: "cputime-next://schedule?action=agenda-list")!
    static let new = URL(string: "cputime-next://schedule?action=agenda-new")!

    static func item(_ item: AgendaWidgetSnapshot.Item) -> URL {
        var components = URLComponents(string: "cputime-next://schedule")!
        components.queryItems = [
            URLQueryItem(name: "action", value: "agenda-item"),
            URLQueryItem(name: "item", value: item.itemID),
            URLQueryItem(name: "date", value: item.date),
        ]
        return components.url ?? list
    }
}

// MARK: - Views

@available(iOS 17.0, *)
struct AgendaWidgetView: View {
    let entry: AgendaWidgetEntry
    var overrides = ScheduleWidgetOverrides()
    @Environment(\.widgetFamily) private var systemFamily

    private var family: WidgetFamily { overrides.family ?? systemFamily }

    var body: some View {
        let defaults = UserDefaults(suiteName: AppWidgetConfiguration.appGroup)
        let style = overrides.style ?? WidgetStyle.load(from: defaults)
        let theme = overrides.theme ?? AppWidgetConfiguration.scheduleTheme
        let textSize = family.isAccessory ? .standard : (overrides.options ?? AppWidgetConfiguration.displayOptions).textSize
        WidgetTextScaled(size: textSize) { content }
            .environment(\.scheduleWidgetStyle, style)
            .environment(\.scheduleWidgetTheme, theme)
            .environment(\.scheduleWidgetFamily, family)
            .environment(\.scheduleWidgetNow, entry.date)
            .containerBackground(for: .widget) {
                if family.isAccessory {
                    Color.clear
                } else {
                    ScheduleWidgetBackground(style: style)
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch entry.state {
        case .loaded(let entries):
            let model = AgendaWidgetModel(entries: entries, now: entry.date)
            switch family {
            case .systemSmall: AgendaSmallView(model: model)
            case .systemMedium: AgendaMediumView(model: model)
            case .systemLarge, .systemExtraLarge: AgendaLargeView(model: model)
            case .accessoryInline: AgendaInlineView(model: model)
            case .accessoryCircular: AgendaCircularView(model: model)
            default: AgendaRectangularView(model: model)
            }
        case .missing:
            AgendaMessageView(symbol: "checklist", title: "打开 App 同步日程", compact: family.isAccessory)
        case .failed:
            AgendaMessageView(symbol: "exclamationmark.triangle", title: "日程读取失败，请打开 App", compact: family.isAccessory)
        }
    }
}

@available(iOS 17.0, *)
private struct AgendaWidgetModel {
    let now: Date
    let entries: [AgendaWidgetRules.Entry]
    let sections: [AgendaWidgetRules.Section]
    let counts: (today: Int, overdue: Int, total: Int)

    init(entries: [AgendaWidgetRules.Entry], now: Date) {
        self.now = now
        self.entries = entries
        sections = AgendaWidgetRules.sections(entries)
        counts = AgendaWidgetRules.counts(entries)
    }

    func label(_ entry: AgendaWidgetRules.Entry) -> AgendaWidgetRules.Label? {
        AgendaWidgetRules.label(for: entry.item, now: now)
    }

    var summary: String {
        var parts: [String] = []
        if counts.today > 0 { parts.append("今天 \(counts.today)") }
        if counts.overdue > 0 { parts.append("逾期 \(counts.overdue)") }
        return parts.isEmpty ? "共 \(counts.total) 项" : parts.joined(separator: " · ")
    }
}

@available(iOS 17.0, *)
private enum AgendaWidgetPalette {
    static let overdue = Color(uiColor: .systemRed)

    static func symbol(_ item: AgendaWidgetSnapshot.Item) -> String {
        if item.todo { return "checklist" }
        if item.start.isEmpty { return "calendar" }
        return item.repeats ? "repeat" : "clock"
    }
}

/// 页眉：「日程」＋「今天 2 · 逾期 1」，逾期那段用红字。
@available(iOS 17.0, *)
private struct AgendaHeader: View {
    let model: AgendaWidgetModel
    @Environment(\.scheduleWidgetStyle) private var style
    @Environment(\.scheduleWidgetTheme) private var theme
    @WidgetStyleColors private var colors

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Label {
                Text("日程")
            } icon: {
                Image(systemName: "checklist")
            }
            .font(style.widgetFont(size: 15, weight: .semibold))
            .foregroundStyle(colors.accent(for: theme))
            .widgetAccentable()
            Spacer(minLength: 4)
            if !model.entries.isEmpty {
                summary.font(style.widgetFont(size: 12)).lineLimit(1)
            }
        }
    }

    private var summary: Text {
        let counts = model.counts
        guard counts.today > 0 || counts.overdue > 0 else {
            return Text("共 \(counts.total) 项").foregroundStyle(colors.secondary)
        }
        var text = Text("")
        if counts.today > 0 { text = text + Text("今天 \(counts.today)").foregroundStyle(colors.secondary) }
        if counts.today > 0 && counts.overdue > 0 { text = text + Text(" · ").foregroundStyle(colors.secondary) }
        if counts.overdue > 0 { text = text + Text("逾期 \(counts.overdue)").foregroundStyle(AgendaWidgetPalette.overdue) }
        return text
    }
}

/// 时间：一小时内开始的用系统自动走的倒计时，逾期用红字。
@available(iOS 17.0, *)
private struct AgendaTimeText: View {
    let label: AgendaWidgetRules.Label
    let now: Date
    var size: CGFloat = 12
    @Environment(\.scheduleWidgetStyle) private var style
    @Environment(\.scheduleWidgetTheme) private var theme
    @WidgetStyleColors private var colors

    var body: some View {
        Group {
            if let target = label.countdownTo, target > now {
                // 「还有 12:34」：倒计时自己会走，不用为它刷新时间线。
                HStack(spacing: 2) {
                    Text("还有")
                    Text(timerInterval: now...target, countsDown: true, showsHours: false)
                        .monospacedDigit()
                        .frame(maxWidth: 40, alignment: .leading)
                }
            } else {
                Text(label.text)
            }
        }
        // Labels mix words and times («明天 14:00»): the running text's face, digits kept even.
        .font(style.widgetFont(size: size, weight: label.overdue || label.inProgress ? .semibold : .regular))
        .monospacedDigit()
        .foregroundStyle(label.overdue ? AgendaWidgetPalette.overdue
                         : (label.inProgress || label.countdownTo != nil ? colors.accent(for: theme) : colors.secondary))
        .lineLimit(1)
    }
}

/// 勾选圈用 `Toggle(isOn:intent:)`：系统点下就先把圈画成勾上，再在后台跑意图。
@available(iOS 17.0, *)
private struct AgendaCheck: View {
    let entry: AgendaWidgetRules.Entry
    @Environment(\.scheduleWidgetTheme) private var theme
    @WidgetStyleColors private var colors

    var body: some View {
        Toggle(isOn: false, intent: CompleteAgendaIntent(itemID: entry.item.itemID, date: entry.item.date)) {
            Text("完成「\(entry.item.title)」")
        }
        .toggleStyle(AgendaCheckStyle(tint: entry.group == .overdue ? AgendaWidgetPalette.overdue : colors.accent(for: theme),
                                      title: entry.item.title))
    }
}

@available(iOS 17.0, *)
private struct AgendaCheckStyle: ToggleStyle {
    let tint: Color
    let title: String

    func makeBody(configuration: Configuration) -> some View {
        Image(systemName: configuration.isOn ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 18, weight: .regular))
            .foregroundStyle(tint)
            .widgetAccentable()
            .frame(width: 26, height: 26)
            .contentShape(Rectangle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("完成「\(title)」")
            .accessibilityValue(configuration.isOn ? "已完成" : "未完成")
    }
}

/// 一行：勾选圈＋图标＋标题＋时间。点圈以外的地方打开这条日程。
@available(iOS 17.0, *)
private struct AgendaRow: View {
    let entry: AgendaWidgetRules.Entry
    let model: AgendaWidgetModel
    var titleSize: CGFloat = 14
    var showsLocation = false
    @Environment(\.scheduleWidgetStyle) private var style
    @Environment(\.scheduleWidgetTheme) private var theme
    @WidgetStyleColors private var colors

    var body: some View {
        HStack(spacing: 4) {
            AgendaCheck(entry: entry)
            Link(destination: AgendaWidgetLinks.item(entry.item)) {
                HStack(spacing: 7) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(entry.item.title)
                            .font(style.widgetFont(size: titleSize, weight: .medium))
                            .foregroundStyle(colors.primary)
                            .lineLimit(1)
                            .privacySensitive()
                        if showsLocation, !entry.item.location.isEmpty {
                            Text(entry.item.location)
                                .font(style.widgetFont(size: 10))
                                .foregroundStyle(colors.secondary)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if let label = model.label(entry) {
                        AgendaTimeText(label: label, now: model.now)
                            .layoutPriority(1)
                    }
                }
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
            }
        }
    }
}

@available(iOS 17.0, *)
private struct AgendaDivider: View {
    @WidgetStyleColors private var colors

    var body: some View {
        Rectangle().fill(colors.muted.opacity(0.35)).frame(height: 0.5).padding(.leading, 30)
    }
}

/// 小号：最要紧的一条写大（图标、分组、勾选圈、两行标题、时间），分隔线下再列 1–2 条。
/// 放不下按 2 → 1 → 0 条退让；只剩主条时标题放宽到三行。
@available(iOS 17.0, *)
private struct AgendaSmallView: View {
    let model: AgendaWidgetModel
    @Environment(\.scheduleWidgetStyle) private var style
    @Environment(\.scheduleWidgetTheme) private var theme
    @WidgetStyleColors private var colors

    var body: some View {
        if let first = model.entries.first {
            let rest = Array(model.entries.dropFirst())
            Group {
                if rest.isEmpty {
                    layout(primary: first, rest: [], titleLines: 3)
                } else {
                    ViewThatFits(in: .vertical) {
                        layout(primary: first, rest: Array(rest.prefix(2)), titleLines: 2)
                        layout(primary: first, rest: Array(rest.prefix(1)), titleLines: 2)
                        layout(primary: first, rest: [], titleLines: 3)
                    }
                }
            }
            // 列出了别的日程就打开列表，只有一条时直接打开它。
            .widgetURL(rest.isEmpty ? AgendaWidgetLinks.item(first.item) : AgendaWidgetLinks.list)
        } else {
            AgendaEmptyView(compact: true)
                .widgetURL(AgendaWidgetLinks.new)
        }
    }

    private func layout(primary entry: AgendaWidgetRules.Entry, rest: [AgendaWidgetRules.Entry], titleLines: Int) -> some View {
        let tint = entry.group == .overdue ? AgendaWidgetPalette.overdue : colors.accent(for: theme)
        let hidden = model.entries.count - 1 - rest.count
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                Image(systemName: AgendaWidgetPalette.symbol(entry.item))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(tint)
                    .widgetAccentable()
                Text(entry.group.title)
                    .font(style.widgetFont(size: 11, weight: .semibold))
                    .foregroundStyle(tint)
                    .lineLimit(1)
                Spacer(minLength: 2)
                AgendaCheck(entry: entry).padding(.trailing, -4)
            }
            .padding(.top, -4)
            Spacer(minLength: 2)
            Text(entry.item.title)
                .font(style.widgetFont(size: 15, weight: .semibold))
                .foregroundStyle(colors.primary)
                .lineLimit(titleLines)
                .minimumScaleFactor(0.85)
                .privacySensitive()
            if let label = model.label(entry) {
                AgendaTimeText(label: label, now: model.now, size: 12).padding(.top, 2)
            }
            if !rest.isEmpty {
                Rectangle().fill(colors.muted.opacity(0.35)).frame(height: 0.5).padding(.vertical, 6)
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(rest.enumerated()), id: \.element.id) { index, other in
                        HStack(spacing: 5) {
                            Image(systemName: AgendaWidgetPalette.symbol(other.item))
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(other.group == .overdue ? AgendaWidgetPalette.overdue : colors.accent(for: theme))
                                .widgetAccentable()
                                .frame(width: 13)
                            Text(other.item.title)
                                .font(style.widgetFont(size: 12, weight: .medium))
                                .foregroundStyle(colors.primary)
                                .lineLimit(1)
                                .privacySensitive()
                                .frame(maxWidth: .infinity, alignment: .leading)
                            // 次要行不写时间，逾期仍要看得出来。
                            if other.group == .overdue {
                                Text("逾期").font(style.widgetFont(size: 11, weight: .semibold))
                                    .foregroundStyle(AgendaWidgetPalette.overdue).fixedSize()
                            }
                            if index == rest.count - 1 && hidden > 0 {
                                Text("+\(hidden)").font(style.widgetFont(size: 11)).foregroundStyle(colors.secondary).fixedSize()
                            }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// 中号：页眉一行，下面整宽三行。
@available(iOS 17.0, *)
private struct AgendaMediumView: View {
    let model: AgendaWidgetModel

    var body: some View {
        if model.entries.isEmpty {
            AgendaEmptyView(compact: false)
                .widgetURL(AgendaWidgetLinks.new)
        } else {
            VStack(alignment: .leading, spacing: 2) {
                AgendaHeader(model: model)
                VStack(spacing: 0) {
                    let items = Array(model.entries.prefix(3))
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { AgendaDivider() }
                        AgendaRow(entry: entry, model: model).frame(maxHeight: 36)
                    }
                    Spacer(minLength: 0)
                }
            }
            .widgetURL(AgendaWidgetLinks.list)
        }
    }
}

/// 大号：按分组往下排（行 34pt、组标题 24pt），按实际高度放满；底部「记一笔」。
@available(iOS 17.0, *)
private struct AgendaLargeView: View {
    let model: AgendaWidgetModel
    @Environment(\.scheduleWidgetStyle) private var style
    @Environment(\.scheduleWidgetTheme) private var theme
    @WidgetStyleColors private var colors
    private let rowHeight: CGFloat = 34
    private let headerHeight: CGFloat = 24
    private let chromeHeight: CGFloat = 44

    var body: some View {
        GeometryReader { proxy in
            content(budget: proxy.size.height - chromeHeight)
        }
        .widgetURL(AgendaWidgetLinks.list)
    }

    private func content(budget: CGFloat) -> some View {
        let visible = visibleSections(budget: budget)
        return VStack(alignment: .leading, spacing: 0) {
            AgendaHeader(model: model).padding(.bottom, 2)
            if model.entries.isEmpty {
                AgendaEmptyView(compact: false)
            } else {
                ForEach(visible, id: \.group) { section in
                    Text(section.group.title)
                        .font(style.widgetFont(size: 11, weight: .semibold))
                        .foregroundStyle(section.group == .overdue ? AgendaWidgetPalette.overdue : colors.secondary)
                        .frame(height: headerHeight, alignment: .bottomLeading)
                    ForEach(Array(section.entries.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { AgendaDivider() }
                        AgendaRow(entry: entry, model: model, titleSize: 15, showsLocation: true).frame(height: rowHeight)
                    }
                }
                Spacer(minLength: 0)
                HStack {
                    Link(destination: AgendaWidgetLinks.new) {
                        Label("记一笔", systemImage: "plus")
                            .font(style.widgetFont(size: 13, weight: .medium))
                            .foregroundStyle(colors.accent(for: theme))
                            .widgetAccentable()
                    }
                    Spacer()
                    let hidden = model.entries.count - visible.reduce(0) { $0 + $1.entries.count }
                    if hidden > 0 {
                        Text("还有 \(hidden) 项").font(style.widgetFont(size: 12)).foregroundStyle(colors.secondary)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// 按分组往下排，放不下就停；一组至少要放得下标题和一行才出现。
    private func visibleSections(budget: CGFloat) -> [AgendaWidgetRules.Section] {
        var remaining = budget
        var result: [AgendaWidgetRules.Section] = []
        for section in model.sections {
            let rows = Int((remaining - headerHeight) / rowHeight)
            guard rows > 0 else { break }
            let entries = Array(section.entries.prefix(rows))
            remaining -= headerHeight + CGFloat(entries.count) * rowHeight
            result.append(.init(group: section.group, entries: entries))
        }
        return result
    }
}

@available(iOS 17.0, *)
private struct AgendaRectangularView: View {
    let model: AgendaWidgetModel

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            if model.entries.isEmpty {
                Label("日程", systemImage: "checklist").font(.system(size: 14, weight: .bold)).widgetAccentable()
                Text("没有要做的事").font(.system(size: 12)).foregroundStyle(.secondary)
            } else {
                ForEach(model.entries.prefix(2)) { entry in
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: 4) {
                            Image(systemName: AgendaWidgetPalette.symbol(entry.item))
                                .font(.system(size: 11, weight: .semibold))
                                .widgetAccentable()
                            Text(entry.item.title)
                                .font(.system(size: 14, weight: .semibold))
                                .lineLimit(1)
                                .privacySensitive()
                        }
                        if let label = model.label(entry) {
                            Text(label.text)
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(AgendaWidgetLinks.list)
    }
}

@available(iOS 17.0, *)
private struct AgendaInlineView: View {
    let model: AgendaWidgetModel

    var body: some View {
        Group {
            if model.entries.isEmpty {
                Label("日程 · 都做完了", systemImage: "checkmark.circle")
            } else if let first = model.entries.first {
                ViewThatFits(in: .horizontal) {
                    Label("\(model.summary) · \(first.item.title)", systemImage: "checklist").fixedSize()
                    Label("日程 · \(model.summary)", systemImage: "checklist")
                }
            }
        }
        .widgetURL(AgendaWidgetLinks.list)
    }
}

@available(iOS 17.0, *)
private struct AgendaCircularView: View {
    let model: AgendaWidgetModel

    var body: some View {
        let pending = model.counts.today + model.counts.overdue
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Image(systemName: model.counts.overdue > 0 ? "exclamationmark.circle" : "checklist")
                    .font(.system(size: 13, weight: .semibold))
                    .widgetAccentable()
                Text("\(pending)")
                    .font(.system(size: 20, weight: .semibold, design: .rounded))
                    .minimumScaleFactor(0.6)
                Text("今天")
                    .font(.system(size: 8, weight: .medium))
            }
        }
        .accessibilityLabel("日程，今天 \(model.counts.today) 项，逾期 \(model.counts.overdue) 项")
        .widgetURL(AgendaWidgetLinks.list)
    }
}

@available(iOS 17.0, *)
private struct AgendaEmptyView: View {
    let compact: Bool
    @Environment(\.scheduleWidgetStyle) private var style
    @Environment(\.scheduleWidgetTheme) private var theme
    @WidgetStyleColors private var colors

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: compact ? 24 : 26, weight: .regular))
                .foregroundStyle(colors.accent(for: theme))
                .widgetAccentable()
            Text("没有要做的日程")
                .font(style.widgetFont(size: 13, weight: .medium))
                .foregroundStyle(colors.primary)
                .multilineTextAlignment(.center)
            if compact {
                Text("轻点记一笔").font(style.widgetFont(size: 11)).foregroundStyle(colors.secondary)
            } else {
                Link(destination: AgendaWidgetLinks.new) {
                    Label("记一笔", systemImage: "plus")
                        .font(style.widgetFont(size: 13, weight: .medium))
                        .foregroundStyle(colors.accent(for: theme))
                        .widgetAccentable()
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

@available(iOS 17.0, *)
private struct AgendaMessageView: View {
    let symbol: String
    let title: String
    let compact: Bool
    @Environment(\.scheduleWidgetStyle) private var style
    @Environment(\.scheduleWidgetTheme) private var theme
    @WidgetStyleColors private var colors

    var body: some View {
        if compact {
            Label(title, systemImage: symbol).font(.system(size: 12, weight: .medium))
                .widgetURL(AgendaWidgetLinks.list)
        } else {
            VStack(spacing: 6) {
                Image(systemName: symbol).font(.system(size: 22)).foregroundStyle(colors.accent(for: theme)).widgetAccentable()
                Text(title).font(style.widgetFont(size: 13, weight: .medium)).foregroundStyle(colors.primary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .widgetURL(AgendaWidgetLinks.list)
        }
    }
}
