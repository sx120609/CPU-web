import photoAccessHelper from '@ohos.file.photoAccessHelper';
import fs from '@ohos.file.fs';
import image from '@ohos.multimedia.image';
import util from '@ohos.util';

// 截图识别: the screenshot the user picks, shrunk to a JPEG `data:` URL small enough to send to 拾间AI
// through the page. Long screenshots keep their width and shrink by height; the server also caps at 4096.
const MAX_WIDTH = 1280;
const MAX_HEIGHT = 4096;
const MAX_BYTES = 2500000;

/** The picked image's uri; empty when the user backs out. */
export async function pickAgendaScreenshot(): Promise<string> {
  const picker = new photoAccessHelper.PhotoViewPicker();
  const options = new photoAccessHelper.PhotoSelectOptions();
  options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
  options.maxSelectNumber = 1;
  const result = await picker.select(options);
  return result.photoUris.length ? result.photoUris[0] : '';
}

/** The image at `uri` as a JPEG `data:` URL; throws when it cannot be read. */
export async function agendaImageDataUrl(uri: string): Promise<string> {
  const file = fs.openSync(uri, fs.OpenMode.READ_ONLY);
  const source = image.createImageSource(file.fd);
  const packer = image.createImagePacker();
  try {
    const info = await source.getImageInfo();
    const ratio = Math.min(1, MAX_WIDTH / info.size.width, MAX_HEIGHT / info.size.height);
    const size: image.Size = {
      width: Math.max(1, Math.round(info.size.width * ratio)),
      height: Math.max(1, Math.round(info.size.height * ratio))
    };
    const pixels = await source.createPixelMap({ desiredSize: size });
    let quality = 88;
    let data = await packer.packToData(pixels, { format: 'image/jpeg', quality: quality });
    while (data.byteLength > MAX_BYTES && quality > 50) {
      quality -= 10;
      data = await packer.packToData(pixels, { format: 'image/jpeg', quality: quality });
    }
    void pixels.release();
    return 'data:image/jpeg;base64,' + new util.Base64Helper().encodeToStringSync(new Uint8Array(data));
  } finally {
    void packer.release();
    void source.release();
    fs.closeSync(file);
  }
}
