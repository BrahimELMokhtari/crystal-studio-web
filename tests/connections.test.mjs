import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCustomBonds,getDisplayBonds,remapCustomBonds,validateProject,validateStructure,MAX_MANUAL_BONDS} from '../frontend/model.js';

const zero = [0,0,0];
const connection = (i,j) => ({i,j,shift:[...zero]});
function structure() {
  const positions=[[.1,0,0],[9.9,0,0],[.3,.2,0]];
  return {schemaVersion:1,name:'Synthetic connection regression',formula:'H3',
    cell:{vectors:[[10,0,0],[0,10,0],[0,0,10]],lengths:[10,10,10],angles:[90,90,90],volume:1000,periodic:true},
    atoms:positions.map((position,id)=>({id,element:'H',fractional:position.map(n=>n/10),position,covalentRadius:.31,vdwRadius:1.2,occupancy:1})),
    bonds:[
      {i:0,j:1,shift:[-1,0,0],start:[...positions[0]],end:[-.1,0,0],distance:.2},
      {i:0,j:2,shift:[0,0,0],start:[...positions[0]],end:[...positions[2]],distance:Math.hypot(.2,.2)}
    ],elements:[{symbol:'H',count:3,color:'#ffffff'}],
    source:{filename:'synthetic',format:'example',description:'Synthetic geometry for connection behavior tests.'},warnings:[]};
}
function settings(overrides={}) {
  return {representation:'ball-stick',atomScale:1,bondScale:1.1,repetitions:[1,1,1],
    background:'dark',colors:{},showCell:true,showAxes:true,showPeriodic:true,showLegend:true,
    connectionMode:'both',customBonds:[connection(2,0),connection(1,0)],...overrides};
}
function project(overrides={}) {
  const unit=structure();
  return {format:'crystal-studio-project',version:1,unit,view:structuredClone(unit),settings:settings(overrides)};
}
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-10,a+' != '+b);

test('reversed manual pair deduplicates against an automatic direct contact without losing a periodic image',()=>{
  const model=validateStructure(structure()),s=settings(),copy=structuredClone({model,s});
  const bonds=getDisplayBonds(model,s);
  assert.equal(bonds.length,3);
  assert.equal(bonds.filter(b=>b.i===0&&b.j===2&&b.shift.every(n=>n===0)).length,1);
  assert.equal(bonds.filter(b=>b.manual).length,1);
  assert.deepEqual(bonds[0].shift,[-1,0,0]);assert.deepEqual(bonds[0].end,[-.1,0,0]);
  const manual=bonds.find(b=>b.manual);
  assert.deepEqual([manual.i,manual.j],[1,0]);assert.deepEqual(manual.shift,zero);
  assert.deepEqual(manual.start,[9.9,0,0]);assert.deepEqual(manual.end,[.1,0,0]);close(manual.distance,9.8);
  assert.deepEqual({model,s},copy);
});

test('deduplication also handles a reversed automatic direct pair',()=>{
  const model=structure(),direct=model.bonds[1];
  model.bonds[1]={...direct,i:direct.j,j:direct.i,start:[...direct.end],end:[...direct.start]};
  validateStructure(model);
  const bonds=getDisplayBonds(model,settings({customBonds:[connection(0,2)]}));
  assert.equal(bonds.length,2);assert.equal(bonds.filter(b=>b.manual).length,0);
});

test('periodic visibility hides image contacts while preserving direct manual connections',()=>{
  const bonds=getDisplayBonds(structure(),settings({showPeriodic:false}));
  assert.equal(bonds.length,2);assert.ok(bonds.every(b=>b.shift.every(n=>n===0)));
  assert.equal(bonds.filter(b=>b.manual).length,1);
  assert.ok(bonds.some(b=>b.i===1&&b.j===0&&b.manual));
});

test('manual-only mode renders supplied connections and automatic mode ignores them',()=>{
  const model=structure();
  const manual=getDisplayBonds(model,settings({connectionMode:'manual',showPeriodic:false}));
  assert.equal(manual.length,2);assert.ok(manual.every(b=>b.manual&&b.shift.every(n=>n===0)));
  close(manual.find(b=>b.i===2&&b.j===0).distance,Math.hypot(.2,.2));
  assert.deepEqual(getDisplayBonds(model,settings({connectionMode:'automatic'})),model.bonds);
  assert.deepEqual(getDisplayBonds(model,settings({connectionMode:'manual',customBonds:[]})),[]);
  assert.throws(()=>getDisplayBonds(model,settings({connectionMode:'unexpected'})),/mode/);
});

test('custom connections reject self pairs, invalid IDs, periodic shifts and coincident geometry',()=>{
  const model=structure();
  for(const bond of [null,connection(0,0),connection(-1,1),connection(0,3),connection(0,.5),connection('0',1),connection(false,1),
    {i:0,j:1},{i:0,j:1,shift:[0,0]},{i:0,j:1,shift:[1,0,0]},{i:0,j:1,shift:[0,NaN,0]},{i:0,j:1,shift:['0',0,0]}]) {
    assert.throws(()=>validateCustomBonds([bond],model),/different displayed atoms/);
  }
  for(const value of [null,{},'0:1']) assert.throws(()=>validateCustomBonds(value,model),/2,000/);
  assert.throws(()=>validateCustomBonds([connection(0,1),connection(1,0)],model),/Duplicate/);
  model.atoms[1].position=[...model.atoms[0].position];
  assert.throws(()=>validateCustomBonds([connection(0,1)],model),/Coincident/);
});

test('manual endpoint geometry is calculated from atom positions rather than stored endpoint fields',()=>{
  const model=structure(),pair={...connection(0,2),start:[999,999,999],end:[999,999,999],distance:999};
  const [result]=getDisplayBonds(model,settings({connectionMode:'manual',customBonds:[pair]}));
  assert.deepEqual(result.start,model.atoms[0].position);assert.deepEqual(result.end,model.atoms[2].position);close(result.distance,Math.hypot(.2,.2));
});

test('saved new settings and legacy projects without connection fields both validate',()=>{
  const current=project();assert.equal(validateProject(current),current);
  const decoded=JSON.parse(JSON.stringify(current));assert.equal(validateProject(decoded),decoded);
  assert.equal(getDisplayBonds(decoded.view,decoded.settings).length,3);
  const legacy=project();delete legacy.settings.connectionMode;delete legacy.settings.customBonds;
  const before=structuredClone(legacy);assert.equal(validateProject(legacy),legacy);
  assert.deepEqual(getDisplayBonds(legacy.view,legacy.settings),legacy.view.bonds);
  assert.deepEqual(legacy,before);
});

test('project loading rejects invalid or duplicate manual connections even when automatic mode is selected',()=>{
  for(const mutate of [
    p=>p.settings.connectionMode='other',
    p=>p.settings.customBonds=[connection(0,8)],
    p=>p.settings.customBonds=[connection(1,1)],
    p=>p.settings.customBonds=[connection(0,1),connection(1,0)],
    p=>p.settings.customBonds=[{i:0,j:1,shift:[0,0,1]}],
    p=>p.settings.customBonds='not an array'
  ]) {const p=project({connectionMode:'automatic'});mutate(p);assert.throws(()=>validateProject(p));}
});

test('manual collection and combined display limits prevent excessive connection allocation',()=>{
  const atoms=Array.from({length:65},(_,i)=>({position:[i,0,0]})),model={atoms,bonds:[]};
  const pairs=[];
  for(let i=0;i<atoms.length;i++)for(let j=i+1;j<atoms.length;j++)pairs.push(connection(i,j));
  assert.equal(MAX_MANUAL_BONDS,2000);assert.equal(validateCustomBonds(pairs.slice(0,2000),model).length,2000);
  assert.throws(()=>validateCustomBonds(pairs.slice(0,2001),model),/2,000/);
  const bounded=structure();bounded.bonds=Array.from({length:20000},()=>structuredClone(bounded.bonds[0]));
  assert.equal(getDisplayBonds(bounded,settings({connectionMode:'automatic',customBonds:[]})).length,20000);
  assert.throws(()=>getDisplayBonds(bounded,settings({customBonds:[connection(0,1)]})),/20,000/);
});

test('supercell remapping preserves physical tile identity when new dimensions alter displayed IDs',()=>{
  // Old tile order:000,001,010,011,100,101,110,111; each has two atoms.
  // New tile order:000,001,002,100,101,102.
  const bonds=[connection(0,1),connection(3,8),connection(8,11),connection(5,9)];
  const before=structuredClone(bonds),mapped=remapCustomBonds(bonds,2,[2,2,2],[2,1,3]);
  assert.deepEqual(mapped,[connection(0,1),connection(3,6),connection(6,9)]);
  assert.deepEqual(bonds,before);
});

test('growing supercells retain connections without automatically copying them into new tiles',()=>{
  const bonds=[connection(0,4),connection(3,7)];
  const expanded=remapCustomBonds(bonds,2,[1,2,2],[2,3,4]);
  assert.deepEqual(expanded,[connection(0,8),connection(3,11)]);
  assert.deepEqual(remapCustomBonds(expanded,2,[2,3,4],[1,2,2]),bonds);
  assert.deepEqual(remapCustomBonds([],2,[1,1,1],[4,4,4]),[]);
});

test('shrinking removes precisely the pairs with at least one endpoint outside the new cell',()=>{
  const bonds=[connection(0,1),connection(1,2),connection(2,3),connection(4,5)];
  assert.deepEqual(remapCustomBonds(bonds,2,[3,1,1],[1,1,1]),[connection(0,1)]);
  assert.deepEqual(remapCustomBonds(bonds,2,[3,1,1],[3,1,1]),bonds);
});

