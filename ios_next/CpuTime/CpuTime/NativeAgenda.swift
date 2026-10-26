import Combine
import Foundation
import UserNotifications

// 日程 in the iOS app: the items come from the site's bridge `CPUTimeNativeAgenda`
// (web/src/utils/nativeAgendaBridge.ts), the same records as the Web timetable, Android,
// HarmonyOS and 药大拾间 NEXT. The rules are in NativeAgendaRules.swift; they are added,
// edited and listed in sheets over the timetable (ScheduleAgendaSheets.swift).

/// What the timetable shows over itself for 日程: one item, a new one, or 日程与待办.
enum NativeAgendaPresentation: Identifiable, Equatable {
    case edit(NativeAgendaItem)
    /// A new item on `date` (empty for none) at `start`.
    case create(date: String, start: String)
    case list

    var id: String {
        switch self {
        case .edit(let item): return "edit:\(item.id)"
        case .create(let date, let start): return "create:\(date):\(start)"
        case .list: return "list"
        }
    }
}

/// What a sentence such as 「周五 14:00 组会 @药学楼」 says, read by the page (`parseAgendaText`).
struct NativeAgendaDraft: Decodable, Equatable {
    var title: String
    var date: String
    var start: String
    var end: String
    var location: String
    var remind: Int
    var repeatRule: String

    enum CodingKeys: String, CodingKey {
        case title, date, start, end, location, remind
        case repeatRule = "repeat"
    }

    /// Says more than a title: a day, a time, a repeat, a reminder or a place.
    var saysMore: Bool { !date.isEmpty || !start.isEmpty || remind >= 0 || repeatRule != "none" || !location.isEmpty }
}

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
    /// 微信和 QQ 也提醒, as the site last said.
    @Published private(set) var relay = false
    /// The sheet the timetable shows over itself.
    @Published var presentation: NativeAgendaPresentation?

    private weak var store: NativeScheduleStore?
    /// Brings the timetable tab to the front, for a reminder or a Web link.
    private var showSchedule: (() -> Void)?
    /// A notification tapped before the items were read.
    private var pendingItem: String?
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
        let relay: Bool?
        let saved: Lossy?
        let error: String?
    }

    private struct ParseReply: Decodable {
        let parsed: NativeAgendaDraft?
    }

    private struct Cache: Codable {
        var items: [NativeAgendaItem]
    }

    init() {
        items = Self.readCache()
    }

    /// Ties the service to the timetable store, whose web view carries the session, and to the
    /// shell, which brings the timetable to the front.
    func connect(to store: NativeScheduleStore, show: @escaping () -> Void) {
        self.store = store
        showSchedule = show
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

    /// Opens an item in the editor over the timetable.
    func open(_ entry: NativeAgendaOccurrence) {
        presentation = .edit(entry.item)
    }

    /// A new item, on `date` (none when it is not a date) at `start`.
    func openNew(date: String?, start: String? = nil) {
        let day = date.flatMap { NativeAgendaRules.dayNumber($0) != nil ? $0 : nil } ?? ""
        let time = start.flatMap { NativeAgendaRules.minutes($0) != nil ? $0 : nil } ?? ""
        presentation = .create(date: day, start: day.isEmpty ? "" : time)
    }

    /// 日程与待办.
    func openList() {
        presentation = .list
    }

    /// A tapped reminder: opens its item over the timetable, once it is read.
    func openFromNotification(id: String, date: String) {
        guard !id.isEmpty else { return }
        showSchedule?()
        pendingItem = id
        flushPendingItem()
    }

    /// An /agenda link inside the site (`CPUTimeNative.openAgenda`, JSON from the Web router).
    func openRequest(_ raw: String) {
        struct Request: Decodable {
            let item: String?
            let date: String?
            let start: String?
            let new: Bool?
        }
        let request = raw.data(using: .utf8).flatMap { try? JSONDecoder().decode(Request.self, from: $0) }
        showSchedule?()
        if let id = request?.item, !id.isEmpty {
            pendingItem = id
            flushPendingItem()
        } else if request?.new == true {
            openNew(date: request?.date, start: request?.start)
        } else {
            openList()
        }
    }

    /// Adds `item` (an empty id makes a new one) or saves the edits to it, through the page.
    /// Returns nil once it is stored, else why not.
    func save(_ item: NativeAgendaItem) async -> String? {
#if DEBUG
        if debugPinned {
            var stored = item
            if stored.id.isEmpty { stored.id = "debug\(Int(Date().timeIntervalSince1970))" }
            items = items.filter { $0.id != stored.id } + [stored]
            return nil
        }
#endif
        var data = item
        data.title = item.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !data.title.isEmpty else { return "先写个标题" }
        guard let body = try? JSONEncoder().encode(data),
              var payload = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else { return Self.unreachable }
        if item.id.isEmpty { payload.removeValue(forKey: "id") }
        guard let reply = await request(["action": "save", "data": payload]) else { return Self.unreachable }
        return reply.saved?.value?.sanitized == nil ? (reply.error ?? Self.unreachable) : nil
    }

    /// Deletes an item (every day of a repeating one). Returns nil once it is gone, else why not.
    func remove(id: String) async -> String? {
#if DEBUG
        if debugPinned {
            items = items.filter { $0.id != id }
            return nil
        }
#endif
        guard let reply = await request(["action": "remove", "id": id]) else { return Self.unreachable }
        return items.contains { $0.id == id } ? (reply.error ?? Self.unreachable) : nil
    }

    /// 微信和 QQ 也提醒: shown at once, then saved through the page.
    func setRelay(_ on: Bool) {
        relay = on
        Task { _ = await request(["action": "relay", "on": on]) }
    }

    /// Reads a sentence into the fields of an item; nil when the page cannot.
    func parse(_ text: String) async -> NativeAgendaDraft? {
        guard let store, let body = try? JSONSerialization.data(withJSONObject: ["action": "parse", "text": text]),
              let request = String(data: body, encoding: .utf8),
              let raw = await store.agenda(request), let data = raw.data(using: .utf8) else { return nil }
        return (try? JSONDecoder().decode(ParseReply.self, from: data))?.parsed
    }

    /// Forgets the copy: signed out.
    func clear() {
#if DEBUG
        if debugPinned { return }
#endif
        available = false
        relay = false
        pendingItem = nil
        if !items.isEmpty { items = [] }
        Self.writeCache([])
        NativeAgendaReminders.sync([])
    }

    private func flushPendingItem() {
        guard let id = pendingItem, let item = items.first(where: { $0.id == id }) else { return }
        pendingItem = nil
        presentation = .edit(item)
    }

    /// One request through the page; the reply when it answered for an account, else nil.
    private func request(_ payload: [String: Any]) async -> Reply? {
        guard let store, let body = try? JSONSerialization.data(withJSONObject: payload),
              let request = String(data: body, encoding: .utf8) else { return nil }
        let raw = await store.agenda(request)
        accept(raw)
        guard let raw, let data = raw.data(using: .utf8), let reply = try? JSONDecoder().decode(Reply.self, from: data),
              reply.missing != true, reply.authenticated == true else { return nil }
        return reply
    }

    private static let unreachable = "没能保存，请检查网络后再试"

    private func accept(_ raw: String?) {
        guard let raw, let data = raw.data(using: .utf8), let reply = try? JSONDecoder().decode(Reply.self, from: data) else { return }
        // An older site without the bridge: keep what is shown.
        if reply.missing == true { return }
        guard reply.authenticated == true else {
            clear()
            return
        }
        relay = reply.relay == true
        var seen = Set<String>()
        let next = (reply.items ?? []).compactMap { $0.value?.sanitized }.filter { seen.insert($0.id).inserted }
        available = true
        if next != items { items = next }
        Self.writeCache(next)
        NativeAgendaReminders.sync(next)
        flushPendingItem()
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
