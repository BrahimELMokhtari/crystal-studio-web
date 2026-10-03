import './style.css';
import examples from './examples.json';
import { CrystalViewer } from './viewer.js';
import { paintLegendBall } from './legend.js';
import { validateStructure, validateProject, measureAtoms, exportDimensions, pngWithDpi, getDisplayBonds, remapCustomBonds, MAX_EXPORT_DPI, MAX_EXPORT_PIXELS } from './model.js';
import { buildManualStructure, parseManualAtomRows } from './manual.js';
import { initializeCommunity } from './community.js';
import { initializeManualPresets } from './manual-presets-ui.js';

const $ = selector => document.querySelector(selector);
const compactLayout=matchMedia('(max-width: 980px)');
function orderWorkspace(){const workspace=$('#workspace'),first=compactLayout.matches?$('.viewer-column'):$('.sidebar');if(workspace.firstElementChild===first)return;const active=document.activeElement;workspace.prepend(first);if(active instanceof HTMLElement&&active!==document.body)active.focus({preventScroll:true});}
compactLayout.addEventListener('change',orderWorkspace);orderWorkspace();
const node = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const initialSettings = () => ({ representation: 'ball-stick', atomScale: 1, elementScales: {}, bondScale: 1.1, showCell: true, showAxes: true, showPeriodic: true, showLegend: true, background: 'dark', colors: {}, repetitions: [1,1,1], connectionMode: 'automatic', customBonds: [] });
const state = { unit: null, view: null, settings: initialSettings(), selection: [], generation: 0, applied: { bondScale: 1.1, repetitions: [1,1,1] } };
const manualPresets=initializeManualPresets();
let viewer, controller, debounce, requestBusy = false, exportBusy = false, mouseConnectMode = false, apiBase = '';
const say = message => { $('#status').textContent = message; };
function storageRead() { try { return localStorage.getItem('crystal-studio-api-url'); } catch { return null; } }
function normalizeApi(value) {
  if (!value.trim()) return '';
  const url = new URL(value.trim());
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw new Error('Use an HTTPS service URL, or HTTP for localhost.');
  if (url.search || url.hash) throw new Error('The service URL cannot contain a query or fragment.');
  return url.href.replace(/\/$/, '');
}
try { apiBase = normalizeApi(storageRead() ?? import.meta.env.VITE_API_BASE_URL ?? (['localhost','127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:8000' : '')); } catch { apiBase = ''; }
function controlsBusy() {
  for (const id of ['save-project','apply-supercell','calculate-contacts']) $('#' + id).disabled = requestBusy || exportBusy || !state.view;
  $('#open-export').disabled = requestBusy || exportBusy || !state.view || !viewer;
  $('#save-transparent-scene').disabled = requestBusy || exportBusy || !state.view || !viewer;
  const pair = selectedConnection();
  $('#connect-selected').disabled = requestBusy || exportBusy || state.selection.length !== 2 || pair !== undefined;
  $('#disconnect-selected').disabled = requestBusy || exportBusy || pair === undefined;
  $('#manual-submit').disabled = exportBusy;
  const mouseEnabled = mouseConnectMode && !requestBusy && !exportBusy && !!state.view && !!viewer;
  $('#mouse-connect-mode').disabled = requestBusy || exportBusy || !state.view || !viewer;
  $('#mouse-connect-mode').setAttribute('aria-pressed',String(mouseEnabled));
  $('#mouse-connect-mode').textContent = mouseEnabled ? 'Mouse connections on' : 'Connect with mouse';
  $('#mouse-connect-hint').hidden = !mouseEnabled;
  $('#viewport').classList.toggle('connecting',mouseEnabled);
  $('#viewport-help').textContent = mouseEnabled ? 'Drag atom to atom or click two atoms to connect; Esc cancels. Drag empty space to rotate.' : 'Drag to rotate; scroll to zoom; right-drag to pan; click atoms to inspect';
  viewer?.setConnectionMode(mouseEnabled);
}
function busy(active, message = '') { requestBusy = active; $('#busy-overlay').hidden = !active; $('#busy-message').textContent = message; controlsBusy(); }
function serviceLabel(message) { $('#service-state').textContent = message || (apiBase ? 'Python service configured' : 'Configure Python service'); }
serviceLabel();
async function request(path, options = {}, message = 'Processing structure…', base = apiBase) {
  if (!base) { openSettings(); throw new Error('Connect your Python service to import files and calculate structures.'); }
  controller?.abort(); const current = ++state.generation, active = new AbortController(); controller = active;
  const timer = setTimeout(() => active.abort('timeout'), 95000); busy(true, message);
  try {
    const response = await fetch(base + path, { ...options, signal: active.signal });
    const data = await response.json().catch(() => null);
    if (current !== state.generation) throw new Error('Request replaced by a newer operation.');
    if (!response.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : typeof data?.error === 'string' ? data.error : response.status === 422 ? 'The file or structure settings are invalid.' : 'The service returned HTTP ' + response.status + '.';
      throw new Error(detail);
    }
    if (!data || typeof data !== 'object') throw new Error('The service returned an invalid response.');
    return data;
  } catch (error) {
    if (active.signal.aborted) throw new Error(active.signal.reason === 'timeout' ? 'The service did not respond in time. It may still be waking up; try again.' : 'Request canceled. Your previous structure is retained.');
    if (error instanceof TypeError) throw new Error('The Python service could not be reached. Check its URL and allowed website origin, then retry.');
    throw error;
  } finally { clearTimeout(timer); if (current === state.generation) { controller = null; busy(false); } }
}
$('#cancel-request').onclick = () => controller?.abort();
function openSettings() { $('#api-url').value = apiBase; $('#service-result').textContent = ''; $('#settings-dialog').showModal(); }
$('#open-settings').onclick = openSettings; $('#service-state').onclick = openSettings;
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => $('#' + button.dataset.close).close();
$('#settings-form').onsubmit = event => {
  event.preventDefault();
  try { apiBase = normalizeApi($('#api-url').value); try { localStorage.setItem('crystal-studio-api-url', apiBase); } catch { /* The connection still works for this tab. */ } serviceLabel(); $('#settings-dialog').close(); say(apiBase ? 'Python service connection saved.' : 'Example-only mode. Connect a Python service to import files.'); }
  catch (error) { $('#service-result').textContent = error.message; }
};
$('#test-service').onclick = async () => {
  const button = $('#test-service'); button.disabled = true; $('#service-result').textContent = 'Connecting. A free service may take about a minute to wake up…';
  try { const base = normalizeApi($('#api-url').value), data = await request('/health', {}, 'Connecting to the Python service…', base); if (data.status !== 'ok') throw new Error('The service did not report a healthy state.'); $('#service-result').textContent = 'Connected. The Python service is ready.'; }
  catch (error) { $('#service-result').textContent = error.message; } finally { button.disabled = false; }
};
function acceptUnit(unit) {
  validateStructure(unit); mouseConnectMode=false;viewer?.cancelConnectionGesture();controller?.abort(); state.generation++; busy(false); state.unit = unit; state.view = structuredClone(unit); state.selection = [];
  state.settings.bondScale = 1.1; state.settings.repetitions = [1,1,1]; state.applied = { bondScale: 1.1, repetitions: [1,1,1] };
  state.settings.customBonds = [];state.settings.connectionMode = unit.source.format === 'manual' ? 'manual' : 'automatic';
  syncControls(); render(true);
}
function render(reset = false) {
  if (!state.view) return; const m = state.view, s = state.settings;
  $('#structure-title').textContent = m.name;
  $('#structure-meta').textContent = m.formula + ' · ' + m.atoms.length.toLocaleString() + ' atoms · ' + s.repetitions.join(' × ') + ' cell';
  $('#source-note').textContent = m.source.description || 'Imported structure. Review the source and validation warnings.';
  $('#provenance').textContent = 'Source: ' + m.source.filename + ' · ' + m.source.format.toUpperCase() + '. ' + m.source.description;
  const cards = [ ['Atoms',m.atoms.length.toLocaleString()], ['Volume',m.cell.volume.toFixed(3)+' Å³'], ['Lengths · Å',m.cell.lengths.map(n=>n.toFixed(3)).join(' / ')], ['Angles · °',m.cell.angles.map(n=>n.toFixed(2)).join(' / ')] ];
  $('#structure-stats').replaceChildren(...cards.map(([label,value])=>{const card=node('div',undefined,'stat-card');card.append(node('span',label),node('strong',value));return card;}));
  $('#warnings').hidden = !m.warnings.length; $('#warnings').replaceChildren(...m.warnings.map(w=>node('p',w)));
  $('#contact-count').textContent = getDisplayBonds(m,s).length.toLocaleString() + ' connections · ' + s.customBonds.length.toLocaleString() + ' manual' + (s.showPeriodic ? ' · faint spheres show periodic neighbors' : ' · periodic contacts hidden');
  const palette = $('#element-controls'); palette.replaceChildren(); const legend = $('#scene-legend'); legend.replaceChildren(); legend.hidden = !s.showLegend;
  for (const element of m.elements) {
    const color = s.colors[element.symbol] || element.color, row=node('div',undefined,'element-control'),colorRow=node('label',undefined,'element-color-row'),input=document.createElement('input');
    input.type='color';input.value=color;input.setAttribute('aria-label',element.symbol+' color');input.className='element-swatch';
    colorRow.append(input,node('strong',element.symbol,'element-name'),node('span',element.count.toLocaleString()+' atoms','element-count'));row.append(colorRow);
    input.oninput=()=>{state.settings.colors[element.symbol]=input.value; viewer?.setStructure(state.view,state.settings); const ball=legend.querySelector('[data-element="'+element.symbol+'"]'); if(ball)paintLegendBall(ball,input.value);};
    const sizeControls=node('div',undefined,'element-size-controls'),sizeLabel=node('label',undefined,'element-size-label'),range=node('input'),number=node('input'),reset=node('button','Reset','element-size-reset');
    range.type='range';number.type='number';
    for(const control of [range,number]){control.min='.2';control.max='3';control.step='.01';control.value=String(s.elementScales?.[element.symbol]??1);}
    number.step='any';
    const formatSize=value=>Number(value.toFixed(2))===value?value.toFixed(2):String(value);
    range.setAttribute('aria-label',element.symbol+' size');number.setAttribute('aria-label',element.symbol+' size multiplier');
    const applySize=(raw,source)=>{
      const value=Number(raw);
      if(raw.trim()===''||!Number.isFinite(value)||value<.2||value>3){source?.setAttribute('aria-invalid','true');return;}
      state.settings={...state.settings,elementScales:{...state.settings.elementScales,[element.symbol]:value}};
      range.value=String(value);if(source!==number)number.value=formatSize(value);number.removeAttribute('aria-invalid');
      viewer?.setStructure(state.view,state.settings);viewer?.highlight(state.selection);
    };
    range.oninput=()=>applySize(range.value,range);number.oninput=()=>applySize(number.value,number);
    number.onchange=()=>{applySize(number.value,number);number.value=formatSize(state.settings.elementScales?.[element.symbol]??1);number.removeAttribute('aria-invalid');};
    reset.type='button';reset.setAttribute('aria-label','Reset '+element.symbol+' size');reset.onclick=()=>applySize('1');
    number.value=formatSize(s.elementScales?.[element.symbol]??1);
    sizeLabel.append(node('span','Size multiplier','element-size-caption'),range);sizeControls.append(sizeLabel,number,reset);row.append(sizeControls);
    palette.append(row); const item=node('span',undefined,'legend-item'),ball=node('canvas',undefined,'legend-ball');ball.dataset.element=element.symbol;ball.setAttribute('aria-hidden','true');paintLegendBall(ball,color);item.append(ball,node('span',element.symbol));legend.append(item);
  }
  renderAtoms(); renderMeasurements();renderConnections(); viewer?.setStructure(m,s,reset); viewer?.highlight(state.selection); controlsBusy();
}
function renderAtoms() {
  if (!state.view) return;
  const focusedId=document.activeElement?.closest('#atom-rows .atom-select')?.dataset.atomId;
  const filter=$('#atom-filter').value.trim().toLowerCase(),mode=$('#coordinate-mode').value, rows=[];
  for(const atom of state.view.atoms) {
    if(filter&&!atom.element.toLowerCase().includes(filter)&&!String(atom.id+1).includes(filter))continue;
    const row=node('tr'); if(state.selection.includes(atom.id))row.classList.add('selected');
    const first=node('td'),button=node('button',String(atom.id+1),'atom-select');button.type='button';button.dataset.atomId=String(atom.id);button.setAttribute('aria-label','Select '+atom.element+' atom '+(atom.id+1));button.setAttribute('aria-pressed',String(state.selection.includes(atom.id)));button.onclick=()=>selectAtom(atom.id);first.append(button);row.append(first,node('td',atom.element));
    const coordinates=mode==='fractional'?atom.fractional:atom.position;coordinates.forEach(v=>row.append(node('td',v.toFixed(5))));row.append(node('td',atom.occupancy.toFixed(3)));rows.push(row);
  }
  if(!rows.length){const row=node('tr'),cell=node('td','No matching atoms.');cell.colSpan=6;row.append(cell);rows.push(row);} $('#atom-rows').replaceChildren(...rows);
  if(focusedId!==undefined)$('#atom-rows').querySelector('[data-atom-id="'+focusedId+'"]')?.focus({preventScroll:true});
}
function selectAtom(id) { const index=state.selection.indexOf(id); if(index>=0)state.selection.splice(index,1);else{if(state.selection.length===3)state.selection.shift();state.selection.push(id);}viewer?.highlight(state.selection);renderAtoms();renderMeasurements();renderConnections();controlsBusy(); }
function selectedConnection() {
  if(state.selection.length!==2)return undefined;
  return state.settings.customBonds.find(bond => state.selection.includes(bond.i) && state.selection.includes(bond.j));
}
function renderConnections() {
  const target=$('#manual-connections');target.replaceChildren();
  $('#connection-selection').textContent=state.selection.length===2 ? state.selection.map(id=>state.view.atoms[id].element+' '+(id+1)).join(' ↔ ') : 'Select exactly two atoms in the 3D view or Atoms table.';
  for(const bond of state.settings.customBonds.slice(0,100)) {
    const row=node('div',undefined,'manual-connection'),description=[bond.i,bond.j].map(id=>state.view.atoms[id].element+' '+(id+1)).join(' ↔ '),button=node('button','Remove','button secondary');
    button.type='button';button.setAttribute('aria-label','Remove manual connection '+description);
    button.onclick=()=>{state.settings.customBonds=state.settings.customBonds.filter(item=>item!==bond);render();say('Manual connection removed.');};
    row.append(node('span',description),button);target.append(row);
  }
  if(state.settings.customBonds.length>100)target.append(node('p','Showing the first 100 of '+state.settings.customBonds.length+' manual connections.','field-help'));
}
function connectAtoms(i,j) {
  if(requestBusy||exportBusy||!state.view||i===j)return false;
  const previous=state.settings;
  try {
    if(previous.customBonds.some(bond=>[bond.i,bond.j].includes(i)&&[bond.i,bond.j].includes(j))){say('These atoms already have a manual connection.');return false;}
    const settings={...previous,customBonds:[...previous.customBonds,{i:Math.min(i,j),j:Math.max(i,j),shift:[0,0,0]}],connectionMode:previous.connectionMode==='automatic'?'both':previous.connectionMode,representation:['spheres','spacefill'].includes(previous.representation)?'ball-stick':previous.representation};
    getDisplayBonds(state.view,settings);state.settings=settings;state.selection=[i,j];syncControls();render();say('Atoms connected. Manual connections are included in figures and saved projects.');return true;
  }catch(error){syncControls();say(error.message);return false;}
}
$('#connect-selected').onclick=()=>{if(state.selection.length===2)connectAtoms(...state.selection);};
$('#mouse-connect-mode').onclick=()=>{
  mouseConnectMode=!mouseConnectMode;
  if(mouseConnectMode&&state.settings.representation==='bonds')updateDisplaySettings({representation:'ball-stick'});
  controlsBusy();say(mouseConnectMode?'Mouse connections enabled. Drag between atoms or click two atoms to connect.':'Mouse connections disabled. Drag to rotate the crystal.');
};
$('#disconnect-selected').onclick=()=>{const bond=selectedConnection();if(!bond)return;state.settings.customBonds=state.settings.customBonds.filter(item=>item!==bond);render();say('Manual connection removed.');};
function updateDisplaySettings(patch) {
  try {const settings={...state.settings,...patch};if(state.view)getDisplayBonds(state.view,settings);state.settings=settings;render();}
  catch(error){syncControls();say(error.message);}
}
$('#connection-mode').onchange=event=>updateDisplaySettings({connectionMode:event.target.value});
function renderMeasurements() {
  const target=$('#measurements');target.replaceChildren();$('#selection-chip').hidden=!state.selection.length;
  $('#selection-chip').textContent=state.selection.map(i=>state.view.atoms[i].element+' '+(i+1)).join(' → ');
  if(state.selection.length<2){target.append(node('p','Select two atoms for a distance, or three atoms for an angle.','empty-state'));return;}
  const atoms=state.selection.map(id=>state.view.atoms[id]),measurement=measureAtoms(atoms),description=atoms.map(a=>a.element+' '+(a.id+1)).join(' → ');
  target.append(node('h3',description),node('p','Direct separation: '+measurement.distance.toFixed(5)+' Å','measurement-value'));
  if('angle' in measurement)target.append(node('p',measurement.angle===null?'Angle undefined for coincident atoms.':'Angle at '+atoms[1].element+' '+(atoms[1].id+1)+': '+measurement.angle.toFixed(3)+'°','measurement-value'));
  const pair=state.view.bonds.filter(b=>(b.i===atoms[0].id&&b.j===atoms[1].id)||(b.j===atoms[0].id&&b.i===atoms[1].id));
  if(pair.length){target.append(node('p','Periodic contact records · shifts follow your selection order','field-help'));for(const contact of pair.slice(0,12)){const shift=contact.i===atoms[0].id?contact.shift:contact.shift.map(n=>-n);target.append(node('p',contact.distance.toFixed(5)+' Å · image shift ['+shift.join(', ')+']'));}if(pair.length>12)target.append(node('p','Showing 12 of '+pair.length+' contact images.'));}
}
$('#clear-selection').onclick=()=>{viewer?.cancelConnectionGesture();state.selection=[];viewer?.highlight([]);renderAtoms();renderMeasurements();renderConnections();controlsBusy();};
$('#atom-filter').oninput=renderAtoms;$('#coordinate-mode').onchange=renderAtoms;
const tabs=[...document.querySelectorAll('[role="tab"]')];
function activateTab(tab){for(const button of tabs){const selected=button===tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;$('#'+button.getAttribute('aria-controls')).hidden=!selected;}}
for(const [i,tab] of tabs.entries()){tab.onclick=()=>activateTab(tab);tab.onkeydown=event=>{let next;if(event.key==='ArrowRight')next=tabs[(i+1)%tabs.length];else if(event.key==='ArrowLeft')next=tabs[(i+tabs.length-1)%tabs.length];else if(event.key==='Home')next=tabs[0];else if(event.key==='End')next=tabs.at(-1);if(next){event.preventDefault();activateTab(next);next.focus();}};}
function syncControls() {
  const s=state.settings;$('#representation').value=s.representation;$('#atom-scale').value=s.atomScale;$('#bond-scale').value=s.bondScale;$('#background').value=s.background;
  $('#atom-scale-value').value=s.atomScale.toFixed(2);$('#bond-scale-value').value=s.bondScale.toFixed(2)+'×';
  for(const [id,key] of [['show-cell','showCell'],['show-axes','showAxes'],['show-periodic','showPeriodic'],['show-legend','showLegend']])$('#'+id).checked=s[key];
  ['a','b','c'].forEach((letter,index)=>$('#repeat-'+letter).value=s.repetitions[index]);
  $('#connection-mode').value=s.connectionMode;
}
for(const [id,key] of [['representation','representation'],['background','background']])$('#'+id).onchange=event=>updateDisplaySettings({[key]:event.target.value});
for(const [id,key] of [['show-cell','showCell'],['show-axes','showAxes'],['show-periodic','showPeriodic'],['show-legend','showLegend']])$('#'+id).onchange=event=>updateDisplaySettings({[key]:event.target.checked});
$('#atom-scale').oninput=event=>{state.settings.atomScale=Number(event.target.value);$('#atom-scale-value').value=state.settings.atomScale.toFixed(2);viewer?.setStructure(state.view,state.settings);};
async function rebuild({force=false}={}) {
  if(!state.unit)return;
  const scale=Number($('#bond-scale').value),repetitions=['a','b','c'].map(k=>Number($('#repeat-'+k).value));
  const generation=state.generation;
  try {
    if(!repetitions.every(n=>Number.isInteger(n)&&n>=1&&n<=4)||repetitions.reduce((p,n)=>p*n,1)*state.unit.atoms.length>2000)throw new Error('Use 1–4 repetitions per axis and at most 2,000 atoms.');
    let result;
    if(!force&&state.unit.source.format!=='manual'&&scale===1.1&&repetitions.every(n=>n===1)){controller?.abort();state.generation++;busy(false);result=structuredClone(state.unit);}
    else result=await request('/api/rebuild',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({structure:state.unit,bondScale:scale,repetitions})},'Calculating periodic contacts and supercell…');
    validateStructure(result);
    const previousCount=state.settings.customBonds.length;
    const customBonds=remapCustomBonds(state.settings.customBonds,state.unit.atoms.length,state.applied.repetitions,repetitions);
    const settings={...state.settings,customBonds,bondScale:scale,repetitions,connectionMode:force?(customBonds.length?'both':'automatic'):state.settings.connectionMode};
    getDisplayBonds(result,settings);
    state.view=result;state.settings=settings;state.applied={bondScale:scale,repetitions:[...repetitions]};state.selection=[];syncControls();render(true);say('Structure updated. Periodic image shifts are preserved.'+(previousCount>state.settings.customBonds.length?' Connections to atoms outside the new supercell were removed.':''));
  } catch(error){if(generation+1<state.generation)return;state.settings.bondScale=state.applied.bondScale;state.settings.repetitions=[...state.applied.repetitions];syncControls();say(error.message);}
}
$('#bond-scale').oninput=event=>{$('#bond-scale-value').value=Number(event.target.value).toFixed(2)+'×';clearTimeout(debounce);debounce=setTimeout(rebuild,350);};
$('#apply-supercell').onclick=()=>{clearTimeout(debounce);rebuild();};
$('#calculate-contacts').onclick=()=>{clearTimeout(debounce);rebuild({force:true});};
$('#camera-view').onchange=()=>viewer?.fit($('#camera-view').value);$('#reset-camera').onclick=()=>viewer?.fit($('#camera-view').value);
$('#zoom-in').onclick=()=>viewer?.zoom(1.25);$('#zoom-out').onclick=()=>viewer?.zoom(.8);
$('#open-file').onclick=()=>$('#structure-file').click();$('#load-project').onclick=()=>$('#project-file').click();
$('#open-manual').onclick=()=>{$('#manual-error').hidden=true;$('#manual-dialog').showModal();};
$('#copy-current-manual').onclick=()=>{
  if(!state.unit)return;
  $('#manual-name').value=state.unit.name;
  ['a','b','c'].forEach((key,index)=>$('#manual-'+key).value=state.unit.cell.lengths[index]);
  ['alpha','beta','gamma'].forEach((key,index)=>$('#manual-'+key).value=state.unit.cell.angles[index]);
  $('#manual-atoms').value=state.unit.atoms.map(atom=>[atom.element,...atom.fractional,atom.occupancy].join(' ')).join('\n');
  manualPresets.useCustomCell();
  $('#manual-error').hidden=true;
};
$('#manual-form').onsubmit=event=>{
  event.preventDefault();
  try {
    const unit=buildManualStructure({name:$('#manual-name').value,...manualPresets.readCell(),atoms:parseManualAtomRows($('#manual-atoms').value)});
    clearTimeout(debounce);acceptUnit(unit);$('#manual-dialog').close();say('Manual structure created. Select two atoms to connect them, or calculate contacts with the Python service.');
  }catch(error){$('#manual-error').textContent=error.message;$('#manual-error').hidden=false;}
};
async function importFile(file) {
  if(!file)return;clearTimeout(debounce);
  if(!/\.(cif|vesta)$/i.test(file.name)){say('Choose a CIF or VESTA structure file.');return;}
  if(file.size>2*1024*1024){say('The structure file exceeds the 2 MB limit.');return;}
  const generation=state.generation;
  try {const form=new FormData();form.append('file',file);form.append('bond_scale','1.1');form.append('supercell','1,1,1');const data=await request('/api/structure',{method:'POST',body:form},'Reading and validating '+file.name+'…');acceptUnit(data);say('Loaded '+file.name+'. Review the structure source and validation notes.');}
  catch(error){if(state.generation<=generation+1)say(error.message);}
}
$('#structure-file').onchange=event=>{importFile(event.target.files[0]);event.target.value='';};
const dropzone=$('#dropzone');dropzone.onclick=()=>$('#structure-file').click();dropzone.onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();$('#structure-file').click();}};
dropzone.ondragover=event=>{event.preventDefault();dropzone.classList.add('dragging');};dropzone.ondragleave=()=>dropzone.classList.remove('dragging');dropzone.ondrop=event=>{event.preventDefault();dropzone.classList.remove('dragging');importFile(event.dataTransfer.files[0]);};
function download(blob, filename) {const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),15000);}
const fileStem = () => (state.unit?.name||'crystal-structure').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,70);
$('#save-project').onclick=()=>{if(!state.unit)return;const project={format:'crystal-studio-project',version:1,savedAt:new Date().toISOString(),unit:state.unit,view:state.view,settings:state.settings,camera:viewer?.cameraState()};download(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),fileStem()+'.crystal.json');say('Project downloaded with structure, display settings and camera.');};
$('#project-file').onchange=async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  controller?.abort();const generation=++state.generation;clearTimeout(debounce);busy(false);
  try{
    if(file.size>8*1024*1024)throw new Error('The project exceeds the 8 MB limit.');
    const text=await file.text();if(generation!==state.generation)return;
    const project=validateProject(JSON.parse(text));
    mouseConnectMode=false;viewer?.cancelConnectionGesture();
    state.unit=project.unit;state.view=project.view;state.settings={...initialSettings(),...project.settings};state.applied={bondScale:project.settings.bondScale,repetitions:[...project.settings.repetitions]};state.selection=[];syncControls();render(true);viewer?.restoreCamera(project.camera);say('Project restored.');
  }catch(error){if(generation===state.generation)say('Unable to load project: '+error.message);}
};
for(const example of examples){const option=node('option',example.label);option.value=example.id;$('#example-select').append(option);}
$('#example-select').onchange=()=>{const selected=examples.find(e=>e.id===$('#example-select').value);if(selected){clearTimeout(debounce);acceptUnit(structuredClone(selected.structure));say('Loaded '+selected.label+'. This is an idealized example structure.');}};
function exportSummary() {
  const widthCm=Number($('#export-width').value),heightCm=Number($('#export-height').value),dpi=Number($('#export-dpi').value),limit=viewer?.exportLimit()||8192;
  $('#fit-export-size').hidden=true;
  try{
    const dims=exportDimensions(widthCm,heightCm,dpi,limit);
    $('#export-summary').textContent=dims.width.toLocaleString()+' × '+dims.height.toLocaleString()+' px · '+dims.widthCm+' × '+dims.heightCm+' cm · '+dims.dpi+' DPI';$('#export-error').hidden=true;$('#export-submit').disabled=exportBusy;
  }catch(error){
    const validInputs=[widthCm,heightCm].every(n=>Number.isFinite(n)&&n>=1&&n<=30)&&Number.isInteger(dpi)&&dpi>=72&&dpi<=MAX_EXPORT_DPI;
    const squareCm=Math.floor(Math.min(30,Math.min(limit,Math.sqrt(MAX_EXPORT_PIXELS))*2.54/dpi)*10)/10;
    $('#export-summary').textContent='Adjust the figure dimensions or resolution.';
    $('#export-error').textContent=error.message+(validInputs?' A square figure at '+dpi.toLocaleString()+' DPI can be up to '+squareCm.toFixed(1)+' cm per side on this device.':'');
    $('#export-error').hidden=false;$('#export-submit').disabled=true;$('#fit-export-size').hidden=!validInputs;
  }
}
$('#fit-export-size').onclick=()=>{
  const widthCm=Number($('#export-width').value),heightCm=Number($('#export-height').value),dpi=Number($('#export-dpi').value),limit=viewer?.exportLimit()||8192;
  if(![widthCm,heightCm].every(n=>Number.isFinite(n)&&n>=1&&n<=30)||!Number.isInteger(dpi)||dpi<72||dpi>MAX_EXPORT_DPI)return;
  const width=Math.round(widthCm*dpi/2.54),height=Math.round(heightCm*dpi/2.54);
  const scale=Math.min(1,limit/width,limit/height,Math.sqrt(MAX_EXPORT_PIXELS/(width*height)));
  $('#export-width').value=Math.max(1,Math.floor(widthCm*scale*10)/10).toFixed(1);
  $('#export-height').value=Math.max(1,Math.floor(heightCm*scale*10)/10).toFixed(1);
  exportSummary();
};
for(const id of ['export-width','export-height','export-dpi'])$('#'+id).oninput=exportSummary;
function syncExportContent() {
  const scene=$('#export-content').value==='scene';
  $('#export-background').disabled=scene;$('#export-legend').disabled=scene;
  $('#export-background').closest('label').hidden=scene;$('#export-legend').closest('label').hidden=scene;
  $('#figure-export-help').hidden=scene;$('#scene-export-help').hidden=!scene;
  $('#export-title').textContent=scene?'Save your transparent scene':'Export your figure';
  $('#export-submit').textContent=scene?'Download scene':'Download figure';
}
$('#export-content').onchange=syncExportContent;
$('#open-export').onclick=()=>{if(!viewer||!state.view)return;$('#export-content').value='figure';syncExportContent();exportSummary();$('#export-dialog').showModal();};
$('#save-transparent-scene').onclick=()=>{if(!viewer||!state.view)return;$('#export-content').value='scene';$('#export-background').value='transparent';$('#export-format').value='png';syncExportContent();exportSummary();$('#export-dialog').showModal();};
$('#export-form').onsubmit=async event=>{
  event.preventDefault();if(!viewer||exportBusy)return;exportBusy=true;controlsBusy();$('#export-submit').disabled=true;
  try{const dims=exportDimensions(Number($('#export-width').value),Number($('#export-height').value),Number($('#export-dpi').value),viewer.exportLimit());const scene=$('#export-content').value==='scene',title=state.view.name,stem=fileStem()+(scene?'-scene':'');const captured=scene?viewer.captureScene(dims):viewer.capture({...dims,transparent:$('#export-background').value==='transparent',legend:$('#export-legend').checked,legendGapCm:1});const data=captured.dataUrl;
    if($('#export-format').value==='png'){const bytes=Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0));download(new Blob([pngWithDpi(bytes,dims.dpi)],{type:'image/png'}),stem+'.png');}
    else{const {jsPDF}=await import('jspdf');const pdf=new jsPDF({orientation:dims.widthCm>=dims.heightCm?'landscape':'portrait',unit:'mm',format:[dims.widthCm*10,dims.heightCm*10],compress:true});pdf.setProperties({title,subject:'Crystal structure raster figure',creator:'Crystal Studio Web'});pdf.addImage(data,'PNG',0,0,dims.widthCm*10,dims.heightCm*10);pdf.save(stem+'.pdf');}
    $('#export-dialog').close();say('Figure exported at '+dims.width+' × '+dims.height+' pixels and '+dims.dpi+' DPI.');
  }catch(error){$('#export-error').textContent=error.message;$('#export-error').hidden=false;}finally{exportBusy=false;controlsBusy();$('#export-submit').disabled=false;}
};
try { viewer=new CrystalViewer($('#viewport'),selectAtom,connectAtoms); } catch(error) { $('#webgl-error').hidden=false;$('#webgl-error').textContent='The 3D viewer requires WebGL 2. Structure data and atom tables remain available. '+error.message; }
initializeCommunity();
if(examples.length){$('#example-select').value=examples[0].id;acceptUnit(structuredClone(examples[0].structure));say('Ready. Explore the example, or open your own structure.');}else{say('Example structures are being prepared. Connect your Python service and open a CIF file.');controlsBusy();}
