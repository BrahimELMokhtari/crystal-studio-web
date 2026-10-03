import { ELEMENT_DATA } from './element-data.js';

// Cell constraints and centring coordinates follow IUCr conventions:
// https://www.iucr.org/what-we-do/education/pamphlets/symmetry
// https://www.iucr.org/__data/iucr/cifdic_html/2/cif_sym.dic/Ispace_group.centring_type.html
// These are editing templates, not a determination of a material's space group.
const ALL_FIELDS = ['a','b','c','alpha','beta','gamma'];
const SYSTEMS = 'system';
const LATTICES = 'lattice';
const NOTICE = ' Reference sites are fractional geometric points, not Wyckoff positions; no space group is inferred.';

function preset(id, label, group, lengths, angles, editable, defaultSites, help) {
  return Object.freeze({id,label,group,help:help + NOTICE,
    defaults:Object.freeze({lengths:Object.freeze(lengths),angles:Object.freeze(angles)}),
    editable:Object.freeze(editable),defaultSites:Object.freeze(defaultSites)});
}

export const CRYSTAL_PRESETS = Object.freeze([
  preset('cubic','Cubic',SYSTEMS,[5,5,5],[90,90,90],['a'],['origin'],'Equal cell lengths and three right angles. The atom motif determines the actual crystal symmetry.'),
  preset('tetragonal','Tetragonal',SYSTEMS,[5,5,7],[90,90,90],['a','c'],['origin'],'a and b are equal; c is independent. All cell angles are 90 degrees.'),
  preset('orthorhombic','Orthorhombic',SYSTEMS,[5,6,7],[90,90,90],['a','b','c'],['origin'],'Three independent cell lengths with all angles fixed at 90 degrees.'),
  preset('hexagonal','Hexagonal',SYSTEMS,[5,5,8],[90,90,120],['a','c'],['origin'],'Hexagonal axes: a = b, alpha = beta = 90 degrees and gamma = 120 degrees; c is independent.'),
  preset('trigonal','Trigonal (rhombohedral axes)',SYSTEMS,[5,5,5],[75,75,75],['a','alpha'],['origin'],'Rhombohedral setting: equal lengths and equal angles. The common angle must be below 120 degrees. Trigonal crystals can also use hexagonal axes.'),
  preset('monoclinic','Monoclinic',SYSTEMS,[5,6,7],[90,105,90],['a','b','c','beta'],['origin'],'Unique b axis: alpha and gamma are 90 degrees; beta and all three lengths are independent.'),
  preset('triclinic','Triclinic',SYSTEMS,[5,6,7],[80,75,70],ALL_FIELDS,['origin'],'All six cell parameters are independent and must form a non-degenerate three-dimensional cell.'),
  preset('fcc','FCC',LATTICES,[5,5,5],[90,90,90],['a'],['origin','face-ab','face-ac','face-bc'],'Conventional face-centered cubic basis: origin and three distinct face centers. Changing the selected sites or atom motif does not establish FCC symmetry.'),
  preset('bcc','BCC',LATTICES,[5,5,5],[90,90,90],['a'],['origin','body'],'Conventional body-centered cubic basis: origin and body center. Changing the selected sites or atom motif does not establish BCC symmetry.'),
  preset('simple-cubic','Simple cubic',LATTICES,[5,5,5],[90,90,90],['a'],['origin'],'Primitive cubic reference basis: one origin site. Periodic corner copies are represented by the same site.'),
]);

const SITE_DEFINITIONS = Object.freeze([
  ['origin','Origin (corner)',[0,0,0]],
  ['body','Body center',[.5,.5,.5]],
  ['face-ab','Face center ab',[.5,.5,0]],
  ['face-ac','Face center ac',[.5,0,.5]],
  ['face-bc','Face center bc',[0,.5,.5]],
  ['edge-a','Edge center a',[.5,0,0]],
  ['edge-b','Edge center b',[0,.5,0]],
  ['edge-c','Edge center c',[0,0,.5]],
].map(([id,label,fractional])=>Object.freeze({id,label,fractional:Object.freeze(fractional)})));

function getPreset(id) {
  const result = CRYSTAL_PRESETS.find(entry=>entry.id === id);
  if (!result) throw new Error('Choose a recognized crystal preset.');
  return result;
}
function inputVector(value, label, predicate) {
  if (!Array.isArray(value) || value.length !== 3 || !Array.from(value).every(number=>typeof number === 'number' && Number.isFinite(number) && predicate(number))) throw new Error(label);
  return [...value];
}

/** Enforce dependent cell parameters; validate and preserve independent numeric inputs. */
export function constrainPresetCell(id, cell) {
  getPreset(id);
  let lengths = inputVector(cell?.lengths,'Cell lengths must be numbers from 0.5 to 1,000 angstroms.',number=>number >= .5 && number <= 1000);
  let angles = inputVector(cell?.angles,'Cell angles must be finite numbers greater than 0 and less than 180 degrees.',number=>number > 0 && number < 180);
  if (['cubic','fcc','bcc','simple-cubic'].includes(id)) {
    lengths = [lengths[0],lengths[0],lengths[0]];angles = [90,90,90];
  } else if (id === 'tetragonal') {
    lengths[1] = lengths[0];angles = [90,90,90];
  } else if (id === 'orthorhombic') {
    angles = [90,90,90];
  } else if (id === 'hexagonal') {
    lengths[1] = lengths[0];angles = [90,90,120];
  } else if (id === 'trigonal') {
    lengths = [lengths[0],lengths[0],lengths[0]];angles = [angles[0],angles[0],angles[0]];
    if (angles[0] >= 120) throw new Error('The rhombohedral angle must be greater than 0 and less than 120 degrees.');
  } else if (id === 'monoclinic') {
    angles[0] = 90;angles[2] = 90;
  }
  const [ca,cb,cg] = angles.map(angle=>Math.cos(angle * Math.PI / 180));
  const determinant = 1 + 2 * ca * cb * cg - ca * ca - cb * cb - cg * cg;
  if (!Number.isFinite(determinant) || determinant <= 1e-12) throw new Error('The cell angles cannot form a non-degenerate three-dimensional cell.');
  return {lengths,angles};
}

/** One representative per periodic site; opposite corners/faces/edges are not duplicated. */
export function referenceSites(id) {
  const selected = getPreset(id).defaultSites;
  return SITE_DEFINITIONS.map(site=>({id:site.id,label:site.label,fractional:[...site.fractional],defaultSelected:selected.includes(site.id)}));
}

/** Turn explicitly selected references into manual-builder atom rows, retaining selection order. */
export function getReferenceAtoms(id, selected) {
  const sites = referenceSites(id);
  if (!Array.isArray(selected) || !selected.length || selected.length > sites.length) throw new Error('Select between one and eight distinct reference sites.');
  const used = new Set();
  return Array.from(selected,(entry,index)=>{
    const row = index + 1;
    const site = sites.find(site=>site.id === entry?.siteId);
    if (!site) throw new Error('Reference row ' + row + ': choose a recognized reference site.');
    if (used.has(site.id)) throw new Error('Reference row ' + row + ': each periodic reference site can be selected only once.');
    used.add(site.id);
    if (typeof entry.element !== 'string' || !Object.hasOwn(ELEMENT_DATA,entry.element)) throw new Error('Reference row ' + row + ': use a recognized element symbol with exact capitalization.');
    const occupancy = entry.occupancy === undefined ? 1 : entry.occupancy;
    if (typeof occupancy !== 'number' || !Number.isFinite(occupancy) || occupancy <= 0 || occupancy > 1) throw new Error('Reference row ' + row + ': occupancy must be greater than 0 and at most 1.');
    return {element:entry.element,fractional:[...site.fractional],occupancy,label:site.label};
  });
}
