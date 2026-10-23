// Execute the shipped geometry and collision builders without a browser or GPU.
// Text labels and roof equipment are omitted; walls, posts, caps, bridges and
// stairs execute unchanged. This verifies model behavior, not real-world access.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../../../server/node_modules/typescript/lib/typescript.js';
import * as THREE from 'three';
import * as metadata from '../../src/views/services/campus3d/placeMetadata.js';
import * as construction from '../../src/views/services/campus3d/constructionSites.js';
import * as research from '../../src/views/services/campus3d/researchCenters.js';
import * as graduate from '../../src/views/services/campus3d/graduateResidences.js';
import * as access from '../../src/views/services/campus3d/coveredAccess.js';
import * as pedestrians from '../../src/views/services/campus3d/pedestrianRoutes.js';

export function sceneContext({variables:extraVariables=[],omitFunctions:extraOmitted=[],globals={}}={}) {
  const base=new URL('../../src/views/services/campus3d/',import.meta.url);
  const source=readFileSync(new URL('app.js',base),'utf8');
  const tree=ts.createSourceFile('app.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const body=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='mountCampus3D').body;
  const variables=new Set(['BUFS','buf','OWNER','WSEG','WGRID','NOWALL','PROPS','REG','REGW','RW','PW','roadW',
    'GATE','gateP','gateRect','GATE_FORE','PLAZAS','STADIUM','COURTS','TRACK_FIELD','inWater','inCampus',
    'XY','XY_PODS','XY_LINKS','NO_TREE','FLAGS','STEP_SURF','BRIDGES','BRIDGE_SPEC','FENCE_RECTS',
    'BGRID','PGRID','segDist','COLLISION_INFO','TGRID','trunkR','onBridge','inRegion','walkable',
    'WATER_Y','frozen','isWet','canStand','pedBlocked','_m4','LIFE','PEOPLE','PED_GRID',...extraVariables]);
  const omitted=new Set(['addSign','textCanvas','roofClutter','academicRoof',...extraOmitted]);
  const ctx=vm.createContext({THREE,...metadata,...construction,...research,...graduate,...access,...pedestrians,
    opts:{data:JSON.parse(readFileSync(new URL('osm-data.json',base))),outer:JSON.parse(readFileSync(new URL('osm-outer.json',base)))},
    root:{querySelector(){}},matchMedia:()=>({matches:false}),navigator:{hardwareConcurrency:8},
    addSign(){},roofClutter(){},academicRoof(){},
    MAT:new Proxy({}, {get:(o,k)=>o[k]??=(new THREE.MeshStandardMaterial())}),
    TREES:[],LAMP_POS:[],CARS:null,NET:{others:new Map()},uTime:{value:0},
    WALK:{y:0,swim:false},WALK_R:.38,STEP_UP:.5,season:'summer',hour:12,scene:new THREE.Scene(),
    ...globals,
  });
  const declarations=body.statements.filter(n=>
    ts.isFunctionDeclaration(n)&&!omitted.has(n.name.text)||
    ts.isClassDeclaration(n)&&n.name.text==='GB'||
    ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>variables.has(d.name.getText(tree)))
  ).map(n=>n.getText(tree));
  vm.runInContext(source.slice(source.indexOf('const D ='),source.indexOf('const stage ='))+'\n'+declarations.join('\n'),ctx);
  return {ctx,run:code=>vm.runInContext(code,ctx),source};
}
