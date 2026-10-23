import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sceneContext } from './helpers/campus3dScene.mjs';

const world=sceneContext();
world.run(`
  const graduate=BLD.find(b=>b.cls.special==='graduate');
  const safety=BLD.find(b=>b.cls.special==='coveredLab');
  OWNER=BLD.indexOf(graduate);buildGraduate(graduate);
  OWNER=BLD.indexOf(safety);buildCoveredLab(safety);
  BLD.forEach((b,i)=>BGRID.add(i,b.bb));
`);
const m=world.run('({BLD,BUFS,graduate,safety,labelHidden})');
world.ctx.camera={position:new THREE.Vector3()};
const meshes=Object.values(m.BUFS).map(b=>new THREE.Mesh(b.geo(),new THREE.MeshBasicMaterial({side:THREE.DoubleSide})));
meshes.forEach(mesh=>mesh.updateMatrixWorld());
function check(a,b,expected,own=[]) {
  world.ctx.camera.position.set(...a);
  const target=new THREE.Vector3(...b),direction=target.clone().sub(world.ctx.camera.position),length=direction.length();
  const ray=new THREE.Raycaster(world.ctx.camera.position,direction.normalize(),0,length*.97);
  if(!own.length)assert.equal(ray.intersectObjects(meshes,false).length>0,expected,'fixture agrees with actual rendered walls');
  assert.equal(m.labelHidden({obj:{position:target},place:{bld:own}}),expected);
}

test('labels can be seen above the low residence link, but remain hidden behind its solid walls',()=>{
  check([500,12,-336],[565,12,-336],false);
  check([500,1.65,-336],[565,1.65,-336],true);
  check([500,12,-375],[590,12,-375],true);
  check([500,12,-375],[590,12,-375],false,[m.BLD.indexOf(m.graduate)]);
});

test('labels remain visible through the ground passage and hidden by its upper connection',()=>{
  check([-244,1.65,-317.05],[-226,1.65,-317.05],false);
  check([-244,6,-317.05],[-226,6,-317.05],true);
  check([-244,1.65,-321],[-226,1.65,-321],true);
});

test.after(()=>meshes.forEach(mesh=>{mesh.geometry.dispose();mesh.material.dispose();}));
