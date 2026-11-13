import Combine
import Foundation
import SwiftUI

/// What the couple timetable does besides being drawn: tells when both are free today, says
/// when the partner's classes are over, and marks the classes taken together in the widgets.
///
/// Everything is worked out on the phone from the partner's timetable the couple link already
/// brought here. Nothing more is asked of the server, and nothing of the partner's timetable
/// leaves the app: the widgets' file gets one 「一起」 flag on the user's own classes.
@available(iOS 17.0, *)
@MainActor
final class NativeCoupleExtras: ObservableObject {
    static let shared = NativeCoupleExtras()
    typealias Meeting = NativeClassReminderRules.Meeting

    /// 「TA 下课时提醒我」. Off until switched on.
    @Published var classOverOn: Bool { didSet { defaults.set(classOverOn, forKey: Self.classOverKey); classOverChanged() } }
    @Published private(set) var message: String?
    /// The partner's classes by date, while their timetable is shown; empty otherwise.
    @Published private(set) var partnerDays: [String: [Meeting]] = [:]
    @Published private(set) var partnerName = "TA"

    static let classOverKey = "cpu.couple.classOver"
    private let defaults = UserDefaults.standard
    private var running: Task<Void, Never>?

    private init() {
        classOverOn = defaults.bool(forKey: Self.classOverKey)
    }

    /// The partner's timetable arrived, changed, was hidden or the link ended.
    func update(layer: NativeCoupleLayer?) {
        let next = layer.map { Self.meetings($0.partner.snapshot()) } ?? [:]
        partnerName = layer?.partnerName.trimmedNonEmpty ?? "TA"
        if next != partnerDays { partnerDays = next }
        NativeWidgetLocalSchedule.setPartner(next)
        refresh()
    }

    /// Every class of a timetable on its real date and clock times.
    static func meetings(_ snapshot: NativeScheduleSnapshot) -> [String: [Meeting]] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = NativeClassReminderRules.zone
        func minute(_ date: Date) -> Int {
            let parts = calendar.dateComponents([.hour, .minute], from: date)
            return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
        }
        var days: [String: [Meeting]] = [:]
        for occurrence in NativeScheduleOccurrences.make(snapshot) {
            days[occurrence.date, default: []].append(Meeting(
                name: occurrence.course.name, location: occurrence.course.location, date: occurrence.date,
                start: minute(occurrence.start), end: minute(occurrence.end)))
        }
        return days.mapValues { $0.sorted { $0.start < $1.start } }
    }

    /// What the couple sheet says about one day.
    struct Outlook: Equatable {
        let date: String
        /// When both are free, from now on for today.
        let free: [NativeClassReminderRules.Window]
        /// The classes both take that day.
        let together: [Meeting]
    }

    /// Today and tomorrow, or nothing while the partner's timetable is not shown.
    func outlooks(now: Date = .now) -> [Outlook] {
        guard !partnerDays.isEmpty else { return [] }
        let today = ScheduleShortcutReader.today(now)
        let mine = Dictionary(NativeScheduleNotifications.upcomingDays(2, now: now).flatMap { $0 }.map { ($0.date, [$0]) }, uniquingKeysWith: +)
        return (0..<2).compactMap { offset in
            guard let date = ScheduleShortcutReader.date(byAdding: offset, to: today.date) else { return nil }
            let own = mine[date] ?? [], theirs = partnerDays[date] ?? []
            return Outlook(
                date: date,
                // From the next five-minute mark: 「20:28–22:30」 reads like a mistake.
                free: NativeClassReminderRules.sharedFree(mine: own, theirs: theirs, from: offset == 0 ? (today.minute + 4) / 5 * 5 : 0),
                together: own.filter { NativeClassReminderRules.isTogether($0, with: theirs) })
        }
    }

    private func classOverChanged() {
        guard classOverOn else { refresh(); return }
        Task {
            if await NativeScheduleNotifications.authorized(asking: true) {
                message = nil
                refresh()
            } else {
                message = "系统设置里没有允许药大拾间发通知，这项提醒不会出现。"
            }
        }
    }

    func refresh() {
        let previous = running
        running = Task { [weak self] in
            await previous?.value
            await self?.apply()
        }
    }

    private func apply() async {
        guard classOverOn, !partnerDays.isEmpty, await NativeScheduleNotifications.authorized(asking: false) else {
            await NativeScheduleNotifications.replace(prefix: NativeScheduleNotifications.partnerPrefix, with: [], thread: "partner")
            return
        }
        let now = Date()
        let today = ScheduleShortcutReader.today(now).date
        let dates = (0..<3).compactMap { ScheduleShortcutReader.date(byAdding: $0, to: today) }
        let planned = NativeClassReminderRules.partnerPlan(
            dates.map { partnerDays[$0] ?? [] }, mine: NativeScheduleNotifications.upcomingDays(3, now: now),
            name: partnerName, now: now, limit: NativeNotificationBudget.partner)
        await NativeScheduleNotifications.replace(prefix: NativeScheduleNotifications.partnerPrefix, with: planned, thread: "partner")
    }
}

/// The couple sheet's 「今天和明天」: when both are free and what they take together.
@available(iOS 17.0, *)
struct NativeCoupleOutlookSection: View {
    @ObservedObject private var extras = NativeCoupleExtras.shared

    var body: some View {
        // The section stands outside the timeline: a Form reads a section's header and footer
        // only from a section it holds directly.
        if !extras.partnerDays.isEmpty {
            Section {
                TimelineView(.everyMinute) { context in
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(extras.outlooks(now: context.date).enumerated()), id: \.element.date) { index, outlook in
                            VStack(alignment: .leading, spacing: 5) {
                                Text(index == 0 ? "今天" : "明天").font(.subheadline.weight(.semibold))
                                if !outlook.together.isEmpty {
                                    Label(outlook.together.map { "\($0.name) \(NativeClassReminderRules.clock($0.start))" }.joined(separator: "、"),
                                          systemImage: "heart.fill")
                                        .font(.footnote).foregroundStyle(.pink)
                                }
                                if outlook.free.isEmpty {
                                    Text(index == 0 ? "今天剩下的时间凑不出半小时以上的共同空闲" : "明天没有半小时以上的共同空闲")
                                        .font(.footnote).foregroundStyle(.secondary)
                                } else {
                                    Text("都有空  " + outlook.free.map(\.text).joined(separator: "   "))
                                        .font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 2)
                }
            } header: {
                Text("一起的时间")
            } footer: {
                Text("按两人的课表算，8:00 到 22:30 之间；心形是你们一起上的课。更长的范围在「找共同空闲」里。")
            }
        }
    }
}

/// The couple sheet's switch for 「TA 下课时提醒我」.
@available(iOS 17.0, *)
struct NativeCoupleClassOverSection: View {
    @ObservedObject private var extras = NativeCoupleExtras.shared

    var body: some View {
        Section {
            Toggle("TA 下课时提醒我", isOn: $extras.classOverOn)
            if let message = extras.message {
                Label(message, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.orange)
            }
        } footer: {
            Text("TA 一段连着的课上完时发一条通知，写着你们接下来都有空到几点。通知由这台手机按 TA 的课表排好最近几次，只在你这里出现。")
        }
    }
}
