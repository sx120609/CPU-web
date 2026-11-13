import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../..', import.meta.url));
const root = process.env.CPU_REPO_ROOT || defaultRoot;
const read = path => readFile(`${root}/${path}`, 'utf8');
const widgets = 'ios_next/CpuTime/CPUWebWidgets';
const app = 'ios_next/CpuTime/CpuTime';
const shared = ['WidgetModels.swift', 'ScheduleWidgetIntents.swift', 'ScheduleWidgetStyle.swift',
  'ScheduleWidgetLayouts.swift', 'ScheduleWidgetViews.swift', 'AgendaWidget.swift'];

const code = source => source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');

test('widget views draw the moment of their timeline entry', async () => {
  // A timeline holds a whole day of entries drawn ahead of time: reading the
  // clock would draw every one of them at the moment the timeline was made.
  for (const file of ['ScheduleWidgetViews.swift', 'AgendaWidget.swift']) {
    const source = code(await read(`${widgets}/${file}`));
    const clockReads = source.match(/Date\.now|Date\(\)/g) ?? [];
    // Only the environment default (views outside a widget root) and the picker's sample.
    assert.ok(clockReads.length <= 1, `${file} reads the clock ${clockReads.length} times`);
    // The family comes through the root, so the gallery can pin it.
    assert.equal((source.match(/@Environment\(\\\.widgetFamily\)/g) ?? []).length, 1, file);
  }
});

test('the widget gallery is Debug only and Release leaves the views out of the app', async () => {
  const gallery = await read(`${app}/NativeWidgetGallery.swift`);
  assert.match(gallery, /^#if DEBUG\n/);
  assert.match(gallery.trimEnd(), /#endif$/);
  const shell = await read(`${app}/ContentView.swift`);
  const debug = shell.slice(shell.indexOf('#if DEBUG'), shell.indexOf('#else'));
  assert.match(debug, /NativeWidgetGallery\.isRequested/);

  const project = await read('ios_next/CpuTime/CpuTime.xcodeproj/project.pbxproj');
  for (const file of [...shared, 'AgendaWidgetSnapshot.swift']) {
    assert.match(project, new RegExp(`CPUWebWidgets/${file.replace('.', '\\.')} in Sources \\*/,`), file);
  }
  const release = project.slice(project.indexOf('/* Release configuration for PBXNativeTarget "CpuTime" */ = {'));
  const excluded = release.slice(0, release.indexOf('};')).match(/EXCLUDED_SOURCE_FILE_NAMES = "([^"]+)"/)?.[1] ?? '';
  for (const file of shared) assert.ok(excluded.split(' ').includes(file), `Release app excludes ${file}`);
  // The 日程 bridge needs the snapshot model in every configuration.
  assert.ok(!excluded.includes('AgendaWidgetSnapshot.swift'));
});

test('the 日程 widget ticks off through the app, never the site', async () => {
  const widget = await read(`${widgets}/AgendaWidget.swift`);
  assert.match(widget, /Toggle\(isOn: false, intent: CompleteAgendaIntent/);
  assert.match(widget, /AgendaWidgetStore\.addPending/);
  assert.doesNotMatch(widget, /URLSession|cookie/i);
  const bridge = await read(`${app}/NativeAgendaWidgetBridge.swift`);
  assert.match(bridge, /service\.toggle\(NativeAgendaOccurrence/);
  assert.match(bridge, /if service\.available \{ applyPending\(service\) \}/);
  const agenda = await read(`${app}/NativeAgenda.swift`);
  assert.match(agenda, /NativeAgendaWidgetBridge\.shared\.start\(self\)/);
  // Notes never leave the app.
  const projection = await read(`${app}/NativeAgendaWidgetProjection.swift`);
  assert.doesNotMatch(projection, /\.note/);
});

test('changing the timetable style refreshes the widgets', async () => {
  const style = await read(`${app}/ScheduleStyle.swift`);
  const setter = style.slice(style.indexOf('func setStyle('));
  assert.match(setter.slice(0, 400), /WidgetCenter\.shared\.reloadAllTimelines\(\)/);
  const models = await read(`${widgets}/WidgetModels.swift`);
  assert.match(models, /timetableStyleKey = "scheduleVisualStyle"/);
});

test('text size scales the whole widget and never the lock screen', async () => {
  const layouts = await read(`${widgets}/ScheduleWidgetLayouts.swift`);
  // One canvas per scale, laid out at 1/scale and scaled back: fitting ladders see the real room.
  assert.match(layouts, /struct WidgetTextScaled<Content: View>: View/);
  assert.match(layouts, /\.scaleEffect\(scale, anchor: \.topLeading\)/);
  assert.match(layouts, /ProposedViewSize\(width: bounds\.width \/ scale, height: bounds\.height \/ scale\)/);
  const models = await read(`${widgets}/WidgetModels.swift`);
  // 自适应 ends at the standard size, so a full day is never drawn smaller than before.
  assert.match(models, /case \.auto: return \[1\.16, 1\.08, 1\]/);
  assert.match(models, /case \.standard: return \[1\]/);
  for (const file of ['ScheduleWidgetViews.swift', 'AgendaWidget.swift']) {
    const source = await read(`${widgets}/${file}`);
    assert.match(source, /family\.isAccessory \? \.standard : /, file);
    assert.match(source, /WidgetTextScaled\(size: textSize\)/, file);
  }
  // Each schedule widget can pick its own size in 编辑小组件; the default follows the app.
  const intents = await read(`${widgets}/ScheduleWidgetIntents.swift`);
  assert.equal((intents.match(/@Parameter\(title: "文字大小", default: \.follow\)/g) ?? []).length, 3);
  assert.equal((intents.match(/textSize: textSize\.size/g) ?? []).length, 3);
  assert.match(code(await read(`${widgets}/ScheduleWidgetViews.swift`)), /entry\.configuration\.textSize \?\? displayOptions\.textSize/);
});

test('display options added later default when an older app wrote the settings', async () => {
  const added = { textSize: 'standard', showWeek: 'true', showBreaks: 'true', showProgress: 'true', hideCompleted: 'false' };
  const extension = await read(`${widgets}/WidgetModels.swift`);
  const settings = await read(`${app}/NativeWidgetSettings.swift`);
  for (const [key, fallback] of Object.entries(added)) {
    for (const [name, source] of [['extension', extension], ['app', settings]]) {
      const decode = key === 'textSize'
        ? /decodeIfPresent\(String\.self, forKey: \.textSize\)/
        : new RegExp(`${key}: try flag\\(\\.${key}, ${fallback}\\)`);
      assert.match(source, decode, `${name} decodes ${key} with a default`);
    }
  }
  // The app writes the sizes the extension can read.
  const sizes = [...settings.matchAll(/\("(\w+)", "[^"]+"\)/g)].map(match => match[1])
    .filter(value => ['auto', 'small', 'standard', 'large'].includes(value));
  assert.deepEqual(sizes, ['auto', 'small', 'standard', 'large']);
  assert.match(extension, /case auto\n\s+case small\n\s+case standard\n\s+case large/);
  const page = await read(`${app}/NativeWidgetSetupView.swift`);
  for (const key of ['showProgress', 'hideCompleted', 'showBreaks', 'showWeek']) {
    assert.match(page, new RegExp(`optionBinding\\(\\\\\\.${key}\\)`), key);
  }
});

test('countdown and progress are system timers anchored to the timeline entry', async () => {
  const views = code(await read(`${widgets}/ScheduleWidgetViews.swift`));
  // Live without a reload: the timers run from the entry's date to the class boundary.
  assert.match(views, /Text\(timerInterval: now\.\.\.max\(now, target\.date\), countsDown: true\)/);
  assert.match(views, /ProgressView\(timerInterval: interval, countsDown: false\)/);
  const countdown = views.slice(views.indexOf('struct CourseCountdownLabel'), views.indexOf('struct CourseProgressBar'));
  assert.match(countdown, /options\.showProgress/);
  assert.match(countdown, /SchedulePayload\.countdownLeadMinutes \* 60/);
  // The countdown to a class needs an entry at the moment it appears.
  const models = await read(`${widgets}/WidgetModels.swift`);
  assert.match(models, /\[\$0 - Self\.countdownLeadMinutes, \$0\]/);
  // A hidden finished course leaves the window whether or not the rest would fit.
  assert.match(models, /hidesCompleted \? completedPrefix : min\(overflow, completedPrefix\)/);
  // The gallery pins its moments and cannot run the system's timers.
  const gallery = await read(`${app}/NativeWidgetGallery.swift`);
  assert.match(gallery, /staticClock: true/);
});
