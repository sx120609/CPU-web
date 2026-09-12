// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "WatchScheduleCore",
    platforms: [.macOS(.v13), .iOS(.v17), .watchOS(.v10)],
    products: [.library(name: "WatchScheduleCore", targets: ["WatchScheduleCore"])],
    targets: [
        .target(
            name: "WatchScheduleCore",
            path: "CpuTime",
            exclude: [
                "AppInfo.plist",
                "Configurations",
                "CpuTime.xcodeproj",
                "CpuTime",
                "CPUWebWidgets",
                "CPUWatch/Assets.xcassets",
                "CPUWatch/CPUWatch.entitlements",
                "CPUWatch/CPUWatchApp.swift",
                "CPUWatch/Info.plist",
                "CPUWatch/WatchBackgroundDelegate.swift",
                "CPUWatch/WatchCalendarView.swift",
                "CPUWatchWidgets",
                "WatchSync/WatchSessionTransport.swift",
            ],
            sources: [
                "WatchShared/AppGroupIdentifier.swift",
                "WatchShared/CourseRepository.swift",
                "WatchShared/ScheduleEnvelope.swift",
                "WatchShared/WatchWidgetSupport.swift",
                "WatchSync/ScheduleReceiptDeduplicator.swift",
                "WatchSync/ScheduleSyncCoordinator.swift",
                "CPUWatch/WatchBackgroundTaskFinisher.swift",
            ]
        ),
        .testTarget(
            name: "WatchScheduleCoreTests",
            dependencies: ["WatchScheduleCore"],
            path: "tests",
            exclude: [
                "NativeScheduleStoreChecks.swift",
                "NativeTabSelectionChecks.swift",
                "native-web-bundle.test.mjs",
                "watch-integration.test.mjs",
                "web-schedule-bridge.test.mjs",
                "widget-configuration.test.mjs",
            ],
            sources: ["WatchScheduleCoreTests.swift"]
        ),
    ],
    swiftLanguageModes: [.v5]
)
