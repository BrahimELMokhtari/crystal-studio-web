import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const root=fileURLToPath(new URL('../',import.meta.url));
const base='http://127.0.0.1:5174';
const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),headless:true,args:['--enable-unsafe-swiftshader']});
const errors=[];const consoleErrors=[];
try {
  await mkdir(root+'/artifacts',{recursive:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error'&&!msg.text().includes('422')&&!msg.text().includes('400'))consoleErrors.push(msg.text());});
  await page.goto(base,{waitUntil:'networkidle'});
  await expect(page.locator('#status')).toContainText('Ready');
  await expect(page.locator('#structure-title')).toContainText('Sodium chloride');
  assert.ok(await page.locator('#viewport canvas').evaluate(canvas=>canvas.toDataURL().length>20000),'Actual WebGL scene is rendered');
  await expect(page.locator('#open-export')).toBeEnabled();
  for(const width of [320,375,768,1440]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const box=await page.evaluate(()=>({width:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));
    assert.ok(box.width<=box.view+1,'Responsive width '+width+': '+JSON.stringify(box));
    const canvas=await page.locator('#viewport canvas').boundingBox();assert.ok(canvas.width>200&&canvas.height>=350,'Usable 3D view at '+width);
    await page.locator('#open-settings').focus();await page.keyboard.press('Tab');await expect(page.locator(width<=980?'#camera-view':'.sidebar .panel:first-child > summary')).toBeFocused();
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:root+'/artifacts/workspace-desktop.png'});
  console.log('PASS actual WebGL rendering, initial example and four responsive viewport layouts');
  await page.locator('#example-select').selectOption('periodic');
  await page.getByRole('tab',{name:'Atoms',exact:true}).click();
  await expect(page.locator('#atom-rows tr')).toHaveCount(2);
  await page.getByRole('button',{name:'Select H atom 1',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Select H atom 1',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Select H atom 2',exact:true})).toBeFocused();await page.keyboard.press('Space');await expect(page.getByRole('button',{name:'Select H atom 2',exact:true})).toBeFocused();
  await page.getByRole('tab',{name:'Measurements',exact:true}).click();
  await expect(page.locator('#measurements')).toContainText('9.80000 Å');
  await expect(page.locator('#measurements')).toContainText('0.20000 Å');
  await expect(page.locator('#measurements')).toContainText('[-1, 0, 0]');
  await page.locator('#clear-selection').click();await page.getByRole('tab',{name:'Atoms',exact:true}).click();await page.getByRole('button',{name:'Select H atom 2',exact:true}).click();await page.getByRole('button',{name:'Select H atom 1',exact:true}).click();await page.getByRole('tab',{name:'Measurements',exact:true}).click();await expect(page.locator('#measurements')).toContainText('[1, 0, 0]');
  await page.locator('#representation').selectOption('spheres');
  await page.getByLabel('H color',{exact:true}).evaluate(input=>{input.value='#f08040';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#background').selectOption('light');
  const projectPromise=page.waitForEvent('download');await page.locator('#save-project').click();const projectDownload=await projectPromise;await projectDownload.saveAs(root+'/artifacts/saved-project.json');
  const project=JSON.parse(await readFile(root+'/artifacts/saved-project.json','utf8'));assert.equal(project.settings.representation,'spheres');assert.equal(project.settings.colors.H,'#f08040');assert.equal(project.unit.atoms.length,2);
  await page.locator('#example-select').selectOption('bcc');
  await page.locator('#project-file').setInputFiles(root+'/artifacts/saved-project.json');
  await expect(page.locator('#status')).toContainText('Project restored');await expect(page.locator('#representation')).toHaveValue('spheres');
  project.view.name='<img src=x onerror="window.__injected=true">';
  await page.locator('#project-file').setInputFiles({name:'untrusted.crystal.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.locator('#structure-title')).toContainText('<img');assert.equal(await page.locator('#structure-title img').count(),0);assert.equal(await page.evaluate(()=>window.__injected),undefined);
  console.log('PASS periodic contact inspection, atom selection, measurements and safe project persistence');
  await page.locator('#open-settings').click();await page.locator('#api-url').fill('http://127.0.0.1:8000');await page.locator('#test-service').click();await expect(page.locator('#service-result')).toContainText('Connected');await page.getByRole('button',{name:'Save connection',exact:true}).click();
  await page.locator('#example-select').selectOption('nacl');
  const supercell=page.locator('.panel').filter({has:page.locator('#repeat-a')});await supercell.locator('summary').click();
  await page.locator('#repeat-a').fill('2');await page.locator('#apply-supercell').click();await expect(page.locator('#status')).toContainText('Structure updated');await expect(page.locator('#structure-meta')).toContainText('16 atoms');
  const expandedProjectPromise=page.waitForEvent('download');await page.locator('#save-project').click();await (await expandedProjectPromise).saveAs(root+'/artifacts/expanded-project.json');await page.locator('#example-select').selectOption('bcc');await page.locator('#project-file').setInputFiles(root+'/artifacts/expanded-project.json');await expect(page.locator('#status')).toContainText('Project restored');await expect(page.locator('#structure-meta')).toContainText('16 atoms');
  await page.locator('#repeat-a').fill('1');await page.locator('#apply-supercell').click();await expect(page.locator('#structure-meta')).toContainText('8 atoms');
  const cutoffResponse=page.waitForResponse(response=>response.url().endsWith('/api/rebuild')&&response.request().postDataJSON()?.bondScale===1.2);
  await page.locator('#bond-scale').evaluate(input=>{input.value='1.2';input.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal((await cutoffResponse).status(),200);await expect(page.locator('#bond-scale-value')).toHaveText('1.20×');await expect(page.locator('#busy-overlay')).not.toBeVisible({timeout:15000});
  // A newer local reset must win even if an older remote rebuild finishes later.
  let releaseResponse;const delayedResponse=new Promise(resolve=>releaseResponse=resolve);let requestStarted;const started=new Promise(resolve=>requestStarted=resolve);
  await page.route('**/api/rebuild',async route=>{const response=await route.fetch();requestStarted();await delayedResponse;await route.fulfill({response}).catch(()=>{});});
  await page.locator('#bond-scale').evaluate(input=>{input.value='1.3';input.dispatchEvent(new Event('input',{bubbles:true}));});await started;
  await page.locator('#bond-scale').evaluate(input=>{input.value='1.1';input.dispatchEvent(new Event('input',{bubbles:true}));});await expect(page.locator('#bond-scale-value')).toHaveText('1.10×');await expect(page.locator('#busy-overlay')).not.toBeVisible();
  releaseResponse();await page.unrouteAll({behavior:'wait'});await expect(page.locator('#bond-scale')).toHaveValue('1.1');await expect(page.locator('#structure-meta')).toContainText('8 atoms');
  const cif=`data_boundary
_cell_length_a 10
_cell_length_b 10
_cell_length_c 10
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P 1'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
H1 H .01 .5 .5
H2 H .99 .5 .5
`;
  await page.locator('#structure-file').setInputFiles({name:'boundary.cif',mimeType:'chemical/x-cif',buffer:Buffer.from(cif)});await expect(page.locator('#status')).toContainText('Loaded boundary.cif');await expect(page.locator('#structure-meta')).toContainText('2 atoms');
  const title=await page.locator('#structure-title').textContent();
  const invalidResponse=page.waitForResponse(response=>response.url().endsWith('/api/structure')&&response.status()===422);
  await page.locator('#structure-file').setInputFiles({name:'invalid.cif',mimeType:'chemical/x-cif',buffer:Buffer.from('not a crystal file')});await invalidResponse;await expect(page.locator('#busy-overlay')).not.toBeVisible();await expect(page.locator('#structure-title')).toHaveText(title);
  console.log('PASS real Python API, CIF import, invalid import retention, cutoff rebuilding and supercell recalculation');
  await page.locator('#example-select').selectOption('nacl');await page.locator('#representation').selectOption('ball-stick');await page.locator('#background').selectOption('dark');
  await page.locator('#open-export').click();await page.locator('#export-width').fill('5');await page.locator('#export-height').fill('5');await page.locator('#export-dpi').fill('300');await page.locator('#export-background').selectOption('transparent');await expect(page.locator('#export-summary')).toContainText('591 × 591 px');
  const pngPromise=page.waitForEvent('download');await page.locator('#export-submit').click();const png=await pngPromise;await png.saveAs(root+'/artifacts/figure.png');
  await page.locator('#open-export').click();await page.locator('#export-format').selectOption('pdf');const pdfPromise=page.waitForEvent('download');await page.locator('#export-submit').click();const pdf=await pdfPromise;await pdf.saveAs(root+'/artifacts/figure.pdf');
  const content=await readFile(root+'/artifacts/figure.pdf');assert.ok(content.subarray(0,4).toString()==='%PDF');const match=content.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);assert.ok(match,'PDF physical page dimensions');assert.ok(Math.abs(Number(match[1])-50*72/25.4)<.01&&Math.abs(Number(match[2])-50*72/25.4)<.01,'PDF is exactly5×5cm');
  await page.locator('#open-export').click();await page.locator('#export-format').selectOption('png');await page.locator('#export-dpi').fill('1600');await expect(page.locator('#export-summary')).toContainText(/3[,\s]?150 × 3[,\s]?150 px/);const highResolutionPromise=page.waitForEvent('download');await page.locator('#export-submit').click();await (await highResolutionPromise).saveAs(root+'/artifacts/figure-high-resolution.png');const pngBytes=await readFile(root+'/artifacts/figure-high-resolution.png');assert.equal(pngBytes.readUInt32BE(16),3150);assert.equal(pngBytes.readUInt32BE(20),3150);
  await expect(page.locator('#background')).toHaveValue('dark');await page.locator('#open-export').click();await page.locator('#export-width').fill('30');await page.locator('#export-dpi').fill('2400');await expect(page.locator('#export-submit')).toBeDisabled();await expect(page.locator('#export-error')).toContainText('Reduce');await page.keyboard.press('Escape');
  await page.setViewportSize({width:375,height:900});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:root+'/artifacts/workspace-mobile.png',fullPage:true});
  assert.deepEqual(errors,[],'No browser JavaScript errors');assert.deepEqual(consoleErrors,[],'No unexpected browser console errors');
  console.log('PASS transparent PNG, accurate PDF physical size, device export limits, restored viewport and zero script errors');
}finally{await browser.close();}
