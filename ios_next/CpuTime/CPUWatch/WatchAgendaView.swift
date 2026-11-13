import Combine
import SwiftUI
import WatchKit

/// 日程 on the watch: the phone's list, kept in the watch's own storage, with the ticks made
/// here shown at once and sent to the phone.
@MainActor
final class WatchAgendaStore: ObservableObject {
    static let shared = WatchAgendaStore()

    @Published private(set) var agenda: WatchAgenda?
    /// Ticks made here that the phone's list does not show yet.
    @Published private(set) var ticks: [String: Bool] = [:]
    /// Set by the app: sends one tick to the phone.
    var send: ((_ itemID: String, _ date: String, _ done: Bool) -> Void)?

    private struct Saved: Codable {
        var agenda: WatchAgenda?
        var ticks: [String: Bool]
    }

    private init() {
        if let url = Self.url, let data = try? Data(contentsOf: url), let saved = try? JSONDecoder().decode(Saved.self, from: data) {
            agenda = saved.agenda
            ticks = saved.ticks
        }
    }

    /// What to show: the list with this watch's ticks over it.
    var shown: WatchAgenda? { agenda?.applying(ticks) }

    /// How many of today's items are still to do, for the entry row.
    func openToday(_ today: String) -> Int {
        shown?.items.filter { $0.date == today && !$0.done }.count ?? 0
    }

    func accept(_ data: Data) {
        guard let next = WatchAgenda.decode(data) else { return }
        // An empty list with no day is the phone signing out.
        agenda = next.today.isEmpty && next.items.isEmpty ? nil : next
        ticks = agenda?.unsettled(ticks) ?? [:]
        save()
    }

    func toggle(_ item: WatchAgenda.Item) {
        guard item.tickable else { return }
        let done = !item.done
        ticks[item.id] = done
        save()
        WKInterfaceDevice.current().play(done ? .success : .click)
        send?(item.itemID, item.date, done)
    }

    private func save() {
        guard let url = Self.url else { return }
        if agenda == nil && ticks.isEmpty {
            try? FileManager.default.removeItem(at: url)
            return
        }
        if let data = try? JSONEncoder().encode(Saved(agenda: agenda, ticks: ticks)) {
            try? data.write(to: url, options: [.atomic])
        }
    }

    private static var url: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: WatchScheduleWidgetConfiguration.appGroupIdentifier)?
            .appendingPathComponent("watch-agenda-v1.json")
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("watch-agenda-v1.json")
    }

    /// The watch's own date in China time, and the day after.
    static func days(_ now: Date = .now) -> (today: String, tomorrow: String) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        func text(_ date: Date) -> String {
            let parts = calendar.dateComponents([.year, .month, .day], from: date)
            return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
        }
        return (text(now), text(calendar.date(byAdding: .day, value: 1, to: now) ?? now))
    }
}

struct WatchAgendaListView: View {
    @ObservedObject private var store = WatchAgendaStore.shared

    var body: some View {
        let days = WatchAgendaStore.days()
        List {
            if let agenda = store.shown {
                let sections = agenda.sections(today: days.today, tomorrow: days.tomorrow)
                if sections.isEmpty {
                    Text("这一周没有日程").foregroundStyle(.secondary)
                }
                ForEach(sections) { section in
                    Section(section.title) {
                        ForEach(section.items) { item in
                            WatchAgendaRow(item: item, showsDate: section.title == "之后" || section.title == "已过日期") {
                                store.toggle(item)
                            }
                        }
                    }
                }
                if !store.ticks.isEmpty {
                    Text("勾选会在 iPhone 上的药大拾间下次打开时保存")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .listRowBackground(Color.clear)
                }
            } else {
                Text("在 iPhone 上打开药大拾间并登录后，这里会显示日程")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("日程")
    }
}

private struct WatchAgendaRow: View {
    let item: WatchAgenda.Item
    let showsDate: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: item.done ? "checkmark.circle.fill" : item.tickable ? "circle" : "pencil.and.list.clipboard")
                    .foregroundStyle(item.done ? Color.green : item.tickable ? Color.secondary : Color.red)
                    .imageScale(.large)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.body)
                        .strikethrough(item.done)
                        .foregroundStyle(item.done ? .secondary : .primary)
                        .lineLimit(2)
                    let detail = [showsDate ? Self.shortDate(item.date) : "", item.timeText, item.location].filter { !$0.isEmpty }.joined(separator: " · ")
                    if !detail.isEmpty {
                        Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
        }
        .disabled(!item.tickable)
        .accessibilityLabel("\(item.title)，\(item.done ? "已完成" : "未完成")")
    }

    /// "11-17" → "11月17日"
    private static func shortDate(_ date: String) -> String {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        return parts.count == 3 ? "\(parts[1])月\(parts[2])日" : ""
    }
}
