import Combine
import Foundation
import UserNotifications

// 日程 in the iOS app: the items come from the site's bridge `CPUTimeNativeAgenda`
// (web/src/utils/nativeAgendaBridge.ts), the same records as the Web page /agenda and
// 药大拾间 NEXT. The rules are in NativeAgendaRules.swift; editing happens on the Web page.

/// The user's 日程 for the timetable. Requests go through the signed-in page (see
/// `NativeScheduleStore.agenda`), so the app needs no sign-in of its own. A copy is kept in
/// Application Support for the next start, and the reminders are local notifications.
@available(iOS 17.0, *)
@MainActor
final class NativeAgendaService: ObservableObject {
    static let shared = NativeAgendaService()

    @Published private(set) var items: [NativeAgendaItem]
    /// The site answered for a signed-in account.
    @Published private(set) var available = false

    private weak var store: NativeScheduleStore?
    private var opener: ((String) -> Void)?
    /// A notification tapped before the shell could open the page.
    private var pendingPath: String?
    private var loading = false
    private var reloadAfterLoading = false
    private var lastLoaded: Date?

    private struct Reply: Decodable {
        struct Lossy: Decodable {
            let value: NativeAgendaItem?
            init(from decoder: Decoder) throws { value = try? NativeAgendaItem(from: decoder) }
        }
        let authenticated: Bool?
        let missing: Bool?
        let items: [Lossy]?
    }

    private struct Cache: Codable {
        var items: [NativeAgendaItem]
    }

    init() {
        items = Self.readCache()
    }

    /// Ties the service to the timetable store, whose web view carries the session, and to the
    /// shell, which opens a Web page in the services tab.
    func connect(to store: NativeScheduleStore, open: @escaping (String) -> Void) {
        self.store = store
        opener = open
    }

    /// Everything on a day, for the day view.
    func on(_ date: String?) -> [NativeAgendaOccurrence] {
        guard let date else { return [] }
        return NativeAgendaRules.on(items, date: date)
    }

    /// Reads the items again; without `force` at most every 20 seconds.
    func refresh(force: Bool = false) async {
#if DEBUG
        if debugPinned { return }
#endif
        guard let store else { return }
        if loading {
            reloadAfterLoading = reloadAfterLoading || force
            return
        }
        if !force, let lastLoaded, Date().timeIntervalSince(lastLoaded) < 20 { return }
        loading = true
        lastLoaded = Date()
        let reply = await store.agenda(#"{"action":"list"}"#)
        loading = false
        accept(reply)
        if reloadAfterLoading {
            reloadAfterLoading = false
            await refresh(force: true)
        }
    }

    /// Ticks an occurrence off or back on: shown at once, then saved through the page.
    func toggle(_ entry: NativeAgendaOccurrence) {
        let done = !entry.done
        items = items.map { item in
            guard item.id == entry.item.id else { return item }
            var copy = item
            if !copy.repeats {
                copy.done = done
            } else if done {
                if !copy.doneDates.contains(entry.date) { copy.doneDates.append(entry.date) }
            } else {
                copy.doneDates.removeAll { $0 == entry.date }
            }
            return copy
        }
#if DEBUG
        if debugPinned { return }
#endif
        let payload: [String: Any] = ["action": "toggle", "id": entry.item.id, "date": entry.date, "done": done]
        guard let store, let body = try? JSONSerialization.data(withJSONObject: payload),
              let request = String(data: body, encoding: .utf8) else { return }
        Task { accept(await store.agenda(request)) }
    }

    /// Opens an item on the Web page for editing.
    func open(_ entry: NativeAgendaOccurrence) {
        openPath("/agenda?item=\(Self.query(entry.item.id))&date=\(Self.query(entry.date))")
    }

    /// Opens the Web page on a new item, on `date` when given.
    func openNew(date: String?, start: String? = nil) {
        var path = "/agenda?new=1"
        if let date, NativeAgendaRules.dayNumber(date) != nil { path += "&date=\(date)" }
        if let start, NativeAgendaRules.minutes(start) != nil { path += "&start=\(Self.query(start))" }
        openPath(path)
    }

    /// A tapped reminder: opens its item once the shell can.
    func openFromNotification(id: String, date: String) {
        guard !id.isEmpty else { return }
        pendingPath = "/agenda?item=\(Self.query(id))" + (date.isEmpty ? "" : "&date=\(Self.query(date))")
        if available { flushPendingPath() }
    }

    /// Forgets the copy: signed out.
    func clear() {
#if DEBUG
        if debugPinned { return }
#endif
        available = false
        pendingPath = nil
        if !items.isEmpty { items = [] }
        Self.writeCache([])
        NativeAgendaReminders.sync([])
    }

    private func openPath(_ path: String) {
        opener?(path)
    }

    private func flushPendingPath() {
        guard let path = pendingPath, let opener else { return }
        pendingPath = nil
        opener(path)
    }

    private func accept(_ raw: String?) {
        guard let raw, let data = raw.data(using: .utf8), let reply = try? JSONDecoder().decode(Reply.self, from: data) else { return }
        // An older site without the bridge: keep what is shown.
        if reply.missing == true { return }
        guard reply.authenticated == true else {
            clear()
            return
        }
        var seen = Set<String>()
        let next = (reply.items ?? []).compactMap { $0.value?.sanitized }.filter { seen.insert($0.id).inserted }
        available = true
        if next != items { items = next }
        Self.writeCache(next)
        NativeAgendaReminders.sync(next)
        flushPendingPath()
    }

    private static func query(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
    }

    private static var cacheURL: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("agenda-cache.json")
    }

    private static func readCache() -> [NativeAgendaItem] {
        guard let url = cacheURL, let data = try? Data(contentsOf: url),
              let cache = try? JSONDecoder().decode(Cache.self, from: data) else { return [] }
        return cache.items.compactMap(\.sanitized)
    }

    private static func writeCache(_ items: [NativeAgendaItem]) {
        guard let url = cacheURL else { return }
        do {
            if items.isEmpty {
                try? FileManager.default.removeItem(at: url)
                return
            }
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            var target = url
            try JSONEncoder().encode(Cache(items: items)).write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? target.setResourceValues(values)
        } catch {}
    }

#if DEBUG
    /// Sample items for a screenshot run (`CPU_DEBUG_AGENDA=1`); nothing is requested or saved.
    private var debugPinned = false

    func installDebugSample() {
        debugPinned = true
        let today = NativeAgendaRules.today()
        let day = NativeAgendaRules.dayNumber(today) ?? 0
        let monday = day - ((NativeAgendaRules.weekday(today) ?? 1) - 1)
        func weekDate(_ offset: Int) -> String { NativeAgendaRules.date(ofDay: monday + offset) }
        items = [
            NativeAgendaItem(id: "debugrun0001", title: "晨跑", date: weekDate(0), start: "07:00", end: "07:40", repeatRule: "weekdays",
                             doneDates: [weekDate(0)], createdAt: 1),
            NativeAgendaItem(id: "debugmeet001", title: "组会", date: weekDate(2), start: "14:00", end: "15:30", location: "药学楼302",
                             remind: 15, createdAt: 2),
            NativeAgendaItem(id: "debugdue0001", kind: "todo", title: "交实验报告", date: weekDate(2), createdAt: 3),
            NativeAgendaItem(id: "debuglunch01", title: "午餐分享会", date: weekDate(4), start: "12:00", end: "13:00", createdAt: 4),
            NativeAgendaItem(id: "debugball001", title: "羽毛球", date: weekDate(1), start: "19:00", end: "20:30", location: "体育馆",
                             repeatRule: "weekly", createdAt: 5),
        ]
        available = true
    }
#endif
}

/// Local notifications for the 日程 reminders. iOS keeps at most 64 pending per app, so the
/// earliest 48 of the coming month are scheduled again whenever the list changes.
@available(iOS 17.0, *)
enum NativeAgendaReminders {
    private static let prefix = "cpu.agenda."
    private static let limit = 48
    @MainActor private static var running: Task<Void, Never>?

    static let itemKey = "cpuAgendaItem"
    static let dateKey = "cpuAgendaDate"

    static func isAgenda(_ notification: UNNotification) -> Bool {
        notification.request.identifier.hasPrefix(prefix)
    }

    @MainActor
    static func sync(_ items: [NativeAgendaItem]) {
        let now = Date()
        let reminders = NativeAgendaRules.reminders(items, from: now, until: now.addingTimeInterval(30 * 86_400), limit: limit)
        let previous = running
        running = Task {
            await previous?.value
            await publish(reminders)
        }
    }

    private static func publish(_ reminders: [NativeAgendaReminder]) async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(prefix) })
        guard !reminders.isEmpty else { return }
        switch await center.notificationSettings().authorizationStatus {
        case .notDetermined:
            // Asked once, the first time an item wants a reminder.
            guard (try? await center.requestAuthorization(options: [.alert, .sound])) == true else { return }
        case .denied:
            return
        default:
            break
        }
        for reminder in reminders {
            let content = UNMutableNotificationContent()
            content.title = reminder.title
            content.body = reminder.text
            content.sound = .default
            content.threadIdentifier = "agenda"
            content.userInfo = [itemKey: reminder.id, dateKey: reminder.date]
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, reminder.at.timeIntervalSinceNow), repeats: false)
            try? await center.add(UNNotificationRequest(identifier: prefix + reminder.id + "." + reminder.date,
                                                        content: content, trigger: trigger))
        }
    }
}
