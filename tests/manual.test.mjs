import test from 'node:test';
import assert from 'node:assert/strict';
import {buildManualStructure, parseManualAtomRows} from '../frontend/manual.js';
import {ELEMENT_DATA, ELEMENT_SYMBOLS} from '../frontend/element-data.js';
import {validateStructure, validateProject} from '../frontend/model.js';

const base = overrides => ({name:'Synthetic manual NaCl', lengths:[5.64,5.64,5.64], angles:[90,90,90], atoms:[{element:'Na',fractional:[0,0,0],occupancy:1},{element:'Cl',fractional:[.5,.5,.5],occupancy:1}], ...overrides});
const close = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) < epsilon, actual + ' != ' + expected);

test('manual unit model is compatible with structure and project validation', () => {
  const model = buildManualStructure(base());
  assert.equal(validateStructure(model), model);
  assert.equal(model.formula, 'ClNa');
  assert.deepEqual(model.cell.vectors, [[5.64,0,0],[0,5.64,0],[0,0,5.64]]);
  assert.deepEqual(model.atoms[1].position, [2.82,2.82,2.82]);
  assert.deepEqual(model.repetitions, [1,1,1]);
  assert.equal(model.baseAtomCount,2);
  assert.equal(model.source.format,'manual');
  assert.match(model.source.description,/No symmetry operations/);
  assert.deepEqual(model.bonds,[]);
  assert.equal(model.contactsCalculated,false);
  assert.ok(model.warnings.some(w=>/Calculate contacts/.test(w)));
  const project = {format:'crystal-studio-project',version:1,unit:model,view:structuredClone(model),settings:{representation:'ball-stick',atomScale:1,bondScale:1.1,repetitions:[1,1,1],background:'dark',colors:{},showCell:true,showAxes:true,showPeriodic:true,showLegend:true}};
  assert.equal(validateProject(project),project);
});

test('triclinic vectors reproduce independent length, angle and fractional-coordinate geometry',()=>{
  const model=buildManualStructure(base({lengths:[4,5,6],angles:[80,75,120]}));
  const cell=model.cell.vectors;
  close(cell[1][0],-2.5); close(cell[1][1],5*Math.sqrt(3)/2);
  close(cell[2][0],6*Math.cos(75*Math.PI/180));
  const cosine=(u,v)=>u.reduce((s,n,i)=>s+n*v[i],0)/(Math.hypot(...u)*Math.hypot(...v));
  for(const [i,j,degrees] of [[1,2,80],[0,2,75],[0,1,120]]) close(cosine(cell[i],cell[j]),Math.cos(degrees*Math.PI/180));
  model.atoms[1].position.forEach((v,k)=>close(v,(cell[0][k]+cell[1][k]+cell[2][k])/2));
  close(model.cell.volume,4*5*6*Math.sqrt(1-Math.cos(80*Math.PI/180)**2-Math.cos(75*Math.PI/180)**2-Math.cos(120*Math.PI/180)**2+2*Math.cos(80*Math.PI/180)*Math.cos(75*Math.PI/180)*Math.cos(120*Math.PI/180)));
  validateStructure(model);
});

test('fractional endpoint1 wraps to0 without mutating input arrays',()=>{
  const input=base({atoms:[{element:'C',fractional:[1,1,.5],occupancy:1,label:'C1'}]});
  const copy=structuredClone(input),model=buildManualStructure(input);
  assert.deepEqual(input,copy);assert.deepEqual(model.atoms[0].fractional,[0,0,.5]);
  assert.equal(model.atoms[0].label,'C1');assert.ok(model.warnings.some(w=>/wrapped to 0/.test(w)));
  model.atoms[0].fractional[2]=.3;assert.equal(input.atoms[0].fractional[2],.5);
});

test('all118 actual symbols have bounded radii and valid palettes with honest late-element fallbacks',()=>{
  assert.equal(ELEMENT_SYMBOLS.length,118);assert.equal(ELEMENT_SYMBOLS[0],'H');assert.equal(ELEMENT_SYMBOLS.at(-1),'Og');
  const atoms=ELEMENT_SYMBOLS.map((element,i)=>({element,fractional:[i/118,.2,.3],occupancy:1}));
  const model=buildManualStructure(base({lengths:[1000,10,10],atoms}));
  assert.equal(model.elements.length,118);assert.equal(model.atoms.length,118);validateStructure(model);
  assert.equal(model.atoms[10].covalentRadius,1.66);assert.equal(model.atoms[10].vdwRadius,2.27);
  assert.equal(model.elements.find(e=>e.symbol==='Na').color,'#ab5cf2');
  assert.equal(ELEMENT_DATA.Og.covalentRadius,2);assert.equal(ELEMENT_DATA.Og.vdwRadius,3);assert.equal(ELEMENT_DATA.Og.color,'#909090');
  assert.ok(model.warnings.some(w=>/not a measured radius/.test(w)));
  assert.ok(model.warnings.some(w=>/1.5 times/.test(w)));
  assert.ok(model.warnings.some(w=>/neutral gray/.test(w)));
});

test('text rows parse decimal scientific notation, occupancy and comments with original line numbers',()=>{
  const atoms=parseManualAtomRows('# synthetic\n\nNa 0 0 0\nCl 5e-1 +.5 0.50 0.75 # representative site');
  assert.deepEqual(atoms[0],{element:'Na',fractional:[0,0,0],occupancy:1,lineNumber:3});
  assert.deepEqual(atoms[1],{element:'Cl',fractional:[.5,.5,.5],occupancy:.75,lineNumber:4});
  const model=buildManualStructure(base({atoms}));assert.equal(model.atoms[1].occupancy,.75);assert.equal(model.formula,'ClNa');
  assert.ok(model.warnings.some(w=>/not occupancy-weighted/.test(w)));
});

test('coincident periodic sites reject both same-element and mixed-element duplicates with row references',()=>{
  for(const element of ['Na','Cl']) {
    const atoms=parseManualAtomRows('Na 0 0 0\n# blank separator\n'+element+' 1 0 0');
    assert.throws(()=>buildManualStructure(base({atoms})),/rows 1 and 3.*same periodic site/);
  }
  assert.throws(()=>buildManualStructure(base({atoms:[{element:'H',fractional:[0,0,0]},{element:'H',fractional:[1e-10,0,0]}]})),/same periodic site/);
});

test('impossible, singular, oversized and nonnumeric cells are rejected',()=>{
  for(const lengths of [[0,5,5],[.49,5,5],[1001,5,5],[5,5],[5,Infinity,5],[5,NaN,5],['5',5,5],[true,5,5]]) assert.throws(()=>buildManualStructure(base({lengths})),/lengths/);
  for(const angles of [[0,90,90],[180,90,90],[90,NaN,90],['90',90,90],[90,90],[1,1,179],[90,90,.01]]) assert.throws(()=>buildManualStructure(base({angles})));
  assert.throws(()=>buildManualStructure(base({lengths:[1000,1000,1000],angles:[90,90,.01]})),/thin|singular/);
  assert.throws(()=>buildManualStructure(base({lengths:[.5,.5,.5],angles:[90,90,30]})),/thin|singular/);
});

test('invalid symbols, coordinates, occupancy, metadata and scale cannot produce a model',()=>{
  for(const element of ['X','D','T','na','NA','Qq','C1','<img>','constructor','__proto__']) assert.throws(()=>buildManualStructure(base({atoms:[{element,fractional:[0,0,0]}]})),/element/);
  for(const fractional of [[-1e-12,0,0],[1.01,0,0],[NaN,0,0],[Infinity,0,0],['.1',0,0],[0,0],null]) assert.throws(()=>buildManualStructure(base({atoms:[{element:'H',fractional}]})),/coordinates/);
  for(const occupancy of [0,-.1,1.01,NaN,Infinity,'1',false,null]) assert.throws(()=>buildManualStructure(base({atoms:[{element:'H',fractional:[0,0,0],occupancy}]})),/occupancy/);
  for(const bondScale of [0,2.01,Infinity,'1.1',false]) assert.throws(()=>buildManualStructure(base({bondScale})),/Bond scale/);
  for(const name of ['', ' '.repeat(20), 'n'.repeat(151),null,'bad\u0000name']) assert.throws(()=>buildManualStructure(base({name})),/name/);
  assert.throws(()=>buildManualStructure(base({atoms:[{element:'H',fractional:[0,0,0],label:'x'.repeat(81)}]})),/labels/);
});

test('malformed text reports its line instead of coercing partial or nondecimal numbers',()=>{
  for(const line of ['Na 0 0','Na 0 0 0 .5 extra','Na 0x1 0 0','Na 0.5junk 0 0','Na NaN 0 0','Na 1e999 0 0','Na 0 0 0 0','Qq 0 0 0','Na -0.1 0 0']) assert.throws(()=>parseManualAtomRows('# synthetic\n'+line),/row 2/);
  for(const value of ['', '# comments only', null]) assert.throws(()=>parseManualAtomRows(value));
  assert.throws(()=>parseManualAtomRows(' '.repeat(512*1024+1)),/512 KiB/);
});

test('atom limit permits2000 distinct sites and rejects2001 before geometric work',()=>{
  const atoms=Array.from({length:2000},(_,i)=>({element:'H',fractional:[i/2000,0,0]}));
  const model=buildManualStructure(base({lengths:[1000,10,10],atoms}));assert.equal(model.atoms.length,2000);assert.equal(model.formula,'H2000');
  atoms.push({element:'H',fractional:[.2,.2,.2]});assert.throws(()=>buildManualStructure(base({atoms})),/2,000/);
  assert.throws(()=>parseManualAtomRows(Array.from({length:2001},()=> 'H 0 0 0').join('\n')),/2,000/);
  assert.throws(()=>buildManualStructure(base({atoms:[]})),/2,000/);
});
