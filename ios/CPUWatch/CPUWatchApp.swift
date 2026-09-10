import Combine
import SwiftUI
import WatchKit
import WidgetKit

@MainActor
final class WatchScheduleStore: ObservableObject {
    static let shared = WatchScheduleStore()
    let coordinator: ScheduleSyncCoordinator
    init() {
        coordinator = ScheduleSyncCoordinator(role: .watch,
            repository: CourseRepository(storage: FileScheduleStorage.local()),
            transport: WatchSessionTransport())
        coordinator.onChange = { [weak self] in
            self?.objectWillChange.send()
            WidgetCenter.shared.reloadTimelines(ofKind: WatchScheduleWidgetConfiguration.kind)
        }
        coordinator.start()
    }
}

@main
struct CPUWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchBackgroundDelegate.self) private var delegate
    @StateObject private var store = WatchScheduleStore.shared
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            WatchScheduleView(store: store)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { store.coordinator.foreground() }
                }
        }
    }
}

struct WatchScheduleView: View {
    @ObservedObject var store: WatchScheduleStore
    @State private var selectedDayID = 0

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            NavigationStack {
                Group {
                    if let snapshot = store.coordinator.repository.snapshot {
                        WatchCalendarPager(
                            snapshot: snapshot,
                            now: context.date,
                            state: store.coordinator.state(at: context.date),
                            connectionIssue: store.coordinator.connectionIssue,
                            selectedDayID: $selectedDayID,
                            refresh: store.coordinator.refresh
                        )
                    } else {
                        WatchScheduleUnavailableView(
                            state: store.coordinator.state(at: context.date),
                            refreshing: store.coordinator.refreshing,
                            refresh: store.coordinator.refresh
                        )
                    }
                }
                .navigationTitle("课表")
            }
        }
    }
}
