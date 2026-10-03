"""Independent real-WebGL current-view framing and failure-restoration check.

Run against the ordinary Vite source server, not the compiled public website.
"""
import argparse
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:5174')
args = parser.parse_args()
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
    try:
        page = browser.new_page()
        page.goto(args.url)
        page.wait_for_load_state('networkidle')
        result = page.evaluate('''async () => {
          const {CrystalViewer}=await import(new URL('./viewer.js',location.href).href);
          const examples=await fetch(new URL('./examples.json',location.href)).then(r=>r.json());
          const host=document.createElement('div');host.style.cssText='position:fixed;left:-10000px;top:0;width:400px;height:400px';document.body.append(host);
          const v=new CrystalViewer(host,()=>{},()=>{});
          const check=(condition,message)=>{if(!condition)throw new Error(message);};
          const r=v.renderer;
          const copied=getter=>getter.call(r,{copy(value){return value.toArray();}});
          const state=()=>JSON.stringify({camera:v.cameraState(),quaternion:v.camera.quaternion.toArray(),projection:v.camera.projectionMatrix.toArray(),
            frustum:[v.camera.left,v.camera.right,v.camera.top,v.camera.bottom,v.camera.near,v.camera.far],size:r.getSize(v.pointer.clone()).toArray(),
            pixelRatio:r.getPixelRatio(),color:copied(r.getClearColor),alpha:r.getClearAlpha(),viewport:copied(r.getViewport),
            scissor:copied(r.getScissor),scissorTest:r.getScissorTest(),target:r.getRenderTarget()?.uuid??null,controlsEnabled:v.controls.enabled,
            settings:v.settings,selection:v.selected,previewVisible:v.connectionPreview.visible,previewChildren:v.connectionPreview.children.length});
          try {
            r.setAnimationLoop(null);v.observer.disconnect();
            v.setStructure(structuredClone(examples[0].structure),{representation:'ball-stick',atomScale:1,elementScales:{},bondScale:1.1,
              showCell:false,showAxes:false,showPeriodic:false,showLegend:true,background:'dark',colors:{},repetitions:[1,1,1],connectionMode:'automatic',customBonds:[]},true);
            v.fit('c');v.zoom(1.25);
            const pan=v.camera.position.clone().set(.6,-.25,0);v.controls.target.add(pan);v.camera.position.add(pan);v.camera.lookAt(v.controls.target);v.camera.updateMatrixWorld(true);
            v.highlight([0]);v.showConnectionPreview(0);
            v.connectionPreview.visible=false;const withoutPreview=v.captureScene({width:600,height:600,dpi:300});v.connectionPreview.visible=true;
            const before=state();
            const square=v.captureScene({width:600,height:600,dpi:300});
            check(square.dataUrl===withoutPreview.dataUrl,'Transient connection preview appeared in export');
            check(state()===before,'Square capture changed live state');
            const rect=v.captureScene({width:1000,height:600,dpi:300});
            check(state()===before,'Rectangular capture changed live state');
            check(JSON.stringify(rect.diagnostics.viewport)===JSON.stringify({x:200,y:0,width:600,height:600}),'Wrong letterbox viewport');
            const sq=square.canvas.getContext('2d').getImageData(0,0,600,600).data;
            const re=rect.canvas.getContext('2d').getImageData(0,0,1000,600).data;
            let opaque=0,paddingPixels=0,alphaDifferences=0;
            for(let y=0;y<600;y++)for(let x=0;x<1000;x++){
              const alpha=re[(y*1000+x)*4+3];
              if(x<200||x>=800){paddingPixels++;check(alpha===0,'Letterbox margin has a background');}
              else{const expected=sq[(y*600+x-200)*4+3];if(alpha!==expected)alphaDifferences++;if(alpha)opaque++;}
            }
            check(opaque>0,'Fixture scene exported empty');check(alphaDifferences<360,'Square/rectangular scene alpha moved');
            const sb=square.diagnostics.sceneBounds,rb=rect.diagnostics.sceneBounds;
            check(Math.abs(rb.left-sb.left-200)<=1&&Math.abs(rb.right-sb.right-200)<=1&&Math.abs(rb.top-sb.top)<=1&&Math.abs(rb.bottom-sb.bottom)<=1,'Current framing changed');
            const original=HTMLCanvasElement.prototype.toDataURL;let caught=false;
            try{HTMLCanvasElement.prototype.toDataURL=function(){throw new Error('forced PNG encoding failure');};v.captureScene({width:700,height:500,dpi:300});}
            catch(error){caught=error.message==='forced PNG encoding failure';}
            finally{HTMLCanvasElement.prototype.toDataURL=original;}
            check(caught,'Failure injection did not execute');check(state()===before,'Failed capture did not restore live state');
            return {square:square.diagnostics.viewport,rect:rect.diagnostics.viewport,opaque,paddingPixels,alphaDifferences,restoredAfterFailure:true};
          }finally{
            r.setAnimationLoop(null);v.observer.disconnect();v.cancelConnectionGesture();v.controls.dispose();v.clear();v.sphereGeometry.dispose();v.cylinderGeometry.dispose();r.dispose();host.remove();
          }
        }''')
        print('PASS exact current framing, transparent rectangular margins, hidden connection preview and restoration after encoding failure', result)
    finally:
        browser.close()
