import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');
const source = readFileSync(new URL('../bridge/shell.ts', import.meta.url), 'utf8');

function harness() {
  const items = []; const notifications = []; const frames = [];
  let mutation; let observers = 0;
  const doc = { body:{}, querySelectorAll:()=>items };
  const host = { CPUHarmony:{webOverlayChanged:value=>notifications.push(value)}, addEventListener(){} };
  const context=vm.createContext({module:{exports:{}},document:doc,window:host,
    getComputedStyle:item=>item.style,requestAnimationFrame:callback=>frames.push(callback),
    MutationObserver:class { constructor(callback){mutation=callback;observers++;} observe(){} },
  });
  vm.runInContext(transformSync(source,{loader:'ts',format:'cjs'}).code,context);
  return {api:context.module.exports,items,notifications,frames,mutate:()=>mutation(),observers:()=>observers};
}
const overlay = (style={}) => ({style:{display:'block',visibility:'visible',opacity:'1',...style},getClientRects:()=>[{}],getAttribute:()=>null});

test('closed and transparent web overlays do not hide native navigation',()=>{
  const h=harness();
  h.items.push(overlay({display:'none'}),overlay({visibility:'hidden'}),overlay({opacity:'0'}));
  assert.equal(h.api.hasVisibleWebOverlay(),false);
  h.items.push(overlay()); assert.equal(h.api.hasVisibleWebOverlay(),true);
});

test('opening and closing a web drawer changes native chrome once per visible state',()=>{
  const h=harness(); h.api.installHarmonyShellObserver(); h.api.installHarmonyShellObserver();
  assert.equal(h.observers(),1); assert.deepEqual(h.notifications,[false]);
  const drawer=overlay();h.items.push(drawer);
  for(let i=0;i<5;i++)h.mutate();assert.equal(h.frames.length,1);h.frames.shift()();
  assert.deepEqual(h.notifications,[false,true]);
  h.mutate();h.frames.shift()();assert.deepEqual(h.notifications,[false,true]);
  drawer.style.display='none';h.mutate();h.frames.shift()();
  assert.deepEqual(h.notifications,[false,true,false]);
});
