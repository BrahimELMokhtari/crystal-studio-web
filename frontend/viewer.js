import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cellEdges, getDisplayBonds, atomRenderRadius } from './model.js';
import { layoutElementLegend, drawElementLegend } from './legend.js';
import { EXPORT_SIDE_CAP, validateCaptureSize, physicalGapPixels, fitExportFrame, scanAlphaBounds, alignRasterBounds } from './export-layout.js';

export class CrystalViewer {
  constructor(container, onSelect, onConnect) {
    this.container = container; this.onSelect = onSelect; this.pickable = []; this.labels = []; this.selected = [];
    this.onConnect=onConnect;this.connectionMode=false;this.connectionEndpoint=null;this.connectionGesture=null;
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2)); this.renderer.setClearColor('#102b32',1);
    this.renderer.domElement.setAttribute('aria-label','Interactive three-dimensional crystal structure');
    this.renderer.domElement.setAttribute('role','img'); container.prepend(this.renderer.domElement);
    this.camera = new THREE.OrthographicCamera(-8,8,8,-8,.01,10000);
    this.camera.position.set(12,-16,12); this.camera.up.set(0,0,1);
    this.controls = new OrbitControls(this.camera,this.renderer.domElement); this.controls.enableDamping = !matchMedia('(prefers-reduced-motion: reduce)').matches; this.controls.dampingFactor = .08;
    this.scene.add(new THREE.HemisphereLight(0xeaf9ff,0x425a6e,2.2));
    const key = new THREE.DirectionalLight(0xffffff,3.2); key.position.set(10,-8,15); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x91c7cc,1.4); rim.position.set(-8,5,8); this.scene.add(rim);
    this.sphereGeometry = new THREE.SphereGeometry(1,28,20); this.cylinderGeometry = new THREE.CylinderGeometry(1,1,1,14);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.connectionPreview=new THREE.Group();this.scene.add(this.connectionPreview);
    this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    const canvas=this.renderer.domElement;
    canvas.addEventListener('pointerdown',event=>this.pointerDown(event),true);
    canvas.addEventListener('pointermove',event=>this.pointerMove(event),true);
    canvas.addEventListener('pointerup',event=>this.pointerUp(event),true);
    canvas.addEventListener('pointercancel',event=>{
      if(this.connectionGesture?.pointerId===event.pointerId){event.stopImmediatePropagation();this.cancelConnectionGesture();}
      else if(this.pointerStart?.pointerId===event.pointerId)this.pointerStart=null;
    },true);
    canvas.addEventListener('lostpointercapture',event=>{
      if(this.connectionGesture?.pointerId===event.pointerId)this.cancelConnectionGesture();
    });
    window.addEventListener('blur',()=>this.cancelConnectionGesture());
    window.addEventListener('keydown',event=>{if(event.key==='Escape')this.cancelConnectionGesture();});
    this.observer=new ResizeObserver(()=>this.resize()); this.observer.observe(container);
    this.renderer.setAnimationLoop(()=>{ if(!this.connectionGesture)this.controls.update(); this.renderer.render(this.scene,this.camera); this.updateLabels(); });
    this.resize();
  }
  resize() {
    const width=Math.max(1,this.container.clientWidth),height=Math.max(1,this.container.clientHeight); this.aspect=width/height;
    const half=(this.halfHeight||8)/Math.min(1,this.aspect); this.camera.left=-half*this.aspect; this.camera.right=half*this.aspect; this.camera.top=half; this.camera.bottom=-half; this.camera.updateProjectionMatrix();
    this.renderer.setSize(width,height); this.updateLabels();
  }
  pickAtom(event) {
    const rect=this.renderer.domElement.getBoundingClientRect();
    if(!rect.width||!rect.height)return null;
    this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    this.camera.updateMatrixWorld(true);this.group.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    if(Math.abs(this.pointer.x)>1||Math.abs(this.pointer.y)>1)return null;
    const hit=this.raycaster.intersectObjects(this.pickable,false)[0];
    return hit&&hit.instanceId!==undefined?hit.object.userData.ids[hit.instanceId]:null;
  }
  setConnectionMode(enabled) {
    const next=Boolean(enabled);
    if(next!==this.connectionMode||!next)this.cancelConnectionGesture();
    this.connectionMode=next;
    this.renderer.domElement.style.cursor=next?'crosshair':'';
  }
  finishConnectionPointer() {
    const gesture=this.connectionGesture;this.connectionGesture=null;
    if(!gesture)return;
    this.controls.enabled=gesture.controlsEnabled;
    const canvas=this.renderer.domElement;
    if(canvas.hasPointerCapture(gesture.pointerId))canvas.releasePointerCapture(gesture.pointerId);
  }
  cancelConnectionGesture() {
    this.finishConnectionPointer();this.connectionEndpoint=null;this.pointerStart=null;
    this.clearConnectionPreview();
  }
  pointerDown(event) {
    if(event.button!==0||event.isPrimary===false){this.pointerStart=null;return;}
    if(this.connectionGesture)return;
    this.pointerStart={pointerId:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
    if(!this.connectionMode)return;
    const id=this.pickAtom(event);
    if(id===null){this.connectionEndpoint=null;this.clearConnectionPreview();return;}
    event.preventDefault();event.stopImmediatePropagation();
    this.pointerStart=null;
    this.connectionGesture={pointerId:event.pointerId,startId:id,x:event.clientX,y:event.clientY,
      dragged:false,controlsEnabled:this.controls.enabled};
    this.controls.enabled=false;
    try{this.renderer.domElement.setPointerCapture(event.pointerId);}
    catch{this.cancelConnectionGesture();return;}
    this.showConnectionPreview(this.connectionEndpoint??id);
  }
  pointerMove(event) {
    const gesture=this.connectionGesture;
    if(!gesture||gesture.pointerId!==event.pointerId){
      if(this.pointerStart?.pointerId===event.pointerId&&Math.hypot(event.clientX-this.pointerStart.x,event.clientY-this.pointerStart.y)>5)this.pointerStart.moved=true;
      return;
    }
    event.preventDefault();event.stopImmediatePropagation();
    gesture.dragged||=Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>5;
    if(!gesture.dragged)return;
    this.connectionEndpoint=null;
    const id=this.pickAtom(event),start=new THREE.Vector3(...this.model.atoms[gesture.startId].position);
    const end=id!==null?new THREE.Vector3(...this.model.atoms[id].position):
      this.raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()),start),new THREE.Vector3());
    this.showConnectionPreview(gesture.startId,end);
  }
  pointerUp(event) {
    const gesture=this.connectionGesture;
    if(gesture?.pointerId===event.pointerId){
      event.preventDefault();event.stopImmediatePropagation();
      const id=this.pickAtom(event);
      const dragged=gesture.dragged||Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>5;
      this.finishConnectionPointer();
      if(dragged){
        this.cancelConnectionGesture();
        if(id!==null&&id!==gesture.startId)this.onConnect?.(gesture.startId,id);
      }else if(id===null||id===this.connectionEndpoint){
        this.cancelConnectionGesture();
      }else if(this.connectionEndpoint===null){
        this.connectionEndpoint=id;this.showConnectionPreview(id);
      }else{
        const first=this.connectionEndpoint;this.cancelConnectionGesture();this.onConnect?.(first,id);
      }
      return;
    }
    const start=this.pointerStart;this.pointerStart=null;
    if(event.button!==0||!start||start.pointerId!==event.pointerId||start.moved||
      Math.hypot(event.clientX-start.x,event.clientY-start.y)>5)return;
    const id=this.pickAtom(event);
    if(this.connectionMode){if(id===null)this.cancelConnectionGesture();return;}
    if(id!==null)this.onSelect?.(id);
  }
  clearConnectionPreview() {
    this.connectionPreview.traverse(node=>{
      if(node.material)node.material.dispose();
      if(node.geometry&&node.geometry!==this.sphereGeometry)node.geometry.dispose();
    });
    this.connectionPreview.clear();this.previewAtomId=null;this.previewHighlight=null;this.previewLine=null;
  }
  showConnectionPreview(id,end=null) {
    const atom=this.model?.atoms[id];
    if(!atom){this.clearConnectionPreview();return;}
    const color=this.settings.background==='light'?0x0b706a:0x5fe0d0;
    if(this.previewAtomId!==id||!this.previewHighlight){
      this.clearConnectionPreview();this.previewAtomId=id;
      this.previewHighlight=new THREE.Mesh(this.sphereGeometry,new THREE.MeshBasicMaterial({
        color,wireframe:true,transparent:true,opacity:.8,depthTest:false,depthWrite:false
      }));
      this.previewHighlight.renderOrder=10;this.connectionPreview.add(this.previewHighlight);
    }
    const start=new THREE.Vector3(...atom.position);
    this.previewHighlight.material.color.setHex(color);
    this.previewHighlight.position.copy(start);
    this.previewHighlight.scale.setScalar(atomRenderRadius(atom,this.settings,{selected:true}));
    if(end&&start.distanceToSquared(end)>1e-12){
      if(!this.previewLine){
        this.previewLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints([start,end]),
          new THREE.LineBasicMaterial({color,transparent:true,opacity:.9,depthTest:false,depthWrite:false}));
        this.previewLine.renderOrder=11;this.previewLine.frustumCulled=false;
        this.connectionPreview.add(this.previewLine);
      }else{
        const position=this.previewLine.geometry.attributes.position;
        position.setXYZ(0,start.x,start.y,start.z);position.setXYZ(1,end.x,end.y,end.z);position.needsUpdate=true;
        this.previewLine.material.color.setHex(color);
      }
    }else if(this.previewLine){
      this.connectionPreview.remove(this.previewLine);this.previewLine.geometry.dispose();this.previewLine.material.dispose();this.previewLine=null;
    }
  }
  clear() {
    this.group.traverse(node=>{ if(node.material){ const materials=Array.isArray(node.material)?node.material:[node.material]; materials.forEach(m=>m.dispose()); } if(node.geometry&&node.geometry!==this.sphereGeometry&&node.geometry!==this.cylinderGeometry)node.geometry.dispose(); });
    this.group.clear(); this.pickable=[]; this.labels=[];
  }
  setStructure(structure,settings,reset=false) {
    if(structure!==this.model)this.cancelConnectionGesture();
    this.model=structure;this.settings=settings;this.build();if(reset)this.fit();
  }
  build() {
    this.clear(); const m=this.model,s=this.settings;if(!m)return;
    this.renderer.setClearColor(s.background==='light'?'#f5f7f3':'#102b32',1); this.container.classList.toggle('paper',s.background==='light');
    const matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion(),unit=new THREE.Vector3(0,1,0);
    if(s.representation!=='bonds') {
      for(const element of m.elements) {
        const atoms=m.atoms.filter(a=>a.element===element.symbol),material=new THREE.MeshPhongMaterial({ color:s.colors[element.symbol]||element.color,shininess:65,specular:0x6b7779 });
        const mesh=new THREE.InstancedMesh(this.sphereGeometry,material,atoms.length); mesh.userData.ids=atoms.map(a=>a.id);mesh.userData.exportAtom=true;
        atoms.forEach((atom,index)=>{ const radius=atomRenderRadius(atom,s); matrix.compose(new THREE.Vector3(...atom.position),quaternion,new THREE.Vector3(radius,radius,radius)); mesh.setMatrixAt(index,matrix); });
        mesh.computeBoundingSphere();this.group.add(mesh);this.pickable.push(mesh);
      }
    }
    if(!['spheres','spacefill'].includes(s.representation)) {
      const bonds=getDisplayBonds(m,s);
      const material=new THREE.MeshPhongMaterial({color:s.background==='light'?0x809295:0x7dabb0,shininess:30});
      if(bonds.length) {
        const mesh=new THREE.InstancedMesh(this.cylinderGeometry,material,bonds.length),radius=s.representation==='bonds'?.055:.045;
        bonds.forEach((bond,index)=>{const a=new THREE.Vector3(...bond.start),b=new THREE.Vector3(...bond.end),delta=b.clone().sub(a),mid=a.clone().add(b).multiplyScalar(.5); quaternion.setFromUnitVectors(unit,delta.clone().normalize());matrix.compose(mid,quaternion,new THREE.Vector3(radius,delta.length(),radius));mesh.setMatrixAt(index,matrix);});
        mesh.computeBoundingSphere(); this.group.add(mesh);
        if(s.showPeriodic) {
          const ghosts=new Map(); for(const b of bonds)if(b.shift.some(n=>n!==0))ghosts.set(b.end.map(n=>n.toFixed(5)).join(','),{p:b.end,atom:m.atoms[b.j]});
          for(const element of m.elements) {
            const entries=[...ghosts.values()].filter(g=>g.atom.element===element.symbol);if(!entries.length)continue;
            const ghost=new THREE.InstancedMesh(this.sphereGeometry,new THREE.MeshPhongMaterial({color:s.colors[element.symbol]||element.color,transparent:true,opacity:.18,depthWrite:false}),entries.length);ghost.userData.exportAtom=true;
            entries.forEach((g,index)=>{quaternion.identity();const r=atomRenderRadius(g.atom,s,{ghost:true});matrix.compose(new THREE.Vector3(...g.p),quaternion,new THREE.Vector3(r,r,r));ghost.setMatrixAt(index,matrix);});ghost.computeBoundingSphere();this.group.add(ghost);
          }
        }
      } else material.dispose();
    }
    if(s.showCell) {
      const points=cellEdges(m.cell.vectors).flat().map(p=>new THREE.Vector3(...p));
      this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:s.background==='light'?0x54666d:0x8eadb0,transparent:true,opacity:.55})));
    }
    if(s.showAxes) {
      const length=Math.min(...m.cell.lengths)*.35;
      m.cell.vectors.forEach((v,index)=>{const direction=new THREE.Vector3(...v).normalize(),end=direction.clone().multiplyScalar(length*1.18); this.group.add(new THREE.ArrowHelper(direction,new THREE.Vector3(),length,[0xef8e83,0x83c4a3,0x87b9ee][index],length*.13,length*.07));this.labels.push({name:['a','b','c'][index],position:end});});
    }
    this.selectionGroup=new THREE.Group();this.group.add(this.selectionGroup);this.highlight(this.selected);
    const previewId=this.connectionGesture?.startId??this.connectionEndpoint;
    if(previewId!==null&&previewId!==undefined)this.showConnectionPreview(previewId);
    this.updateLabels();
  }
  highlight(ids) {
    this.selected=ids;if(!this.selectionGroup||!this.model)return;
    this.selectionGroup.traverse(n=>n.material?.dispose());this.selectionGroup.clear();
    for(const id of ids){const atom=this.model.atoms[id];if(!atom)continue;const radius=atomRenderRadius(atom,this.settings,{selected:true});const mesh=new THREE.Mesh(this.sphereGeometry,new THREE.MeshBasicMaterial({color:0xf1ca76,wireframe:true,transparent:true,opacity:.65}));mesh.userData.exportAtom=true;mesh.position.set(...atom.position);mesh.scale.setScalar(radius);this.selectionGroup.add(mesh);}
  }
  fit(direction='isometric') {
    if(!this.model)return; const box=new THREE.Box3().setFromObject(this.group),center=box.getCenter(new THREE.Vector3()),span=box.getSize(new THREE.Vector3());
    const extent=Math.max(span.x,span.y,span.z,1);this.halfHeight=Math.max(span.length(),1)*.56;this.camera.zoom=1;this.camera.near=Math.max(.0001,extent*.00001);this.camera.far=Math.max(100,extent*12);
    const vector=direction==='isometric'?new THREE.Vector3(1.4,-1.8,1.25):new THREE.Vector3(...this.model.cell.vectors[['a','b','c'].indexOf(direction)]);
    vector.normalize();this.controls.target.copy(center);this.camera.position.copy(center).addScaledVector(vector,extent*4);
    this.camera.up.copy(Math.abs(vector.z)>.95?new THREE.Vector3(0,1,0):new THREE.Vector3(0,0,1));this.camera.lookAt(center);this.resize();this.controls.update();
  }
  updateLabels() {
    const layer=this.container.querySelector('#axis-labels');if(!layer)return;
    for(const label of layer.children){const entry=this.labels.find(a=>a.name===label.dataset.axis);label.hidden=!entry||!this.settings?.showAxes;if(!entry)continue;const p=entry.position.clone().project(this.camera);label.style.left=((p.x+1)/2*100)+'%';label.style.top=((-p.y+1)/2*100)+'%';label.hidden=p.z<-1||p.z>1;}
  }
  zoom(factor){this.camera.zoom=Math.max(.1,Math.min(30,this.camera.zoom*factor));this.camera.updateProjectionMatrix();}
  cameraState(){return {position:this.camera.position.toArray(),target:this.controls.target.toArray(),up:this.camera.up.toArray(),halfHeight:this.halfHeight||8,zoom:this.camera.zoom};}
  restoreCamera(state){if(!state)return;this.camera.position.set(...state.position);this.controls.target.set(...state.target);if(state.up)this.camera.up.set(...state.up);if(state.halfHeight)this.halfHeight=state.halfHeight;this.camera.zoom=state.zoom;this.camera.lookAt(this.controls.target);this.resize();this.controls.update();}
  exportLimit() {
    const gl=this.renderer.getContext(),viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    return Math.min(EXPORT_SIDE_CAP,this.renderer.capabilities.maxTextureSize,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),viewport[0],viewport[1]);
  }
  projectedGeometryBounds(camera) {
    this.group.updateMatrixWorld(true);camera.updateMatrixWorld(true);
    const scene={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity};
    const atoms={...scene},point=new THREE.Vector3(),instance=new THREE.Matrix4(),matrix=new THREE.Matrix4();
    const expand=(bounds,x,y,z,rx=0,ry=0,rz=0)=>{
      bounds.minX=Math.min(bounds.minX,x-rx);bounds.maxX=Math.max(bounds.maxX,x+rx);
      bounds.minY=Math.min(bounds.minY,y-ry);bounds.maxY=Math.max(bounds.maxY,y+ry);
      bounds.minZ=Math.min(bounds.minZ,z-rz);bounds.maxZ=Math.max(bounds.maxZ,z+rz);
    };
    const add=(node,transform)=>{
      const atom=!!node.userData.exportAtom;
      if(node.geometry===this.sphereGeometry) {
        point.set(0,0,0).applyMatrix4(transform);const e=transform.elements;
        const rx=Math.hypot(e[0],e[4],e[8]),ry=Math.hypot(e[1],e[5],e[9]),rz=Math.hypot(e[2],e[6],e[10]);
        expand(scene,point.x,point.y,point.z,rx,ry,rz);
        if(atom)expand(atoms,point.x,point.y,point.z,rx,ry,rz);
      } else {
        if(!node.geometry.boundingBox)node.geometry.computeBoundingBox();
        const box=node.geometry.boundingBox;if(!box||box.isEmpty())return;
        for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
          point.set(x,y,z).applyMatrix4(transform);expand(scene,point.x,point.y,point.z);
          if(atom)expand(atoms,point.x,point.y,point.z);
        }
      }
    };
    this.group.traverseVisible(node=>{
      if(!node.geometry)return;
      if(node.isInstancedMesh){
        for(let index=0;index<node.count;index++){
          node.getMatrixAt(index,instance);
          matrix.multiplyMatrices(camera.matrixWorldInverse,node.matrixWorld).multiply(instance);add(node,matrix);
        }
      }else{matrix.multiplyMatrices(camera.matrixWorldInverse,node.matrixWorld);add(node,matrix);}
    });
    // Text anchors sit beyond the arrow tips; frame reserves a font-sized margin.
    for(const axis of this.labels){point.copy(axis.position).applyMatrix4(camera.matrixWorldInverse);expand(scene,point.x,point.y,point.z);}
    if(!Number.isFinite(scene.minX))throw new Error('There is no visible structure to export.');
    return {scene,atoms:Number.isFinite(atoms.minX)?atoms:null};
  }
  drawExportAxes(ctx,camera,width,height,font,dx=0) {
    ctx.save();ctx.font=font+'px system-ui';ctx.fillStyle='#213b40';ctx.textAlign='left';ctx.textBaseline='alphabetic';
    for(const axis of this.labels){
      const p=axis.position.clone().project(camera);
      if(p.z>=-1&&p.z<=1)ctx.fillText(axis.name,dx+(p.x+1)*width/2,(-p.y+1)*height/2);
    }
    ctx.restore();
  }
  captureScene({width,height,dpi=300,axes=true}) {
    validateCaptureSize(width,height,dpi,this.exportLimit());
    if(!this.model||!this.settings)throw new Error('Load a structure before exporting.');
    const renderer=this.renderer;
    const size=renderer.getSize(new THREE.Vector2()),pixelRatio=renderer.getPixelRatio();
    const oldColor=renderer.getClearColor(new THREE.Color()),oldAlpha=renderer.getClearAlpha();
    const oldTarget=renderer.getRenderTarget();
    const oldCubeFace=renderer.getActiveCubeFace(),oldMipmapLevel=renderer.getActiveMipmapLevel();
    const oldViewport=renderer.getViewport(new THREE.Vector4());
    const oldScissor=renderer.getScissor(new THREE.Vector4()),oldScissorTest=renderer.getScissorTest();
    const previewVisible=this.connectionPreview.visible;
    const exportCamera=this.camera.clone();exportCamera.updateMatrixWorld(true);
    const aspect=(exportCamera.right-exportCamera.left)/(exportCamera.top-exportCamera.bottom);
    if(!Number.isFinite(aspect)||aspect<=0)throw new Error('The current camera view cannot be exported.');
    const viewWidth=Math.max(1,Math.min(width,Math.round(height*aspect)));
    const viewHeight=Math.max(1,Math.min(height,Math.round(width/aspect)));
    const viewX=Math.floor((width-viewWidth)/2),viewBottom=Math.floor((height-viewHeight)/2);
    const viewY=height-viewBottom-viewHeight;
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw new Error('A canvas for the scene could not be created.');
    let result;
    try {
      this.connectionPreview.visible=false;
      renderer.setRenderTarget(null);renderer.setPixelRatio(1);
      renderer.setSize(width,height,false);renderer.setClearColor(0xffffff,0);
      renderer.setScissorTest(false);renderer.clear(true,true,true);
      renderer.setViewport(viewX,viewBottom,viewWidth,viewHeight);
      renderer.setScissor(viewX,viewBottom,viewWidth,viewHeight);renderer.setScissorTest(true);
      renderer.render(this.scene,exportCamera);ctx.drawImage(renderer.domElement,0,0);
      if(axes&&this.settings.showAxes){
        ctx.save();ctx.beginPath();ctx.rect(viewX,viewY,viewWidth,viewHeight);ctx.clip();ctx.translate(viewX,viewY);
        this.drawExportAxes(ctx,exportCamera,viewWidth,viewHeight,Math.max(6,Math.round(Math.min(viewWidth,viewHeight)*.023)));
        ctx.restore();
      }
      const diagnostics={mode:'current-scene',width,height,dpi,transparent:true,legend:false,preserveFraming:true,
        viewport:{x:viewX,y:viewY,width:viewWidth,height:viewHeight},
        camera:{position:exportCamera.position.toArray(),quaternion:exportCamera.quaternion.toArray(),
          up:exportCamera.up.toArray(),zoom:exportCamera.zoom,left:exportCamera.left,right:exportCamera.right,
          top:exportCamera.top,bottom:exportCamera.bottom,near:exportCamera.near,far:exportCamera.far},
        sceneBounds:scanAlphaBounds(ctx,width,height)};
      const dataUrl=canvas.toDataURL('image/png');
      if(!dataUrl.startsWith('data:image/png;'))throw new Error('The requested scene is too large for this browser.');
      this.lastCaptureDiagnostics=diagnostics;result={canvas,dataUrl,diagnostics};
    } finally {
      this.connectionPreview.visible=previewVisible;
      renderer.setPixelRatio(pixelRatio);renderer.setSize(size.x,size.y,false);renderer.setClearColor(oldColor,oldAlpha);
      renderer.setRenderTarget(oldTarget,oldCubeFace,oldMipmapLevel);
      renderer.setViewport(oldViewport);renderer.setScissor(oldScissor);renderer.setScissorTest(oldScissorTest);
      renderer.render(this.scene,this.camera);this.updateLabels();
    }
    return result;
  }
  capture({width,height,transparent=false,legend=true,dpi=300,legendGapCm=1}) {
    validateCaptureSize(width,height,dpi,this.exportLimit());
    if(!this.model||!this.settings)throw new Error('Load a structure before exporting.');
    const renderer=this.renderer,originalSettings=this.settings;
    const previewVisible=this.connectionPreview.visible;
    const size=renderer.getSize(new THREE.Vector2()),pixelRatio=renderer.getPixelRatio();
    const oldColor=renderer.getClearColor(new THREE.Color()),oldAlpha=renderer.getClearAlpha();
    const oldTarget=renderer.getRenderTarget(),oldViewport=renderer.getViewport(new THREE.Vector4());
    const oldScissor=renderer.getScissor(new THREE.Vector4()),oldScissorTest=renderer.getScissorTest();
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw new Error('A canvas for the figure could not be created.');
    const gapPixels=physicalGapPixels(dpi,legendGapCm);
    const layout=legend?layoutElementLegend(ctx,this.model.elements,width,height):{width:0,height:0};
    drawElementLegend(ctx,layout,originalSettings.colors);
    const legendBounds=layout.width?scanAlphaBounds(ctx,width,height,{width:layout.width,height:layout.height}):null;
    ctx.clearRect(0,0,width,height);
    const axisFont=Math.max(12,Math.round(Math.min(width,height)*.023));
    const margin=Math.max(8,Math.ceil(axisFont*1.3)),exportCamera=this.camera.clone();
    // Live camera, controls target, orbit, pan and zoom remain untouched.
    exportCamera.zoom=1;let result;
    try {
      this.connectionPreview.visible=false;
      this.settings={...originalSettings,background:'light'};this.build();
      const geometry=this.projectedGeometryBounds(exportCamera);
      const targetLeft=legendBounds?legendBounds.right+gapPixels+1:margin+1;
      const atomLeft=legendBounds?(geometry.atoms?.minX??geometry.scene.minX):geometry.scene.minX;
      const frame=fitExportFrame({width,height,bounds:geometry.scene,atomLeft,targetLeft,margin,
        leftGuard:legendBounds?legendBounds.right+margin:margin});
      Object.assign(exportCamera,{left:frame.left,right:frame.right,top:frame.top,bottom:frame.bottom});
      // Move only along cloned camera's depth axis, preserving orientation.
      const depth=Math.max(geometry.scene.maxZ-geometry.scene.minZ,1),depthMargin=Math.max(1,depth*.1);
      const back=new THREE.Vector3(0,0,1).applyQuaternion(exportCamera.quaternion);
      exportCamera.position.addScaledVector(back,geometry.scene.maxZ+depthMargin);
      exportCamera.near=Math.max(.00001,depth*.000001);exportCamera.far=depth+depthMargin*2;
      exportCamera.updateProjectionMatrix();exportCamera.updateMatrixWorld(true);
      renderer.setRenderTarget(null);renderer.setScissorTest(false);renderer.setPixelRatio(1);
      renderer.setSize(width,height,false);renderer.setViewport(0,0,width,height);
      // Measure transparent layers even when final requested background is white.
      renderer.setClearColor(0xffffff,0);
      let atomBounds=null;
      if(geometry.atoms&&legendBounds) {
        const visibility=[];this.group.traverseVisible(node=>{if(node.geometry)visibility.push([node,node.visible]);});
        try {
          for(const [node] of visibility)node.visible=!!node.userData.exportAtom;
          renderer.render(this.scene,exportCamera);ctx.drawImage(renderer.domElement,0,0);
          atomBounds=scanAlphaBounds(ctx,width,height);
        } finally {for(const [node,visible] of visibility)node.visible=visible;}
        ctx.clearRect(0,0,width,height);
      }
      renderer.render(this.scene,exportCamera);ctx.drawImage(renderer.domElement,0,0);
      this.drawExportAxes(ctx,exportCamera,width,height,axisFont);
      const sceneBounds=scanAlphaBounds(ctx,width,height);
      const aligned=alignRasterBounds({legendBounds,atomBounds,sceneBounds,gapPixels,width,height});
      ctx.clearRect(0,0,width,height);
      if(!transparent){ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);}
      // Integer translation preserves measured antialiased silhouette exactly.
      ctx.drawImage(renderer.domElement,aligned.dx,0);
      this.drawExportAxes(ctx,exportCamera,width,height,axisFont,aligned.dx);
      drawElementLegend(ctx,layout,originalSettings.colors);
      const diagnostics={width,height,dpi,transparent,legend,
        requestedGapCm:legendBounds?legendGapCm:null,gapPixels:aligned.gapPixels,
        actualGapCm:legendBounds?gapPixels*2.54/dpi:null,gapReference:aligned.gapReference,
        legendBounds,legendContentRight:legendBounds?.right??null,
        atomBounds:aligned.atomBounds,atomPixelLeft:aligned.atomBounds?.left??null,
        sceneBounds:aligned.sceneBounds,referenceBounds:aligned.referenceBounds,
        sceneTranslationX:aligned.dx,legendColumns:layout.width?1:0};
      const dataUrl=canvas.toDataURL('image/png');
      if(!dataUrl.startsWith('data:image/png;'))throw new Error('The requested figure is too large for this browser.');
      this.lastCaptureDiagnostics=diagnostics;result={canvas,dataUrl,diagnostics};
    } finally {
      this.settings=originalSettings;
      try {this.build();}
      finally {
        this.connectionPreview.visible=previewVisible;
        renderer.setPixelRatio(pixelRatio);renderer.setSize(size.x,size.y,false);
        renderer.setClearColor(oldColor,oldAlpha);renderer.setRenderTarget(oldTarget);
        renderer.setViewport(oldViewport);renderer.setScissor(oldScissor);renderer.setScissorTest(oldScissorTest);
        renderer.render(this.scene,this.camera);this.updateLabels();
      }
    }
    return result;
  }
}
