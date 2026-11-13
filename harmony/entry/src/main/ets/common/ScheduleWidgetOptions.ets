// 服务卡片的显示开关。字段名和默认值与 iOS 写进 App Group 的 scheduleWidgetDisplayOptions 一致
//（ios_next/CpuTime/CPUWebWidgets/WidgetModels.swift），存成一份 JSON；旧版本存的没有后来加的字段，
// 缺哪个就取哪个的默认值，不让已经关掉的开关又被打开。

export interface ScheduleWidgetDisplayOptions {
  showCourseName: boolean;
  showRoom: boolean;
  showTeacher: boolean;
  showTime: boolean;
  showLunarDate: boolean;
  showHoliday: boolean;
  // 最近的法定假期常驻在日期栏右边（「距国庆节还有 5 天」），而不是只在休息时才出现。
  holidayAlwaysVisible: boolean;
  // auto（自适应）| small | standard | large。整块内容一起缩放，见 widgetTextScales。
  textSize: string;
  // 日期栏右边的「第 N 周」。
  showWeek: boolean;
  // 时间线上长课间的「休息 2 小时」。鸿蒙卡片还没有时间线排法，这一项只是照 iOS 的格式存着。
  showBreaks: boolean;
  // 正在上的课带一条进度，临近课程的标签旁边是「距下课」「距上课」的倒计时。
  showProgress: boolean;
  // 今天已经上完的课不再灰着留在列表里。
  hideCompleted: boolean;
}

export const WIDGET_TEXT_SIZES: string[] = ['auto', 'small', 'standard', 'large'];

export function widgetTextSizeLabel(size: string): string {
  return size === 'auto' ? '自适应' : size === 'small' ? '小' : size === 'large' ? '大' : '标准';
}

export function defaultWidgetDisplayOptions(): ScheduleWidgetDisplayOptions {
  return {
    showCourseName: true,
    showRoom: true,
    showTeacher: true,
    showTime: true,
    showLunarDate: true,
    showHoliday: true,
    holidayAlwaysVisible: true,
    textSize: 'standard',
    showWeek: true,
    showBreaks: true,
    showProgress: true,
    hideCompleted: false
  };
}

function flag(record: Record<string, Object | undefined>, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === 'boolean' ? value as boolean : fallback;
}

export function parseWidgetDisplayOptions(raw: string): ScheduleWidgetDisplayOptions {
  const options = defaultWidgetDisplayOptions();
  let record: Record<string, Object | undefined> = {};
  try {
    const parsed = JSON.parse(raw || '{}') as Record<string, Object | undefined> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return options;
    record = parsed;
  } catch (_) {
    return options;
  }
  options.showCourseName = flag(record, 'showCourseName', options.showCourseName);
  options.showRoom = flag(record, 'showRoom', options.showRoom);
  options.showTeacher = flag(record, 'showTeacher', options.showTeacher);
  options.showTime = flag(record, 'showTime', options.showTime);
  options.showLunarDate = flag(record, 'showLunarDate', options.showLunarDate);
  options.showHoliday = flag(record, 'showHoliday', options.showHoliday);
  options.holidayAlwaysVisible = flag(record, 'holidayAlwaysVisible', options.holidayAlwaysVisible);
  // 认不出的值（以后的版本写的）当标准大小，不让整份设置作废。
  const size = record['textSize'];
  options.textSize = typeof size === 'string' && WIDGET_TEXT_SIZES.includes(size as string) ? size as string : 'standard';
  options.showWeek = flag(record, 'showWeek', options.showWeek);
  options.showBreaks = flag(record, 'showBreaks', options.showBreaks);
  options.showProgress = flag(record, 'showProgress', options.showProgress);
  options.hideCompleted = flag(record, 'hideCompleted', options.hideCompleted);
  return options;
}

// 依次试的缩放比例：第一个整块放得下的就用，都放不下用最后一个。
// 自适应最后落在标准大小，课多的日子不会比原来小。
export function widgetTextScales(size: string): number[] {
  if (size === 'auto') return [1.16, 1.08, 1];
  if (size === 'small') return [0.9];
  if (size === 'large') return [1.12];
  return [1];
}
