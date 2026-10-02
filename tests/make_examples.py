import json
import sys
from pathlib import Path
from ase import Atoms
from ase.spacegroup import crystal

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from science import model

definitions = [
    ('nacl', 'Sodium chloride · rocksalt', crystal(['Na','Cl'], basis=[(0,0,0),(.5,.5,.5)], spacegroup=225, cellpar=[5.64,5.64,5.64,90,90,90])),
    ('bcc', 'Iron · body-centered cubic', Atoms('Fe2', scaled_positions=[(0,0,0),(.5,.5,.5)], cell=[2.8665,2.8665,2.8665], pbc=True)),
    ('skew', 'Hexagonal cell · illustrative carbon', Atoms('C2', scaled_positions=[(0,0,0),(1/3,2/3,.5)], cell=[[2.46,0,0],[-1.23,2.1304224933,0],[0,0,3.4]], pbc=True)),
    ('periodic', 'Periodic boundary · two atoms', Atoms('H2', scaled_positions=[(.01,.5,.5),(.99,.5,.5)], cell=[10,10,10], pbc=True)),
]
examples = []
for slug, label, atoms in definitions:
    source = {'filename': slug + '-idealized.cif', 'format': 'example', 'description': 'Idealized synthetic example for visualization and geometry checks; not an experimental refinement.'}
    structure = model(atoms, name=label, source=source, scale=1.1, repeat=(1,1,1))
    examples.append({'id':slug,'label':label,'structure':structure})
target = ROOT / 'frontend/examples.json'
target.write_text(json.dumps(examples, ensure_ascii=False, indent=2), encoding='utf-8')
print('Generated', len(examples), 'scientifically labeled examples.')
