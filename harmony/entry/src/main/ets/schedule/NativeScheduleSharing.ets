import { emptySharedLibrary, libraryAdopt, libraryMarkRevoked, libraryRefresh, libraryRemove, libraryRename, librarySave,
  normalizedShareCode, parseSharedLibrary, RawShareDocument, readSharedSchedule, ScheduleShareMeta, shareInvitation, shareMetaFrom,
  shareOwnerName, SharePublishBody, SharedSchedule, SharedScheduleLibrary, sharedScheduleName, shareTimeLabel } from './ScheduleSharing';

// Share codes: publishing the signed-in user's own timetable, and keeping the timetables other
// people shared with them (NativeScheduleSharingService and NativeScheduleSharingView on iOS).
//
// Publishing and revoking go through the site account, so the codes follow the account across
// devices. What somebody else shared is kept on this device only, under the account that imported
// it, and opens read-only: it never reaches the service cards or the timetable cache.

export interface ShareApiRequest {
  // mine | publish | revoke | meta | get
  action: string;
  code?: string;
  body?: SharePublishBody;
}
export interface ShareApiData extends RawShareDocument {
  shares?: RawShareDocument[];
}
export interface ShareApiReply {
  ok: boolean;
  // The HTTP status, or 0 when the request never got an answer.
  status: number;
  error?: string;
  data?: ShareApiData;
}
export type ShareApi = (request: ShareApiRequest) => Promise<ShareApiReply>;

@Observed
export class NativeScheduleSharingModel {
  visible: boolean = false;
  library: SharedScheduleLibrary = emptySharedLibrary();
  // The signed-in user's own share codes, newest first.
  mine: ScheduleShareMeta[] = [];
  // '' | load | publish | revoke | import
  busy: string = '';
  error: string = '';
  notice: string = '';
  codeInput: string = '';
  preview?: SharedSchedule;
  remark: string = '';
  renameCode: string = '';
  renameText: string = '';
  private api?: ShareApi;
  private persistence?: (raw: string) => void;
  private refreshing: boolean = false;
  private generation: number = 0;

  attach(api: ShareApi, persistence: (raw: string) => void): void {
    this.api = api;
    this.persistence = persistence;
  }

  restore(raw: string): void {
    if (raw) this.library = parseSharedLibrary(raw);
  }

  /** Starts over when another account signs in; signing out keeps the saved copies for the next sign-in. */
  adopt(account: string): void {
    const next = libraryAdopt(this.library, account);
    if (next === this.library) return;
    this.generation += 1;
    this.mine = [];
    this.preview = undefined;
    this.codeInput = '';
    this.commit(next);
  }

  open(): void {
    this.error = '';
    this.notice = '';
    this.visible = true;
    void this.loadMine();
    void this.refresh();
  }

  // The preview stays: looking at a share before saving it closes the sheet for a moment.
  close(): void {
    this.visible = false;
    this.renameCode = '';
    this.error = '';
    this.notice = '';
  }

  /** The share code of `semester`, when one was published. */
  share(semester: string): ScheduleShareMeta | undefined {
    return this.mine.find((item: ScheduleShareMeta) => item.semester === semester);
  }

  async loadMine(): Promise<void> {
    if (!this.api) return;
    const generation = this.generation;
    const reply = await this.api({ action: 'mine' });
    if (generation !== this.generation || !reply.ok) return;
    this.mine = (reply.data?.shares ?? []).map((item: RawShareDocument) => shareMetaFrom(item))
      .filter((item: ScheduleShareMeta) => !!item.code);
  }

  /**
   * Publishes a semester. A semester has one code: publishing again updates what that code shows
   * and tells whether anything changed. `body` throws when the timetable cannot be shared yet.
   */
  async publish(body: () => SharePublishBody): Promise<void> {
    if (!this.api || this.busy) return;
    this.error = '';
    this.notice = '';
    let payload: SharePublishBody;
    try {
      payload = body();
    } catch (error) {
      this.error = error instanceof Error ? error.message : '课表暂时不能分享';
      return;
    }
    const generation = this.generation;
    this.busy = 'publish';
    const reply = await this.api({ action: 'publish', body: payload });
    if (generation !== this.generation) return;
    this.busy = '';
    if (!reply.ok || !reply.data) { this.error = reply.error || '课表分享失败，请稍后再试'; return; }
    const meta = shareMetaFrom(reply.data);
    if (!meta.code) { this.error = '课表分享失败，请稍后再试'; return; }
    this.mine = [meta].concat(this.mine.filter((item: ScheduleShareMeta) => item.code !== meta.code));
    // An older server answers without these two; it always made a new code.
    this.notice = reply.data.created === false
      ? (reply.data.changed === false ? '分享的课表已经是最新的' : '已更新分享的课表，分享码不变')
      : '已生成分享码';
  }

  /** Withdraws a code. A code the server no longer has is already gone. */
  async revoke(code: string): Promise<void> {
    if (!this.api || this.busy) return;
    this.error = '';
    this.notice = '';
    const generation = this.generation;
    this.busy = 'revoke';
    const reply = await this.api({ action: 'revoke', code });
    if (generation !== this.generation) return;
    this.busy = '';
    if (!reply.ok && reply.status !== 404) { this.error = reply.error || '撤销失败，请稍后再试'; return; }
    this.mine = this.mine.filter((item: ScheduleShareMeta) => item.code !== code);
    this.notice = '已撤销，分享码不再有效';
  }

  /** Downloads a share without keeping it, for the preview card. */
  async previewInput(): Promise<void> {
    if (!this.api || this.busy) return;
    this.error = '';
    this.notice = '';
    this.preview = undefined;
    const code = normalizedShareCode(this.codeInput);
    if (!code) { this.error = '分享码是 8 位字母和数字，请检查后再试'; return; }
    const generation = this.generation;
    this.busy = 'import';
    // Whose share it is comes from the account's own list, never from the public nickname, which anyone can pick.
    if (!this.mine.length) await this.loadMine();
    if (generation !== this.generation) return;
    if (this.mine.some((item: ScheduleShareMeta) => item.code === code)) {
      this.busy = '';
      this.error = '这是你自己分享的课表，直接看自己的课表就可以';
      return;
    }
    const result = await this.download(code);
    if (generation !== this.generation) return;
    this.busy = '';
    if (result.schedule) {
      this.preview = result.schedule;
      const saved = this.library.schedules.find((item: SharedSchedule) => item.meta.code === code);
      this.remark = saved ? saved.remark : '';
    } else {
      this.error = result.status === 404 ? '没有找到这份共享课表，可能已被撤销' : result.error;
    }
  }

  savePreview(): void {
    if (!this.preview) return;
    this.commit(librarySave(this.library, this.preview, this.remark));
    this.notice = '已保存到本机';
    this.preview = undefined;
    this.codeInput = '';
    this.remark = '';
  }

  beginRename(schedule: SharedSchedule): void {
    this.renameCode = schedule.meta.code;
    this.renameText = schedule.remark;
  }

  finishRename(): void {
    if (this.renameCode) this.commit(libraryRename(this.library, this.renameCode, this.renameText));
    this.renameCode = '';
  }

  remove(code: string): void {
    this.commit(libraryRemove(this.library, code));
  }

  /**
   * Checks every saved share once: a changed one is downloaded again, a withdrawn one is marked.
   * Anything else, being offline included, leaves the saved copy as it is.
   */
  async refresh(): Promise<void> {
    if (!this.api || this.refreshing) return;
    this.refreshing = true;
    const generation = this.generation;
    const live = this.library.schedules.filter((item: SharedSchedule) => !item.revoked);
    for (let index = 0; index < live.length && generation === this.generation; index += 1) {
      const saved = live[index];
      const code = saved.meta.code;
      const reply = await this.api({ action: 'meta', code });
      if (generation !== this.generation) break;
      if (reply.ok && reply.data && shareMetaFrom(reply.data).updatedAt === saved.meta.updatedAt) continue;
      // A server that predates the summary route answers 404 for every code. Only the share
      // itself being gone means revoked.
      if (!reply.ok && reply.status !== 404) continue;
      const result = await this.download(code);
      if (generation !== this.generation) break;
      if (result.schedule) this.commit(libraryRefresh(this.library, result.schedule));
      else if (result.status === 404) this.commit(libraryMarkRevoked(this.library, code));
    }
    this.refreshing = false;
  }

  private async download(code: string): Promise<ShareDownload> {
    const reply = await this.api!({ action: 'get', code });
    if (!reply.ok || !reply.data) return { status: reply.status, error: reply.error || '请求失败，请稍后再试' };
    try {
      return { status: reply.status, error: '', schedule: readSharedSchedule(reply.data, Date.now()) };
    } catch (error) {
      return { status: reply.status, error: error instanceof Error ? error.message : '这份共享课表无法读取' };
    }
  }

  private commit(next: SharedScheduleLibrary): void {
    this.library = next;
    this.persistence?.(next.account || next.schedules.length ? JSON.stringify(next) : '');
  }
}

interface ShareDownload {
  status: number;
  error: string;
  schedule?: SharedSchedule;
}

@Component
export struct NativeScheduleSharing {
  @ObjectLink model: NativeScheduleSharingModel;
  // The semester on screen and whether it can be published at all.
  @Prop semester: string = '';
  @Prop semesterLabel: string = '';
  @Prop canPublish: boolean = true;
  @Prop origin: string = 'https://cputime.cn';
  publishBody: () => SharePublishBody = () => { throw new Error('整学期课表还没有加载完，请刷新课表后再试'); };
  onOpen: (schedule: SharedSchedule) => void = () => undefined;
  onCopy: (text: string) => void = () => undefined;
  onSend: (text: string) => void = () => undefined;

  build() {
    Scroll() {
      Column({ space: 18 }) {
        Text('共享课表').fontSize(22).fontWeight(FontWeight.Bold).fontColor($r('app.color.app_text_primary')).width('100%')
        if (this.model.error) {
          Text(this.model.error).fontSize(13).fontColor('#B42318').width('100%')
        } else if (this.model.notice) {
          Text(this.model.notice).fontSize(13).fontColor($r('app.color.app_accent')).width('100%')
        }
        this.mineSection()
        this.importSection()
        this.librarySection()
        Text('别人分享的课表只保存在这台设备上，只读，不会进入桌面卡片，也不会和你自己的课表混在一起。')
          .fontSize(12).fontColor($r('app.color.app_text_tertiary')).width('100%')
      }.width('100%').padding({ left: 20, right: 20, top: 32, bottom: 40 })
    }.width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top).backgroundColor($r('app.color.app_surface'))
  }

  @Builder
  private sectionTitle(title: string) {
    Text(title).fontSize(14).fontWeight(600).fontColor($r('app.color.app_text_secondary')).width('100%').padding({ left: 4 })
  }

  @Builder
  private mineSection() {
    Column({ space: 8 }) {
      this.sectionTitle('分享我的课表')
      Column({ space: 12 }) {
        if (this.model.share(this.semester)) {
          Column({ space: 4 }) {
            Text(this.spaced(this.model.share(this.semester)?.code ?? '')).fontSize(26).fontWeight(FontWeight.Bold).fontFamily('monospace')
              .fontColor($r('app.color.app_text_primary')).width('100%').copyOption(CopyOptions.LocalDevice)
              .accessibilityText('分享码 ' + (this.model.share(this.semester)?.code ?? ''))
            Text(`${this.semesterLabel || this.semester} · ${this.model.share(this.semester)?.courseCount ?? 0} 门课` + this.updatedLabel(this.model.share(this.semester)))
              .fontSize(12).fontColor($r('app.color.app_text_secondary')).width('100%')
          }.width('100%')
          Row({ space: 8 }) {
            Button('复制邀请').type(ButtonType.Normal).height(40).layoutWeight(1).borderRadius(12).fontSize(14)
              .fontColor($r('app.color.app_on_accent')).backgroundColor($r('app.color.app_accent'))
              .onClick(() => this.onCopy(shareInvitation(this.model.share(this.semester)?.code ?? '', this.origin)))
            Button('发送').type(ButtonType.Normal).height(40).layoutWeight(1).borderRadius(12).fontSize(14)
              .fontColor($r('app.color.app_accent')).backgroundColor($r('app.color.app_accent_surface'))
              .onClick(() => this.onSend(shareInvitation(this.model.share(this.semester)?.code ?? '', this.origin)))
          }.width('100%')
          Row({ space: 8 }) {
            Button(this.model.busy === 'publish' ? '更新中' : '更新分享的课表').type(ButtonType.Normal).height(40).layoutWeight(1).borderRadius(12).fontSize(14)
              .fontColor($r('app.color.app_accent')).backgroundColor($r('app.color.app_surface')).enabled(!this.model.busy && this.canPublish)
              .onClick(() => { void this.model.publish(this.publishBody); })
            Button(this.model.busy === 'revoke' ? '撤销中' : '撤销').type(ButtonType.Normal).height(40).width(88).borderRadius(12).fontSize(14)
              .fontColor('#B42318').backgroundColor($r('app.color.app_surface')).enabled(!this.model.busy)
              .onClick(() => this.confirmRevoke(this.model.share(this.semester)?.code ?? ''))
          }.width('100%')
        } else {
          Text(this.canPublish ? '生成一个分享码，对方在药大拾间里输入，或打开链接，就能看到你这个学期的课表。之后你改了课表，再点一次更新即可，分享码不变。'
            : '课表还没有加载，暂时不能分享。')
            .fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%')
          Button(this.model.busy === 'publish' ? '生成中' : `分享 ${this.semesterLabel || this.semester || '本学期'} 的课表`)
            .type(ButtonType.Normal).height(44).width('100%').borderRadius(12).fontSize(15)
            .fontColor($r('app.color.app_on_accent')).backgroundColor($r('app.color.app_accent'))
            .enabled(!this.model.busy && this.canPublish).id('schedule-share-publish')
            .onClick(() => { void this.model.publish(this.publishBody); })
        }
      }.width('100%').padding(14).borderRadius(16).backgroundColor($r('app.color.app_control'))
      ForEach(this.model.mine.filter((item: ScheduleShareMeta) => item.semester !== this.semester), (item: ScheduleShareMeta) => {
        Row({ space: 10 }) {
          Column({ space: 3 }) {
            Text(this.spaced(item.code)).fontSize(16).fontWeight(600).fontFamily('monospace').fontColor($r('app.color.app_text_primary')).width('100%')
            Text(`${item.semester} · ${item.courseCount} 门课`).fontSize(12).fontColor($r('app.color.app_text_secondary')).width('100%')
          }.layoutWeight(1)
          Text('撤销').fontSize(13).fontWeight(600).fontColor('#B42318').padding(8)
            .onClick(() => { if (!this.model.busy) this.confirmRevoke(item.code); })
        }.width('100%').padding({ left: 14, right: 6, top: 10, bottom: 10 }).borderRadius(14).backgroundColor($r('app.color.app_control'))
      }, (item: ScheduleShareMeta) => item.code + item.updatedAt)
    }.width('100%')
  }

  @Builder
  private importSection() {
    Column({ space: 8 }) {
      this.sectionTitle('查看别人的课表')
      Column({ space: 12 }) {
        Row({ space: 8 }) {
          TextInput({ text: this.model.codeInput, placeholder: '输入分享码，或粘贴分享链接' }).height(44).layoutWeight(1).maxLength(200)
            .backgroundColor($r('app.color.app_surface')).borderRadius(12).id('schedule-share-code')
            .accessibilityText('分享码或分享链接').onChange((value: string) => this.model.codeInput = value)
            .onSubmit(() => this.lookUp())
          Button(this.model.busy === 'import' ? '查找中' : '查看').type(ButtonType.Normal).height(44).width(76).borderRadius(12).fontSize(14)
            .fontColor($r('app.color.app_on_accent')).backgroundColor($r('app.color.app_accent'))
            .enabled(!this.model.busy && this.model.codeInput.trim().length > 0)
            .onClick(() => this.lookUp())
        }.width('100%')
        if (this.model.preview) {
          Column({ space: 10 }) {
            Text(shareOwnerName(this.model.preview.meta) ? `${shareOwnerName(this.model.preview.meta)} 的课表` : '共享课表')
              .fontSize(17).fontWeight(600).fontColor($r('app.color.app_text_primary')).width('100%')
            Text(`${this.model.preview.meta.semester} · ${this.courseTotal(this.model.preview)} 门课` + this.updatedLabel(this.model.preview.meta))
              .fontSize(12).fontColor($r('app.color.app_text_secondary')).width('100%')
            TextInput({ text: this.model.remark, placeholder: '备注（选填），比如室友、同组同学' }).height(44).maxLength(20)
              .backgroundColor($r('app.color.app_control')).borderRadius(12)
              .accessibilityText('备注').onChange((value: string) => this.model.remark = value)
            Row({ space: 8 }) {
              Button('先看看').type(ButtonType.Normal).height(40).layoutWeight(1).borderRadius(12).fontSize(14)
                .fontColor($r('app.color.app_accent')).backgroundColor($r('app.color.app_accent_surface'))
                .onClick(() => { if (this.model.preview) this.onOpen(this.model.preview); })
              Button('保存到本机').type(ButtonType.Normal).height(40).layoutWeight(1).borderRadius(12).fontSize(14)
                .fontColor($r('app.color.app_on_accent')).backgroundColor($r('app.color.app_accent'))
                .onClick(() => this.model.savePreview())
            }.width('100%')
          }.width('100%').padding(12).borderRadius(14).backgroundColor($r('app.color.app_surface'))
        }
      }.width('100%').padding(14).borderRadius(16).backgroundColor($r('app.color.app_control'))
    }.width('100%')
  }

  @Builder
  private librarySection() {
    if (this.model.library.schedules.length) {
      Column({ space: 8 }) {
        this.sectionTitle('已保存的课表')
        ForEach(this.model.library.schedules, (schedule: SharedSchedule) => {
          Column({ space: 8 }) {
            Row({ space: 10 }) {
              Column({ space: 3 }) {
                Row({ space: 6 }) {
                  Text(sharedScheduleName(schedule)).fontSize(16).fontWeight(600).fontColor($r('app.color.app_text_primary'))
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  if (schedule.revoked) {
                    Text('已撤销').fontSize(10).fontWeight(600).fontColor('#B42318').padding({ left: 5, right: 5, top: 1, bottom: 1 })
                      .borderRadius(6).backgroundColor('#FEECEB')
                  }
                }.width('100%')
                Text(`${schedule.meta.semester} · ${this.courseTotal(schedule)} 门课` + (schedule.revoked ? ' · 不再更新' : this.updatedLabel(schedule.meta)))
                  .fontSize(12).fontColor($r('app.color.app_text_secondary')).width('100%').maxLines(1)
              }.layoutWeight(1)
              SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([$r('app.color.app_text_tertiary')])
            }.width('100%')
              .accessibilityGroup(true).accessibilityText('打开 ' + sharedScheduleName(schedule) + ' 的课表')
              .onClick(() => this.onOpen(schedule))
            if (this.model.renameCode === schedule.meta.code) {
              Row({ space: 8 }) {
                TextInput({ text: this.model.renameText, placeholder: '备注' }).height(40).layoutWeight(1).maxLength(20)
                  .backgroundColor($r('app.color.app_surface')).borderRadius(12)
                  .onChange((value: string) => this.model.renameText = value).onSubmit(() => this.model.finishRename())
                Button('完成').type(ButtonType.Normal).height(40).borderRadius(12).fontSize(13)
                  .fontColor($r('app.color.app_on_accent')).backgroundColor($r('app.color.app_accent'))
                  .onClick(() => this.model.finishRename())
              }.width('100%')
            } else {
              Row({ space: 18 }) {
                Text('改备注').fontSize(13).fontWeight(600).fontColor($r('app.color.app_accent')).padding({ top: 4, bottom: 4 })
                  .onClick(() => this.model.beginRename(schedule))
                Text('删除').fontSize(13).fontWeight(600).fontColor('#B42318').padding({ top: 4, bottom: 4 })
                  .onClick(() => this.confirmRemove(schedule))
              }.width('100%')
            }
          }.width('100%').padding(14).borderRadius(16).backgroundColor($r('app.color.app_control'))
        }, (schedule: SharedSchedule) => [schedule.meta.code, schedule.meta.updatedAt, schedule.remark, schedule.revoked ? 1 : 0,
          this.model.renameCode === schedule.meta.code ? 1 : 0].join('|'))
      }.width('100%')
    }
  }

  // The keyboard would otherwise sit on top of the preview card it has just brought up.
  private lookUp(): void {
    this.getUIContext().getFocusController().clearFocus();
    void this.model.previewInput();
  }

  private courseTotal(schedule: SharedSchedule): number {
    if (schedule.meta.courseCount > 0) return schedule.meta.courseCount;
    const names: string[] = [];
    schedule.cells.forEach((cell) => cell.courses.forEach((course) => { if (!names.includes(course.name)) names.push(course.name); }));
    return names.length;
  }

  private updatedLabel(meta?: ScheduleShareMeta): string {
    const label = shareTimeLabel(meta?.updatedAt ?? '');
    return label ? ` · 更新于 ${label}` : '';
  }

  // "ABCD EFGH": easier to read aloud and to type.
  private spaced(code: string): string {
    return code.length === 8 ? code.substring(0, 4) + ' ' + code.substring(4) : code;
  }

  private confirmRevoke(code: string): void {
    if (!code) return;
    AlertDialog.show({ title: '撤销分享码', message: '撤销后这个分享码立刻失效，已经保存了它的人不会再收到更新。',
      primaryButton: { value: '取消', action: () => undefined },
      secondaryButton: { value: '撤销', fontColor: '#B42318', action: () => { void this.model.revoke(code); } } });
  }

  private confirmRemove(schedule: SharedSchedule): void {
    AlertDialog.show({ title: '删除这份课表', message: `只删除保存在本机的「${sharedScheduleName(schedule)}」，不影响对方。`,
      primaryButton: { value: '取消', action: () => undefined },
      secondaryButton: { value: '删除', fontColor: '#B42318', action: () => this.model.remove(schedule.meta.code) } });
  }
}
