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
