import Foundation
import WidgetKit

/// 日程 on the Apple Watch, the phone's end. The watch gets the list the home-screen widget
/// shows, cut to a week; a tick made there comes back and is left with the widget's own
/// pending ticks, so `NativeAgendaWidgetBridge` saves it the same way once the app can.
@available(iOS 17.0, *)
@MainActor
enum PhoneWatchAgenda {
    private static weak var transport: WatchSessionTransport?
    private static var lastSent: Data?
    private static var latest: Data?

    static func attach(_ transport: WatchSessionTransport) {
        self.transport = transport
        transport.onAgendaTick = { itemID, date, done in
            AgendaWidgetStore.addPending(AgendaWidgetCompletion(itemID: itemID, date: date, done: done))
            // The widgets show the tick at once; the app saves it when its page is signed in.
            WidgetCenter.shared.reloadTimelines(ofKind: AgendaWidgetSnapshot.widgetKind)
            WidgetCenter.shared.reloadTimelines(ofKind: AppWidgetConfiguration.overviewKind)
            NativeAgendaWidgetBridge.shared.sync()
        }
        resend()
    }

    /// The list the widget was just given; nil when signed out.
    static func publish(_ snapshot: AgendaWidgetSnapshot?) {
        latest = list(snapshot).encoded()
        resend()
    }

    /// Sends the latest list if the watch has not been sent it: after a change, and when the
    /// app comes forward (the watch may have been paired or its app installed since).
    static func resend() {
        guard let transport, let latest, latest != lastSent,
              transport.connection.activated, transport.connection.installed else { return }
        transport.sendAgenda(latest)
        lastSent = latest
    }

    static func list(_ snapshot: AgendaWidgetSnapshot?) -> WatchAgenda {
        guard let snapshot else { return WatchAgenda(today: "", items: []) }
        let last = AgendaWidgetClock.adding(WatchAgenda.days - 1, to: snapshot.today)
        let items = snapshot.items.filter { $0.date.isEmpty || $0.date <= last }.prefix(WatchAgenda.limit).map {
            WatchAgenda.Item(itemID: $0.itemID, date: $0.date, title: $0.title, todo: $0.todo, start: $0.start, end: $0.end,
                             location: $0.location, done: $0.done)
        }
        return WatchAgenda(today: snapshot.today, items: Array(items))
    }
}
