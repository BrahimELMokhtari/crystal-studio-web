import test from 'node:test';
import assert from 'node:assert/strict';
import {atomRenderRadius,validateProject} from '../frontend/model.js';
import {buildManualStructure} from '../frontend/manual.js';
import {ELEMENT_SYMBOLS} from '../frontend/element-data.js';
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,actual+' != '+expected);
const atoms={
  H:{element:'H',covalentRadius:.31,vdwRadius:1.2},
  Na:{element:'Na',covalentRadius:1.66,vdwRadius:2.27},
  Cl:{element:'Cl',covalentRadius:1.02,vdwRadius:1.75},
};
function project() {
  const unit=buildManualStructure({name:'Synthetic independent element sizes',lengths:[10,10,10],angles:[90,90,90],atoms:[
    {element:'H',fractional:[.1,.1,.1]},{element:'Na',fractional:[.4,.4,.4]},{element:'Cl',fractional:[.7,.7,.7]}]});
  return {format:'crystal-studio-project',version:1,unit,view:structuredClone(unit),settings:{
    representation:'ball-stick',atomScale:1.25,bondScale:1.1,repetitions:[1,1,1],background:'dark',colors:{},
    showCell:true,showAxes:true,showPeriodic:true,showLegend:true,connectionMode:'manual',customBonds:[{i:0,j:1,shift:[0,0,0]}],
    elementScales:{Na:1.8,Cl:.6}}};
}

test('per-element scales change only their own elements and multiply global atom size',()=>{
  const settings={representation:'ball-stick',atomScale:1.25,elementScales:{Na:1.8,Cl:.6}};
  const atomSnapshot=structuredClone(atoms);
  close(atomRenderRadius(atoms.Na,settings),1.66*.32*1.25*1.8);
  close(atomRenderRadius(atoms.Cl,settings),1.02*.32*1.25*.6);
  close(atomRenderRadius(atoms.H,settings),.31*.32*1.25);
  const previousCl=atomRenderRadius(atoms.Cl,settings),previousH=atomRenderRadius(atoms.H,settings);
  settings.elementScales.Na=.2;
  close(atomRenderRadius(atoms.Na,settings),1.66*.32*1.25*.2);
  assert.equal(atomRenderRadius(atoms.Cl,settings),previousCl);
  assert.equal(atomRenderRadius(atoms.H,settings),previousH);
  assert.deepEqual(atoms,atomSnapshot);
});

test('each representation uses its own scientific radius while ghosts and selected outlines share element scale',()=>{
  const settings={atomScale:1.6,elementScales:{Na:2.1}};
  const factor=1.6*2.1;
  for(const [representation,base] of [['ball-stick',1.66*.32],['spheres',1.66*.65],['spacefill',2.27],['bonds',1.66*.32]]) {
    const s={...settings,representation};
    close(atomRenderRadius(atoms.Na,s),base*factor);
    close(atomRenderRadius(atoms.Na,s,{selected:true}),base*factor*1.08);
    close(atomRenderRadius(atoms.Na,s,{ghost:true}),1.66*.26*factor);
    close(atomRenderRadius(atoms.Na,s,{ghost:true,selected:true}),1.66*.26*factor*1.08);
  }
});

test('legacy settings without element sizes keep previous global and representation radii',()=>{
  for(const atom of Object.values(atoms)) {
    close(atomRenderRadius(atom,{representation:'ball-stick',atomScale:1}),atom.covalentRadius*.32);
    close(atomRenderRadius(atom,{representation:'spheres',atomScale:2}),atom.covalentRadius*.65*2);
    close(atomRenderRadius(atom,{representation:'spacefill',atomScale:.4}),atom.vdwRadius*.4);
    close(atomRenderRadius(atom,{representation:'ball-stick',atomScale:1},{selected:true}),atom.covalentRadius*.32*1.08);
  }
});

test('independent sizes survive project JSON persistence without changing atomic geometry or connections',()=>{
  const p=project(),scientific=structuredClone({unit:p.unit,view:p.view}),saved=JSON.stringify(p);
  const restored=validateProject(JSON.parse(saved));
  assert.deepEqual(restored.settings.elementScales,{Na:1.8,Cl:.6});
  assert.deepEqual({unit:restored.unit,view:restored.view},scientific);
  assert.deepEqual(restored.settings.customBonds,[{i:0,j:1,shift:[0,0,0]}]);
  for(const atom of restored.view.atoms)close(atomRenderRadius(atom,restored.settings),atomRenderRadius(atom,p.settings));
  const legacy=project();delete legacy.settings.elementScales;
  assert.equal(validateProject(legacy),legacy);
  assert.equal(legacy.settings.elementScales,undefined);
});

test('element size project mappings accept boundary factors and all118 actual symbols',()=>{
  const p=project();p.settings.elementScales={H:.2,Na:3,Og:.4};
  assert.equal(validateProject(p),p);
  close(atomRenderRadius(atoms.H,p.settings),.31*.32*1.25*.2);
  close(atomRenderRadius(atoms.Na,p.settings),1.66*.32*1.25*3);
  p.settings.elementScales=Object.fromEntries(ELEMENT_SYMBOLS.map((symbol,index)=>[symbol,index%2?.2:3]));
  assert.equal(Object.keys(p.settings.elementScales).length,118);assert.equal(validateProject(p),p);
  p.settings.elementScales={};assert.equal(validateProject(p),p);
});

test('project loading rejects non-mapping sizes, fake symbols, coercions and nonfinite or out-of-range factors',()=>{
  for(const mapping of [null,[],[1],true,false,1,'H:1']) {
    const p=project();p.settings.elementScales=mapping;assert.throws(()=>validateProject(p),/Element sizes/);
  }
  for(const scale of [.199999,3.000001,0,-1,NaN,Infinity,-Infinity,'1',true,false,null,undefined]) {
    const p=project();p.settings.elementScales={H:scale};assert.throws(()=>validateProject(p),/Element sizes/);
  }
  for(const symbol of ['X','D','Qq','na','NA','H1','constructor','__proto__','<img>']) {
    const p=project();p.settings.elementScales=Object.fromEntries([[symbol,1]]);assert.throws(()=>validateProject(p),/Element sizes/);
  }
});

