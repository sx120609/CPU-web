import assert from "node:assert/strict";
import test from "node:test";
import { preloadAvatar } from "../src/utils/avatarPreview";
test("avatar preview distinguishes a saved but unavailable image from a loaded image",async(t)=>{
  const previousWindow = (globalThis as any).window;
  const previousImage = (globalThis as any).Image;
  (globalThis as any).window={setTimeout,clearTimeout};
  (globalThis as any).Image=class {
    naturalWidth=320;
    onload: null | (()=>void)=null;
    onerror: null | (()=>void)=null;
    set src(value:string) { queueMicrotask(()=>value.includes("missing") ? this.onerror?.() : this.onload?.()); }
  };
  t.after(()=>{(globalThis as any).window=previousWindow;(globalThis as any).Image=previousImage;});
  assert.equal(await preloadAvatar("/uploads/avatars/7/image.jpg"),true);
  assert.equal(await preloadAvatar("/uploads/avatars/7/missing.jpg"),false);
  assert.equal(await preloadAvatar(null),false);
});
