import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const sharp = require(path.join(root, "server", "node_modules", "sharp"));
const splashRoot = path.join(root, "web", "public", "splash");
const logoPath = path.join(root, "web", "public", "favicon.svg");

for (const fileName of (await readdir(splashRoot)).filter((name) => /^ios-launch-v4-\d+x\d+\.png$/u.test(name))) {
  const sourcePath = path.join(splashRoot, fileName);
  const { data, info } = await sharp(sourcePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      if (red > 70 || green < 95 || green > 180 || blue < 70 || blue > 175) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right <= left || bottom <= top) throw new Error(`Unable to locate launch logo in ${fileName}`);
  const width = right - left + 1;
  const height = bottom - top + 1;
  const logo = await sharp(logoPath).trim().resize(width, height, { fit: "fill" }).png().toBuffer();
  await sharp(sourcePath)
    .composite([{ input: logo, left, top }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(splashRoot, fileName.replace("ios-launch-v4-", "ios-launch-v6-")));
}
