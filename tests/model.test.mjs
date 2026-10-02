import test from 'node:test';
import assert from 'node:assert/strict';
import { cellEdges, fractionalToCartesian, measureAtoms, validateStructure, validateProject, exportDimensions, pngWithDpi } from '../frontend/model.js';
function structure() {
  return {schemaVersion:1,name:'Periodic hydrogen example',formula:'H2',cell:{vectors:[[10,0,0],[0,10,0],[0,0,10]],lengths:[10,10,10],angles:[90,90,90],volume:1000,periodic:true},atoms:[{id:0,element:'H',fractional:[.01,0,0],position:[.1,0,0],covalentRadius:.31,vdwRadius:1.2,occupancy:1},{id:1,element:'H',fractional:[.99,0,0],position:[9.9,0,0],covalentRadius:.31,vdwRadius:1.2,occupancy:1}],bonds:[{i:0,j:1,shift:[-1,0,0],start:[.1,0,0],end:[-.1,0,0],distance:.2}],elements:[{symbol:'H',count:2,color:'#ffffff'}],source:{filename:'example',format:'example',description:'Synthetic periodic regression example.'},warnings:[]};
}
test('nonorthogonal cell edges follow real lattice directions',()=>{
  const cell=[[2,0,0],[1,Math.sqrt(3),0],[0,0,4]];
  assert.deepEqual(fractionalToCartesian([.5,.5,.5],cell),[1.5,Math.sqrt(3)/2,2]);
  const edges=cellEdges(cell);assert.equal(edges.length,12);
  assert.deepEqual(edges[1],[[0,0,0],[1,Math.sqrt(3),0]]);
  assert.ok(edges.some(([a,b])=>b[0]===3&&b[1]===Math.sqrt(3)&&b[2]===4));
});
test('periodic contacts preserve image endpoints while measurements describe selected atoms',()=>{
  const m=validateStructure(structure());
  assert.ok(Math.abs(measureAtoms(m.atoms).distance-9.8)<1e-10);
  assert.equal(m.bonds[0].distance,.2);
  const incorrect=structure();incorrect.bonds[0].end=[9.9,0,0];
  assert.throws(()=>validateStructure(incorrect),/endpoints/);
});
test('angles use the middle atom and avoid fabricated angles for coincident atoms',()=>{
  assert.equal(measureAtoms([{position:[1,0,0]},{position:[0,0,0]},{position:[0,1,0]}]).angle,90);
  assert.equal(measureAtoms([{position:[0,0,0]},{position:[0,0,0]},{position:[0,1,0]}]).angle,null);
});
test('imported project geometry rejects inconsistent cells, coordinates and invalid contacts',()=>{
  for(const mutate of [m=>m.cell.volume=20,m=>m.cell.lengths[0]=99,m=>m.cell.angles[2]=60,m=>m.atoms[0].position=[NaN,0,0],m=>m.atoms[0].fractional=[.4,0,0],m=>m.bonds[0].j=20,m=>m.elements[0].count=99,m=>m.atoms[0].occupancy=1.5,m=>{m.atoms[1].element='C';m.elements=[{symbol:'H',count:1,color:'#ffffff'},{symbol:'H',count:1,color:'#ffffff'}];}]){const m=structure();mutate(m);assert.throws(()=>validateStructure(m));}
});
test('portable projects retain unit and displayed structures but reject unsafe display values',()=>{
  const p={format:'crystal-studio-project',version:1,unit:structure(),view:structure(),settings:{representation:'ball-stick',atomScale:1,bondScale:1.1,repetitions:[1,1,1],background:'dark',colors:{H:'#abcdef'},showCell:true,showAxes:true,showPeriodic:true,showLegend:true},camera:{position:[10,10,10],target:[0,0,0],zoom:1}};
  assert.equal(validateProject(p),p);p.settings.repetitions=[4,4,4];assert.throws(()=>validateProject(p),/supercell/);p.settings.repetitions=[1,1,1];p.view.atoms[1].element='C';p.view.elements=[{symbol:'H',count:1,color:'#ffffff'},{symbol:'C',count:1,color:'#909090'}];assert.throws(()=>validateProject(p),/displayed atoms/);p.view=structure();p.settings.colors.H='url(javascript:alert(1))';assert.throws(()=>validateProject(p),/colors/);
});
test('publication dimensions correspond to physical centimetres and hardware limits',()=>{
  assert.deepEqual(exportDimensions(5,5,1600),{width:3150,height:3150,widthCm:5,heightCm:5,dpi:1600});
  assert.throws(()=>exportDimensions(30,30,2400),/Reduce/);
  assert.throws(()=>exportDimensions(0,5,600));
  assert.throws(()=>exportDimensions(5,5,599.5));
});
test('PNG embeds a single physical-resolution chunk in pixels per metre',()=>{
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV8sAAAAASUVORK5CYII=','base64');
  const png=pngWithDpi(pngWithDpi(bytes,300),600),view=new DataView(png.buffer);let count=0;
  for(let offset=8;offset<png.length;){const length=view.getUint32(offset);if(Buffer.from(png.slice(offset+4,offset+8)).toString()==='pHYs'){count++;assert.equal(length,9);assert.equal(view.getUint32(offset+8),Math.round(600/.0254));assert.equal(view.getUint32(offset+12),Math.round(600/.0254));assert.equal(png[offset+16],1);}offset+=length+12;}
  assert.equal(count,1);assert.throws(()=>pngWithDpi(bytes,0));
});
