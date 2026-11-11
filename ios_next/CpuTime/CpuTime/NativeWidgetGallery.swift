#if DEBUG
import SwiftUI
import UIKit
import WidgetKit

/// A Debug-only gallery of every home-screen and lock-screen widget at its
/// real size (iPhone 17 Pro points), drawn by the extension's own views
/// (ScheduleWidgetViews.swift and AgendaWidget.swift are compiled into the
/// app's Debug build for this). Widgets cannot be added to a simulator home
/// screen by script, so this is how their layouts are checked.
///
/// `CPU_DEBUG_WIDGET_GALLERY=1` shows it instead of the app. Narrow it with
/// `CPU_DEBUG_WIDGET_GALLERY_STYLE` (minimal, table, paper, board),
/// `CPU_DEBUG_WIDGET_GALLERY_KIND` (upcoming, today, twoDay, agenda, states),
/// `CPU_DEBUG_WIDGET_GALLERY_MODE` (fullColor, accented) and
/// `CPU_DEBUG_WIDGET_GALLERY_SCHEME` (light, dark). The system appearance
/// (`xcrun simctl ui <udid> appearance dark`) picks the scheme when none is
/// named. `CPU_DEBUG_WIDGET_GALLERY_EXPORT=/some/dir` also writes each sheet as
/// a PNG there (all styles, kinds and schemes unless narrowed). The system's
/// own surfaces are approximated: the widget corner and 16-point margin, the
/// lock screen's vibrant rendering (grayscale over a dark wallpaper) and the
/// tinted home screen (the content as a white mask over dark glass).
@available(iOS 17.0, *)
struct NativeWidgetGallery: View {
    static var isRequested: Bool {
        ProcessInfo.processInfo.environment["CPU_DEBUG_WIDGET_GALLERY"] == "1"
    }

    @Environment(\.colorScheme) private var systemScheme
    @State private var exported: String?

    private var environment: [String: String] { ProcessInfo.processInfo.environment }

    private var styles: [WidgetStyle] {
        environment["CPU_DEBUG_WIDGET_GALLERY_STYLE"].flatMap(WidgetStyle.init(rawValue:)).map { [$0] } ?? WidgetStyle.allCases
    }

    private var kinds: [GallerySheet.Kind] {
        environment["CPU_DEBUG_WIDGET_GALLERY_KIND"].flatMap(GallerySheet.Kind.init(rawValue:)).map { [$0] } ?? GallerySheet.Kind.allCases
    }

    private var modes: [GallerySheet.Mode] {
        environment["CPU_DEBUG_WIDGET_GALLERY_MODE"].flatMap(GallerySheet.Mode.init(rawValue:)).map { [$0] } ?? [.fullColor]
    }

    private func schemes(exporting: Bool) -> [ColorScheme] {
        switch environment["CPU_DEBUG_WIDGET_GALLERY_SCHEME"] {
        case "light": return [.light]
        case "dark": return [.dark]
        default: return exporting ? [.light, .dark] : [systemScheme]
        }
    }

    private func sheets(exporting: Bool) -> [GallerySheet] {
        styles.flatMap { style in
            kinds.flatMap { kind in
                modes.flatMap { mode in
                    schemes(exporting: exporting).map { GallerySheet(kind: kind, style: style, scheme: $0, mode: mode) }
                }
            }
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                if let exported {
                    Text(exported).font(.caption.monospaced()).padding(.horizontal, 12)
                }
                ForEach(sheets(exporting: false)) { sheet in
                    sheet
                }
            }
            .padding(.vertical, 12)
        }
        .background(Color(white: systemScheme == .dark ? 0.06 : 0.93))
        .task {
            guard let directory = environment["CPU_DEBUG_WIDGET_GALLERY_EXPORT"], !directory.isEmpty else { return }
            exported = export(to: URL(fileURLWithPath: directory))
        }
    }

    /// Renders every sheet to a PNG; returns what was written, for the screen.
    private func export(to directory: URL) -> String {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var written = 0
        for sheet in sheets(exporting: true) {
            let renderer = ImageRenderer(content: sheet.background(Color(white: sheet.scheme == .dark ? 0.06 : 0.93)))
            renderer.scale = 2
            guard let data = renderer.uiImage?.pngData() else { continue }
            try? data.write(to: directory.appendingPathComponent(sheet.id + ".png"))
            written += 1
        }
        let line = "widget-gallery: wrote \(written) sheets to \(directory.path)"
        print(line)
        return line
    }
}

/// One kind of widget in one style, scheme and rendering mode: every family.
@available(iOS 17.0, *)
struct GallerySheet: View, Identifiable {
    enum Kind: String, CaseIterable { case upcoming, today, twoDay, agenda, states }
    enum Mode: String, CaseIterable { case fullColor, accented }

    let kind: Kind
    let style: WidgetStyle
    let scheme: ColorScheme
    let mode: Mode

    var id: String { "\(kind.rawValue)-\(style.rawValue)-\(scheme == .dark ? "dark" : "light")-\(mode.rawValue)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\(title) · \(style.title) · \(scheme == .dark ? "深色" : "浅色")\(mode == .accented ? " · 染色" : "")")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(scheme == .dark ? Color.white : Color.black)
            content
        }
        .padding(.horizontal, 16)
        .frame(width: 400, alignment: .leading)
        .environment(\.colorScheme, scheme)
    }

    private var title: String {
        switch kind {
        case .upcoming: "临近课程"
        case .today: "今日课表"
        case .twoDay: "两日课表"
        case .agenda: "日程"
        case .states: "其他状态"
        }
    }

    @ViewBuilder
    private var content: some View {
        let now = GallerySample.classTime
        switch kind {
        case .upcoming, .today:
            let widget: ScheduleWidgetKind = kind == .upcoming ? .upcoming : .today
            HStack(alignment: .top, spacing: 12) {
                cell("小号", .systemSmall) { schedule(widget, .systemSmall, now: now) }
                VStack(alignment: .leading, spacing: 10) {
                    cell("锁屏矩形", .accessoryRectangular) { schedule(widget, .accessoryRectangular, now: now) }
                    cell("锁屏圆形", .accessoryCircular) { schedule(widget, .accessoryCircular, now: now) }
                }
            }
            cell("锁屏单行", .accessoryInline) { schedule(widget, .accessoryInline, now: now) }
            cell("中号", .systemMedium) { schedule(widget, .systemMedium, now: now) }
            cell("大号 · 时间线", .systemLarge) { schedule(widget, .systemLarge, now: now) }
            if kind == .upcoming {
                cell("小号 · 只显示一节 · 晚上（明天的课）", .systemSmall) {
                    schedule(widget, .systemSmall, now: GallerySample.evening, count: 1)
                }
            }
        case .twoDay:
            HStack(alignment: .top, spacing: 12) {
                cell("锁屏矩形", .accessoryRectangular) { schedule(.twoDay, .accessoryRectangular, now: now) }
                cell("锁屏圆形", .accessoryCircular) { schedule(.twoDay, .accessoryCircular, now: now) }
            }
            cell("锁屏单行", .accessoryInline) { schedule(.twoDay, .accessoryInline, now: now) }
            cell("中号", .systemMedium) { schedule(.twoDay, .systemMedium, now: now) }
            cell("大号 · 列表", .systemLarge) { schedule(.twoDay, .systemLarge, now: now, layout: .list) }
            cell("大号 · 时间线 · 周五晚上", .systemLarge) { schedule(.twoDay, .systemLarge, now: GallerySample.fridayEvening, layout: .timeline) }
        case .agenda:
            HStack(alignment: .top, spacing: 12) {
                cell("小号", .systemSmall) { agenda(.systemSmall, now: now) }
                VStack(alignment: .leading, spacing: 10) {
                    cell("锁屏矩形", .accessoryRectangular) { agenda(.accessoryRectangular, now: now) }
                    cell("锁屏圆形", .accessoryCircular) { agenda(.accessoryCircular, now: now) }
                }
            }
            cell("锁屏单行", .accessoryInline) { agenda(.accessoryInline, now: now) }
            cell("中号", .systemMedium) { agenda(.systemMedium, now: now) }
            cell("大号", .systemLarge) { agenda(.systemLarge, now: now) }
            HStack(alignment: .top, spacing: 12) {
                cell("小号 · 都做完了", .systemSmall) { agenda(.systemSmall, now: now, state: .loaded([])) }
                cell("小号 · 没同步", .systemSmall) { agenda(.systemSmall, now: now, state: .missing) }
            }
        case .states:
            HStack(alignment: .top, spacing: 12) {
                cell("暑假 · 小号", .systemSmall) { schedule(.upcoming, .systemSmall, now: GallerySample.summer) }
                cell("课表过期 · 小号", .systemSmall) { schedule(.today, .systemSmall, now: GallerySample.stale) }
            }
            cell("国庆 · 两日课表大号", .systemLarge) { schedule(.twoDay, .systemLarge, now: GallerySample.holiday) }
            cell("今日课表中号 · 晚上（明天的课）", .systemMedium) { schedule(.today, .systemMedium, now: GallerySample.evening) }
            cell("今日课表大号 · 列表", .systemLarge) { schedule(.today, .systemLarge, now: now, layout: .list) }
            cell("临近课程中号 · 课间", .systemMedium) { schedule(.upcoming, .systemMedium, now: GallerySample.lunch) }
            HStack(alignment: .top, spacing: 12) {
                cell("等待同步 · 小号", .systemSmall) {
                    ScheduleWidgetView(kind: .upcoming, entry: ScheduleEntry(date: now, state: .unconfigured), overrides: overrides(.systemSmall))
                }
                cell("暑假 · 锁屏矩形", .accessoryRectangular) { schedule(.upcoming, .accessoryRectangular, now: GallerySample.summer) }
            }
        }
    }

    private func overrides(_ family: WidgetFamily) -> ScheduleWidgetOverrides {
        ScheduleWidgetOverrides(family: family, style: style, theme: .colorGlass, options: .default)
    }

    private func schedule(_ widget: ScheduleWidgetKind, _ family: WidgetFamily, now: Date,
                          layout: ScheduleWidgetLayoutStyle = .timeline, count: Int = 2) -> some View {
        let entry = ScheduleEntry(
            date: now,
            state: GallerySample.state(at: now),
            configuration: ScheduleWidgetConfiguration(upcomingCourseCount: count, layout: layout)
        )
        return ScheduleWidgetView(kind: widget, entry: entry, overrides: overrides(family))
    }

    private func agenda(_ family: WidgetFamily, now: Date, state: AgendaWidgetEntry.State? = nil) -> some View {
        var entry = AgendaWidgetEntry.sample(at: now)
        if let state { entry.state = state }
        return AgendaWidgetView(entry: entry, overrides: overrides(family))
    }

    /// One widget at its size on its surface, with a caption.
    private func cell<Content: View>(_ caption: String, _ family: WidgetFamily, @ViewBuilder _ content: () -> Content) -> some View {
        let size = Self.size(family)
        let accessory = family == .accessoryInline || family == .accessoryCircular || family == .accessoryRectangular
        return VStack(alignment: .leading, spacing: 4) {
            Text(caption)
                .font(.system(size: 10))
                .foregroundStyle(scheme == .dark ? Color.white.opacity(0.6) : Color.black.opacity(0.55))
            Group {
                if accessory {
                    lockScreen(content(), family: family, size: size)
                } else {
                    homeScreen(content(), size: size)
                }
            }
        }
    }

    private func homeScreen<Content: View>(_ content: Content, size: CGSize) -> some View {
        let shape = RoundedRectangle(cornerRadius: 22, style: .continuous)
        let widget = content
            .padding(16)
            .frame(width: size.width, height: size.height)
        return Group {
            if mode == .accented {
                // The tinted home screen: the content as a white mask over dark glass.
                Rectangle().fill(Color.white)
                    .frame(width: size.width, height: size.height)
                    .mask { widget.environment(\.widgetRenderingMode, .accented) }
                    .background(Color.black.opacity(0.55))
                    .background(Color(red: 0.36, green: 0.42, blue: 0.55).opacity(scheme == .dark ? 0.35 : 0.55))
            } else {
                widget.background(ScheduleWidgetBackground(style: style, showsPhoto: false))
            }
        }
        .clipShape(shape)
    }

    /// The lock screen draws accessories vibrant: white on the wallpaper, levels kept, colour gone.
    private func lockScreen<Content: View>(_ content: Content, family: WidgetFamily, size: CGSize) -> some View {
        ZStack {
            if family == .accessoryCircular {
                Circle().fill(Color.white.opacity(0.22)).frame(width: size.width, height: size.height)
            }
            content
                .environment(\.widgetRenderingMode, .vibrant)
                .environment(\.colorScheme, .dark)
                .frame(width: size.width, height: size.height, alignment: family == .accessoryInline ? .leading : .center)
        }
        .grayscale(1)
        .compositingGroup()
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(red: 0.16, green: 0.2, blue: 0.3)))
    }

    /// iPhone 17 Pro.
    static func size(_ family: WidgetFamily) -> CGSize {
        switch family {
        case .systemSmall: CGSize(width: 170, height: 170)
        case .systemMedium: CGSize(width: 364, height: 170)
        case .systemLarge: CGSize(width: 364, height: 382)
        case .accessoryRectangular: CGSize(width: 172, height: 76)
        case .accessoryCircular: CGSize(width: 76, height: 76)
        default: CGSize(width: 300, height: 22)
        }
    }
}

/// A week of courses at China Pharmaceutical University, and the moments the
/// gallery pins.
@available(iOS 17.0, *)
enum GallerySample {
    /// Wednesday 11 November 2026, 10:20: the second class of the day is on.
    static let classTime = at("2026-11-11", "10:20")
    static let lunch = at("2026-11-11", "12:10")
    static let evening = at("2026-11-11", "21:40")
    static let fridayEvening = at("2026-11-13", "19:30")
    static let holiday = at("2026-10-02", "10:00")
    static let summer = at("2026-08-25", "09:00")
    /// A Wednesday in the term the sample leaves out, as an app not opened for weeks would.
    static let stale = at("2026-12-09", "09:00")

    static func at(_ date: String, _ time: String) -> Date {
        let minutes = (Int(time.prefix(2)) ?? 0) * 60 + (Int(time.suffix(2)) ?? 0)
        return (ChineseCalendarInfo.date(fromDate: date).map { ChineseCalendarInfo.gregorian.startOfDay(for: $0) } ?? Date())
            .addingTimeInterval(TimeInterval(minutes * 60))
    }

    private static func course(_ name: String, _ start: String, _ end: String, _ room: String, _ teacher: String) -> ScheduleCourse {
        ScheduleCourse(name: name, teacher: teacher, location: room, note: nil, slotNote: nil,
                       startTime: start, endTime: end, startSlot: nil, endSlot: nil)
    }

    private static let weekdays: [Int: [ScheduleCourse]] = [
        1: [course("药物化学", "08:00", "09:40", "A201", "王老师"), course("药理学", "10:00", "11:40", "B305", "李老师"),
            course("体育（羽毛球）", "14:00", "15:40", "体育馆", "赵老师")],
        2: [course("物理化学", "08:00", "09:40", "C101", "周老师"), course("中国近现代史纲要", "14:00", "15:40", "A102", "吴老师")],
        3: [course("药剂学", "08:00", "09:40", "C204", "苏老师"), course("生物药剂学与药物动力学", "10:00", "11:40", "D301", "邹老师"),
            course("药物分析实验", "14:00", "17:20", "实验楼 B402", "陈老师"), course("形势与政策", "19:00", "20:40", "A102", "孙老师")],
        4: [course("药物设计学", "08:00", "09:40", "D301", "邹老师"), course("天然药物化学", "10:00", "11:40", "B201", "钱老师")],
        5: [course("药事管理学", "14:00", "15:40", "A305", "冯老师")],
    ]

    /// The autumn term: 7 September 2026 to 10 January 2027, every day but
    /// the National Day week and the week of the stale sample.
    static func state(at now: Date) -> ScheduleEntryState {
        ChineseCalendarInfo.usePublishedHolidays([])
        var days: [ScheduleDay] = []
        let start = ChineseCalendarInfo.date(fromDate: "2026-09-07")!
        for offset in 0..<(18 * 7) {
            let date = ChineseCalendarInfo.dateString(ChineseCalendarInfo.gregorian.date(byAdding: .day, value: offset, to: start)!)
            guard !(date >= "2026-12-07" && date <= "2026-12-13") else { continue }
            let weekday = offset % 7 + 1
            let holiday = date >= "2026-10-01" && date <= "2026-10-08"
            days.append(ScheduleDay(day: weekday, label: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][weekday - 1],
                                    date: date, week: offset / 7 + 1, isToday: nil,
                                    courses: holiday ? [] : weekdays[weekday] ?? []))
        }
        let record = ScheduleLocalDays.Record(semester: "2026-2027-1", days: days, holidays: nil,
                                              termStart: "2026-09-07", termEnd: "2027-01-10")
        return .loaded(ScheduleLocalDays.payload(record: record, now: now))
    }
}
#endif
