import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from '../../server/node_modules/typescript/lib/typescript.js';

const source=readFileSync(new URL('../src/views/services/campus3d/app.js',import.meta.url),'utf8');
const tree=ts.createSourceFile('app.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const body=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='mountCampus3D').body;
const fn=name=>body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(tree);
function harness(touch=false){
  const elements=new Map(),events=new Map(),focusRoot={activeElement:null},state={unlocks:0,locks:0,focus:0,released:[],driveFrames:0,rideFrames:0,audio:0};
  const get=id=>{
    if(!elements.has(id))elements.set(id,{hidden:true,open:false,textContent:'',attrs:{},listeners:{},
      classList:{toggle(){},remove(){}},setAttribute(k,v){this.attrs[k]=v;},
      addEventListener(k,f){this.listeners[k]=f;},showModal(){this.open=true;},close(){this.open=false;},
      focus(){state.focus++;focusRoot.activeElement=this;},getRootNode:()=>focusRoot,
      click(){this.listeners.click?.({currentTarget:this});},
    });
    return elements.get(id);
  };
  const ctx=vm.createContext({
    mode:'walk',DISPOSED:false,TOUCH:touch,CLEANUP:[],
    WALK:{menu:false,noLock:true,locked:false,inspect:false,sound:!touch,keys:new Set(['KeyW']),pad:{x:.7,y:-1},jumpBuf:.15,zoomOn:true,x:1,y:0,z:2,yaw:0,vx:3,vz:4,trans:null},
    DRIVE:{on:false,gas:true,brake:true,x:5,y:0,z:6,vx:9,vz:1,v:9,a:0,bodyMat:{color:{}}},RIDE:{on:false,x:7,y:0,z:8,hop:0,v:4,a:0,frameMat:{color:{}}},
    NET:{on:true,count:2,hidden:false,shirt:1},PRESENCE_API:{},
    WALK_PTR:new Map([[3,{}],[8,{}]]),
    LOCK_EL:{focus(){state.focus++;focusRoot.activeElement=this;},releasePointerCapture:id=>state.released.push(id)},
    $:get,walkUnlock:()=>state.unlocks++,walkLock:()=>state.locks++,
    stickEnd:()=>{ctx.WALK.pad.x=ctx.WALK.pad.y=0;ctx.WALK.padRun=false;},
    walkAudioWake:()=>state.audio++,toast(){},walkSound(){},walkInspect(){},
    updateDrive:()=>state.driveFrames++,updateRide:()=>state.rideFrames++,
    nearestPal:()=>2,angDiff:(a,b)=>a-b,
    window:{},on:(_target,type,callback)=>events.set(type,callback),performance:{now:()=>2000},
    setMode:mode=>{ctx.mode=mode;vm.runInContext('closeWalkSettings(false)',ctx);},
  });
  const handlers=source.slice(source.indexOf("$('#walkSettings').addEventListener"),source.indexOf('let TOUR ='));
  const keyboard=source.slice(source.indexOf('const keyTarget ='),source.indexOf("on(window, 'keyup'"));
  vm.runInContext(['netHud','netState','vehicleThreat','walkMotionPaused','walkHud','resetWalkInput','openWalkSettings','closeWalkSettings','keepWalkSettingsFocus','updateWalk'].map(fn).join('\n')+'\n'+handlers+'\n'+keyboard,ctx);
  return {ctx,state,get,events,run:code=>vm.runInContext(code,ctx)};
}

test('drag and touch settings clear held movement, pedals and captured gestures',()=>{
  for(const touch of [false,true]){
    const h=harness(touch);h.run('openWalkSettings()');
    assert.ok(h.ctx.WALK.menu&&h.get('#walkSettingsPanel').open);
    assert.equal(h.ctx.WALK.keys.size,0);assert.equal(h.ctx.WALK.jumpBuf,0);
    assert.deepEqual({...h.ctx.WALK.pad},{x:0,y:0});assert.equal(h.ctx.WALK_PTR.size,0);
    assert.deepEqual(h.state.released,[3,8]);assert.equal(h.ctx.DRIVE.gas,false);assert.equal(h.ctx.DRIVE.brake,false);
    assert.equal(h.get('#walkpad').hidden,true);assert.equal(h.get('#walkbtns').hidden,true);
    assert.equal(h.get('#walkSettings').attrs['aria-expanded'],'true');
    assert.equal(h.get('#walkSound').attrs['aria-pressed'],String(!touch));
  }
});

test('the settings pause freezes walkers, riders and drivers; resume restores the mode dispatcher',()=>{
  const h=harness();h.run('openWalkSettings()');
  for(const vehicle of [null,'RIDE','DRIVE']){
    h.ctx.RIDE.on=vehicle==='RIDE';h.ctx.DRIVE.on=vehicle==='DRIVE';
    const before=JSON.stringify([h.ctx.WALK.x,h.ctx.WALK.z,h.ctx.RIDE,h.ctx.DRIVE]);
    for(let i=0;i<120;i++)h.run('updateWalk(.05)');
    assert.equal(JSON.stringify([h.ctx.WALK.x,h.ctx.WALK.z,h.ctx.RIDE,h.ctx.DRIVE]),before);
  }
  assert.equal(h.state.driveFrames+h.state.rideFrames,0);
  h.get('#walkSettingsDone').click();h.run('updateWalk(.05)');
  assert.equal(h.state.driveFrames,1);assert.equal(h.ctx.WALK.menu,false);
  assert.equal(h.get('#walkSettingsPanel').open,false);assert.equal(h.state.focus,1);
});

test('loss of normal pointer lock also freezes a vehicle behind the pause panel',()=>{
  const h=harness();h.ctx.WALK.noLock=false;h.ctx.DRIVE.on=true;
  h.run('walkHud();updateWalk(.05)');
  assert.equal(h.get('#walkPause').hidden,false);assert.equal(h.state.driveFrames,0);
});

test('paused actors report zero animation speed and stationary vehicle avoidance while retaining their position',()=>{
  const h=harness();
  for(const vehicle of [null,'RIDE','DRIVE']){
    h.ctx.RIDE.on=vehicle==='RIDE';h.ctx.DRIVE.on=vehicle==='DRIVE';
    const before=h.run('netState()');assert.ok(before.every(Number.isFinite));assert.ok(before[6]>0);
    h.run('openWalkSettings()');const paused=h.run('netState()');
    assert.deepEqual(Array.from(paused.slice(0,6)),Array.from(before.slice(0,6)));
    assert.ok(paused.every(Number.isFinite));assert.equal(paused[6],0);
    if(vehicle)assert.equal(h.run('vehicleThreat()').sp,0);
    h.run('closeWalkSettings(true)');assert.ok(h.run('netState()')[6]>0);
  }
});

test('visibility and audio toggles remain truthful while the settings dialog is open',()=>{
  const h=harness(true);h.run('openWalkSettings()');
  h.get('#walkNet').click();assert.equal(h.ctx.NET.hidden,true);
  assert.equal(h.get('#walkNet').attrs['aria-pressed'],'false');assert.equal(h.get('#walkNet').textContent,'已隐身');
  h.get('#walkSound').click();assert.equal(h.ctx.WALK.sound,true);
  assert.equal(h.get('#walkSound').attrs['aria-pressed'],'true');assert.equal(h.state.audio,1);
  h.ctx.PRESENCE_API=null;h.run('netHud()');assert.equal(h.get('#walkNet').hidden,true);
});

test('dialog keys and focused controls cannot trigger movement or jumping',()=>{
  const h=harness();let prevented=0;
  const key=(code,tagName)=>h.events.get('keydown')({code,target:{tagName},preventDefault:()=>prevented++,repeat:false});
  h.run('openWalkSettings()');key('KeyW','BUTTON');key('Space','BUTTON');key('Escape','BUTTON');
  assert.equal(h.ctx.WALK.keys.size,0);assert.equal(h.ctx.WALK.jumpBuf,0);assert.equal(prevented,0);
  h.run('closeWalkSettings(true)');key('Space','BUTTON');assert.equal(h.ctx.WALK.jumpBuf,0);
  key('Space','CANVAS');assert.equal(h.ctx.WALK.jumpBuf,.15);assert.equal(prevented,1);
});

test('Escape resumes through dialog cancellation, while Exit leaves exploration and closes the modal',()=>{
  const h=harness();h.run('openWalkSettings()');let prevented=false;
  h.get('#walkSettingsPanel').listeners.cancel({preventDefault:()=>prevented=true});
  assert.ok(prevented);assert.equal(h.ctx.mode,'walk');assert.equal(h.ctx.WALK.menu,false);
  h.run('openWalkSettings()');h.get('#walkSettingsExit').click();
  assert.equal(h.ctx.mode,'orbit');assert.equal(h.get('#walkSettingsPanel').open,false);
  assert.equal(h.get('#walkSettings').hidden,true);
  assert.equal(h.get('#walkSettingsPanel').getRootNode().activeElement,h.ctx.LOCK_EL,'exit focuses the map even when the small-screen toolbar is hidden');
});

test('Tab and Shift+Tab wrap at the dialog edges, including when networking is unavailable',()=>{
  const h=harness(),panel=h.get('#walkSettingsPanel');
  for(const id of ['#walkSound','#walkSettingsExit','#walkSettingsDone'])h.get(id).hidden=false;
  panel.querySelectorAll=()=>['#walkNet','#walkSound','#walkSettingsExit','#walkSettingsDone'].map(h.get).filter(el=>!el.hidden);
  for(const api of [{},null]){
    h.ctx.PRESENCE_API=api;h.run('netHud()');let prevented=0;
    h.get('#walkSettingsDone').focus();
    panel.listeners.keydown({key:'Tab',shiftKey:false,currentTarget:panel,preventDefault:()=>prevented++});
    assert.equal(panel.getRootNode().activeElement,h.get(api?'#walkNet':'#walkSound'));
    panel.listeners.keydown({key:'Tab',shiftKey:true,currentTarget:panel,preventDefault:()=>prevented++});
    assert.equal(panel.getRootNode().activeElement,h.get('#walkSettingsDone'));assert.equal(prevented,2);
  }
});
