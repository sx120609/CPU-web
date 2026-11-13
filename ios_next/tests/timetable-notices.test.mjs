import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// How 课前提醒, the changed-timetable notice, exams, homework and the watch's 日程 are wired
// into the app. Their rules run in scripts/check-class-reminders.sh and scripts/check-agenda.sh.
const root = new URL('../..', import.meta.url).pathname;
const read = path => readFile(`${root}/${path}`, 'utf8');
const app = 'ios_next/CpuTime/CpuTime';

test('the kinds of local notification share out the 64 iOS lets an app keep pending', async () => {
  const source = await read(`${app}/NativeClassReminders.swift`);
  const budget = Object.fromEntries([...source.matchAll(/static let (agenda|classes|partner) = (\d+)/g)].map(match => [match[1], Number(match[2])]));
  assert.deepEqual(Object.keys(budget).sort(), ['agenda', 'classes', 'partner']);
  assert.ok(budget.agenda + budget.classes + budget.partner <= 62, 'room is left for a notice shown at once');
  assert.match(await read(`${app}/NativeAgenda.swift`), /private static let limit = NativeNotificationBudget\.agenda/);
  assert.match(source, /limit: NativeNotificationBudget\.classes/);
  assert.match(await read(`${app}/NativeCoupleExtras.swift`), /limit: NativeNotificationBudget\.partner/);
});

test('timetable notifications show with the app open, open the timetable when tapped, and 今天不再提醒 is an action', async () => {
  const delegate = await read(`${app}/ContentView.swift`);
  assert.match(delegate, /NativeScheduleNotifications\.registerCategories\(\)/);
  assert.match(delegate, /NativeAgendaReminders\.isAgenda\(notification\) \|\| NativeScheduleNotifications\.isOurs\(notification\)/);
  assert.match(delegate, /if await NativeScheduleNotifications\.handle\(response\) \{ return \}/);
  const source = await read(`${app}/NativeClassReminders.swift`);
  assert.match(source, /UNNotificationAction\(identifier: skipTodayAction, title: "今天不再提醒"/);
  assert.match(source, /NativeClassReminders\.shared\.skip\(date:/);
  // Off until switched on, and permission is asked only then.
  assert.match(source, /enabled = defaults\.bool\(forKey: Self\.enabledKey\)/);
  assert.match(source, /authorized\(asking: true\)/);
  // Rearranged when the timetable is written and when the app comes forward.
  assert.match(await read(`${app}/NativeWidgetLocalSchedule.swift`), /NativeClassReminders\.shared\.enabled \{ NativeClassReminders\.shared\.refresh\(\) \}/);
  assert.match(delegate, /if NativeClassReminders\.shared\.enabled \{ NativeClassReminders\.shared\.refresh\(\) \}/);
});

test('a changed timetable is told once, only when the app is not on screen, and never asks for permission', async () => {
  const alerts = await read(`${app}/NativeScheduleChangeAlerts.swift`);
  assert.match(alerts, /guard enabled, UIApplication\.shared\.applicationState != \.active else \{ return \}/);
  assert.match(alerts, /guard !told\.contains\(notice\.id\) else \{ return \}/);
  assert.match(alerts, /authorized\(asking: false\)/);
  const store = await read(`${app}/NativeScheduleStore.swift`);
  assert.match(store, /scheduleChangeNotice = notice\n\s+onScheduleChangeNotice\?\(notice\)/);
  assert.match(store, /public func refreshForChanges\(minimumInterval: TimeInterval = 15 \* 60\) async/);
  // The app looks on every return to the foreground and on a background wake-up it asks for itself.
  const content = await read(`${app}/ContentView.swift`);
  assert.match(content, /Task \{ await scheduleStore\.refreshForChanges\(\) \}/);
  assert.match(content, /LiveActivityBackgroundRefresh\.shared\.enteredBackground\(\)/);
  const background = await read(`${app}/LiveActivityBackgroundRefresh.swift`);
  assert.match(background, /await shared\.timetableWork\?\(\)/);
  assert.match(background, /shared\.schedule\(at: Date\(\)\.addingTimeInterval\(interval\)\)/);
});

test('exams are drawn as 日程 but are never saved, sent, ticked or edited as one', async () => {
  const agenda = await read(`${app}/NativeAgenda.swift`);
  assert.match(agenda, /let next = saved \+ examItems/);
  assert.match(agenda, /Self\.writeCache\(next\)\n\s+merge\(\)/, 'only the site\'s own items reach the cache');
  assert.match(agenda, /guard !NativeExamRules\.isExam\(entry\.item\.id\) else \{ return \}/);
  assert.match(agenda, /guard !NativeExamRules\.isExam\(item\.id\) else \{ return "考试安排来自教务/);
  assert.match(agenda, /reminders\.contains\(where: \{ !NativeExamRules\.isExam\(\$0\.id\) \}\)/, 'an exam alone never prompts for notifications');
  const exams = await read(`${app}/NativeExams.swift`);
  assert.match(exams, /NativeAgendaService\.shared\.setExamItems\(NativeExamRules\.agendaItems\(exams, today:/);
  assert.match(exams, /appendingPathComponent\("exam-cache\.json"\)/);
  // Signing out forgets them with the 日程.
  assert.match(await read(`${app}/NativeShellCoordinator.swift`), /NativeAgendaService\.shared\.clear\(\)\n\s+NativeExamService\.shared\.clear\(\)/);
  // The entry shows only for a school whose 教务 has exams.
  assert.match(await read(`${app}/NativeScheduleView.swift`), /if examService\.supported \{/);
  assert.match(await read(`${app}/NativeScheduleStore.swift`), /typeof window\.CPUTimeNativeExams !== 'function'\) return JSON\.stringify\(\{missing: true\}\)/);
  assert.match(await read('web/src/main.ts'), /installNativeExamsBridge\(\);/);
});

test('homework is an ordinary 日程 written from a class, due when the course next meets', async () => {
  const view = await read(`${app}/NativeScheduleView.swift`);
  assert.match(view, /ScheduleCourseMenuAction\("记作业", systemImage: "square\.and\.pencil"\)/);
  assert.match(view, /agendaService\.openHomework\(course: name, due: due\?\.date \?\? "", start: due\?\.start \?\? ""\)/);
  assert.match(await read(`${app}/NativeAgenda.swift`), /presentation = \.draft\(NativeAgendaRules\.homeworkDraft\(course: course, due: due, start: start\)\)/);
  // Nothing about the course is added to what the site stores: the model has no new field.
  const rules = await read(`${app}/NativeAgendaRules.swift`);
  assert.match(rules, /case id, kind, title, date, start, end, location, note, remind\n\s+case repeatRule = "repeat"\n\s+case until, done, doneDates, createdAt/);
});

test("the partner's timetable feeds free time, 下课 notices and the widgets' 一起 without leaving the app", async () => {
  const service = await read(`${app}/NativeCoupleService.swift`);
  assert.match(service, /NativeCoupleExtras\.shared\.update\(layer: layer\)/);
  const extras = await read(`${app}/NativeCoupleExtras.swift`);
  assert.match(extras, /classOverOn = defaults\.bool\(forKey: Self\.classOverKey\)/, 'off until switched on');
  assert.match(extras, /NativeWidgetLocalSchedule\.setPartner\(next\)/);
  const sheet = await read(`${app}/NativeCoupleSheet.swift`);
  assert.match(sheet, /NativeCoupleOutlookSection\(\)/);
  assert.match(sheet, /NativeCoupleClassOverSection\(\)/);
});

test('日程 reach the watch as queued transfers and ticks come back into the widget\'s pending file', async () => {
  const transport = await read('ios_next/CpuTime/WatchSync/WatchSessionTransport.swift');
  assert.equal((transport.match(/session\.transferUserInfo\(/g) ?? []).length, 2);
  assert.match(transport, /transfer\.cancel\(\)/, 'a list still waiting is replaced, not piled up');
  assert.match(transport, /func session\(_ session: WCSession, didReceiveUserInfo userInfo: \[String: Any\] = \[:\]\)/);
  // The timetable's application context is untouched: it still carries only schedule and status.
  assert.doesNotMatch(transport.match(/func updateSnapshot[\s\S]*?\n    \}/)[0], /agenda/);
  const wire = await read('ios_next/CpuTime/WatchShared/ScheduleEnvelope.swift');
  assert.match(wire, /static let agendaList = "agenda\.list"/);
  assert.match(wire, /static let agendaTick = "agenda\.tick"/);
  const phone = await read(`${app}/PhoneWatchAgenda.swift`);
  assert.match(phone, /AgendaWidgetStore\.addPending\(AgendaWidgetCompletion\(itemID: itemID, date: date, done: done\)\)/);
  assert.match(await read(`${app}/NativeAgendaWidgetBridge.swift`), /PhoneWatchAgenda\.publish\(snapshot\)/);
  const watch = await read('ios_next/CpuTime/CPUWatch/CPUWatchApp.swift');
  assert.match(watch, /transport\.onAgenda = \{ data in WatchAgendaStore\.shared\.accept\(data\) \}/);
  assert.match(watch, /transport\?\.sendAgendaTick\(itemID: itemID, date: date, done: done\)/);
  assert.match(await read('ios_next/CpuTime/CPUWatch/WatchCalendarView.swift'), /WatchAgendaListView\(\)/);
});
