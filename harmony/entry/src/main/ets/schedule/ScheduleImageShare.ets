import fs from '@ohos.file.fs';
import fileUri from '@ohos.file.fileuri';
import image from '@ohos.multimedia.image';
import common from '@ohos.app.ability.common';
import { systemShare } from '@kit.ShareKit';
import { uniformTypeDescriptor } from '@kit.ArkData';

/**
 * Draws `builder` off screen (componentSnapshot), saves it as a PNG in the cache and opens the
 * system share panel with it. Resolves to '' or a message to show.
 */
export async function shareSnapshotImage(context: common.UIAbilityContext, ui: UIContext, builder: CustomBuilder,
  name: string): Promise<string> {
  let pixels: image.PixelMap | undefined = undefined;
  const packer = image.createImagePacker();
  try {
    pixels = await ui.getComponentSnapshot().createFromBuilder(builder, 320, true);
    const data = await packer.packToData(pixels, { format: 'image/png', quality: 100 });
    const directory = context.cacheDir + '/share';
    if (!fs.accessSync(directory)) fs.mkdirSync(directory);
    const path = `${directory}/${name}`;
    const file = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    try { fs.writeSync(file.fd, data); } finally { fs.closeSync(file); }
    const shared = new systemShare.SharedData({ utd: uniformTypeDescriptor.UniformDataType.PNG, uri: fileUri.getUriFromPath(path) });
    const controller = new systemShare.ShareController(shared);
    await controller.show(context, { selectionMode: systemShare.SelectionMode.SINGLE,
      previewMode: systemShare.SharePreviewMode.DETAIL });
    return '';
  } catch (_) {
    return '分享图片暂时生成不了，请重试';
  } finally {
    void packer.release();
    if (pixels) void pixels.release();
  }
}
