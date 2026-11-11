// The card shown above a course's long-press menu (NapTable's larger card). The system's image preview
// only enlarges the cell a little, so a two-character-wide cell stayed unreadable.

/** What the preview says about one course meeting. */
export interface ScheduleCoursePreviewInfo {
  name: string;
  // "周三 · 第 3–4 节 · 10:00–11:45"
  when: string;
  location: string;
  accent: string;
  // 已停课, 调课 or the partner's name; empty for an ordinary meeting.
  note: string;
  dark: boolean;
}

@Builder
export function scheduleCoursePreview(info: ScheduleCoursePreviewInfo) {
  Row({ space: 12 }) {
    Column().width(4).borderRadius(2).backgroundColor(info.accent).alignSelf(ItemAlign.Stretch)
    Column({ space: 5 }) {
      Text(info.name).fontSize(18).fontWeight(FontWeight.Bold).fontColor(info.dark ? '#ECEEF1' : '#172033')
        .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
      Text(info.when).fontSize(13).fontColor(info.dark ? '#A8ADB4' : '#5F6670').width('100%')
      if (info.location) {
        Text(info.location).fontSize(13).fontColor(info.dark ? '#A8ADB4' : '#5F6670').width('100%')
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      if (info.note) {
        Text(info.note).fontSize(12).fontWeight(600).fontColor(info.dark ? '#FDBA74' : '#C2410C').width('100%')
      }
    }.layoutWeight(1).alignItems(HorizontalAlign.Start)
  }
  .width(260)
  .padding({ left: 14, right: 16, top: 14, bottom: 14 })
  .borderRadius(18)
  .backgroundColor(info.dark ? '#24282D' : '#FFFFFF')
}
