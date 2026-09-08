import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');
const source = readFileSync(new URL('../bridge/header.ts', import.meta.url), 'utf8');
function setup() {
  const routes = [], notifications = [], frames = [], subscribers = [];
  let more = 0, back = 0, routeChanged, mutation, hasHeader = true;
  const router = {currentRoute:{value:{path:'/home',fullPath:'/home',meta:{title:'首页'}}},
    push:value=>routes.push(value),back:()=>back++,afterEach:cb=>routeChanged=cb};
  const stores = new Map([['auth',{isLoggedIn:true,$subscribe:cb=>subscribers.push(cb)}],
    ['message',{unreadCount:3,directUnreadCount:2,$subscribe:cb=>subscribers.push(cb)}]]);
  const host = {history:{state:{}},CPUHarmony:{headerChanged:p=>notifications.push(JSON.parse(p))}};
  const doc = {body:{},querySelector:s=>s.includes('button')?{click:()=>more++}:hasHeader?{}:null};
  const context = vm.createContext({module:{exports:{}},window:host,document:doc,
    require:()=>({liveApp:()=>({config:{globalProperties:{$router:router,$pinia:{_s:stores}}}})}),
    requestAnimationFrame:cb=>frames.push(cb),MutationObserver:class {constructor(cb){mutation=cb;}observe(){}},
  });
  vm.runInContext(transformSync(source,{loader:'ts',format:'cjs'}).code,context);
  return {api:context.module.exports,router,stores,host,doc,routes,notifications,subscribers,
    more:()=>more,back:()=>back,route:()=>routeChanged(),mutate:()=>mutation(),hide:()=>hasHeader=false,
    flush:()=>{while(frames.length)frames.shift()();}};
}
test('native titles track routes and preserve pages with their own header',()=>{
  const h=setup(); h.api.installHarmonyHeader(); h.api.installHarmonyHeader();
  assert.equal(h.notifications.length,1); assert.equal(h.subscribers.length,2);
  assert.equal(h.notifications[0].title,'药大拾间'); assert.equal(h.notifications[0].back,false);
  h.router.currentRoute.value={path:'/messages',meta:{title:'消息中心'}};h.route();h.flush();
  assert.equal(h.notifications.at(-1).title,'消息中心'); assert.equal(h.notifications.at(-1).back,true);
  h.hide();h.mutate();h.flush(); assert.equal(h.notifications.at(-1).visible,false);
});
test('account and unread updates reach native chrome without leaking counts after logout',()=>{
  const h=setup();h.api.installHarmonyHeader();assert.equal(h.notifications.at(-1).unread,3);
  h.stores.get('message').unreadCount=0;h.subscribers[1]();h.flush();assert.equal(h.notifications.at(-1).unread,0);
  h.stores.get('auth').isLoggedIn=false;h.subscribers[0]();h.flush();
  assert.equal(h.notifications.at(-1).authenticated,false);assert.equal(h.notifications.at(-1).directUnread,0);
});
test('native actions use live message state, route history and existing configured shortcuts',()=>{
  const h=setup();const act=a=>h.api.runHeaderAction(a,'/services',h.router,h.stores);
  act('messages');assert.equal(h.routes.at(-1),'/messages?tab=private');
  h.stores.get('message').directUnreadCount=0;act('messages');assert.equal(h.routes.at(-1),'/messages');
  act('back');assert.equal(h.routes.at(-1),'/services');assert.equal(h.back(),0);
  h.host.history.state.back='/home';act('back');assert.equal(h.back(),1);
  act('more');assert.equal(h.more(),1);
  h.stores.get('auth').isLoggedIn=false;act('messages');assert.equal(h.routes.at(-1),'/login');
});
