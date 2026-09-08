import {
  NativeCourseBlock,
  NativeScheduleCourse,
  NativeScheduleSemester,
  NativeScheduleStore,
  NativeScheduleWeek
} from './NativeScheduleStore';

const DAYS: string[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const SLOT_STARTS: string[] = ['08:00', '08:55', '09:55', '10:50', '13:30', '14:25', '15:25', '16:20', '18:30', '19:25', '20:20'];
const SLOT_ENDS: string[] = ['08:45', '09:40', '10:40', '11:35', '14:15', '15:10', '16:10', '17:05', '19:15', '20:10', '21:05'];
const COURSE_COLORS: string[] = ['#376FD6', '#168776', '#7056C7', '#D97706', '#DB2777', '#2F855A', '#7C3AED', '#0F766E'];

@Component
export struct NativeSchedulePage {
  store: NativeScheduleStore = new NativeScheduleStore();
  @Prop revision: number = 0;
  onLogin: () => void = () => undefined;
  onWidgets: () => void = () => undefined;
  @State private detailVisible: boolean = false;
  @State private detailName: string = '';
  @State private detailTeacher: string = '';
  @State private detailLocation: string = '';
  @State private detailWeeks: string = '';
  @State private detailSlotNote: string = '';
  @State private detailDay: number = 1;
  @State private detailStartSlot: number = 1;
  @State private detailEndSlot: number = 2;

  build() {
    Stack() {
      Column() {
        this.header()

        Refresh({
          refreshing: this.store.status === 'loading' && this.store.result !== undefined,
          promptText: '下拉刷新课表'
        }) {
          Scroll() {
            Column({ space: 14 }) {
              this.controls()

              if (this.store.errorMessage) {
                this.messageBanner(this.store.errorMessage, '#FFF4E8', '#A65300')
              }

              if (this.store.status === 'loading' && this.store.result !== undefined) {
                this.messageBanner('正在更新课表，当前内容仍可使用', '#EDF4FF', '#376FD6')
              }

              if (this.store.status === 'unauthorized') {
                this.stateCard('教务授权已失效', '请重新登录并完成教务授权后读取课表', '去登录', () => this.onLogin())
              } else if ((this.store.status === 'idle' || this.store.status === 'loading') && !this.store.result) {
                this.loadingCard()
              } else if (this.store.status === 'failed' && !this.store.result) {
                this.stateCard('课表暂时无法加载', this.store.errorMessage || '请检查网络连接后重试', '重新加载', () => this.store.load(true))
              } else if (this.store.result) {
                this.summary()
                if (this.store.visibleCells().length === 0) {
                  this.stateCard('本周没有课程', '可以切换其他周次，或下拉刷新最新课表', '返回本周', () => this.store.returnToCurrentWeek())
                } else if (this.store.viewMode === 'day') {
                  this.daySchedule()
                } else {
                  this.weekSchedule()
                }
              }
            }
            .width('100%')
            .padding({ left: 14, right: 14, top: 12, bottom: 28 })
          }
          .width('100%')
          .height('100%')
          .scrollBar(BarState.Off)
        }
        .layoutWeight(1)
        .onRefreshing(() => this.store.load(true))
      }
      .width('100%')
      .height('100%')
      .backgroundColor($r('app.color.app_background'))

      if (this.detailVisible) {
        this.courseDetail()
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  private header() {
    Row() {
      Column({ space: 2 }) {
        Text('课表')
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.app_text_primary'))
        Text('原生课表 · 登录状态与网站同步')
          .fontSize(12)
          .fontColor($r('app.color.app_text_secondary'))
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Button('小组件')
        .type(ButtonType.Capsule)
        .height(36)
        .fontSize(13)
        .fontColor('#2459AF')
        .backgroundColor('#E7F0FF')
        .onClick(() => this.onWidgets())
    }
    .width('100%')
    .height(68)
    .padding({ left: 18, right: 18, top: 8 })
    .alignItems(VerticalAlign.Center)
    .backgroundColor($r('app.color.app_surface'))
  }

  @Builder
  private controls() {
    Column({ space: 12 }) {
      Row({ space: 10 }) {
        if (this.store.semesterOptions().length > 0) {
          Select(this.semesterSelectOptions())
            .selected(this.store.selectedSemesterIndex())
            .value(this.semesterLabel())
            .font({ size: 13 })
            .fontColor($r('app.color.app_text_primary'))
            .backgroundColor($r('app.color.app_control'))
            .borderRadius(10)
            .layoutWeight(1)
            .onSelect((index: number) => {
              const option = this.store.semesterOptions()[index];
              if (option) this.store.selectSemester(option.value);
            })
        }

        if (this.store.weekOptions().length > 0) {
          Select(this.weekSelectOptions())
            .selected(this.store.selectedWeekIndex())
            .value(this.weekLabel())
            .font({ size: 13 })
            .fontColor($r('app.color.app_text_primary'))
            .backgroundColor($r('app.color.app_control'))
            .borderRadius(10)
            .layoutWeight(1)
            .onSelect((index: number) => {
              const option = this.store.weekOptions()[index];
              if (option) this.store.selectWeek(option.value);
            })
        }

        Button('本周')
          .type(ButtonType.Capsule)
          .height(36)
          .fontSize(13)
          .fontColor('#FFFFFF')
          .backgroundColor('#376FD6')
          .onClick(() => this.store.returnToCurrentWeek())
      }
      .width('100%')

      Row() {
        this.modeButton('周视图', 'week')
        this.modeButton('日视图', 'day')
      }
      .width('100%')
      .height(38)
      .padding(3)
      .backgroundColor($r('app.color.app_control'))
      .borderRadius(12)
    }
    .width('100%')
    .padding(14)
    .backgroundColor($r('app.color.app_surface'))
    .borderRadius(16)
  }

  @Builder
  private modeButton(label: string, mode: string) {
    Button(label)
      .type(ButtonType.Normal)
      .height('100%')
      .layoutWeight(1)
      .fontSize(13)
      .fontWeight(this.store.viewMode === mode ? FontWeight.Medium : FontWeight.Regular)
      .fontColor(this.store.viewMode === mode ? '#2459AF' : $r('app.color.app_text_secondary'))
      .backgroundColor(this.store.viewMode === mode ? $r('app.color.app_surface') : 'transparent')
      .borderRadius(9)
      .onClick(() => this.store.setViewMode(mode))
  }

  @Builder
  private summary() {
    Row() {
      Column({ space: 3 }) {
        Text(this.weekLabel())
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.app_text_primary'))
        Text(this.store.viewMode === 'week' ? '整周安排' : `${DAYS[this.store.selectedDay - 1]}的课程`)
          .fontSize(12)
          .fontColor($r('app.color.app_text_secondary'))
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Text(`${this.courseCount()} 门课`)
        .fontSize(12)
        .fontColor($r('app.color.app_text_secondary'))
    }
    .width('100%')
    .padding({ left: 4, right: 4 })
  }

  @Builder
  private daySchedule() {
    Column({ space: 12 }) {
      Scroll() {
        Row({ space: 8 }) {
          ForEach([1, 2, 3, 4, 5, 6, 7], (day: number) => {
            Button() {
              Column({ space: 3 }) {
                Text(DAYS[day - 1])
                  .fontSize(12)
                  .fontWeight(FontWeight.Medium)
                Text(this.store.dayDate(day) || '--')
                  .fontSize(10)
                  .fontColor(this.store.selectedDay === day ? '#DCE8FF' : $r('app.color.app_text_secondary'))
              }
            }
            .type(ButtonType.Normal)
            .width(62)
            .height(48)
            .fontColor(this.store.selectedDay === day ? '#FFFFFF' : $r('app.color.app_text_primary'))
            .backgroundColor(this.store.selectedDay === day ? '#376FD6' : $r('app.color.app_surface'))
            .borderRadius(12)
            .onClick(() => this.store.selectDay(day))
          })
        }
      }
      .width('100%')
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)

      if (this.store.blocksForDay(this.store.selectedDay).length === 0) {
        this.stateCard('当天没有课程', '选择其他日期查看课程安排', '', () => undefined)
      } else {
        Column({ space: 10 }) {
          ForEach(this.store.blocksForDay(this.store.selectedDay), (block: NativeCourseBlock) => {
            this.courseRow(block)
          })
        }
        .width('100%')
      }
    }
    .width('100%')
  }

  @Builder
  private weekSchedule() {
    Scroll() {
      Row({ space: 10 }) {
        ForEach([1, 2, 3, 4, 5, 6, 7], (day: number) => {
          Column({ space: 8 }) {
            Column({ space: 2 }) {
              Row({ space: 5 }) {
                Text(DAYS[day - 1])
                  .fontSize(13)
                  .fontWeight(FontWeight.Medium)
                  .fontColor($r('app.color.app_text_primary'))
                if (this.store.isToday(day)) {
                  Circle()
                    .width(6)
                    .height(6)
                    .fill('#376FD6')
                }
              }
              Text(this.store.dayDate(day) || '--')
                .fontSize(10)
                .fontColor($r('app.color.app_text_secondary'))
            }
            .width('100%')
            .height(48)
            .justifyContent(FlexAlign.Center)
            .backgroundColor(this.store.isToday(day) ? '#E7F0FF' : '#F2F5F9')
            .borderRadius(12)

            if (this.store.blocksForDay(day).length === 0) {
              Text('无课')
                .width('100%')
                .height(82)
                .fontSize(12)
                .fontColor($r('app.color.app_text_tertiary'))
                .textAlign(TextAlign.Center)
                .backgroundColor($r('app.color.app_surface'))
                .borderRadius(12)
            } else {
              ForEach(this.store.blocksForDay(day), (block: NativeCourseBlock) => {
                this.compactCourseCard(block)
              })
            }
          }
          .width(142)
          .alignItems(HorizontalAlign.Start)
        })
      }
      .alignItems(VerticalAlign.Top)
    }
    .width('100%')
    .scrollable(ScrollDirection.Horizontal)
    .scrollBar(BarState.Off)
  }

  @Builder
  private courseRow(block: NativeCourseBlock) {
    Row({ space: 12 }) {
      Column({ space: 2 }) {
        Text(block.startSlot === block.endSlot ? `${block.startSlot}` : `${block.startSlot}-${block.endSlot}`)
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .fontColor('#2459AF')
        Text(this.timeRange(block.startSlot, block.endSlot))
          .fontSize(9)
          .fontColor($r('app.color.app_text_secondary'))
          .textAlign(TextAlign.Center)
      }
      .width(54)
      .alignItems(HorizontalAlign.Center)

      Rect()
        .width(4)
        .height(62)
        .fill(this.courseColor(block.course.name))
        .borderRadius(2)

      Column({ space: 5 }) {
        Text(block.course.name || '课程')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.app_text_primary'))
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (block.course.location) {
          Text(`地点 · ${block.course.location}`)
            .fontSize(12)
            .fontColor($r('app.color.app_text_secondary'))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        if (block.course.teacher) {
          Text(`教师 · ${block.course.teacher}`)
            .fontSize(12)
            .fontColor($r('app.color.app_text_secondary'))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .padding(14)
    .backgroundColor($r('app.color.app_surface'))
    .borderRadius(14)
    .onClick(() => this.openDetail(block))
  }

  @Builder
  private compactCourseCard(block: NativeCourseBlock) {
    Column({ space: 5 }) {
      Text(block.course.name || '课程')
        .width('100%')
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.app_text_primary'))
        .maxLines(3)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Text(`${block.startSlot}-${block.endSlot} 节${block.course.location ? ` · ${block.course.location}` : ''}`)
        .width('100%')
        .fontSize(10)
        .fontColor($r('app.color.app_text_secondary'))
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .padding(10)
    .backgroundColor(this.courseColor(block.course.name, 0.12))
    .border({ width: 1, color: this.courseColor(block.course.name, 0.28) })
    .borderRadius(12)
    .onClick(() => this.openDetail(block))
  }

  @Builder
  private loadingCard() {
    Column({ space: 14 }) {
      LoadingProgress()
        .width(34)
        .height(34)
        .color('#376FD6')
      Text('正在加载课表')
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.app_text_primary'))
      Text(this.store.bridgeReady ? '正在从教务服务读取最新安排' : '正在恢复登录状态与课表服务')
        .fontSize(13)
        .fontColor($r('app.color.app_text_secondary'))
        .textAlign(TextAlign.Center)
    }
    .width('100%')
    .height(260)
    .justifyContent(FlexAlign.Center)
    .padding(24)
    .backgroundColor($r('app.color.app_surface'))
    .borderRadius(16)
  }

  @Builder
  private stateCard(title: string, message: string, action: string, callback: () => void) {
    Column({ space: 12 }) {
      Text(title)
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.app_text_primary'))
      Text(message)
        .fontSize(13)
        .fontColor($r('app.color.app_text_secondary'))
        .textAlign(TextAlign.Center)
      if (action) {
        Button(action)
          .type(ButtonType.Capsule)
          .height(38)
          .fontSize(13)
          .fontColor('#FFFFFF')
          .backgroundColor('#376FD6')
          .onClick(() => callback())
      }
    }
    .width('100%')
    .height(220)
    .justifyContent(FlexAlign.Center)
    .padding(24)
    .backgroundColor($r('app.color.app_surface'))
    .borderRadius(16)
  }

  @Builder
  private messageBanner(message: string, background: string, foreground: string) {
    Row({ space: 8 }) {
      Text('i')
        .width(20)
        .height(20)
        .fontSize(12)
        .fontWeight(FontWeight.Bold)
        .fontColor('#FFFFFF')
        .textAlign(TextAlign.Center)
        .backgroundColor(foreground)
        .borderRadius(10)
      Text(message)
        .fontSize(12)
        .fontColor(foreground)
        .layoutWeight(1)
        .maxLines(3)
    }
    .width('100%')
    .padding(11)
    .backgroundColor(background)
    .borderRadius(12)
  }

  @Builder
  private courseDetail() {
    Column() {
      Blank()
        .layoutWeight(1)
        .width('100%')
        .onClick(() => this.detailVisible = false)

      Column({ space: 14 }) {
        Row() {
          Text('课程详情')
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.app_text_primary'))
            .layoutWeight(1)
          Button('完成')
            .type(ButtonType.Normal)
            .height(34)
            .fontSize(14)
            .fontColor('#2459AF')
            .backgroundColor('#E7F0FF')
            .onClick(() => this.detailVisible = false)
        }
        .width('100%')

        Text(this.detailName)
          .width('100%')
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.app_text_primary'))

        this.detailRow('星期', DAYS[this.detailDay - 1])
        this.detailRow('节次', this.detailSlotNote || `第 ${this.detailStartSlot}-${this.detailEndSlot} 节`)
        this.detailRow('时间', this.timeRange(this.detailStartSlot, this.detailEndSlot))
        this.detailRow('周次', this.detailWeeks)
        if (this.detailTeacher) this.detailRow('教师', this.detailTeacher)
        if (this.detailLocation) this.detailRow('地点', this.detailLocation)
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 20, bottom: 28 })
      .backgroundColor($r('app.color.app_surface'))
      .borderRadius({ topLeft: 24, topRight: 24 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('rgba(15, 23, 42, 0.36)')
  }

  @Builder
  private detailRow(label: string, value: string) {
    Row() {
      Text(label)
        .width(58)
        .fontSize(13)
        .fontColor($r('app.color.app_text_secondary'))
      Text(value || '—')
        .fontSize(13)
        .fontColor($r('app.color.app_text_primary'))
        .layoutWeight(1)
    }
    .width('100%')
  }

  private openDetail(block: NativeCourseBlock): void {
    this.detailName = block.course.name || '课程';
    this.detailTeacher = block.course.teacher ?? '';
    this.detailLocation = block.course.location ?? '';
    this.detailWeeks = block.course.weeks ?? '';
    this.detailSlotNote = block.course.slotNote ?? '';
    this.detailDay = block.day;
    this.detailStartSlot = block.startSlot;
    this.detailEndSlot = block.endSlot;
    this.detailVisible = true;
  }

  private semesterLabel(): string {
    return this.store.semesterOptions()[this.store.selectedSemesterIndex()]?.label || this.store.selectedSemester || '选择学期';
  }

  private semesterSelectOptions(): SelectOption[] {
    const options: SelectOption[] = [];
    this.store.semesterOptions().forEach((item: NativeScheduleSemester) => options.push({ value: item.label }));
    return options;
  }

  private weekSelectOptions(): SelectOption[] {
    const options: SelectOption[] = [];
    this.store.weekOptions().forEach((item: NativeScheduleWeek) => options.push({ value: item.label }));
    return options;
  }

  private weekLabel(): string {
    return this.store.weekOptions()[this.store.selectedWeekIndex()]?.label ||
      (this.store.selectedWeek ? `第 ${this.store.selectedWeek} 周` : '选择周次');
  }

  private courseCount(): number {
    return this.store.visibleCells().reduce((sum: number, cell) => sum + cell.courses.length, 0);
  }

  private timeRange(startSlot: number, endSlot: number): string {
    const start = SLOT_STARTS[Math.max(0, startSlot - 1)] ?? '';
    const end = SLOT_ENDS[Math.max(0, endSlot - 1)] ?? '';
    return start && end ? `${start}-${end}` : '';
  }

  private courseColor(name: string, opacity: number = 1): string {
    let hash = 0;
    for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
    const color = COURSE_COLORS[hash % COURSE_COLORS.length];
    if (opacity >= 1) return color;
    const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, '0');
    return `${color}${alpha}`;
  }
}
