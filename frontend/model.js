import { ELEMENT_DATA } from './element-data.js';

export const MAX_ATOMS = 2000;
export const MAX_EXPORT_DPI = 5000;
export const MAX_EXPORT_PIXELS = 32000000;
export const MAX_MANUAL_BONDS = 2000;
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const norm = a => Math.hypot(...a);
export const subtract = (a, b) => a.map((v, i) => v - b[i]);
export const fractionalToCartesian = (f, cell) => [0, 1, 2].map(k => f.reduce((sum, v, j) => sum + v * cell[j][k], 0));
export function atomRenderRadius(atom, settings, {ghost=false, selected=false}={}) {
  const elementScale = settings.elementScales?.[atom.element] ?? 1;
  const base = ghost ? atom.covalentRadius * .26 : settings.representation === 'spacefill' ? atom.vdwRadius : atom.covalentRadius * (settings.representation === 'spheres' ? .65 : .32);
  return base * (settings.atomScale ?? 1) * elementScale * (selected ? 1.08 : 1);
}
export function cellEdges(cell) {
  const corners = [[0,0,0],[1,0,0],[0,1,0],[0,0,1],[1,1,0],[1,0,1],[0,1,1],[1,1,1]].map(f => fractionalToCartesian(f, cell));
  return [[0,1],[0,2],[0,3],[1,4],[1,5],[2,4],[2,6],[3,5],[3,6],[4,7],[5,7],[6,7]].map(([i,j]) => [corners[i],corners[j]]);
}
export function measureAtoms(atoms) {
  if (atoms.length < 2) return {};
  const result = { distance: norm(subtract(atoms[1].position, atoms[0].position)) };
  if (atoms.length >= 3) {
    const u = subtract(atoms[0].position, atoms[1].position), v = subtract(atoms[2].position, atoms[1].position);
    const lengths = norm(u) * norm(v);
    result.angle = lengths > 1e-12 ? Math.acos(Math.max(-1, Math.min(1, u.reduce((sum, n, i) => sum + n * v[i], 0) / lengths))) * 180 / Math.PI : null;
  }
  return result;
}
export function validateCustomBonds(bonds, structure) {
  if (!Array.isArray(bonds) || bonds.length > MAX_MANUAL_BONDS) throw new Error('Use at most 2,000 manual connections.');
  const seen = new Set();
  for (const bond of bonds) {
    if (!bond || ![bond.i, bond.j].every(id => Number.isInteger(id) && id >= 0 && id < structure.atoms.length) || bond.i === bond.j || !Array.isArray(bond.shift) || bond.shift.length !== 3 || bond.shift.some(n => n !== 0)) throw new Error('Manual connections must join two different displayed atoms.');
    const key = [bond.i, bond.j].sort((a,b) => a-b).join(':');
    if (seen.has(key)) throw new Error('Duplicate manual connection.');
    seen.add(key);
    if (norm(subtract(structure.atoms[bond.i].position, structure.atoms[bond.j].position)) < 1e-8) throw new Error('Coincident atoms cannot be connected.');
  }
  return bonds;
}
export function getDisplayBonds(structure, settings) {
  const mode = settings.connectionMode ?? 'automatic';
  if (!['automatic','manual','both'].includes(mode)) throw new Error('Invalid connection display mode.');
  const manual = validateCustomBonds(settings.customBonds ?? [], structure).map(bond => {
    const start = structure.atoms[bond.i].position, end = structure.atoms[bond.j].position;
    return {...bond, start, end, distance: norm(subtract(end, start)), manual: true};
  });
  const automatic = mode === 'manual' ? [] : structure.bonds.filter(bond => settings.showPeriodic || bond.shift.every(n => n === 0));
  const result = [...automatic], keys = new Set(automatic.map(bond => [Math.min(bond.i,bond.j), Math.max(bond.i,bond.j), ...(bond.i <= bond.j ? bond.shift : bond.shift.map(n => -n))].join(':')));
  if (mode !== 'automatic') for (const bond of manual) {
    const key = [Math.min(bond.i,bond.j), Math.max(bond.i,bond.j),0,0,0].join(':');
    if (!keys.has(key)) {result.push(bond);keys.add(key);}
  }
  if (result.length > 20000) throw new Error('The view exceeds 20,000 connections. Use manual connections only or reduce the contact cutoff.');
  return result;
}
export function remapCustomBonds(bonds, baseCount, oldRepeats, newRepeats) {
  const mapId = id => {
    const tile = Math.floor(id/baseCount);
    const offset = [Math.floor(tile/(oldRepeats[1]*oldRepeats[2])),Math.floor(tile/oldRepeats[2])%oldRepeats[1],tile%oldRepeats[2]];
    if (offset.some((n,k) => n >= newRepeats[k])) return null;
    return ((offset[0]*newRepeats[1]+offset[1])*newRepeats[2]+offset[2])*baseCount + id%baseCount;
  };
  return bonds.flatMap(bond => {const i=mapId(bond.i),j=mapId(bond.j);return i===null||j===null?[]:[{i,j,shift:[0,0,0]}];});
}
function vector(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(n => finite(n) && Math.abs(n) < 1e6)) throw new Error('Invalid ' + label + '.');
  return value;
}
export function validateStructure(value) {
  if (!value || value.schemaVersion !== 1 || !value.cell || !Array.isArray(value.atoms) || !value.atoms.length || value.atoms.length > MAX_ATOMS) throw new Error('The structure must contain between 1 and 2,000 atoms.');
  const cell = value.cell.vectors;
  if (!Array.isArray(cell) || cell.length !== 3) throw new Error('Invalid lattice vectors.');
  cell.forEach(v => vector(v, 'lattice vector'));
  const determinant = cell[0][0]*(cell[1][1]*cell[2][2]-cell[1][2]*cell[2][1])-cell[0][1]*(cell[1][0]*cell[2][2]-cell[1][2]*cell[2][0])+cell[0][2]*(cell[1][0]*cell[2][1]-cell[1][1]*cell[2][0]);
  if (!finite(determinant) || determinant < 1e-8) throw new Error('Use a right-handed cell with positive volume.');
  vector(value.cell.lengths, 'cell lengths'); vector(value.cell.angles, 'cell angles');
  if (cell.some((v,i)=>Math.abs(norm(v)-value.cell.lengths[i])>1e-3)) throw new Error('Cell lengths disagree with the lattice vectors.');
  const actualAngles=[[1,2],[0,2],[0,1]].map(([i,j])=>Math.acos(Math.max(-1,Math.min(1,cell[i].reduce((sum,n,k)=>sum+n*cell[j][k],0)/(norm(cell[i])*norm(cell[j])))))*180/Math.PI);
  if (actualAngles.some((angle,i)=>Math.abs(angle-value.cell.angles[i])>1e-3)) throw new Error('Cell angles disagree with the lattice vectors.');
  if (!finite(value.cell.volume) || value.cell.volume <= 0 || Math.abs(Math.abs(determinant)-value.cell.volume) > Math.max(1e-3,value.cell.volume*1e-4)) throw new Error('The cell volume is inconsistent.');
  const ids = new Set();
  for (const [index, atom] of value.atoms.entries()) {
    if (atom.id !== index || ids.has(atom.id) || !/^[A-Z][a-z]?$/.test(atom.element)) throw new Error('Invalid atom identifiers or elements.');
    ids.add(atom.id); vector(atom.position, 'atom coordinates'); vector(atom.fractional, 'fractional coordinates');
    const expected = fractionalToCartesian(atom.fractional, cell);
    if (norm(subtract(expected, atom.position)) > 1e-3) throw new Error('Cartesian and fractional coordinates disagree.');
    if (![atom.covalentRadius, atom.vdwRadius].every(r => finite(r) && r > 0 && r < 10) || !finite(atom.occupancy) || atom.occupancy <= 0 || atom.occupancy > 1) throw new Error('Invalid atom radius or occupancy.');
  }
  if (!Array.isArray(value.bonds) || value.bonds.length > 20000) throw new Error('Invalid contact collection.');
  for (const bond of value.bonds) {
    if (![bond.i,bond.j].every(i => Number.isInteger(i) && i >= 0 && i < value.atoms.length) || !Array.isArray(bond.shift) || bond.shift.length !== 3 || !bond.shift.every(Number.isInteger)) throw new Error('Invalid periodic contact identifiers.');
    vector(bond.start, 'contact start'); vector(bond.end, 'contact end');
    const expected = value.atoms[bond.j].position.map((v,k) => v + fractionalToCartesian(bond.shift,cell)[k]);
    if (norm(subtract(bond.start,value.atoms[bond.i].position)) > 1e-3 || norm(subtract(bond.end,expected)) > 1e-3 || !finite(bond.distance) || Math.abs(norm(subtract(bond.end,bond.start))-bond.distance) > 1e-3) throw new Error('Periodic contact endpoints are inconsistent.');
  }
  if (!Array.isArray(value.elements) || value.elements.length > 118 || !value.elements.every(e => /^[A-Z][a-z]?$/.test(e.symbol) && Number.isInteger(e.count) && e.count > 0 && /^#[0-9a-f]{6}$/i.test(e.color))) throw new Error('Invalid element palette.');
  const counts = new Map(); value.atoms.forEach(a => counts.set(a.element,(counts.get(a.element)||0)+1));
  if (value.elements.length !== counts.size || new Set(value.elements.map(e=>e.symbol)).size!==counts.size || value.elements.some(e => counts.get(e.symbol) !== e.count)) throw new Error('Element counts disagree with the atom collection.');
  if (typeof value.name !== 'string' || value.name.length > 300 || typeof value.formula !== 'string' || value.formula.length > 300 || !value.source || !['filename','format','description'].every(k => typeof value.source[k] === 'string' && value.source[k].length <= 5000) || !Array.isArray(value.warnings) || value.warnings.length > 50 || !value.warnings.every(w => typeof w === 'string' && w.length <= 5000)) throw new Error('Invalid structure metadata.');
  return value;
}
export function validateProject(value) {
  if (value?.format !== 'crystal-studio-project' || value.version !== 1) throw new Error('Choose a Crystal Studio project JSON file.');
  validateStructure(value.unit); validateStructure(value.view);
  const s = value.settings;
  if (!s || !['ball-stick','spheres','spacefill','bonds'].includes(s.representation) || !finite(s.atomScale) || s.atomScale < .4 || s.atomScale > 2 || !finite(s.bondScale) || s.bondScale < .6 || s.bondScale > 1.8 || !Array.isArray(s.repetitions) || s.repetitions.length !== 3 || !s.repetitions.every(n => Number.isInteger(n) && n >= 1 && n <= 4) || !['dark','light'].includes(s.background)) throw new Error('Invalid project display settings.');
  for (const key of ['showCell','showAxes','showPeriodic','showLegend']) if (typeof s[key] !== 'boolean') throw new Error('Invalid project visibility settings.');
  if (!s.colors || Object.keys(s.colors).length > 118 || !Object.entries(s.colors).every(([element,color]) => /^[A-Z][a-z]?$/.test(element) && /^#[0-9a-f]{6}$/i.test(color))) throw new Error('Invalid project colors.');
  if (s.elementScales !== undefined && (!s.elementScales || typeof s.elementScales !== 'object' || Array.isArray(s.elementScales) || Object.keys(s.elementScales).length > 118 || !Object.entries(s.elementScales).every(([element,scale]) => Object.hasOwn(ELEMENT_DATA,element) && finite(scale) && scale >= .2 && scale <= 3))) throw new Error('Element sizes must map recognized element symbols to finite scales from 0.2 to 3.');
  if (s.connectionMode !== undefined && !['automatic','manual','both'].includes(s.connectionMode)) throw new Error('Invalid project connection mode.');
  validateCustomBonds(s.customBonds === undefined ? [] : s.customBonds, value.view);
  getDisplayBonds(value.view, s);
  const count=value.unit.atoms.length, repeatCount=s.repetitions.reduce((product,n)=>product*n,1);
  if(value.view.atoms.length!==count*repeatCount || value.view.cell.vectors.some((row,i)=>norm(subtract(row,value.unit.cell.vectors[i].map(n=>n*s.repetitions[i])))>1e-3)) throw new Error('The displayed supercell disagrees with the original unit cell and repetitions.');
  for(const [index,atom] of value.view.atoms.entries()){
    const original=value.unit.atoms[index%count],tile=Math.floor(index/count),offset=[Math.floor(tile/(s.repetitions[1]*s.repetitions[2])),Math.floor(tile/s.repetitions[2])%s.repetitions[1],tile%s.repetitions[2]],translation=fractionalToCartesian(offset,value.unit.cell.vectors);
    if(atom.element!==original.element || Math.abs(atom.occupancy-original.occupancy)>1e-6 || norm(subtract(atom.position,original.position.map((n,k)=>n+translation[k])))>1e-3) throw new Error('The displayed atoms disagree with the original unit cell and repetitions.');
  }
  if((value.unit.repetitions!==undefined&&JSON.stringify(value.unit.repetitions)!=='[1,1,1]') || (value.view.repetitions!==undefined&&JSON.stringify(value.view.repetitions)!==JSON.stringify(s.repetitions)) || (value.unit.bondScale!==undefined&&Math.abs(value.unit.bondScale-1.1)>1e-8) || (value.view.bondScale!==undefined&&Math.abs(value.view.bondScale-s.bondScale)>1e-8)) throw new Error('Project calculation metadata disagrees with the display settings.');
  if (value.camera) {
    vector(value.camera.position,'camera position'); vector(value.camera.target,'camera target');
    if (!finite(value.camera.zoom) || value.camera.zoom <= 0 || value.camera.zoom > 1000) throw new Error('Invalid project camera.');
    if (value.camera.up) {vector(value.camera.up,'camera up direction');if(norm(value.camera.up)<1e-8)throw new Error('Invalid camera up direction.');}
    if (value.camera.halfHeight !== undefined && (!finite(value.camera.halfHeight)||value.camera.halfHeight<=0||value.camera.halfHeight>1e6)) throw new Error('Invalid camera framing.');
  }
  return value;
}
export function exportDimensions(widthCm, heightCm, dpi, limit = 8192) {
  if (![widthCm,heightCm,dpi].every(finite) || widthCm < 1 || widthCm > 30 || heightCm < 1 || heightCm > 30 || !Number.isInteger(dpi) || dpi < 72 || dpi > MAX_EXPORT_DPI) throw new Error('Use dimensions from 1–30 cm and an integer resolution from 72–5,000 DPI.');
  const width = Math.round(widthCm * dpi / 2.54), height = Math.round(heightCm * dpi / 2.54);
  if (Math.max(width,height) > limit) throw new Error('This device supports exports up to ' + limit.toLocaleString() + ' pixels per side. Reduce the size or DPI.');
  if (width * height > MAX_EXPORT_PIXELS) throw new Error('Exports support up to 32 million pixels. Reduce the figure size or DPI.');
  return { width, height, widthCm, heightCm, dpi };
}
const crcTable = new Uint32Array(256).map((_,n) => { for (let i=0;i<8;i++) n=n&1?0xedb88320^(n>>>1):n>>>1; return n>>>0; });
function crc(bytes) { let n=0xffffffff; for(const v of bytes) n=crcTable[(n^v)&255]^(n>>>8); return (n^0xffffffff)>>>0; }
export function pngWithDpi(bytes, dpi) {
  if (!Number.isInteger(dpi) || dpi < 72 || dpi > MAX_EXPORT_DPI || bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((n,i) => bytes[i]===n)) throw new Error('Invalid PNG or resolution.');
  const chunk = new Uint8Array(21), view = new DataView(chunk.buffer), ppm = Math.round(dpi/.0254);
  view.setUint32(0,9); chunk.set([112,72,89,115],4); view.setUint32(8,ppm); view.setUint32(12,ppm); chunk[16]=1; view.setUint32(17,crc(chunk.slice(4,17)));
  const chunks = [bytes.slice(0,8)], source = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let offset=8;offset<bytes.length;) {
    if (offset+12>bytes.length) throw new Error('Truncated PNG.');
    const length=source.getUint32(offset), end=offset+length+12;
    if(end>bytes.length) throw new Error('Truncated PNG chunk.');
    const name=String.fromCharCode(...bytes.slice(offset+4,offset+8));
    if(name!=='pHYs')chunks.push(bytes.slice(offset,end));
    if(name==='IHDR')chunks.push(chunk);
    offset=end;
  }
  const result = new Uint8Array(chunks.reduce((sum,a)=>sum+a.length,0)); let offset=0;
  for(const part of chunks){ result.set(part,offset); offset+=part.length; }
  return result;
}
