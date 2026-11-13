import Combine
import UIKit
import WidgetKit

/// Feeds the 日程 widget (`AgendaWidget` in the extension) and takes back what
/// was ticked off on it.
///
/// - Whenever the list changes, the open to-dos and the coming fortnight of
///   日程 are written to the App Group (`AgendaWidgetSnapshot`), titles and
///   places only, and only that widget is reloaded, only when the file changed.
/// - The widget has no session, so a tick there is kept in the App Group
///   (`AgendaWidgetStore.pending`). Once the site has answered for the account
///   (`NativeAgendaService.available`), each tick that still differs from the
///   list is saved through `NativeAgendaService.toggle`, the same path as a
///   tick in the app, and the file is cleared.
/// - Signed out, the snapshot and the ticks are removed.
@available(iOS 17.0, *)
@MainActor
final class NativeAgendaWidgetBridge {
    static let shared = NativeAgendaWidgetBridge()

    private var cancellables: Set<AnyCancellable> = []
    private weak var service: NativeAgendaService?

    /// Called once by `NativeAgendaService` when it is made.
    func start(_ service: NativeAgendaService) {
        guard self.service == nil else { return }
        self.service = service
        service.$items
            .combineLatest(service.$available)
            .debounce(for: .milliseconds(300), scheduler: RunLoop.main)
            .sink { [weak self] _, _ in self?.sync() }
            .store(in: &cancellables)
        // A tick made on the widget while the app sat in the background.
        NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
            .sink { [weak self] _ in self?.sync() }
            .store(in: &cancellables)
    }

    /// Applies waiting ticks, then writes the snapshot.
    func sync() {
        guard let service else { return }
        if service.available { applyPending(service) }
        write(service)
        // The same list feeds 日程 into the Live Activities (off unless chosen there).
        NativeLiveActivityController.shared.setAgenda(NativeAgendaRules.activities(service.items, now: Date()).map {
            .init(id: $0.id, title: $0.title, location: $0.location, dateKey: $0.date, start: $0.start, end: $0.end)
        })
    }

    /// The line in 设备与服务 → iPhone 小组件.
    static var statusText: String {
        let waiting = AgendaWidgetStore.pending().count
        if waiting > 0 { return "\(waiting) 项勾选待同步" }
        switch AgendaWidgetStore.read() {
        case .loaded(let snapshot): return snapshot.items.isEmpty ? "没有要做的日程" : "已同步 \(snapshot.items.count) 项"
        case .missing: return "登录后同步"
        case .failed: return "等待同步"
        }
    }

    private func applyPending(_ service: NativeAgendaService) {
        let pending = AgendaWidgetStore.pending()
        guard !pending.isEmpty else { return }
        for tick in pending {
            guard let item = service.items.first(where: { $0.id == tick.itemID }) else { continue }
            let date = tick.date.isEmpty ? item.date : tick.date
            let done = NativeAgendaRules.isDone(item, on: date)
            // Ticked in the app too, or the day no longer belongs to a repeating item.
            guard done != tick.done else { continue }
            if item.repeats && !NativeAgendaRules.occurs(item, on: date) { continue }
            service.toggle(NativeAgendaOccurrence(item: item, date: date, done: done))
        }
        AgendaWidgetStore.writePending([])
    }

    private func write(_ service: NativeAgendaService) {
        let snapshot: AgendaWidgetSnapshot?
        if !service.available && service.items.isEmpty {
            // Signed out, or nothing read yet on a fresh install: the widget asks to open the app.
            snapshot = nil
            AgendaWidgetStore.writePending([])
        } else {
            snapshot = NativeAgendaWidgetProjection.snapshot(service.items, now: Date())
        }
        if AgendaWidgetStore.write(snapshot) {
            WidgetCenter.shared.reloadTimelines(ofKind: AgendaWidgetSnapshot.widgetKind)
        }
    }
}

/// The 日程 widget's links: `cputime-next://schedule?action=agenda-item&item=…&date=…`,
/// `action=agenda-list` and `action=agenda-new`.
@available(iOS 17.0, *)
@MainActor
enum NativeAgendaWidgetLink {
    static func isLink(_ query: [URLQueryItem]) -> Bool {
        ["agenda-item", "agenda-list", "agenda-new"].contains(action(query) ?? "")
    }

    static func open(_ query: [URLQueryItem]) {
        let service = NativeAgendaService.shared
        switch action(query) {
        case "agenda-item":
            let id = query.first { $0.name == "item" }?.value ?? ""
            let date = query.first { $0.name == "date" }?.value ?? ""
            if id.isEmpty { service.openList() } else { service.openFromNotification(id: id, date: date) }
        case "agenda-new":
            service.openNew(date: NativeAgendaRules.today())
        default:
            service.openList()
        }
    }

    private static func action(_ query: [URLQueryItem]) -> String? {
        query.first { $0.name == "action" }?.value
    }
}
