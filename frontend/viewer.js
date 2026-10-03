import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cellEdges } from './model.js';
import { layoutElementLegend, drawElementLegend } from './legend.js';

export class CrystalViewer {
  constructor(container, onSelect) {
    this.container = container; this.onSelect = onSelect; this.pickable = []; this.labels = []; this.selected = [];
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
    this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    this.renderer.domElement.addEventListener('pointerdown',e => { this.pointerStart=[e.clientX,e.clientY]; });
    this.renderer.domElement.addEventListener('pointerup',e => {
      if(e.button!==0||!this.pointerStart||Math.hypot(e.clientX-this.pointerStart[0],e.clientY-this.pointerStart[1])>5)return;
      const rect=this.renderer.domElement.getBoundingClientRect(); this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
      this.raycaster.setFromCamera(this.pointer,this.camera);
      const hit=this.raycaster.intersectObjects(this.pickable,false)[0];
      if(hit&&hit.instanceId!==undefined)this.onSelect(hit.object.userData.ids[hit.instanceId]);
    });
    this.observer=new ResizeObserver(()=>this.resize()); this.observer.observe(container);
    this.renderer.setAnimationLoop(()=>{ this.controls.update(); this.renderer.render(this.scene,this.camera); this.updateLabels(); });
    this.resize();
  }
  resize() {
    const width=Math.max(1,this.container.clientWidth),height=Math.max(1,this.container.clientHeight); this.aspect=width/height;
    const half=(this.halfHeight||8)/Math.min(1,this.aspect); this.camera.left=-half*this.aspect; this.camera.right=half*this.aspect; this.camera.top=half; this.camera.bottom=-half; this.camera.updateProjectionMatrix();
    this.renderer.setSize(width,height); this.updateLabels();
  }
  clear() {
    this.group.traverse(node=>{ if(node.material){ const materials=Array.isArray(node.material)?node.material:[node.material]; materials.forEach(m=>m.dispose()); } if(node.geometry&&node.geometry!==this.sphereGeometry&&node.geometry!==this.cylinderGeometry)node.geometry.dispose(); });
    this.group.clear(); this.pickable=[]; this.labels=[];
  }
  setStructure(structure, settings, reset=false) { this.model=structure; this.settings=settings; this.build(); if(reset)this.fit(); }
  build() {
    this.clear(); const m=this.model,s=this.settings;if(!m)return;
    this.renderer.setClearColor(s.background==='light'?'#f5f7f3':'#102b32',1); this.container.classList.toggle('paper',s.background==='light');
    const matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion(),unit=new THREE.Vector3(0,1,0);
    if(s.representation!=='bonds') {
      for(const element of m.elements) {
        const atoms=m.atoms.filter(a=>a.element===element.symbol),material=new THREE.MeshPhongMaterial({ color:s.colors[element.symbol]||element.color,shininess:65,specular:0x6b7779 });
        const mesh=new THREE.InstancedMesh(this.sphereGeometry,material,atoms.length); mesh.userData.ids=atoms.map(a=>a.id);
        atoms.forEach((atom,index)=>{ const radius=(s.representation==='spacefill'?atom.vdwRadius:atom.covalentRadius*(s.representation==='spheres'?.65:.32))*s.atomScale; matrix.compose(new THREE.Vector3(...atom.position),quaternion,new THREE.Vector3(radius,radius,radius)); mesh.setMatrixAt(index,matrix); });
        mesh.computeBoundingSphere();this.group.add(mesh);this.pickable.push(mesh);
      }
    }
    if(!['spheres','spacefill'].includes(s.representation)) {
      const bonds=m.bonds.filter(b=>s.showPeriodic||b.shift.every(n=>n===0));
      const material=new THREE.MeshPhongMaterial({color:s.background==='light'?0x809295:0x7dabb0,shininess:30});
      if(bonds.length) {
        const mesh=new THREE.InstancedMesh(this.cylinderGeometry,material,bonds.length),radius=s.representation==='bonds'?.055:.045;
        bonds.forEach((bond,index)=>{const a=new THREE.Vector3(...bond.start),b=new THREE.Vector3(...bond.end),delta=b.clone().sub(a),mid=a.clone().add(b).multiplyScalar(.5); quaternion.setFromUnitVectors(unit,delta.clone().normalize());matrix.compose(mid,quaternion,new THREE.Vector3(radius,delta.length(),radius));mesh.setMatrixAt(index,matrix);});
        mesh.computeBoundingSphere(); this.group.add(mesh);
        if(s.showPeriodic) {
          const ghosts=new Map(); for(const b of bonds)if(b.shift.some(n=>n!==0))ghosts.set(b.end.map(n=>n.toFixed(5)).join(','),{p:b.end,atom:m.atoms[b.j]});
          for(const element of m.elements) {
            const entries=[...ghosts.values()].filter(g=>g.atom.element===element.symbol);if(!entries.length)continue;
            const ghost=new THREE.InstancedMesh(this.sphereGeometry,new THREE.MeshPhongMaterial({color:s.colors[element.symbol]||element.color,transparent:true,opacity:.18,depthWrite:false}),entries.length);
            entries.forEach((g,index)=>{quaternion.identity();const r=g.atom.covalentRadius*.26*s.atomScale;matrix.compose(new THREE.Vector3(...g.p),quaternion,new THREE.Vector3(r,r,r));ghost.setMatrixAt(index,matrix);});ghost.computeBoundingSphere();this.group.add(ghost);
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
    this.updateLabels();
  }
  highlight(ids) {
    this.selected=ids;if(!this.selectionGroup||!this.model)return;
    this.selectionGroup.traverse(n=>n.material?.dispose());this.selectionGroup.clear();
    for(const id of ids){const atom=this.model.atoms[id];if(!atom)continue;const radius=(this.settings.representation==='spacefill'?atom.vdwRadius:atom.covalentRadius*(this.settings.representation==='spheres'?.65:.32))*this.settings.atomScale*1.08;const mesh=new THREE.Mesh(this.sphereGeometry,new THREE.MeshBasicMaterial({color:0xf1ca76,wireframe:true,transparent:true,opacity:.65}));mesh.position.set(...atom.position);mesh.scale.setScalar(radius);this.selectionGroup.add(mesh);}
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
  exportLimit(){const gl=this.renderer.getContext();return Math.min(4096,this.renderer.capabilities.maxTextureSize,gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));}
  capture({width,height,transparent,legend}) {
    const renderer=this.renderer,camera=this.camera,size=renderer.getSize(new THREE.Vector2()),pixelRatio=renderer.getPixelRatio(),oldColor=renderer.getClearColor(new THREE.Color()),oldAlpha=renderer.getClearAlpha();
    const frustum={left:camera.left,right:camera.right,top:camera.top,bottom:camera.bottom};
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
    const legendLayout=legend?layoutElementLegend(ctx,this.model.elements,width,height):{height:0};
    const sceneHeight=height-legendLayout.height,aspect=width/sceneHeight;
    const oldBackground=this.settings.background;let result;
    try {
      this.settings={...this.settings,background:'light'};this.build();
      renderer.setPixelRatio(1);renderer.setSize(width,sceneHeight,false);renderer.setClearColor(0xffffff,transparent?0:1);
      const half=Math.max((frustum.top-frustum.bottom)/2,(frustum.right-frustum.left)/2/aspect);camera.top=half;camera.bottom=-half;camera.left=-half*aspect;camera.right=half*aspect;camera.updateProjectionMatrix();
      renderer.render(this.scene,camera);
      if(!transparent){ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);}
      ctx.drawImage(renderer.domElement,0,legendLayout.height);
      if(legend) {
        drawElementLegend(ctx,legendLayout,this.settings.colors);
        ctx.save();ctx.beginPath();ctx.rect(0,legendLayout.height,width,sceneHeight);ctx.clip();ctx.font=legendLayout.font+'px system-ui';ctx.fillStyle='#213b40';
        for(const axis of this.labels){const p=axis.position.clone().project(camera);if(p.z>=-1&&p.z<=1)ctx.fillText(axis.name,(p.x+1)*width/2,legendLayout.height+(-p.y+1)*sceneHeight/2);}
        ctx.restore();
      }
      result=canvas.toDataURL('image/png');
    } finally {
      this.settings={...this.settings,background:oldBackground};this.build();renderer.setPixelRatio(pixelRatio);renderer.setSize(size.x,size.y,false);renderer.setClearColor(oldColor,oldAlpha);Object.assign(camera,frustum);camera.updateProjectionMatrix();renderer.render(this.scene,camera);this.updateLabels();
    }
    return result;
  }
}
