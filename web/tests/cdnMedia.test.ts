import assert from "node:assert/strict";
import test from "node:test";
import { cdnImageUrl, directMediaUrl, withMediaRevision } from "../src/utils/cdnMedia";

test("avatars use the server storage resolver instead of the static mirror", () => {
  const avatar = "/uploads/avatars/7/new-avatar.jpg";
  assert.equal(directMediaUrl(avatar), avatar);
  assert.equal(cdnImageUrl(avatar, { width: 240, quality: 84 }), `${avatar}?image_width=240&image_quality=84`);
});

test("a newly saved avatar keeps its revision on the server storage URL", () => {
  const avatar = withMediaRevision("/uploads/avatars/7/new-avatar.jpg", 12345);
  assert.equal(
    cdnImageUrl(avatar, { width: 96 }),
    "/uploads/avatars/7/new-avatar.jpg?media_rev=12345&image_width=96&image_quality=80",
  );
});

test("all managed uploads follow the server storage resolver", () => {
  assert.equal(
    directMediaUrl("/uploads/forum/example image.png"),
    "/uploads/forum/example image.png",
  );
});

test("managed images request provider-independent thumbnails", () => {
  assert.equal(
    cdnImageUrl("/uploads/forum/example.png", { width: 640, quality: 82 }),
    "/uploads/forum/example.png?image_width=640&image_quality=82",
  );
});

test("media revisions replace earlier revisions and preserve fragments and relative URLs", () => {
  assert.equal(withMediaRevision("avatar.jpg?media_rev=old#preview", "new"), "avatar.jpg?media_rev=new#preview");
  assert.equal(withMediaRevision("data:image/png;base64,test", 1), "data:image/png;base64,test");
  assert.equal(cdnImageUrl("/uploads/forum/animation.gif", {width:320}), "/uploads/forum/animation.gif");
  assert.equal(cdnImageUrl("https://external.example/image.jpg", {width:320}), "https://external.example/image.jpg");
});
