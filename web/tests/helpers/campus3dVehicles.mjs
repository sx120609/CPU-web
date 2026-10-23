import * as THREE from 'three';
import {sceneContext} from './campus3dScene.mjs';

// Real vehicle meshes, entry/exit logic, physics, terrain and collision grids.
// Audio hardware, DOM HUD and underwater rendering are outside this harness.
export function vehicleScene({touch=false}={}) {
  const world=sceneContext({
    variables:['WALK','WALK_R','MOVE','DRIVE','VEH_FOCUS','RIDE','limbTo','BUSH_GRID','CHUNKS','LIFE_ON','CARS','walkForward','angDiff'],
    omitFunctions:['walkHud','walkSound','walkAudioWake','driveSound','setUnderwater','toast'],
    globals:{matchMedia:query=>({matches:touch&&query==='(pointer: coarse)'}),HTMLElement:class{},ICE:null,LOCK_EL:{focus(){}},walkHud(){},walkSound(){},walkAudioWake(){},driveSound(){},setUnderwater(){},toast(){},mode:'walk',camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3()}},
  });
  const elements=new Map();
  world.ctx.root.querySelector=key=>{
    if(!elements.has(key))elements.set(key,{hidden:false,classList:{toggle(){},add(){},remove(){}},setAttribute(){},textContent:''});
    return elements.get(key);
  };
  world.run(`buildBuildings();buildBridges();buildBikes();buildCars();collisionGrids();BLD.forEach((b,i)=>BGRID.add(i,b.bb));
    if(typeof rebuildPropGrid==='function')rebuildPropGrid();
    else PROPS.forEach((q,i)=>{q.bb=pBox(q.p);q.skip=groundAt(...q.c)>.02;if(!q.skip)PGRID.add(i,q.bb);});`);
  const model=world.run('({D,CARS,BIKE_SPOTS,BIKE_CHUNKS,DRIVE,RIDE,WALK,BRIDGES,PROPS,WSEG,WGRID,PGRID,BLD,groundAt,inCampus,inWater,walkResolve,walkSpot,floorAt,nearCar,nearBike,enterCar,exitCar,enterBike,exitBike,updateWalk,updateDrive,updateRide,vehicleThreat,camBlocked,pCentroid,pArea,pip,rectPoly,bikeSlot,collisionGrids,cumLen,sampleAt})');
  return {...world,model,elements};
}
