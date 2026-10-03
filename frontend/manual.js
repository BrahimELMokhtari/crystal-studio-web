import { ELEMENT_DATA } from './element-data.js';
import { MAX_ATOMS, finite, fractionalToCartesian, validateStructure } from './model.js';

const DEG = Math.PI / 180;
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const CONTACT_WARNING = 'Automatic contacts have not been calculated for this manual structure. Use Calculate contacts to calculate periodic contacts with the Python service.';
const PARTIAL_WARNING = 'Partial occupancies are shown as representative sites; atom counts and formula are not occupancy-weighted.';
const VDW_WARNING = 'Some elements lack tabulated van der Waals radii; their space-filling radii use 1.5 times the covalent radius.';
const COVALENT_WARNING = 'Elements Bk through Og lack tabulated covalent radii in ASE; a 2 angstrom display default is used and is not a measured radius.';
const COLOR_WARNING = 'Elements Ds through Og lack a bundled Jmol color and use neutral gray.';

function numericVector(value, label, predicate) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(n => finite(n) && predicate(n))) throw new Error(label);
  return [...value];
}

function text(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) throw new Error(label);
  return value.trim();
}

// Singular values of the 3x3 cell from a scaled symmetric Gram matrix.
// Jacobi rotations avoid cancellation in nearly singular skew-cell geometry.
function minimumSingularValue(vectors) {
  const scale = Math.max(...vectors.flat().map(Math.abs));
  const a = vectors.map(row => vectors.map(other => row.reduce((sum, n, k) => sum + (n / scale) * (other[k] / scale), 0)));
  for (let sweep = 0; sweep < 20; sweep++) {
    let largest = 0, p = 0, q = 1;
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(a[i][j]) > largest) { largest = Math.abs(a[i][j]); p = i; q = j; }
    if (largest < Number.EPSILON * 2) break;
    const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(angle), s = Math.sin(angle), app = a[p][p], aqq = a[q][q], apq = a[p][q];
    a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p][q] = a[q][p] = 0;
    for (let k = 0; k < 3; k++) if (k !== p && k !== q) {
      const akp = a[k][p], akq = a[k][q];
      a[k][p] = a[p][k] = c * akp - s * akq;
      a[k][q] = a[q][k] = s * akp + c * akq;
    }
  }
  return scale * Math.sqrt(Math.max(0, Math.min(a[0][0], a[1][1], a[2][2])));
}

function makeCell(lengths, angles) {
  lengths = numericVector(lengths, 'Cell lengths must be numbers from 0.5 to 1,000 angstroms.', n => n >= 0.5 && n <= 1000);
  angles = numericVector(angles, 'Cell angles must be finite numbers greater than 0 and less than 180 degrees.', n => n > 0 && n < 180);
  const [a, b, c] = lengths, [alpha, beta, gamma] = angles.map(n => n * DEG);
  const ca = Math.cos(alpha), cb = Math.cos(beta), cg = Math.cos(gamma), sg = Math.sin(gamma);
  const cy = (ca - cb * cg) / sg, czSquared = 1 - cb * cb - cy * cy;
  if (!finite(czSquared) || czSquared <= 0) throw new Error('The cell angles cannot form a non-degenerate three-dimensional cell.');
  const vectors = [[a, 0, 0], [b * cg, b * sg, 0], [c * cb, c * cy, c * Math.sqrt(czSquared)]].map(row => row.map(n => Math.abs(n) < 1e-12 ? 0 : n));
  const volume = vectors[0][0] * vectors[1][1] * vectors[2][2];
  if (!finite(volume) || volume < 0.1 || minimumSingularValue(vectors) < 0.2 - 1e-10) throw new Error('The cell is too thin or nearly singular. Use a cell volume of at least 0.1 cubic angstroms and a minimum principal dimension of 0.2 angstroms.');
  return {vectors, lengths, angles, volume, periodic: true};
}

function atomEntry(entry, index) {
  const row = Number.isInteger(entry?.lineNumber) && entry.lineNumber > 0 ? entry.lineNumber : index + 1;
  if (!entry || typeof entry !== 'object' || !Object.hasOwn(ELEMENT_DATA, entry.element)) throw new Error('Atom row ' + row + ': use a recognized chemical element symbol with exact capitalization.');
  const fractional = numericVector(entry.fractional, 'Atom row ' + row + ': fractional coordinates must be finite numbers from 0 to 1.', n => n >= 0 && n <= 1);
  const occupancy = entry.occupancy === undefined ? 1 : entry.occupancy;
  if (!finite(occupancy) || occupancy <= 0 || occupancy > 1) throw new Error('Atom row ' + row + ': occupancy must be greater than 0 and at most 1.');
  const label = entry.label === undefined ? undefined : text(entry.label, 'Atom row ' + row + ': labels must contain 1–80 printable characters.', 80);
  return {element: entry.element, fractional, occupancy, ...(label === undefined ? {} : {label}), lineNumber: row};
}

/** Parse whitespace-separated "element x y z [occupancy]" rows in fractional coordinates. */
export function parseManualAtomRows(value) {
  if (typeof value !== 'string' || value.length > 512 * 1024) throw new Error('Enter atom rows using at most 512 KiB of text.');
  const atoms = [];
  for (const [index, raw] of value.split(/\r?\n/).entries()) {
    const line = raw.split('#', 1)[0].trim();
    if (!line) continue;
    if (atoms.length >= MAX_ATOMS) throw new Error('The structure must contain between 1 and 2,000 atoms.');
    const columns = line.split(/\s+/), row = index + 1;
    if (![4, 5].includes(columns.length)) throw new Error('Atom row ' + row + ': enter element x y z, with optional occupancy.');
    if (!columns.slice(1).every(n => DECIMAL.test(n) && finite(Number(n)))) throw new Error('Atom row ' + row + ': coordinates and occupancy must use finite decimal numbers.');
    atoms.push(atomEntry({element: columns[0], fractional: columns.slice(1, 4).map(Number), occupancy: columns.length === 5 ? Number(columns[4]) : 1, lineNumber: row}, atoms.length));
  }
  if (!atoms.length) throw new Error('Enter at least one atom row.');
  return atoms;
}

/** Build a periodic unit cell locally. Contacts are explicitly deferred to Calculate contacts. */
export function buildManualStructure({name = 'Manual crystal', lengths, angles, atoms, bondScale = 1.1} = {}) {
  name = text(name, 'Give the structure a name containing 1–150 printable characters.', 150);
  if (!finite(bondScale) || bondScale < 0.5 || bondScale > 2) throw new Error('Bond scale must be a finite number from 0.5 to 2.');
  const cell = makeCell(lengths, angles);
  if (!Array.isArray(atoms) || !atoms.length || atoms.length > MAX_ATOMS) throw new Error('The structure must contain between 1 and 2,000 atoms.');
  const warnings = [CONTACT_WARNING], counts = new Map(), entries = [], rows = [];
  let wrapped = false;
  for (const [index, original] of atoms.entries()) {
    const entry = atomEntry(original, index), data = ELEMENT_DATA[entry.element];
    const fractional = entry.fractional.map(n => { if (n === 1) wrapped = true; return n === 1 || Object.is(n, -0) ? 0 : n; });
    for (const [otherIndex, other] of entries.entries()) {
      const difference = fractional.map((n, k) => n - other.fractional[k]);
      const nearest = fractionalToCartesian(difference.map(n => n - Math.round(n)), cell.vectors);
      if (Math.hypot(...nearest) < 1e-6) throw new Error('Atom rows ' + rows[otherIndex] + ' and ' + entry.lineNumber + ' occupy the same periodic site. Use one representative site; mixed sites are not supported by the manual builder.');
    }
    const atom = {id: index, element: entry.element, fractional, position: fractionalToCartesian(fractional, cell.vectors),
      covalentRadius: data.covalentRadius, vdwRadius: data.vdwRadius, occupancy: entry.occupancy};
    if (entry.label !== undefined) atom.label = entry.label;
    entries.push(atom); rows.push(entry.lineNumber); counts.set(entry.element, (counts.get(entry.element) ?? 0) + 1);
    if (entry.occupancy < 1) warnings.push(PARTIAL_WARNING);
    if (data.fallbackVdwRadius) warnings.push(VDW_WARNING);
    if (data.defaultCovalentRadius) warnings.push(COVALENT_WARNING);
    if (data.fallbackColor) warnings.push(COLOR_WARNING);
  }
  if (wrapped) warnings.push('Fractional coordinates equal to 1 were wrapped to 0, the same periodic site in the neighboring cell.');
  const symbols = [...counts.keys()], hill = [...symbols].sort();
  if (counts.has('C')) {
    hill.splice(hill.indexOf('C'), 1); hill.unshift('C');
    if (counts.has('H')) { hill.splice(hill.indexOf('H'), 1); hill.splice(1, 0, 'H'); }
  }
  const formula = hill.map(symbol => symbol + (counts.get(symbol) === 1 ? '' : counts.get(symbol))).join('');
  if (formula.length > 300) throw new Error('The formula exceeds the supported 300-character limit. Use fewer distinct elements.');
  return validateStructure({schemaVersion: 1, name, formula, cell, atoms: entries, bonds: [],
    elements: symbols.sort((a, b) => ELEMENT_DATA[a].atomicNumber - ELEMENT_DATA[b].atomicNumber).map(symbol => ({symbol, count: counts.get(symbol), color: ELEMENT_DATA[symbol].color})),
    source: {filename: 'manual structure', format: 'manual', description: 'Entered manually in Crystal Studio Web using fractional coordinates. No symmetry operations are inferred; enter all sites in the unit cell.'},
    warnings: [...new Set(warnings)], repetitions: [1, 1, 1], baseAtomCount: entries.length, bondScale,
    contactsCalculated: false});
}
