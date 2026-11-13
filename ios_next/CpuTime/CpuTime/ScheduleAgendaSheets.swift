import PhotosUI
import SwiftUI

// 日程 over the timetable: the editor for one item and 日程与待办 (a line to jot one down, the
// open to-dos, the next seven days and 微信和 QQ 也提醒). Every change goes through the page
// (NativeAgendaService), the same records as the Web timetable, Android, HarmonyOS and 药大拾间 NEXT.

/// The sheet `NativeAgendaService.presentation` asks for.
@available(iOS 17.0, *)
struct NativeAgendaSheet: View {
    let presentation: NativeAgendaPresentation

    var body: some View {
        Group {
            switch presentation {
            case .edit(let item):
                NavigationStack { NativeAgendaEditor(draft: item) }
            case .create(let date, let start):
                NavigationStack { NativeAgendaEditor(draft: NativeAgendaItem(id: "", title: "", date: date, start: start)) }
            case .list:
                NativeAgendaListView()
            case .draft(let item):
                NavigationStack { NativeAgendaEditor(draft: item) }
            case .exam(let exam):
                NavigationStack { NativeExamDetailView(exam: exam) }
            case .exams:
                NativeExamListView()
            }
        }
        // The app has no Chinese localization, so pickers would otherwise read
        // "Oct 28, 2026"; and the items' days and times are China time
        // (`AgendaText.calendar`), whatever zone the phone is set to.
        .environment(\.locale, Locale(identifier: "zh_CN"))
        .environment(\.timeZone, AgendaText.china)
    }
}

enum AgendaText {
    static let remindChoices: [(Int, String)] = [
        (-1, "不提醒"), (0, "准时"), (5, "5 分钟前"), (15, "15 分钟前"), (30, "30 分钟前"), (60, "1 小时前"), (1440, "1 天前"),
    ]
    static let repeatChoices: [(String, String)] = [
        ("none", "不重复"), ("daily", "每天"), ("weekdays", "工作日"), ("weekly", "每周"), ("monthly", "每月"),
    ]
    static let weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

    static var china: TimeZone { TimeZone(identifier: "Asia/Shanghai") ?? .current }

    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = china
        return calendar
    }

    /// 今天 / 明天 / 昨天 / 10月23日.
    static func shortDay(_ date: String, today: String = NativeAgendaRules.today()) -> String {
        guard let day = NativeAgendaRules.dayNumber(date), let base = NativeAgendaRules.dayNumber(today) else { return "" }
        switch day - base {
        case 0: return "今天"
        case 1: return "明天"
        case -1: return "昨天"
        default:
            let parts = date.split(separator: "-")
            return "\(Int(parts[1]) ?? 0)月\(Int(parts[2]) ?? 0)日"
        }
    }

    static func dayTitle(_ date: String) -> String {
        let weekday = NativeAgendaRules.weekday(date).map { weekdays[$0 - 1] } ?? ""
        return "\(shortDay(date)) · \(weekday)"
    }

    static func date(_ value: String) -> Date {
        guard let day = NativeAgendaRules.dayNumber(value) else { return Date() }
        return Date(timeIntervalSince1970: Double(day) * 86_400 - Double(china.secondsFromGMT()) + 12 * 3_600)
    }

    static func string(_ date: Date) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 1970, parts.month ?? 1, parts.day ?? 1)
    }

    static func time(_ value: String) -> Date {
        let minutes = NativeAgendaRules.minutes(value) ?? 9 * 60
        return calendar.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: Date()) ?? Date()
    }

    static func clock(_ date: Date) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    static func summary(_ draft: NativeAgendaDraft) -> String {
        var parts = [draft.date.isEmpty ? "不设日期" : shortDay(draft.date)]
        if !draft.start.isEmpty { parts.append(draft.end.isEmpty ? draft.start : "\(draft.start)–\(draft.end)") }
        if let label = repeatChoices.first(where: { $0.0 == draft.repeatRule && $0.0 != "none" })?.1 { parts.append(label) }
        if draft.remind >= 0 { parts.append("提醒") }
        if !draft.location.isEmpty { parts.append("@" + draft.location) }
        return "会记作「\(draft.title)」：" + parts.joined(separator: " · ")
    }
}

/// What 截图识别 reads for a new 日程: a picked screenshot, or a whole pasted notice.
@available(iOS 17.0, *)
enum NativeAgendaSource: Hashable, Identifiable {
    case photo(PhotosPickerItem)
    case text(String)

    var id: Self { self }
}

/// Pasting more than this into a title reads it as a whole notice for 拾间AI (截图识别).
private let agendaNoticePasteChars = 60

/// Adds or edits one 日程, with the fields of the Web editor. For a new one the first field reads
/// what the user writes (「周五 14:00 组会 @药学楼」) and fills the fields below until one is changed
/// by hand. Saving goes through the page and waits for its answer.
///
/// A new one can also be filled from a screenshot or a pasted notice (截图识别, `source` when 日程与待办
/// already picked one): 拾间AI reads the time, place and what to bring; several items found are shown
/// one at a time and can be added one by one or all at once.
@available(iOS 17.0, *)
struct NativeAgendaEditor: View {
    private let original: NativeAgendaItem
    private let source: NativeAgendaSource?
    /// Pushed from 日程与待办: done goes back there instead of closing the sheet.
    private let onDone: (() -> Void)?
    @ObservedObject private var service = NativeAgendaService.shared
    @Environment(\.dismiss) private var dismiss
    @State private var item: NativeAgendaItem
    @State private var text: String
    @State private var touched: Bool
    @State private var parsed: NativeAgendaDraft?
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var confirmingDelete = false
    // 截图识别: what is being read ("截图" / "这段通知"), the items found and the one shown.
    @State private var extracting = ""
    @State private var extracted: [NativeAgendaItem] = []
    @State private var pick = 0
    @State private var extractNote = ""
    @State private var extractTask: Task<Void, Never>?
    @State private var photo: PhotosPickerItem?
    @State private var sourceRead = false
    /// "assistant" once the fields came from 截图识别.
    @State private var origin: String?

    init(draft: NativeAgendaItem, source: NativeAgendaSource? = nil, onDone: (() -> Void)? = nil) {
        original = draft
        self.source = source
        self.onDone = onDone
        _item = State(initialValue: draft)
        _text = State(initialValue: draft.title)
        _touched = State(initialValue: !draft.id.isEmpty)
    }

    private var isNew: Bool { original.id.isEmpty }

    /// What the form shows: what the text says, until a field is changed by hand.
    private var shown: NativeAgendaItem {
        guard let parsed, !touched else { return item }
        var value = item
        value.date = parsed.date.isEmpty ? original.date : parsed.date
        value.start = parsed.start.isEmpty && parsed.date.isEmpty ? original.start : parsed.start
        value.end = parsed.end
        value.location = parsed.location
        value.remind = value.date.isEmpty ? -1 : parsed.remind
        value.repeatRule = value.date.isEmpty ? "none" : parsed.repeatRule
        return value
    }

    /// A field changed by hand: the text stops steering the form and keeps only the title it read.
    private func edit(_ change: (inout NativeAgendaItem) -> Void) {
        if !touched {
            item = shown
            if let parsed { text = parsed.title }
            parsed = nil
            touched = true
        }
        change(&item)
    }

    private func binding<Value>(_ get: @escaping (NativeAgendaItem) -> Value,
                                _ set: @escaping (inout NativeAgendaItem, Value) -> Void) -> Binding<Value> {
        Binding(get: { get(shown) }, set: { value in edit { set(&$0, value) } })
    }

    var body: some View {
        Form {
            Section {
                TextField(isNew ? "写下要做的事，例如「周五 14:00 组会 @药学楼」" : "标题", text: $text)
                    .font(.headline)
                    .submitLabel(.done)
                    .onSubmit(save)
                if let parsed, !touched {
                    Text("会记作「\(parsed.title)」，日期和时间已从文字里读出，可在下面修改")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if isNew && service.available {
                extractSection
            }
            Section {
                Toggle("设定日期", isOn: binding({ !$0.date.isEmpty }) { item, on in
                    if on {
                        item.date = NativeAgendaRules.today()
                    } else {
                        item.date = ""
                        item.start = ""
                        item.end = ""
                        item.remind = -1
                        item.repeatRule = "none"
                        item.until = ""
                    }
                })
                if !shown.date.isEmpty {
                    AgendaDayPicker(title: "日期", selection: binding({ AgendaText.date($0.date) }) { item, value in
                        item.date = AgendaText.string(value)
                        if !item.until.isEmpty, item.until < item.date { item.until = "" }
                    })
                    Toggle("设定时间", isOn: binding({ !$0.start.isEmpty }) { item, on in
                        item.start = on ? (item.start.isEmpty ? "09:00" : item.start) : ""
                        if !on { item.end = "" }
                    })
                }
                if !shown.start.isEmpty {
                    DatePicker("开始", selection: binding({ AgendaText.time($0.start) }) { item, value in
                        item.start = AgendaText.clock(value)
                        if !item.end.isEmpty, item.end <= item.start { item.end = "" }
                    }, displayedComponents: .hourAndMinute)
                    Toggle("结束时间", isOn: binding({ !$0.end.isEmpty }) { item, on in
                        item.end = on ? AgendaText.clock(AgendaText.time(item.start).addingTimeInterval(3_600)) : ""
                        if item.end <= item.start { item.end = "" }
                    })
                    if !shown.end.isEmpty {
                        DatePicker("结束", selection: binding({ AgendaText.time($0.end) }) { item, value in
                            let end = AgendaText.clock(value)
                            item.end = end > item.start ? end : ""
                        }, displayedComponents: .hourAndMinute)
                    }
                }
            }
            .environment(\.timeZone, AgendaText.china)
            Section {
                Picker("提醒", selection: binding({ $0.remind }) { item, value in item.remind = value }) {
                    ForEach(AgendaText.remindChoices.filter { !shown.date.isEmpty || $0.0 < 0 }, id: \.0) { choice in
                        Text(choice.1).tag(choice.0)
                    }
                }
                if !shown.date.isEmpty {
                    Picker("重复", selection: binding({ $0.repeatRule }) { item, value in
                        item.repeatRule = value
                        if value == "none" { item.until = "" }
                    }) {
                        ForEach(AgendaText.repeatChoices, id: \.0) { choice in Text(choice.1).tag(choice.0) }
                    }
                    if shown.repeats {
                        Toggle("重复到某天为止", isOn: binding({ !$0.until.isEmpty }) { item, on in
                            item.until = on ? item.date : ""
                        })
                        if !shown.until.isEmpty {
                            AgendaDayPicker(title: "重复到", selection: binding({ AgendaText.date($0.until) }) { item, value in
                                let until = AgendaText.string(value)
                                item.until = until >= item.date ? until : item.date
                            })
                        }
                    }
                }
            }
            .environment(\.timeZone, AgendaText.china)
            Section {
                TextField("地点", text: binding({ $0.location }) { item, value in item.location = String(value.prefix(40)) })
                TextField("备注", text: binding({ $0.note }) { item, value in item.note = String(value.prefix(1_000)) }, axis: .vertical)
                    .lineLimit(2...6)
            }
            if let errorMessage {
                Section {
                    Text(errorMessage).font(.footnote).foregroundStyle(.red)
                }
            }
            if !isNew {
                Section {
                    Button("删除这条日程", role: .destructive) { confirmingDelete = true }
                }
            }
        }
        .disabled(saving)
        .navigationTitle(isNew ? "新建日程" : "编辑日程")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if onDone == nil {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                if saving {
                    ProgressView()
                } else {
                    Button(isNew ? "添加" : "保存", action: save)
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .confirmationDialog("删除「\(original.title)」？", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("删除", role: .destructive, action: remove)
        } message: {
            Text(original.repeats ? "这是重复的日程，所有日子的都会删除。" : "删除后其他设备上也会删除。")
        }
        .task(id: text) {
            // A new item's text is read after a pause in typing, while no field was changed by hand.
            guard isNew, !touched else { return }
            let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty else {
                parsed = nil
                return
            }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            let draft = await service.parse(value)
            guard !Task.isCancelled, !touched else { return }
            parsed = draft.flatMap { $0.saysMore ? $0 : nil }
        }
        .onChange(of: text) { old, new in
            // A whole notice pasted into a new item's title: 拾间AI sorts it out instead.
            guard isNew, service.available, extracting.isEmpty, new.count - old.count > agendaNoticePasteChars else { return }
            text = old
            extractText(new)
        }
        .onChange(of: photo) { _, picked in
            guard let picked else { return }
            photo = nil
            extractPhoto(picked)
        }
        .task(id: service.available) {
            // A screenshot picked in 日程与待办: read it once the page has said who is signed in.
            guard let source, !sourceRead, isNew, service.available else { return }
            sourceRead = true
            switch source {
            case .photo(let picked): extractPhoto(picked)
            case .text(let notice): extractText(notice)
            }
        }
        .onDisappear { extractTask?.cancel() }
    }

    @ViewBuilder
    private var extractSection: some View {
        Section {
            if !extracting.isEmpty {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("拾间AI 正在读\(extracting)，读出来的时间和地点会填在下面")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 4)
                    Button("取消", action: cancelExtract).buttonStyle(.borderless)
                }
            } else if extracted.count > 1 {
                HStack {
                    Text("识别出 \(extracted.count) 条，逐条看过再添加").font(.subheadline.weight(.semibold))
                    Spacer(minLength: 4)
                    Button("全部添加", action: saveAll).buttonStyle(.borderless)
                }
                ScrollViewReader { proxy in
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(extracted.indices, id: \.self) { index in
                                Button { choose(index) } label: {
                                    Text(extracted[index].title).lineLimit(1)
                                }
                                .buttonStyle(.bordered)
                                .tint(index == pick ? Color.cpuBrand : Color.secondary)
                                .id(index)
                            }
                        }
                    }
                    // The item shown stays in view, not cut off at the edge.
                    .onChange(of: pick) { _, index in
                        withAnimation { proxy.scrollTo(index, anchor: .center) }
                    }
                }
                if !extractNote.isEmpty {
                    Text(extractNote).font(.caption).foregroundStyle(.secondary)
                }
            } else {
                PhotosPicker(selection: $photo, matching: .images) {
                    Label("截图识别", systemImage: "text.viewfinder")
                }
                Text(extractNote.isEmpty ? "选一张活动通知的截图，或把整段通知粘贴到上面，拾间AI 帮你填好" : extractNote)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// The form as it would be saved now.
    private func current() -> NativeAgendaItem {
        var value = shown
        value.title = (touched ? text : (parsed?.title ?? text)).trimmingCharacters(in: .whitespacesAndNewlines)
        return value
    }

    /// Shows one item read from a screenshot; the text no longer steers the form.
    private func show(_ value: NativeAgendaItem) {
        item = value
        text = value.title
        parsed = nil
        touched = true
        origin = "assistant"
    }

    private func choose(_ index: Int) {
        guard index != pick, extracted.indices.contains(index) else { return }
        extracted[pick] = current()
        pick = index
        show(extracted[index])
    }

    private func cancelExtract() {
        extractTask?.cancel()
        extractTask = nil
        extracting = ""
    }

    private func runExtract(_ what: String, _ read: @escaping () async -> Result<[NativeAgendaItem], AgendaExtractError>) {
        extractTask?.cancel()
        extracting = what
        extractNote = ""
        errorMessage = nil
        extractTask = Task {
            let result = await read()
            guard !Task.isCancelled else { return }
            extracting = ""
            switch result {
            case .success(let items):
                extracted = items
                pick = 0
                show(items[0])
                if items.count == 1 { extractNote = "已按\(what)填好，看一下再添加" }
            case .failure(let error):
                errorMessage = error.message
            }
        }
    }

    private func extractPhoto(_ picked: PhotosPickerItem) {
        runExtract("截图") {
            guard let data = try? await picked.loadTransferable(type: Data.self),
                  let image = await Task.detached(operation: { NativeAgendaImage.dataURL(from: data) }).value else {
                return .failure(AgendaExtractError("这张图片读不出来，换一张试试"))
            }
            return await NativeAgendaService.shared.extract(image: image)
        }
    }

    private func extractText(_ notice: String) {
        runExtract("这段通知") { await NativeAgendaService.shared.extract(text: notice) }
    }

    private func save() {
        guard !saving else { return }
        let value = current()
        guard !value.title.isEmpty else {
            errorMessage = "先写个标题"
            return
        }
        saving = true
        errorMessage = nil
        Task {
            let error = await service.save(value, origin: isNew ? origin : nil)
            saving = false
            if let error {
                errorMessage = error
            } else if extracted.count > 1 {
                // Several items read from a screenshot: go on to the next one.
                extracted.remove(at: pick)
                pick = min(pick, extracted.count - 1)
                show(extracted[pick])
                extractNote = extracted.count == 1 ? "已添加，还有「\(extracted[0].title)」" : "已添加，还剩 \(extracted.count) 条"
            } else {
                finish()
            }
        }
    }

    /// Adds every item read, the one shown with its edits.
    private func saveAll() {
        guard !saving, !extracted.isEmpty else { return }
        var all = extracted
        all[pick] = current()
        saving = true
        errorMessage = nil
        Task {
            var left: [NativeAgendaItem] = []
            var failure: String?
            for entry in all {
                if let error = await service.save(entry, origin: "assistant") {
                    failure = error
                    left.append(entry)
                }
            }
            saving = false
            if left.isEmpty {
                finish()
                return
            }
            extracted = left
            pick = 0
            show(left[0])
            errorMessage = failure ?? "有 \(left.count) 条没能添加"
        }
    }

    private func remove() {
        saving = true
        errorMessage = nil
        Task {
            let error = await service.remove(id: original.id)
            saving = false
            if let error { errorMessage = error } else { finish() }
        }
    }

    private func finish() {
        if let onDone { onDone() } else { dismiss() }
    }
}

/// 日程与待办, from the timetable's tools: a line to jot one down, the to-dos still open, the
/// next seven days and the 微信和 QQ 也提醒 switch. A day's items are on the timetable itself.
@available(iOS 17.0, *)
struct NativeAgendaListView: View {
    @ObservedObject private var service = NativeAgendaService.shared
    @Environment(\.dismiss) private var dismiss
    @State private var quick = ""
    @State private var quickDraft: NativeAgendaDraft?
    @State private var message = ""
    @State private var adding = false
    @State private var editing: NativeAgendaItem?
    /// 截图识别 from the list: a new item that 拾间AI fills from this screenshot or notice.
    @State private var extracting: NativeAgendaSource?
    @State private var photo: PhotosPickerItem?

    var body: some View {
        NavigationStack {
            List {
                if !service.available {
                    Text("登录后就能记日程，并在课表里看到它们。").foregroundStyle(.secondary)
                } else {
                    Section {
                        HStack {
                            TextField("一句话记下，例如「明天下午3点 实验报告」", text: $quick)
                                .submitLabel(.done)
                                .onSubmit(quickAdd)
                            Button("添加", action: quickAdd)
                                .buttonStyle(.borderedProminent)
                                .tint(.cpuBrand)
                                .disabled(adding || quickDraft == nil)
                        }
                        // The line below starts under the text field, not under 添加.
                        .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
                        if let quickDraft {
                            Text(AgendaText.summary(quickDraft)).font(.caption).foregroundStyle(.secondary)
                        } else if !message.isEmpty {
                            Text(message).font(.caption).foregroundStyle(.secondary)
                        }
                        PhotosPicker(selection: $photo, matching: .images) {
                            VStack(alignment: .leading, spacing: 3) {
                                Label("截图识别", systemImage: "text.viewfinder")
                                Text("活动通知太长？选一张截图或粘贴整段通知，拾间AI 帮你填好时间、地点和注意事项")
                                    .font(.caption)
                                    .foregroundStyle(Color.secondary) // grey, not a paler tint of the button
                            }
                        }
                    }
                    Section("待办") {
                        let todos = NativeAgendaRules.openTodos(service.items, today: NativeAgendaRules.today())
                        if todos.isEmpty { Text("没有待办").foregroundStyle(.secondary) }
                        ForEach(todos) { item in
                            row(time: AgendaText.shortDay(item.date), late: !item.date.isEmpty, done: false, title: item.title,
                                detail: item.date.isEmpty ? "" : "已过日期，还没完成",
                                toggle: {
                                    service.toggle(NativeAgendaOccurrence(item: item, date: item.date.isEmpty ? NativeAgendaRules.today() : item.date,
                                                                          done: false))
                                },
                                open: { editing = item })
                        }
                        Button { editing = NativeAgendaItem(id: "", title: "") } label: {
                            Label("添加不设日期的待办", systemImage: "plus")
                        }
                    }
                    ForEach(upcoming, id: \.date) { day in
                        Section(AgendaText.dayTitle(day.date)) {
                            ForEach(day.entries) { entry in
                                row(time: entry.timeText, late: false, done: entry.done, title: entry.item.title,
                                    detail: detail(entry.item), toggle: { service.toggle(entry) }, open: { editing = entry.item })
                            }
                        }
                    }
                    Section {
                        if upcoming.isEmpty { Text("接下来一周没有安排").foregroundStyle(.secondary) }
                        Button { editing = NativeAgendaItem(id: "", title: "", date: NativeAgendaRules.today()) } label: {
                            Label("添加到今天", systemImage: "plus")
                        }
                    }
                    Section {
                        Toggle(isOn: Binding(get: { service.relay }, set: { service.setRelay($0) })) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("微信和 QQ 也提醒")
                                Text("设了提醒的日程到点时，服务器发一条站内通知，并转到你绑定的微信和 QQ；这台设备也会在通知栏提醒。")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .tint(.cpuBrand)
                    } footer: {
                        Text("网页、手机 App 和药大拾间 NEXT 用的是同一份日程，在哪里改都会同步。")
                    }
                }
            }
            .navigationTitle("日程与待办")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } }
            }
            .navigationDestination(item: $editing) { item in
                // An exam among the days is 教务's: shown, not edited.
                if let exam = NativeExamService.shared.exams.first(where: { $0.id == item.id }) {
                    NativeExamDetailView(exam: exam)
                } else {
                NativeAgendaEditor(draft: item) { editing = nil }
                }
            }
            .navigationDestination(item: $extracting) { source in
                NativeAgendaEditor(draft: NativeAgendaItem(id: "", title: ""), source: source) { extracting = nil }
            }
            .onChange(of: photo) { _, picked in
                guard let picked else { return }
                photo = nil
                extracting = .photo(picked)
            }
            .onChange(of: quick) { old, new in
                // A whole notice pasted in: a new item that 拾间AI fills from it.
                guard new.count - old.count > agendaNoticePasteChars else { return }
                quick = old
                extracting = .text(new)
            }
            .task(id: quick) {
                let value = quick.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !value.isEmpty else {
                    quickDraft = nil
                    return
                }
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
                let draft = await service.parse(value)
                guard !Task.isCancelled else { return }
                quickDraft = draft.flatMap { $0.title.isEmpty ? nil : $0 }
            }
        }
    }

    private struct Day {
        let date: String
        let entries: [NativeAgendaOccurrence]
    }

    private var upcoming: [Day] {
        guard let first = NativeAgendaRules.dayNumber(NativeAgendaRules.today()) else { return [] }
        return (0..<7).map { offset in
            let date = NativeAgendaRules.date(ofDay: first + offset)
            return Day(date: date, entries: NativeAgendaRules.on(service.items, date: date))
        }.filter { !$0.entries.isEmpty }
    }

    private func detail(_ item: NativeAgendaItem) -> String {
        let repeatLabel = AgendaText.repeatChoices.first { $0.0 == item.repeatRule && $0.0 != "none" }?.1 ?? ""
        return [item.location, repeatLabel].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func row(time: String, late: Bool, done: Bool, title: String, detail: String,
                     toggle: @escaping () -> Void, open: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            Text(time)
                .font(.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(late ? Color.red : Color.primary)
                .frame(width: 84, alignment: .leading)
            Button(action: toggle) {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(done ? Color.cpuBrand : Color.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(done ? "标为未完成" : "标为完成")
            Button(action: open) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).strikethrough(done).lineLimit(1)
                    if !detail.isEmpty {
                        Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .opacity(done ? 0.55 : 1)
    }

    private func quickAdd() {
        guard let draft = quickDraft, !adding else { return }
        adding = true
        Task {
            let item = NativeAgendaItem(id: "", title: draft.title, date: draft.date, start: draft.start, end: draft.end,
                                        location: draft.location, remind: draft.remind, repeatRule: draft.repeatRule)
            let error = await service.save(item)
            adding = false
            if let error {
                message = error
            } else {
                message = draft.date.isEmpty ? "已添加到待办" : "已添加到\(AgendaText.shortDay(draft.date))"
                quick = ""
                quickDraft = nil
            }
        }
    }
}

/// A day picker that reads 「2026年11月12日」 like the rest of the form. A compact picker added to
/// a form already on screen (日期 switched on, or a day filled by 截图识别) labels itself
/// 「2026/11/12」 until its day changes, so it shows the day after once and then the real one.
@available(iOS 17.0, *)
private struct AgendaDayPicker: View {
    let title: String
    @Binding var selection: Date
    @State private var settled = false

    var body: some View {
        DatePicker(title, selection: Binding(get: { settled ? selection : selection.addingTimeInterval(86_400) },
                                             set: { selection = $0 }),
                   displayedComponents: .date)
            .task {
                // Once it has been laid out; changing the day in the same pass keeps the short label.
                try? await Task.sleep(for: .milliseconds(100))
                settled = true
            }
    }
}
