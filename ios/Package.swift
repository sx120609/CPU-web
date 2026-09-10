// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "WatchScheduleCore",
    platforms: [.macOS(.v13), .iOS(.v17), .watchOS(.v10)],
    products: [.library(name: "WatchScheduleCore", targets: ["WatchScheduleCore"])],
    targets: [
        .target(name: "SharedConfiguration", path: "SharedConfiguration"),
        .target(
            name: "WatchScheduleCore",
            dependencies: ["SharedConfiguration"],
            path: "SharedSchedule",
            exclude: ["WatchSessionTransport.swift"]
        ),
        .testTarget(
            name: "WatchScheduleCoreTests",
            dependencies: ["WatchScheduleCore"],
            path: "tests",
            exclude: [
                "watch-bridge.test.mjs",
                "watch-calendar-ui.test.mjs",
                "watch-ui-entry.test.mjs",
                "watch-widget.test.mjs",
            ]
        ),
    ],
    swiftLanguageModes: [.v5]
)
