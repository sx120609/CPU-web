import AppIntents
import SwiftUI
import WidgetKit

@main
struct CPUWebWidgetBundle: WidgetBundle {
    var body: some Widget {
        UpcomingScheduleWidget()
        TodayScheduleWidget()
        TwoDayScheduleWidget()
        WeekScheduleWidget()
        OverviewScheduleWidget()
        AgendaWidget()
        liveActivity
        // Control Center buttons.
        if #available(iOS 18.0, *) {
            ScheduleOpenControl()
            ScheduleAgendaControl()
        }
    }

    private var liveActivity: some Widget {
        // WidgetBundleBuilder supports availability without an else branch.
        // Its public availability wrapper keeps one activity configuration
        // registered on both iOS 17 and versions with Watch family support.
        if #available(iOS 18.0, *) {
            return WidgetBundleBuilder.buildOptional(
                WidgetBundleBuilder.buildLimitedAvailability(ScheduleLiveActivityModernWidget())
            )
        }
        return WidgetBundleBuilder.buildOptional(
            WidgetBundleBuilder.buildLimitedAvailability(ScheduleLiveActivityWidget())
        )
    }
}

@available(iOS 18.0, *)
private struct ScheduleLiveActivityModernWidget: Widget {
    var body: some WidgetConfiguration {
        ScheduleLiveActivityWidget().body
            .supplementalActivityFamilies([.small, .medium])
    }
}

@available(iOS 16.1, *)
private struct ScheduleLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ScheduleLiveActivityAttributes.self) { context in
            let state = context.state.resolvedForBroadcast(attributes: context.attributes)
            Group {
                if #available(iOS 18.0, *) {
                    ScheduleLiveActivityAdaptiveContent(state: state)
                } else {
                    ScheduleLiveActivityLockScreen(state: state)
                }
            }
            .modifier(ScheduleLiveActivitySurface())
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            let state = context.state.resolvedForBroadcast(attributes: context.attributes)
            return DynamicIsland {
                // The camera owns the centre of the expanded island. Put the
                // title in the full-width bottom region rather than squeezing
                // it between the logo, camera and a growing timer.
                DynamicIslandExpandedRegion(.leading, priority: 1) {
                    HStack(spacing: 5) {
                        ScheduleLiveActivityLogo(size: 24)
                        Text(state.islandTitle)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(ScheduleLiveActivityPalette.accent)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .frame(maxWidth: .infinity, minHeight: 24, alignment: .topLeading)
                    .padding(.top, -8)
                    .dynamicIsland(verticalPlacement: .belowIfTooWide)
                }
                DynamicIslandExpandedRegion(.trailing, priority: 1) {
                    // The two rows carry a timer each; a third one up here
                    // would only repeat the user's.
                    if state.pairedCompanion == nil {
                        ScheduleLiveActivityCountdown(state: state, compact: true, centered: true)
                            .frame(maxWidth: .infinity, minHeight: 24, alignment: .topTrailing)
                            .padding(.top, -8)
                            .dynamicIsland(verticalPlacement: .belowIfTooWide)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if state.pairedCompanion != nil {
                        ScheduleLiveActivityPairRows(state: state, compact: true)
                            .padding(.horizontal, 6)
                            .padding(.bottom, 8)
                            .padding(.top, 1)
                    } else {
                        ScheduleLiveActivityExpandedDetails(state: state)
                            .padding(.top, 1)
                    }
                }
            } compactLeading: {
                ScheduleLiveActivityLogo(size: 24)
                    .overlay(alignment: .bottomTrailing) {
                        // The partner has a class around this one.
                        if let companion = state.companion {
                            Image(systemName: "heart.fill")
                                .font(.system(size: 8))
                                .foregroundStyle(ScheduleLiveActivityPalette.partner(companion.hue))
                                .offset(x: 4, y: 3)
                        }
                    }
                    .accessibilityLabel(state.companion == nil ? "药大拾间课表" : "药大拾间课表，\(state.islandTitle)")
            } compactTrailing: {
                ScheduleLiveActivityCompactTimer(state: state)
            } minimal: {
                ScheduleLiveActivityLogo(size: 24)
                    .accessibilityLabel("药大拾间课表")
            }
            // Keep the system's side and bottom insets clear of the capsule corners.
            .contentMargins(.top, 0, for: .expanded)
            .widgetURL(context.attributes.deepLinkURL)
            .keylineTint(ScheduleLiveActivityPalette.brand)
        }
    }
}

@available(iOS 18.0, *)
private struct ScheduleLiveActivityAdaptiveContent: View {
    let state: ScheduleLiveActivityAttributes.ContentState
    @Environment(\.activityFamily) private var family

    var body: some View {
        switch family {
        case .small:
            ScheduleLiveActivityWatchCard(state: state)
        case .medium:
            ScheduleLiveActivityLockScreen(state: state)
        @unknown default:
            ScheduleLiveActivityLockScreen(state: state)
        }
    }
}

@available(iOS 16.1, *)
private struct ScheduleLiveActivityLockScreen: View {
    let state: ScheduleLiveActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if state.pairedCompanion != nil {
                // The partner has a class around this one: a row each.
                HStack(spacing: 8) {
                    ScheduleLiveActivityLogo(size: 24)
                    Text(state.islandTitle)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(ScheduleLiveActivityPalette.accent)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                }
                if let note = state.normalizedAdjustmentNote {
                    ScheduleLiveActivityAdjustmentChip(note: note)
                }
                ScheduleLiveActivityPairRows(state: state, showsProgress: true)
            } else {
            HStack(alignment: .center, spacing: 10) {
                ScheduleLiveActivityLogo(size: 34)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 5) {
                        Text(state.courseName)
                            .font(.system(size: 19, weight: .bold))
                            .foregroundStyle(ScheduleLiveActivityPalette.primaryText)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        if let companion = state.companion, companion.together {
                            ScheduleLiveActivityTogetherTag(label: companion.label, hue: companion.hue)
                        }
                    }
                    Text(ScheduleLiveActivityFormatting.timeRange(start: state.startDate, end: state.endDate))
                        .font(.system(size: 12, weight: .medium, design: .rounded).monospacedDigit())
                        .foregroundStyle(ScheduleLiveActivityPalette.secondaryText)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                ScheduleLiveActivityCountdown(state: state)
            }

            if let note = state.normalizedAdjustmentNote {
                ScheduleLiveActivityAdjustmentChip(note: note)
            }
            ScheduleLiveActivityCourseDetails(state: state)
            ScheduleLiveActivityProgress(state: state)
            }

            if state.hasNextCourse {
                ScheduleLiveActivityNextCourse(state: state)
                    .padding(.top, 1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // ActivityKit supplies the rounded background, not content insets.
        // Keep every baseline clear of its corners, including the next row.
        .padding(.horizontal, 21)
        .padding(.vertical, 14)
        .background {
            LinearGradient(
                colors: [ScheduleLiveActivityPalette.brand.opacity(0.2), .clear],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }
}

@available(iOS 16.1, *)
private struct ScheduleLiveActivityExpandedDetails: View {
    let state: ScheduleLiveActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                HStack(spacing: 5) {
                    Text(state.courseName)
                        .font(.system(size: 19, weight: .bold))
                        .foregroundStyle(ScheduleLiveActivityPalette.primaryText)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    if let companion = state.companion, companion.together {
                        ScheduleLiveActivityTogetherTag(label: companion.label, hue: companion.hue)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(ScheduleLiveActivityFormatting.timeRange(start: state.startDate, end: state.endDate))
                    .font(.system(size: 11, weight: .medium, design: .rounded).monospacedDigit())
                    .foregroundStyle(ScheduleLiveActivityPalette.secondaryText)
                    .fixedSize()
            }
            if let note = state.normalizedAdjustmentNote {
                ScheduleLiveActivityAdjustmentChip(note: note)
            }
            ScheduleLiveActivityCourseDetails(state: state)
            ScheduleLiveActivityProgress(state: state)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // The bottom region is clipped by Dynamic Island's own capsule. Keep
        // the progress track and the metadata away from its lower corners.
        .padding(.horizontal, 6)
        .padding(.bottom, 8)
    }
}

/// 情侣课表：两人这段时间都有课时，一人一行。自己的在上、TA 的在下，
/// 各有自己的倒计时；行首的小标签写明是谁的课。
@available(iOS 16.1, *)
private struct ScheduleLiveActivityPairRows: View {
    let state: ScheduleLiveActivityAttributes.ContentState
    var showsProgress = false
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 5 : 8) {
            ScheduleLiveActivityPairRow(entry: .own(state), showsProgress: showsProgress, compact: compact)
            if let companion = state.pairedCompanion {
                ScheduleLiveActivityPairRow(entry: .partner(companion), showsProgress: showsProgress, compact: compact)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ScheduleLiveActivityPairEntry {
    let tag: String
    let tint: Color
    let courseName: String
    let detail: String
    let inProgress: Bool
    /// The countdown; nil while there is nothing to count down to.
    let timer: ClosedRange<Date>?
    let progress: ClosedRange<Date>?

    static func own(_ state: ScheduleLiveActivityAttributes.ContentState) -> Self {
        let end = state.phase == .inProgress ? state.endDate : state.startDate
        return Self(tag: "我", tint: ScheduleLiveActivityPalette.person(state.companion?.ownHue, fallback: ScheduleLiveActivityPalette.accent),
                    courseName: state.courseName,
                    detail: detail(location: state.location, teacher: state.teacher, period: state.periodLabel),
                    inProgress: state.phase == .inProgress,
                    timer: state.phase == .idle ? nil : min(state.updatedAt, end)...end,
                    progress: state.phase == .inProgress && state.endDate > state.startDate ? state.startDate...state.endDate : nil)
    }

    static func partner(_ companion: ScheduleLiveActivityAttributes.ContentState.Companion) -> Self {
        let inProgress = companion.phase == .inProgress
        let end = inProgress ? companion.endDate : companion.startDate
        return Self(tag: companion.label.isEmpty ? "TA" : companion.label, tint: ScheduleLiveActivityPalette.partner(companion.hue),
                    courseName: companion.courseName,
                    detail: detail(location: companion.location, teacher: companion.teacher, period: companion.periodLabel),
                    inProgress: inProgress, timer: min(companion.updatedAt, end)...end,
                    progress: inProgress && companion.endDate > companion.startDate ? companion.startDate...companion.endDate : nil)
    }

    private static func detail(location: String, teacher: String, period: String?) -> String {
        [location.isEmpty ? teacher : location, period ?? ""]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }
}

@available(iOS 16.1, *)
private struct ScheduleLiveActivityPairRow: View {
    let entry: ScheduleLiveActivityPairEntry
    var showsProgress = false
    var compact = false

    /// Each row takes the colour its person picked for the couple
    /// timetable, so the two can be told apart before either tag is read.
    private var tint: Color { entry.tint }

    var body: some View {
        HStack(alignment: .top, spacing: compact ? 6 : 8) {
            Capsule()
                .fill(tint)
                .frame(width: 3)
                .padding(.vertical, 1)
            VStack(alignment: .leading, spacing: compact ? 1 : 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(entry.courseName)
                        .font(.system(size: compact ? 13 : 15, weight: .bold))
                        .foregroundStyle(ScheduleLiveActivityPalette.primaryText)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    ScheduleLiveActivityTimer(interval: entry.timer)
                        .font(.system(size: compact ? 13 : 15, weight: .semibold, design: .rounded).monospacedDigit())
                        .foregroundStyle(tint)
                }
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(entry.tag)
                        .font(.system(size: compact ? 9 : 10, weight: .bold))
                        .foregroundStyle(tint)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(tint.opacity(0.18), in: Capsule())
                        .frame(maxWidth: compact ? 44 : 72, alignment: .leading)
                        .fixedSize(horizontal: true, vertical: false)
                    if !entry.detail.isEmpty {
                        Text(entry.detail)
                            .font(.system(size: compact ? 10 : 11, weight: .medium))
                            .foregroundStyle(ScheduleLiveActivityPalette.secondaryText)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Spacer(minLength: 4)
                    if !compact, entry.timer != nil {
                        Text(entry.inProgress ? "距下课" : "距上课")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(ScheduleLiveActivityPalette.tertiaryText)
                            .fixedSize()
                    }
                }
                if showsProgress, let progress = entry.progress {
                    ProgressView(timerInterval: progress, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                        .progressViewStyle(.linear)
                        .tint(tint)
                        .frame(height: 4)
                        .padding(.top, 1)
                }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(entry.tag)：\(entry.courseName)，\(entry.inProgress ? "正在上课" : "即将上课")")
    }
}

/// 两人上的是同一节课：不拆成两行，课名后面标一下。
@available(iOS 16.1, *)
private struct ScheduleLiveActivityTogetherTag: View {
    let label: String
    var hue: Int? = nil

    var body: some View {
        let tint = ScheduleLiveActivityPalette.partner(hue)
        HStack(spacing: 2) {
            Image(systemName: "heart.fill").font(.system(size: 8))
            Text("一起上").font(.system(size: 10, weight: .bold))
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 5)
        .padding(.vertical, 1)
        .background(tint.opacity(0.18), in: Capsule())
        .fixedSize()
        .accessibilityLabel("和\(label.isEmpty ? "TA" : label)一起上")
    }
}

/// 调休那天锁屏上多一行说明。补课日显示的是另一天的课，不说清楚就是一节
/// 看起来不该存在的课。
@available(iOS 16.1, *)
private struct ScheduleLiveActivityAdjustmentChip: View {
    let note: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "calendar.badge.exclamationmark")
                .font(.system(size: 10, weight: .semibold))
            Text(note)
                .font(.system(size: 11, weight: .medium))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .foregroundStyle(ScheduleLiveActivityPalette.brand)
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .background(ScheduleLiveActivityPalette.brand.opacity(0.16), in: Capsule())
    }
}

@available(iOS 16.1, *)
private struct ScheduleLiveActivityCourseDetails: View {
    let state: ScheduleLiveActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 10) {
            if !state.location.isEmpty {
                Text(state.location)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(ScheduleLiveActivityPalette.primaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .minimumScaleFactor(0.78)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: 6) {
                if !state.teacher.isEmpty {
                    Text(state.teacher)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .minimumScaleFactor(0.72)
                }
                if let period = state.periodLabel, !period.isEmpty {
                    Text(period)
                        .fixedSize()
                }
            }
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(ScheduleLiveActivityPalette.secondaryText)
            .frame(maxWidth: .infinity, alignment: state.location.isEmpty ? .leading : .trailing)
        }
    }
}

@available(iOS 16.1, *)
private struct ScheduleLiveActivityCountdown: View {
    let state: ScheduleLiveActivityAttributes.ContentState
    var compact = false
    var centered = false

    var body: some View {
        VStack(alignment: centered ? .center : .trailing, spacing: compact ? 1 : 3) {
            Text(state.countdownTitle)
                .font(.system(size: compact ? 10 : 11, weight: .medium))
                .foregroundStyle(ScheduleLiveActivityPalette.accent)
            ScheduleLiveActivityTimer(state: state, alignment: centered ? .center : .trailing)
                .font(.system(size: compact ? 22 : 25, weight: .semibold, design: .rounded).monospacedDigit())
                .foregroundStyle(ScheduleLiveActivityPalette.accent)
        }
        .fixedSize()
        .accessibilityElement(children: .combine)
    }
}

@available(iOS 16.1, *)
private struct ScheduleLiveActivityNextCourse: View {
    let state: ScheduleLiveActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Divider()
                .overlay(ScheduleLiveActivityPalette.divider)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("下一节")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(ScheduleLiveActivityPalette.tertiaryText)
                    .fixedSize()
                Text([state.nextCourseName, state.nextCourseContext].compactMap { $0 }.joined(separator: "  "))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(ScheduleLiveActivityPalette.secondaryText)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let start = state.nextCourseStart {
                    Text(ScheduleLiveActivityFormatting.timeRange(start: start, end: state.nextCourseEnd))
                        .font(.system(size: 10, weight: .medium, design: .rounded).monospacedDigit())
                        .foregroundStyle(ScheduleLiveActivityPalette.tertiaryText)
                        .lineLimit(1)
                        .frame(width: 80, alignment: .trailing)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 1)
    }
}

@available(iOS 16.1, *)
private struct ScheduleLiveActivityWatchCard: View {
    let state: ScheduleLiveActivityAttributes.ContentState

    var body: some View {
        // Smart Stack's mirrored small activity has a much shorter proposal
        // than the phone lock screen. Fit within it instead of overflowing a
        // six-row stack and losing the logo/top baseline to the system clip.
        ViewThatFits(in: .vertical) {
            content(showsTimeRange: true)
            content(showsTimeRange: false)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private func content(showsTimeRange: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 5) {
                ScheduleLiveActivityLogo(size: 16)
                Text(state.courseName)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(ScheduleLiveActivityPalette.primaryText)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: 4) {
                Text(state.phaseTitle)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(ScheduleLiveActivityPalette.accent)
                    .lineLimit(1)
                Spacer(minLength: 2)
                ScheduleLiveActivityTimer(state: state)
                    .font(.system(size: 12, weight: .semibold, design: .rounded).monospacedDigit())
                    .foregroundStyle(ScheduleLiveActivityPalette.primaryText)
            }
            Text([state.location.isEmpty ? state.teacher : state.location, state.periodLabel ?? ""]
                .filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(ScheduleLiveActivityPalette.secondaryText)
                .lineLimit(1)
            if showsTimeRange {
                Text(ScheduleLiveActivityFormatting.timeRange(start: state.startDate, end: state.endDate))
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(ScheduleLiveActivityPalette.secondaryText)
                    .lineLimit(1)
            }
            ScheduleLiveActivityProgress(state: state)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }
}

@available(iOS 16.1, *)
private struct ScheduleLiveActivityLogo: View {
    let size: CGFloat

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 18 / 84, style: .continuous)
        ZStack {
            Color(red: 15 / 255, green: 143 / 255, blue: 127 / 255)
                .clipShape(shape)
            Image("CPUActivityLogo")
                .resizable()
                .renderingMode(.original)
                .aspectRatio(contentMode: .fit)
        }
        .frame(width: size, height: size)
        .clipShape(shape)
        .accessibilityHidden(true)
    }
}

@available(iOS 16.1, *)
private struct ScheduleLiveActivityProgress: View {
    let state: ScheduleLiveActivityAttributes.ContentState

    var body: some View {
        if state.phase == .inProgress, state.endDate > state.startDate {
            ProgressView(timerInterval: state.startDate...state.endDate, countsDown: false) {
                EmptyView()
            } currentValueLabel: {
                // The default timer progress label draws another clock below
                // the track even when its frame is only a few points tall.
                EmptyView()
            }
            .progressViewStyle(.linear)
            .tint(ScheduleLiveActivityPalette.accent)
            .frame(height: 4)
            .accessibilityLabel("本节课程进度")
        }
    }
}

/// The countdown of the compact island. Where the island is limited in width
/// (iOS 27: the iPhone Duo's closed display stands it upright in the status
/// column, about 27 points across) "214:37" cannot fit on one line at any
/// readable size, so the minutes go above and the seconds below.
@available(iOS 16.1, *)
private struct ScheduleLiveActivityCompactTimer: View {
    let state: ScheduleLiveActivityAttributes.ContentState

    var body: some View {
        if #available(iOS 27.0, *) {
            ScheduleLiveActivityNarrowAwareTimer(state: state)
        } else {
            wide
        }
    }

    fileprivate var wide: some View {
        ScheduleLiveActivityTimer(state: state)
            .font(.system(size: 16, weight: .semibold, design: .rounded).monospacedDigit())
            .foregroundStyle(ScheduleLiveActivityPalette.accent)
    }
}

@available(iOS 27.0, *)
private struct ScheduleLiveActivityNarrowAwareTimer: View {
    let state: ScheduleLiveActivityAttributes.ContentState
    @Environment(\.isDynamicIslandLimitedInWidth) private var limited

    var body: some View {
        let end = state.phase == .inProgress ? state.endDate : state.startDate
        if limited, state.phase != .idle {
            let interval = min(state.updatedAt, end)...end
            let template = ScheduleLiveActivityAttributes.countdownTemplate(interval)
            // A timer only formats as a whole "m:ss", so each line shows the
            // same live timer, cut down to its minutes or to ":ss". No
            // update from the app is needed while it counts.
            let minutes = String(template.prefix { $0 != ":" })
            // The slot is about as wide as the 24-point logo above it.
            let large = minutes.count < 3
            VStack(spacing: -2) {
                part(interval, template: template, shown: minutes, alignment: .leading)
                    .font(.system(size: large ? 14 : 12, weight: .bold, design: .rounded).monospacedDigit())
                part(interval, template: template, shown: ":00", alignment: .trailing)
                    .font(.system(size: large ? 11 : 10, weight: .semibold, design: .rounded).monospacedDigit())
            }
            .foregroundStyle(ScheduleLiveActivityPalette.accent)
            .accessibilityRepresentation {
                Text(timerInterval: interval, countsDown: true, showsHours: false)
            }
        } else {
            ScheduleLiveActivityCompactTimer(state: state).wide
        }
    }

    /// The part of the live countdown that `shown` covers: the whole timer is
    /// laid over `template` ("000:00"), which is pinned to the leading edge
    /// for the minutes or to the trailing edge for ":ss", and cut to `shown`.
    private func part(_ interval: ClosedRange<Date>, template: String, shown: String, alignment: Alignment) -> some View {
        Text(shown)
            .hidden()
            .overlay(alignment: alignment) {
                Text(template)
                    .hidden()
                    .overlay(alignment: .trailing) {
                        Text(timerInterval: interval, countsDown: true, showsHours: false)
                    }
                    .fixedSize()
            }
            .clipped()
            .lineLimit(1)
    }
}

/// A countdown as wide as the longest value it will show. A timer Text takes
/// all the width it is offered, so it is laid over a hidden text of that
/// length (`countdownTemplate`) instead of being given a fixed width, which
/// cut "100:00" and longer short.
@available(iOS 16.1, *)
private struct ScheduleLiveActivityTimer: View {
    /// Nil while there is nothing to count down to.
    let interval: ClosedRange<Date>?
    var alignment: Alignment = .trailing

    init(interval: ClosedRange<Date>?, alignment: Alignment = .trailing) {
        self.interval = interval
        self.alignment = alignment
    }

    init(state: ScheduleLiveActivityAttributes.ContentState, alignment: Alignment = .trailing) {
        let end = state.phase == .inProgress ? state.endDate : state.startDate
        // Use the content's stable origin, not Date.now. A stale render must
        // never create a reversed ClosedRange after the deadline has passed.
        self.init(interval: state.phase == .idle ? nil : min(state.updatedAt, end)...end, alignment: alignment)
    }

    var body: some View {
        if let interval {
            Text(ScheduleLiveActivityAttributes.countdownTemplate(interval))
                .hidden()
                .overlay(alignment: alignment) {
                    Text(timerInterval: interval, countsDown: true, showsHours: false)
                        .multilineTextAlignment(alignment == .center ? .center : .trailing)
                }
                .lineLimit(1)
                .fixedSize()
        } else {
            Text("—")
        }
    }
}

private enum ScheduleLiveActivityPalette {
    static let brand = Color(red: 15 / 255, green: 143 / 255, blue: 127 / 255)
    static let accent = Color(red: 70 / 255, green: 216 / 255, blue: 187 / 255)
    /// The partner's row of the couple timetable when no colour came along.
    static let partner = Color(red: 255 / 255, green: 133 / 255, blue: 173 / 255)

    static func partner(_ hue: Int?) -> Color { person(hue, fallback: partner) }

    /// The colour a person picked for the couple timetable, light enough
    /// for the dark surface: hsl(hue 88% 72%).
    static func person(_ hue: Int?, fallback: Color) -> Color {
        guard let hue else { return fallback }
        let h = Double(((hue % 360) + 360) % 360), s = 0.88, l = 0.72
        let chroma = (1 - abs(2 * l - 1)) * s
        let x = chroma * (1 - abs((h / 60).truncatingRemainder(dividingBy: 2) - 1))
        let m = l - chroma / 2
        let (r, g, b): (Double, Double, Double)
        switch Int(h / 60) {
        case 0: (r, g, b) = (chroma, x, 0)
        case 1: (r, g, b) = (x, chroma, 0)
        case 2: (r, g, b) = (0, chroma, x)
        case 3: (r, g, b) = (0, x, chroma)
        case 4: (r, g, b) = (x, 0, chroma)
        default: (r, g, b) = (chroma, 0, x)
        }
        return Color(red: r + m, green: g + m, blue: b + m)
    }
    static let surface = Color(red: 18 / 255, green: 23 / 255, blue: 24 / 255)
    static let primaryText = Color.white
    static let secondaryText = Color(red: 171 / 255, green: 183 / 255, blue: 184 / 255)
    static let tertiaryText = Color(red: 128 / 255, green: 143 / 255, blue: 144 / 255)
    static let divider = Color.white.opacity(0.16)
}

private enum ScheduleLiveActivityFormatting {
    private static let clock: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    private static let day: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        formatter.dateFormat = "M月d日"
        return formatter
    }()

    static func timeRange(start: Date, end: Date?) -> String {
        guard let end else { return clock.string(from: start) }
        return "\(clock.string(from: start))–\(clock.string(from: end))"
    }

    static func dayContext(for date: Date, relativeTo reference: Date) -> String? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: reference), to: calendar.startOfDay(for: date)).day
        if days == 0 { return nil }
        if days == 1 { return "明天" }
        return day.string(from: date)
    }
}

private extension ScheduleLiveActivityAttributes.ContentState {
    /// A 日程 is not a class: it starts and ends, it is not attended.
    var phaseTitle: String {
        if isAgenda { return phase == .idle ? "已结束或暂不可用" : phase == .inProgress ? "正在进行" : "即将开始" }
        return phase == .idle ? "已结束或暂不可用" : phase == .inProgress ? "正在上课" : phase == .intermission ? "课间休息" : "即将上课"
    }

    /// What the countdown counts to.
    var countdownTitle: String {
        if isAgenda { return phase == .idle ? "日程" : phase == .inProgress ? "距结束" : "距开始" }
        return phase == .idle ? "课间" : phase == .inProgress ? "距下课" : "距上课"
    }

    /// The partner's course on a row of its own. A class taken together is
    /// shown once, with a tag, so it has no second row.
    var pairedCompanion: Companion? {
        guard phase != .idle, let companion, !companion.together else { return nil }
        return companion
    }

    /// 情侣课表：两边都在上课就说「同时在上课」，一起上的课说「一起上课」，
    /// 否则还是自己这节课的状态。
    var islandTitle: String {
        guard phase != .idle, let companion else { return phaseTitle }
        if companion.together { return phase == .inProgress ? "一起上课" : "一起\(phaseTitle)" }
        if phase == .inProgress && companion.phase == .inProgress { return "同时在上课" }
        return phaseTitle
    }

    var hasNextCourse: Bool {
        !(nextCourseName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
            && nextCourseStart != nil
    }

    var nextCourseContext: String? {
        guard let start = nextCourseStart else { return nil }
        let value = [
            ScheduleLiveActivityFormatting.dayContext(for: start, relativeTo: startDate),
            nextCourseLocation,
        ].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        return value.isEmpty ? nil : value
    }
}

// MARK: - Schedule widgets
//
// The views are in ScheduleWidgetViews.swift, which the app's widget gallery
// compiles too.

private struct UpcomingScheduleWidget: Widget {
    let kind = "cn.cputime.mobile.widget.upcoming"

    var body: some WidgetConfiguration {
        // 沿用原来的 kind：换成可编辑的配置后，已经放在桌面上的小组件照样在，取默认值。
        AppIntentConfiguration(
            kind: kind,
            intent: UpcomingScheduleWidgetIntent.self,
            provider: ScheduleIntentTimelineProvider<UpcomingScheduleWidgetIntent>()
        ) { entry in
            ScheduleWidgetView(kind: .upcoming, entry: entry)
        }
        .configurationDisplayName("临近课程")
        .description("小号、中号和锁屏显示当前与下一节课，大号显示今天的完整安排。")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .systemLarge,
            .accessoryInline,
            .accessoryCircular,
            .accessoryRectangular,
        ])
    }
}

private struct TodayScheduleWidget: Widget {
    let kind = "cn.cputime.mobile.widget.today"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: TodayScheduleWidgetIntent.self,
            provider: ScheduleIntentTimelineProvider<TodayScheduleWidgetIntent>()
        ) { entry in
            ScheduleWidgetView(kind: .today, entry: entry)
        }
        .configurationDisplayName("今日课表")
        .description("查看今天的课程安排和还剩几节。")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .systemLarge,
            .accessoryInline,
            .accessoryCircular,
            .accessoryRectangular,
        ])
    }
}

private struct TwoDayScheduleWidget: Widget {
    let kind = "cn.cputime.mobile.widget.twoday"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: TwoDayScheduleWidgetIntent.self,
            provider: ScheduleIntentTimelineProvider<TwoDayScheduleWidgetIntent>()
        ) { entry in
            ScheduleWidgetView(kind: .twoDay, entry: entry)
        }
        .configurationDisplayName("两日课表")
        .description("并排显示今天和下一个有课日的课程。")
        .supportedFamilies([
            .systemMedium,
            .systemLarge,
            // iPad。
            .systemExtraLarge,
            .accessoryInline,
            .accessoryCircular,
            .accessoryRectangular,
        ])
    }
}

private struct WeekScheduleWidget: Widget {
    let kind = "cn.cputime.mobile.widget.week"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: WeekScheduleWidgetIntent.self,
            provider: ScheduleIntentTimelineProvider<WeekScheduleWidgetIntent>()
        ) { entry in
            ScheduleWidgetView(kind: .week, entry: entry)
        }
        .configurationDisplayName("本周课表")
        .description("一天一列看完这一周的课；周末上完后换成下一周。")
        // 超大号只有 iPad 有。
        .supportedFamilies([.systemLarge, .systemExtraLarge])
    }
}

private struct OverviewScheduleWidget: Widget {
    let kind = AppWidgetConfiguration.overviewKind

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: OverviewScheduleWidgetIntent.self,
            provider: ScheduleIntentTimelineProvider<OverviewScheduleWidgetIntent>()
        ) { entry in
            ScheduleWidgetView(kind: .overview, entry: entry)
        }
        .configurationDisplayName("今日概览")
        .description("下一节课、今天还剩几节和要办的日程，放在一个小组件里。")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

#Preview(as: .systemSmall) {
    UpcomingScheduleWidget()
} timeline: {
    ScheduleEntry.placeholder
}

#Preview(as: .systemMedium) {
    TodayScheduleWidget()
} timeline: {
    ScheduleEntry.placeholder
}

#Preview(as: .systemLarge) {
    TwoDayScheduleWidget()
} timeline: {
    ScheduleEntry.placeholder
}

#Preview(as: .accessoryRectangular) {
    UpcomingScheduleWidget()
} timeline: {
    ScheduleEntry.placeholder
}

private extension ScheduleLiveActivityAttributes {
    static var preview: Self {
        Self(semester: "2026 秋", dateKey: "2026-09-15", week: 3)
    }
}

private extension ScheduleLiveActivityAttributes.ContentState {
    static var upcomingPreview: Self {
        let start = Date.now.addingTimeInterval(8 * 60)
        return Self(
            phase: .upcoming,
            courseName: "药理学实验",
            teacher: "李老师",
            location: "药学楼 302",
            startDate: start,
            endDate: start.addingTimeInterval(90 * 60),
            updatedAt: .now
        )
    }

    static var inProgressPreview: Self {
        let start = Date.now.addingTimeInterval(-25 * 60)
        return Self(
            phase: .inProgress,
            courseName: "药理学实验",
            teacher: "李老师",
            location: "药学楼 302",
            startDate: start,
            endDate: start.addingTimeInterval(90 * 60),
            updatedAt: .now
        )
    }
}

#Preview("实时活动", as: .content, using: ScheduleLiveActivityAttributes.preview) {
    ScheduleLiveActivityWidget()
} contentStates: {
    ScheduleLiveActivityAttributes.ContentState.upcomingPreview
    ScheduleLiveActivityAttributes.ContentState.inProgressPreview
}

/// The lock screen activity's background: the dark surface, or on iOS 26 and
/// later, when 锁屏玻璃背景 is on in the app, dark-tinted glass that keeps the
/// white text readable over any wallpaper.
private struct ScheduleLiveActivitySurface: ViewModifier {
    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *),
           UserDefaults(suiteName: AppWidgetConfiguration.appGroup)?.bool(forKey: "cpu.liveActivity.glass") == true {
            content
                .background {
                    ContainerRelativeShape().fill(.clear)
                        .glassEffect(.regular.tint(.black.opacity(0.38)), in: ContainerRelativeShape())
                }
                .activityBackgroundTint(.clear)
        } else {
            content.activityBackgroundTint(ScheduleLiveActivityPalette.surface)
        }
    }
}

/// 控制中心「课表」: opens the timetable.
@available(iOS 18.0, *)
private struct ScheduleOpenControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "cn.cputime.control.schedule") {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "cputime-next://schedule")!)) {
                Label("课表", systemImage: "calendar")
            }
        }
        .displayName("课表")
        .description("打开药大拾间的课表。")
    }
}

/// 控制中心「记一笔」: a new 日程 at the class on now, or the next one today.
@available(iOS 18.0, *)
private struct ScheduleAgendaControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "cn.cputime.control.agenda") {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "cputime-next://schedule?action=agenda")!)) {
                Label("记一笔", systemImage: "square.and.pencil")
            }
        }
        .displayName("给这节课记一笔")
        .description("新建日程，时间定在现在这节或下一节课。")
    }
}
