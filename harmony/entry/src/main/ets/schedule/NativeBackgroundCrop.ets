// Picks the part of a photo the timetable shows, at the screen's shape: drag to move it, pinch to
// zoom, like setting a wallpaper (iOS NativeBackgroundCropEditor). The result is a rectangle in
// fractions of the image, "x,y,w,h"; empty means the default (the whole photo filling the screen).

/** "x,y,w,h" as four fractions, or [] when it is not a usable rectangle. */
export function backgroundCropRect(value: string): number[] {
  const parts = (value ?? '').split(',').map((part: string) => Number(part));
  if (parts.length !== 4 || parts.some((part: number) => !Number.isFinite(part))) return [];
  const x = parts[0];
  const y = parts[1];
  const w = parts[2];
  const h = parts[3];
  if (w <= 0.02 || h <= 0.02 || x < -0.001 || y < -0.001 || x + w > 1.001 || y + h > 1.001) return [];
  return [x, y, w, h];
}

export function backgroundCropText(rect: number[]): string {
  return rect.map((value: number) => String(Math.round(value * 10000) / 10000)).join(',');
}

const MARGIN: number = 28;

@Component
export struct NativeBackgroundCrop {
  @Prop path: string = '';
  // Width over height of the area the background fills.
  @Prop aspect: number = 0.46;
  @Prop crop: string = '';
  onDone: (crop: string) => void = () => undefined;
  onCancel: () => void = () => undefined;
  @State private naturalW: number = 0;
  @State private naturalH: number = 0;
  @State private areaW: number = 360;
  @State private areaH: number = 640;
  @State private zoom: number = 1;
  @State private offsetX: number = 0;
  @State private offsetY: number = 0;
  private startZoom: number = 1;
  private startX: number = 0;
  private startY: number = 0;
  private seeded: boolean = false;

  build() {
    Column() {
      Stack({ alignContent: Alignment.TopStart }) {
        if (this.naturalW > 0) {
          Image(this.path).objectFit(ImageFit.Fill).width(this.shownW()).height(this.shownH())
            .position({ x: this.imageLeft(), y: this.imageTop() })
        } else {
          Image(this.path).objectFit(ImageFit.Contain).width('100%').height('100%').opacity(0)
            .onComplete((event) => {
              if (!event) return;
              this.naturalW = event.width;
              this.naturalH = event.height;
              this.seed();
            })
        }
        // Everything outside the frame dimmed, the frame itself outlined.
        Column().width('100%').height(this.frameTop()).backgroundColor('#A6000000').position({ x: 0, y: 0 })
        Column().width('100%').height(this.areaH - this.frameTop() - this.frameH()).backgroundColor('#A6000000')
          .position({ x: 0, y: this.frameTop() + this.frameH() })
        Column().width(this.frameLeft()).height(this.frameH()).backgroundColor('#A6000000').position({ x: 0, y: this.frameTop() })
        Column().width(this.areaW - this.frameLeft() - this.frameW()).height(this.frameH()).backgroundColor('#A6000000')
          .position({ x: this.frameLeft() + this.frameW(), y: this.frameTop() })
        Column().width(this.frameW()).height(this.frameH()).border({ width: 1.5, color: '#FFFFFF', radius: 14 })
          .position({ x: this.frameLeft(), y: this.frameTop() }).hitTestBehavior(HitTestMode.None)
      }.width('100%').layoutWeight(1).clip(true)
        .onAreaChange((_old: Area, next: Area) => {
          this.areaW = Number(next.width);
          this.areaH = Number(next.height);
          this.seed();
        })
        .gesture(GestureGroup(GestureMode.Parallel,
          PanGesture({ distance: 1 })
            .onActionStart(() => { this.startX = this.offsetX; this.startY = this.offsetY; })
            .onActionUpdate((event: GestureEvent) => {
              this.offsetX = this.startX + event.offsetX;
              this.offsetY = this.startY + event.offsetY;
              this.clamp();
            }),
          PinchGesture()
            .onActionStart(() => { this.startZoom = this.zoom; })
            .onActionUpdate((event: GestureEvent) => {
              this.zoom = Math.min(6, Math.max(1, this.startZoom * event.scale));
              this.clamp();
            })))
        .id('background-crop-area')
      Text('拖动移动照片，双指缩放，框里就是课表看到的部分').fontSize(13).fontColor('#D9FFFFFF').margin({ top: 10 })
      Row({ space: 12 }) {
        Button('取消').type(ButtonType.Capsule).height(42).layoutWeight(1).fontColor('#FFFFFF').backgroundColor('#33FFFFFF')
          .onClick(() => this.onCancel())
        Button('还原').type(ButtonType.Capsule).height(42).layoutWeight(1).fontColor('#FFFFFF').backgroundColor('#33FFFFFF')
          .onClick(() => { this.zoom = 1; this.offsetX = 0; this.offsetY = 0; })
        Button('完成').type(ButtonType.Capsule).height(42).layoutWeight(1).fontColor('#FFFFFF').backgroundColor('#0F766E')
          .id('background-crop-done')
          .onClick(() => this.onDone(this.result()))
      }.width('100%').padding({ left: 20, right: 20, top: 12, bottom: 28 })
    }.width('100%').height('100%').padding({ top: 36 }).backgroundColor('#000000')
  }

  // ---- Geometry: the largest rectangle of the screen's shape that fits with a margin ----

  private frameW(): number {
    const width = this.areaW - 2 * MARGIN;
    const height = this.areaH - 2 * MARGIN;
    return Math.max(40, Math.min(width, height * this.aspect));
  }
  private frameH(): number { return this.frameW() / Math.max(0.1, this.aspect); }
  private frameLeft(): number { return (this.areaW - this.frameW()) / 2; }
  private frameTop(): number { return (this.areaH - this.frameH()) / 2; }
  // The image at `zoom` times the size that just covers the frame.
  private coverScale(): number {
    if (this.naturalW <= 0 || this.naturalH <= 0) return 1;
    return Math.max(this.frameW() / this.naturalW, this.frameH() / this.naturalH);
  }
  private shownW(): number { return this.naturalW * this.coverScale() * this.zoom; }
  private shownH(): number { return this.naturalH * this.coverScale() * this.zoom; }
  private imageLeft(): number { return this.frameLeft() + this.frameW() / 2 + this.offsetX - this.shownW() / 2; }
  private imageTop(): number { return this.frameTop() + this.frameH() / 2 + this.offsetY - this.shownH() / 2; }

  // An offset of the image's centre from the frame's that keeps the frame covered.
  private clamp(): void {
    const limitX = Math.max(0, (this.shownW() - this.frameW()) / 2);
    const limitY = Math.max(0, (this.shownH() - this.frameH()) / 2);
    this.offsetX = Math.min(limitX, Math.max(-limitX, this.offsetX));
    this.offsetY = Math.min(limitY, Math.max(-limitY, this.offsetY));
  }

  // The saved framing, once the photo's size and the area are known.
  private seed(): void {
    if (this.seeded || this.naturalW <= 0 || this.areaW <= 0) return;
    this.seeded = true;
    const rect = backgroundCropRect(this.crop);
    if (!rect.length) return;
    const shownW = this.frameW() / rect[2];
    this.zoom = Math.min(6, Math.max(1, shownW / (this.naturalW * this.coverScale())));
    const left = this.frameLeft() - rect[0] * this.shownW();
    const top = this.frameTop() - rect[1] * this.shownH();
    this.offsetX = left + this.shownW() / 2 - (this.frameLeft() + this.frameW() / 2);
    this.offsetY = top + this.shownH() / 2 - (this.frameTop() + this.frameH() / 2);
    this.clamp();
  }

  private result(): string {
    if (this.naturalW <= 0) return '';
    if (this.zoom === 1 && this.offsetX === 0 && this.offsetY === 0) return '';
    const x = (this.frameLeft() - this.imageLeft()) / this.shownW();
    const y = (this.frameTop() - this.imageTop()) / this.shownH();
    return backgroundCropText([Math.max(0, x), Math.max(0, y), Math.min(1, this.frameW() / this.shownW()),
      Math.min(1, this.frameH() / this.shownH())]);
  }
}
