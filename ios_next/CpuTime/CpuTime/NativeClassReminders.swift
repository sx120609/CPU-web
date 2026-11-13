import Combine
import Foundation
import SwiftUI
import UIKit
import UserNotifications

/// What each kind of local notification may keep pending. iOS holds 64 per app and silently
/// drops the rest, so the kinds share that out; what is left over is for notifications shown
/// at once (a changed timetable).
@available(iOS 17.0, *)
enum NativeNotificationBudget {
    static let agenda = 40
    static let classes = 14
    static let partner = 8
}

/// The notifications that are about the timetable rather than one 日程 item: 课前提醒, a
/// partner's classes ending, and a timetable 教务 changed. All of them are made on the phone
/// from what the phone already holds; nothing is registered with the server.
@available(iOS 17.0, *)
enum NativeScheduleNotifications {
    static let classPrefix = "cpu.class."
    static let partnerPrefix = "cpu.partner."
    static let changePrefix = "cpu.change."
    static let classCategory = "cpu.class"
    static let skipTodayAction = "cpu.class.skipToday"
    static let dateKey = "cpuClassDate"

    static func isOurs(_ notification: UNNotification) -> Bool {
        let id = notification.request.identifier
        return [classPrefix, partnerPrefix, changePrefix].contains { id.hasPrefix($0) }
    }

    /// Before launch finishes, so an action chosen on a notification that launched the app is known.
    static func registerCategories() {
        let skip = UNNotificationAction(identifier: skipTodayAction, title: "今天不再提醒", options: [])
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: classCategory, actions: [skip], intentIdentifiers: [], options: [])
        ])
    }

    /// True when the response was one of these and has been dealt with.
    @MainActor
    static func handle(_ response: UNNotificationResponse) async -> Bool {
        guard isOurs(response.notification) else { return false }
        if response.actionIdentifier == skipTodayAction {
            let date = response.notification.request.content.userInfo[dateKey] as? String
            NativeClassReminders.shared.skip(date: date ?? ScheduleShortcutReader.today().date)
        } else if response.actionIdentifier == UNNotificationDefaultActionIdentifier,
                  let url = URL(string: "cputime-next://schedule?source=notification&week=current") {
            _ = await UIApplication.shared.open(url)
        }
        return true
    }

    /// Whether notifications may be shown, asking the first time when `asking`.
    static func authorized(asking: Bool) async -> Bool {
        let center = UNUserNotificationCenter.current()
        switch await center.notificationSettings().authorizationStatus {
        case .notDetermined:
            guard asking else { return false }
            return (try? await center.requestAuthorization(options: [.alert, .sound])) == true
        case .denied:
            return false
        default:
            return true
        }
    }

    /// Replaces everything pending under `prefix` with `planned`.
    static func replace(prefix: String, with planned: [NativeClassReminderRules.Planned], thread: String, category: String? = nil) async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(prefix) })
        for item in planned {
            let content = UNMutableNotificationContent()
            content.title = item.title
            content.body = item.body
            content.sound = .default
            content.threadIdentifier = thread
            content.userInfo = [dateKey: item.date]
            if let category { content.categoryIdentifier = category }
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, item.fire.timeIntervalSinceNow), repeats: false)
            try? await center.add(UNNotificationRequest(identifier: prefix + item.id, content: content, trigger: trigger))
        }
    }

    /// The user's classes of the next `days` days from the dated timetable the widgets use,
    /// which already has days off, make-up days, single meetings moved and the course shown first.
    static func upcomingDays(_ days: Int, now: Date = .now) -> [[NativeClassReminderRules.Meeting]] {
        guard let record = ScheduleShortcutReader.record() else { return [] }
        let today = ScheduleShortcutReader.today(now).date
        return (0..<days).compactMap { offset in
            guard let date = ScheduleShortcutReader.date(byAdding: offset, to: today),
                  let meetings = ScheduleShortcutReader.meetings(on: date, in: record) else { return nil }
            return meetings.map {
                NativeClassReminderRules.Meeting(name: $0.name, location: $0.location, date: $0.date, start: $0.start, end: $0.end)
            }
        }
    }
}

/// 课前提醒: an ordinary notification before each class, for anyone who keeps Live Activities
/// off or whose phone shows none. Off until switched on.
///
/// iOS limits how many notifications can wait, so only the next few classes are arranged
/// (`NativeNotificationBudget.classes`). They are arranged again whenever the timetable is
/// saved, the app comes forward or a background refresh runs.
@available(iOS 17.0, *)
@MainActor
final class NativeClassReminders: ObservableObject {
    static let shared = NativeClassReminders()

    @Published var enabled: Bool { didSet { defaults.set(enabled, forKey: Self.enabledKey); enabledChanged() } }
    /// Minutes before class.
    @Published var lead: Int { didSet { defaults.set(lead, forKey: Self.leadKey); refresh() } }
    @Published private(set) var planned: [NativeClassReminderRules.Planned] = []
    @Published private(set) var message: String?

    static let enabledKey = "cpu.classReminder.on"
    static let leadKey = "cpu.classReminder.lead"
    /// The date 「今天不再提醒」 was chosen for.
    static let skippedKey = "cpu.classReminder.skipped"
    private let defaults = UserDefaults.standard
    private var running: Task<Void, Never>?

    private init() {
        enabled = defaults.bool(forKey: Self.enabledKey)
        lead = NativeClassReminderRules.normalizedLead(defaults.object(forKey: Self.leadKey) as? Int ?? 15)
    }

    private func enabledChanged() {
        guard enabled else { refresh(); return }
        // The one place permission is asked for: the moment the switch is turned on.
        Task {
            if await NativeScheduleNotifications.authorized(asking: true) {
                message = nil
                refresh()
            } else {
                message = "系统设置里没有允许药大拾间发通知，课前提醒不会出现。"
                await NativeScheduleNotifications.replace(prefix: NativeScheduleNotifications.classPrefix, with: [], thread: "class")
            }
        }
    }

    /// 「今天不再提醒」 on a reminder.
    func skip(date: String) {
        defaults.set(date, forKey: Self.skippedKey)
        refresh()
    }

    func refresh() {
        let previous = running
        running = Task { [weak self] in
            await previous?.value
            await self?.apply()
        }
    }

    /// Awaited by the background refresh, which must not finish before the reminders are in.
    func refreshNow() async {
        refresh()
        await running?.value
    }

    private func apply() async {
        guard enabled, await NativeScheduleNotifications.authorized(asking: false) else {
            planned = []
            await NativeScheduleNotifications.replace(prefix: NativeScheduleNotifications.classPrefix, with: [], thread: "class")
            return
        }
        let next = NativeClassReminderRules.plan(
            NativeScheduleNotifications.upcomingDays(7), lead: lead, now: .now,
            limit: NativeNotificationBudget.classes, skipping: defaults.string(forKey: Self.skippedKey))
        planned = next
        await NativeScheduleNotifications.replace(
            prefix: NativeScheduleNotifications.classPrefix, with: next, thread: "class",
            category: NativeScheduleNotifications.classCategory)
    }
}

/// 课前提醒 settings.
@available(iOS 17.0, *)
struct NativeClassReminderSettingsPage: View {
    @ObservedObject private var reminders = NativeClassReminders.shared
    @State private var changeAlerts = NativeScheduleChangeAlerts.enabled

    var body: some View {
        Form {
            Section {
                Toggle("课前提醒", isOn: $reminders.enabled)
                if reminders.enabled {
                    Picker("提前", selection: $reminders.lead) {
                        ForEach(NativeClassReminderRules.leads, id: \.self) { Text("\($0) 分钟").tag($0) }
                    }
                }
            } footer: {
                Text("每节课前发一条普通通知，写着上课时间和教室。上一节课还没下课时，等它下课再提醒。已经开着实时活动的话不必再开这一项。")
            }
            if let message = reminders.message {
                Section {
                    Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).font(.footnote)
                }
            }
            if reminders.enabled {
                Section("接下来") {
                    if reminders.planned.isEmpty && reminders.message == nil {
                        Text("未来 7 天没有要提醒的课。").foregroundStyle(.secondary)
                    }
                    ForEach(reminders.planned.prefix(6)) { item in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Self.fireText(item.fire)).font(.body.weight(.semibold).monospacedDigit())
                            Text(item.title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
            }
            Section {
                Toggle("课表变化提醒", isOn: $changeAlerts)
                    .onChange(of: changeAlerts) { _, on in
                        NativeScheduleChangeAlerts.enabled = on
                        // Asked for here too, since this switch can be the only one that is on.
                        if on { Task { _ = await NativeScheduleNotifications.authorized(asking: true) } }
                    }
            } footer: {
                Text("教务调课、停课或换教室后，App 下次在后台刷新课表时发现变化就通知你。系统不保证后台刷新的时间；App 被彻底关闭后要等下次打开才能发现。")
            }
            Section {
            } footer: {
                Text("系统限制了能排队的通知数量，所以只排好最近的 \(NativeNotificationBudget.classes) 节课；每次打开 App、课表更新后会接着往后排。放假、调休、停课和调课都会跟着变。长按通知可以选「今天不再提醒」。")
            }
        }
        .navigationTitle("课程通知")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { reminders.refresh() }
    }

    private static func fireText(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = NativeClassReminderRules.zone
        formatter.dateFormat = "M月d日 EEE HH:mm"
        return formatter.string(from: date)
    }
}
