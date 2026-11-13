import Combine
import Foundation
import SwiftUI

/// 考试安排 in the timetable, for the schools whose 教务 lists exams (南医, 南中医).
///
/// The list is the one the Web's 考试安排 page shows, read through the signed-in page
/// (`CPUTimeNativeExams`) and kept on the phone. The exams still ahead are handed to
/// `NativeAgendaService` as 日程, so the week, day and month views, the 日程 widget and the
/// reminders show them without code of their own.
@available(iOS 17.0, *)
@MainActor
final class NativeExamService: ObservableObject {
    static let shared = NativeExamService()

    @Published private(set) var exams: [NativeExam] = []
    /// The school's 教务 has exam arrangements at all. False hides every entry point.
    @Published private(set) var supported = false
    @Published private(set) var error: String?
    @Published private(set) var loading = false
    @Published private(set) var updatedAt: Date?

    private weak var store: NativeScheduleStore?
    private var lastLoaded: Date?

    private struct Reply: Decodable {
        struct Lossy: Decodable {
            let value: NativeExam?
            init(from decoder: Decoder) throws { value = try? NativeExam(from: decoder) }
        }
        let missing: Bool?
        let supported: Bool?
        let authenticated: Bool?
        let account: String?
        let list: [Lossy]?
        let error: String?
    }

    private struct Cache: Codable {
        var supported: Bool
        var exams: [NativeExam]
        var savedAt: Date
    }

    private init() {
        if let cache = Self.readCache() {
            supported = cache.supported
            exams = cache.exams
            updatedAt = cache.savedAt
        }
        publish()
    }

    func connect(to store: NativeScheduleStore) {
        self.store = store
    }

    /// Reads the list again; without `force` at most every half hour, which is how long the
    /// server keeps 教务's answer anyway.
    func refresh(force: Bool = false) async {
        guard let store, !loading else { return }
        if !force, let lastLoaded, Date().timeIntervalSince(lastLoaded) < 30 * 60 { return }
        loading = true
        defer { loading = false }
        let raw = await store.exams("{}")
        guard let raw, let data = raw.data(using: .utf8), let reply = try? JSONDecoder().decode(Reply.self, from: data),
              reply.missing != true else { return }
        lastLoaded = Date()
        if reply.supported != true {
            // A school without exam arrangements, or another account's school: nothing to show.
            apply(supported: false, exams: [])
            return
        }
        guard reply.authenticated == true else {
            // Signed out of 教务: keep what the phone has until the account itself is cleared.
            if !supported { supported = true }
            return
        }
        if let message = reply.error {
            error = message
            if !supported { supported = true }
            return
        }
        error = nil
        var seen = Set<String>()
        apply(supported: true, exams: (reply.list ?? []).compactMap(\.value).filter { !$0.courseName.isEmpty && seen.insert($0.id).inserted })
    }

    /// Forgets the list: signed out.
    func clear() {
        lastLoaded = nil
        error = nil
        apply(supported: false, exams: [])
    }

    private func apply(supported next: Bool, exams list: [NativeExam]) {
        if supported != next { supported = next }
        if exams != list { exams = list }
        updatedAt = Date()
        Self.writeCache(next || !list.isEmpty ? Cache(supported: next, exams: list, savedAt: Date()) : nil)
        publish()
    }

    private func publish() {
        NativeAgendaService.shared.setExamItems(NativeExamRules.agendaItems(exams, today: NativeAgendaRules.today()))
    }

    private static var cacheURL: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("exam-cache.json")
    }

    private static func readCache() -> Cache? {
        guard let url = cacheURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Cache.self, from: data)
    }

    private static func writeCache(_ cache: Cache?) {
        guard let url = cacheURL else { return }
        guard let cache else {
            try? FileManager.default.removeItem(at: url)
            return
        }
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            var target = url
            try JSONEncoder().encode(cache).write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? target.setResourceValues(values)
        } catch {}
    }

#if DEBUG
    /// Sample exams for a screenshot run (`CPU_DEBUG_EXAMS=1`); nothing is requested.
    func installDebugSample() {
        let today = NativeAgendaRules.dayNumber(NativeAgendaRules.today()) ?? 0
        func day(_ offset: Int) -> String { NativeAgendaRules.date(ofDay: today + offset) }
        supported = true
        exams = [
            NativeExam(courseName: "药理学", examTime: "\(day(1)) 09:30~11:30", location: "仙林校区 B11-209", seat: "23", examType: "期末考试"),
            NativeExam(courseName: "诊断学", examTime: "\(day(4))(14:00-16:00)", location: "江宁校区 博学楼 302", examName: "2026-2027学年第一学期期末考试"),
            NativeExam(courseName: "医学统计学", examTime: "", location: "", examType: "期末考试"),
            NativeExam(courseName: "生理学", examTime: "\(day(-9)) 09:00~11:00", location: "仙林校区 B5-102", examType: "期中考试"),
        ]
        publish()
    }
#endif
}

/// 考试安排: what is ahead first, with how far off each is.
@available(iOS 17.0, *)
struct NativeExamListView: View {
    @ObservedObject private var service = NativeExamService.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                let today = NativeAgendaRules.today()
                let ordered = NativeExamRules.ordered(service.exams, today: today)
                let ahead = ordered.filter { ($0.when?.date ?? "9") >= today }
                let past = ordered.filter { ($0.when?.date ?? "9") < today }
                if let error = service.error {
                    Section { Label(error, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.orange) }
                }
                Section {
                    if ahead.isEmpty {
                        Text(service.loading ? "正在读取教务的考试安排…" : "教务还没有排出接下来的考试").foregroundStyle(.secondary)
                    }
                    ForEach(ahead) { exam in
                        NavigationLink { NativeExamDetailView(exam: exam) } label: { NativeExamRow(exam: exam, today: today) }
                    }
                } header: {
                    Text("接下来")
                } footer: {
                    Text("有日期的考试会画进课表和月历，并在前一天提醒。数据来自教务，以教务和学院通知为准。")
                }
                if !past.isEmpty {
                    Section("已结束") {
                        ForEach(past) { exam in
                            NavigationLink { NativeExamDetailView(exam: exam) } label: { NativeExamRow(exam: exam, today: today) }
                        }
                    }
                }
            }
            .navigationTitle("考试安排")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } }
            }
            .refreshable { await service.refresh(force: true) }
            .task { await service.refresh() }
        }
    }
}

@available(iOS 17.0, *)
private struct NativeExamRow: View {
    let exam: NativeExam
    let today: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(exam.courseName).font(.body.weight(.semibold))
                Text(NativeExamText.time(exam)).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                if !exam.place.isEmpty {
                    Text(exam.place).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            if let when = exam.when {
                let days = NativeExamRules.daysUntil(when.date, today: today) ?? 0
                Text(NativeExamRules.countdown(when.date, today: today))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(days < 0 ? Color.secondary : days <= 3 ? Color.red : days <= 7 ? Color.orange : Color.accentColor)
            }
        }
        .padding(.vertical, 2)
    }
}

@available(iOS 17.0, *)
enum NativeExamText {
    /// "1月5日 周二 09:30–11:30", or what 教务 wrote when it holds no date.
    static func time(_ exam: NativeExam) -> String {
        guard let when = exam.when else { return exam.examTime.isEmpty ? "时间待定" : exam.examTime }
        let clock = when.start.isEmpty ? "" : when.end.isEmpty ? " \(when.start)" : " \(when.start)–\(when.end)"
        return AgendaText.dayTitle(when.date) + clock
    }
}

/// One exam, read-only: it is 教务's arrangement, not an item to edit.
@available(iOS 17.0, *)
struct NativeExamDetailView: View {
    let exam: NativeExam

    var body: some View {
        Form {
            Section {
                row("课程", exam.courseName)
                row("时间", NativeExamText.time(exam))
                if let when = exam.when {
                    row("距今", NativeExamRules.countdown(when.date, today: NativeAgendaRules.today()))
                }
                if !exam.location.isEmpty { row("地点", exam.location) }
                if !exam.seat.isEmpty { row("座位", exam.seat) }
                if !exam.kindText.isEmpty { row("类型", exam.kindText) }
            } footer: {
                Text("考试安排来自教务，不能在这里修改；有变动时以教务和学院通知为准。")
            }
        }
        .navigationTitle("考试")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ title: String, _ value: String) -> some View {
        LabeledContent(title) { Text(value).multilineTextAlignment(.trailing) }
    }
}
