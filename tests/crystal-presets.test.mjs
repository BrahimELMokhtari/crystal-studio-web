import test from 'node:test';
import assert from 'node:assert/strict';
import {CRYSTAL_PRESETS, constrainPresetCell, referenceSites, getReferenceAtoms} from '../frontend/crystal-presets.js';
import {buildManualStructure} from '../frontend/manual.js';
import {ELEMENT_SYMBOLS} from '../frontend/element-data.js';
import {validateStructure} from '../frontend/model.js';

const input = () => ({lengths:[4.125,6.25,8.5],angles:[80,105,110]});
const close = (actual,expected,epsilon=1e-10) => assert.ok(Math.abs(actual-expected)<epsilon,actual+' != '+expected);
const defaults = id => CRYSTAL_PRESETS.find(preset=>preset.id === id);
const defaultSelections = (id,element='Si') => referenceSites(id).filter(site=>site.defaultSelected).map(site=>({siteId:site.id,element}));

test('the ten immutable presets expose honest geometry and independently editable parameters',()=>{
  assert.deepEqual(CRYSTAL_PRESETS.map(preset=>preset.id),['cubic','tetragonal','orthorhombic','hexagonal','trigonal','monoclinic','triclinic','fcc','bcc','simple-cubic']);
  const editable = {cubic:['a'],tetragonal:['a','c'],orthorhombic:['a','b','c'],hexagonal:['a','c'],trigonal:['a','alpha'],monoclinic:['a','b','c','beta'],triclinic:['a','b','c','alpha','beta','gamma'],fcc:['a'],bcc:['a'],'simple-cubic':['a']};
  for (const preset of CRYSTAL_PRESETS) {
    assert.deepEqual(preset.editable,editable[preset.id]);assert.equal(preset.group,['fcc','bcc','simple-cubic'].includes(preset.id)?'lattice':'system');assert.match(preset.help,/not Wyckoff/);assert.match(preset.help,/no space group/);
    assert.ok(Object.isFrozen(preset));assert.ok(Object.isFrozen(preset.defaults));assert.ok(Object.isFrozen(preset.defaults.lengths));
  }
  assert.match(defaults('trigonal').label,/rhombohedral axes/);assert.match(defaults('trigonal').help,/hexagonal axes/);
  assert.throws(()=>{defaults('cubic').defaults.lengths[0]=20;},TypeError);
});

test('cubic and centered cubic bases enforce equal lengths without changing their independent a',()=>{
  for (const id of ['cubic','fcc','bcc','simple-cubic']) {
    const original = input(), snapshot = structuredClone(original), cell = constrainPresetCell(id,original);
    assert.deepEqual(cell,{lengths:[4.125,4.125,4.125],angles:[90,90,90]});assert.deepEqual(original,snapshot);
    assert.notEqual(cell.lengths,original.lengths);assert.notEqual(cell.angles,original.angles);
  }
});

test('tetragonal and hexagonal preserve independent c while synchronizing only required metrics',()=>{
  assert.deepEqual(constrainPresetCell('tetragonal',input()),{lengths:[4.125,4.125,8.5],angles:[90,90,90]});
  assert.deepEqual(constrainPresetCell('hexagonal',input()),{lengths:[4.125,4.125,8.5],angles:[90,90,120]});
  // Editing templates allow special metrics; geometry alone does not classify a crystal.
  assert.deepEqual(constrainPresetCell('tetragonal',{lengths:[5,5,5],angles:[90,90,90]}).lengths,[5,5,5]);
});

test('orthorhombic, monoclinic and triclinic retain exactly their independent cell parameters',()=>{
  const original = input(), snapshot = structuredClone(original);
  assert.deepEqual(constrainPresetCell('orthorhombic',original),{lengths:[4.125,6.25,8.5],angles:[90,90,90]});
  assert.deepEqual(constrainPresetCell('monoclinic',original),{lengths:[4.125,6.25,8.5],angles:[90,105,90]});
  assert.deepEqual(constrainPresetCell('triclinic',original),original);assert.deepEqual(original,snapshot);
});

test('rhombohedral setting preserves a and alpha and rejects a degenerate common angle',()=>{
  assert.deepEqual(constrainPresetCell('trigonal',input()),{lengths:[4.125,4.125,4.125],angles:[80,80,80]});
  for (const angle of [120,140,179.9]) assert.throws(()=>constrainPresetCell('trigonal',{lengths:[5,6,7],angles:[angle,75,75]}),/rhombohedral/);
  const cell = constrainPresetCell('trigonal',defaults('trigonal').defaults);
  assert.deepEqual(cell.angles,[75,75,75]);
  // Ninety degrees is a valid metric specialization, not an inferred space group.
  assert.deepEqual(constrainPresetCell('trigonal',{lengths:[5,6,7],angles:[90,90,90]}).angles,[90,90,90]);
});

test('all eight references are unique modulo periodic boundaries and use canonical fractional coordinates',()=>{
  for (const preset of CRYSTAL_PRESETS) {
    const sites = referenceSites(preset.id);
    assert.equal(sites.length,8);assert.equal(new Set(sites.map(site=>site.id)).size,8);
    const fractionalKeys = sites.map(site=>site.fractional.map(value=>((value%1)+1)%1).join(','));
    assert.equal(new Set(fractionalKeys).size,8);
    for (const site of sites) assert.ok(site.fractional.every(value=>value>=0&&value<1));
    assert.deepEqual(sites.find(site=>site.id==='origin').fractional,[0,0,0]);
    assert.deepEqual(sites.find(site=>site.id==='body').fractional,[.5,.5,.5]);
    assert.deepEqual(sites.filter(site=>site.id.startsWith('edge-')).map(site=>site.fractional),[[.5,0,0],[0,.5,0],[0,0,.5]]);
  }
});

test('FCC, BCC and simple cubic default bases contain exactly four, two and one periodic sites',()=>{
  const fcc = getReferenceAtoms('fcc',defaultSelections('fcc','Cu'));
  const bcc = getReferenceAtoms('bcc',defaultSelections('bcc','Fe'));
  const simple = getReferenceAtoms('simple-cubic',defaultSelections('simple-cubic','Po'));
  assert.deepEqual(fcc.map(atom=>atom.fractional),[[0,0,0],[.5,.5,0],[.5,0,.5],[0,.5,.5]]);
  assert.deepEqual(bcc.map(atom=>atom.fractional),[[0,0,0],[.5,.5,.5]]);
  assert.deepEqual(simple.map(atom=>atom.fractional),[[0,0,0]]);
  for (const id of ['cubic','tetragonal','orthorhombic','hexagonal','trigonal','monoclinic','triclinic']) assert.equal(defaultSelections(id).length,1);
});

test('every default preset and its full reference set builds a scientifically coherent manual model',()=>{
  for (const preset of CRYSTAL_PRESETS) {
    const cell = constrainPresetCell(preset.id,preset.defaults);
    for (const selection of [defaultSelections(preset.id),referenceSites(preset.id).map(site=>({siteId:site.id,element:'Si'}))]) {
      const model = buildManualStructure({name:'Synthetic '+preset.label,...cell,atoms:getReferenceAtoms(preset.id,selection)});
      assert.equal(validateStructure(model),model);assert.equal(model.atoms.length,selection.length);assert.ok(model.cell.volume>0);
      assert.equal(model.source.format,'manual');assert.match(model.source.description,/No symmetry operations/);
      assert.deepEqual(model.bonds,[]);
    }
  }
});

test('hexagonal and rhombohedral cells reproduce the requested angles and conventional volumes',()=>{
  for (const id of ['hexagonal','trigonal']) {
    const cell = constrainPresetCell(id,defaults(id).defaults), model = buildManualStructure({name:'Synthetic '+id,...cell,atoms:getReferenceAtoms(id,defaultSelections(id))});
    const vectors = model.cell.vectors;
    const cosine = (u,v)=>u.reduce((sum,value,k)=>sum+value*v[k],0)/(Math.hypot(...u)*Math.hypot(...v));
    for (const [i,j,index] of [[1,2,0],[0,2,1],[0,1,2]]) close(cosine(vectors[i],vectors[j]),Math.cos(cell.angles[index]*Math.PI/180));
    const expected = id==='hexagonal' ? Math.sqrt(3)/2*5*5*8 : 5**3*Math.sqrt(1-3*Math.cos(75*Math.PI/180)**2+2*Math.cos(75*Math.PI/180)**3);
    close(model.cell.volume,expected);
  }
});

test('reference atom output preserves chosen elements, occupancy and order without aliasing caller data',()=>{
  const chosen = [{siteId:'body',element:'Li',occupancy:.5},{siteId:'origin',element:'B'}], snapshot = structuredClone(chosen);
  const atoms = getReferenceAtoms('bcc',chosen);
  assert.deepEqual(atoms,[{element:'Li',fractional:[.5,.5,.5],occupancy:.5,label:'Body center'},{element:'B',fractional:[0,0,0],occupancy:1,label:'Origin (corner)'}]);
  assert.deepEqual(chosen,snapshot);
  atoms[0].fractional[0]=.2;
  const sites = referenceSites('bcc');sites[0].fractional[0]=.7;
  assert.deepEqual(referenceSites('bcc')[0].fractional,[0,0,0]);assert.deepEqual(getReferenceAtoms('bcc',chosen)[0].fractional,[.5,.5,.5]);
  for (const element of ELEMENT_SYMBOLS) assert.equal(getReferenceAtoms('cubic',[{siteId:'origin',element}])[0].element,element);
});

test('cell constraints reject unknown presets, malformed vectors, coercions and impossible angular geometry',()=>{
  for (const id of ['custom','FCC','unknown',null]) assert.throws(()=>constrainPresetCell(id,input()),/preset/);
  for (const cell of [undefined,null,{}, {lengths:[5,5],angles:[90,90,90]},{lengths:[5,5,5],angles:[90,90]},{lengths:new Array(3),angles:[90,90,90]}]) assert.throws(()=>constrainPresetCell('cubic',cell),/Cell/);
  for (const value of [0,.49,1000.1,NaN,Infinity,'5',null,undefined]) {
    for (const index of [0,1,2]) { const cell=input();cell.lengths[index]=value;assert.throws(()=>constrainPresetCell('triclinic',cell),/lengths/); }
  }
  for (const value of [0,180,-1,NaN,Infinity,'90',null,undefined]) {
    for (const index of [0,1,2]) { const cell=input();cell.angles[index]=value;assert.throws(()=>constrainPresetCell('triclinic',cell),/angles/); }
  }
  assert.throws(()=>constrainPresetCell('triclinic',{lengths:[5,5,5],angles:[10,10,170]}),/non-degenerate/);
  assert.throws(()=>constrainPresetCell('triclinic',{lengths:[5,5,5],angles:[60,60,120]}),/non-degenerate/);
});

test('reference selections reject missing or duplicate sites, invalid elements and occupancy coercion',()=>{
  for (const selected of [null,[],new Array(1),Array.from({length:9},()=>({siteId:'origin',element:'C'})),[null],[{siteId:'other',element:'C'}]]) assert.throws(()=>getReferenceAtoms('cubic',selected),/reference|Reference/);
  assert.throws(()=>getReferenceAtoms('bcc',[{siteId:'body',element:'Li'},{siteId:'body',element:'B'}]),/only once/);
  for (const element of ['X','si','SI','D','constructor','__proto__',null,{}, {toString:()=> 'Si'}]) assert.throws(()=>getReferenceAtoms('fcc',[{siteId:'origin',element}]),/element/);
  for (const occupancy of [0,-1,1.01,NaN,Infinity,'1',null,false]) assert.throws(()=>getReferenceAtoms('fcc',[{siteId:'origin',element:'C',occupancy}]),/occupancy/);
  assert.equal(getReferenceAtoms('fcc',[{siteId:'origin',element:'C',occupancy:.001}])[0].occupancy,.001);
  assert.throws(()=>referenceSites('unknown'),/preset/);
});
