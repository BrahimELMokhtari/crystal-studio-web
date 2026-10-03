import { CRYSTAL_PRESETS, constrainPresetCell, referenceSites, getReferenceAtoms } from './crystal-presets.js';
import { ELEMENT_SYMBOLS } from './element-data.js';
import { buildManualStructure, parseManualAtomRows } from './manual.js';

export function initializeManualPresets() {
  const $ = selector => document.querySelector(selector);
  const fields = ['a','b','c','alpha','beta','gamma'];
  const select = $('#manual-system'), atoms = $('#manual-atoms');
  const choices = new Map();
  function make(tag, text, className) {
    const element = document.createElement(tag);
    if(text !== undefined)element.textContent = text;
    if(className)element.className = className;
    return element;
  }
  for(const [group,label] of [['system','Crystal systems'],['lattice','Cubic lattice templates']]) {
    const section = make('optgroup');section.label = label;
    for(const preset of CRYSTAL_PRESETS.filter(item => item.group === group)) {
      const option = make('option',preset.label);option.value = preset.id;section.append(option);
    }
    select.append(section);
  }
  function rawCell() {
    const values = fields.map(key => {const raw=$('#manual-'+key).value;return raw.trim() ? Number(raw) : NaN;});
    return {lengths:values.slice(0,3),angles:values.slice(3)};
  }
  function readCell() {
    const cell = rawCell();return select.value === 'custom' ? cell : constrainPresetCell(select.value,cell);
  }
  function error(text = '') {
    $('#manual-preset-error').textContent = text;$('#manual-preset-error').hidden = !text;
  }
  function syncCell() {
    try {
      const cell = readCell(),values = [...cell.lengths,...cell.angles];
      fields.forEach((key,index) => {const input=$('#manual-'+key);if(input.readOnly)input.value=values[index];});
      error();
    }catch(problem){error(problem.message);}
  }
  function rememberSites() {
    for(const site of $('#reference-sites').children) {
      const id = site.dataset.site;
      choices.set(id,{element:$('#reference-'+id+'-element').value,occupancy:$('#reference-'+id+'-occupancy').value});
    }
  }
  function renderSites() {
    rememberSites();$('#reference-sites').replaceChildren();
    for(const site of referenceSites(select.value === 'custom' ? 'triclinic' : select.value)) {
      const row = make('div',undefined,'reference-site-row');row.dataset.site = site.id;
      const siteLabel=make('label',undefined,'reference-site-label'),check=make('input');
      check.type='checkbox';check.id='reference-'+site.id+'-include';check.checked=site.defaultSelected;
      check.setAttribute('aria-label','Include '+site.label);
      const description=make('span'),name=make('strong',site.label),coordinates=make('small',site.fractional.map(n=>n===.5?'1/2':String(n)).join(', '));
      description.append(name,coordinates);siteLabel.append(check,description);
      const elementLabel=make('label',undefined,'field reference-element');elementLabel.append(make('span','Element'));
      const element=make('select');element.id='reference-'+site.id+'-element';element.setAttribute('aria-label','Element at '+site.label);
      for(const symbol of ELEMENT_SYMBOLS){const option=make('option',symbol);option.value=symbol;element.append(option);}
      element.value=choices.get(site.id)?.element || 'Si';elementLabel.append(element);
      const occupancyLabel=make('label',undefined,'field reference-occupancy');occupancyLabel.append(make('span','Occupancy'));
      // Staged site choices do not participate in the committed atom form's validity.
      const occupancy=make('input');occupancy.type='text';occupancy.inputMode='decimal';occupancy.maxLength=30;
      occupancy.id='reference-'+site.id+'-occupancy';occupancy.value=choices.get(site.id)?.occupancy || '1';
      occupancy.setAttribute('aria-label','Occupancy at '+site.label);occupancyLabel.append(occupancy);
      function enabled(){element.disabled=occupancy.disabled=!check.checked;}
      check.onchange=enabled;enabled();row.append(siteLabel,elementLabel,occupancyLabel);$('#reference-sites').append(row);
    }
    $('#reference-message').textContent='';
  }
  function presetSelection(resetCell) {
    const preset=CRYSTAL_PRESETS.find(item=>item.id===select.value);
    if(preset&&resetCell){const values=[...preset.defaults.lengths,...preset.defaults.angles];fields.forEach((key,index)=>$('#manual-'+key).value=values[index]);}
    for(const key of fields)$('#manual-'+key).readOnly=!!preset&&!preset.editable.includes(key);
    $('#manual-system-help').textContent=preset ? preset.help : 'Enter any valid cell. All six cell parameters are editable.';
    syncCell();renderSites();
  }
  select.onchange=()=>presetSelection(true);
  for(const key of fields)$('#manual-'+key).addEventListener('input',syncCell);
  $('#reference-action').onchange=()=>$('#apply-reference-sites').textContent=$('#reference-action').value==='replace'?'Replace atom rows with selected sites':'Add selected sites to atom rows';
  $('#apply-reference-sites').onclick=()=>{
    const message=$('#reference-message');message.classList.remove('warning');
    try {
      const selected=[];
      for(const row of $('#reference-sites').children){
        const siteId=row.dataset.site;if(!$('#reference-'+siteId+'-include').checked)continue;
        const raw=$('#reference-'+siteId+'-occupancy').value.trim();
        const occupancy=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)?Number(raw):NaN;
        selected.push({siteId,element:$('#reference-'+siteId+'-element').value,occupancy});
      }
      if(!selected.length)throw new Error('Select at least one reference site.');
      const generated=getReferenceAtoms(select.value==='custom'?'triclinic':select.value,selected);
      const replace=$('#reference-action').value==='replace';
      let skipped=0;
      const existing=replace||atoms.value.split(/\r?\n/).every(line=>!line.split('#',1)[0].trim())?[]:parseManualAtomRows(atoms.value);
      const additions=generated.filter(atom=>{
        const occupied=existing.find(entry=>entry.fractional.every((n,index)=>(n===1?0:n)===atom.fractional[index]));
        if(!occupied)return true;
        if(occupied.element!==atom.element||occupied.occupancy!==atom.occupancy)throw new Error(atom.label+' is already occupied by '+occupied.element+' with occupancy '+occupied.occupancy+'. Use a different site or explicitly replace the atom rows.');
        skipped++;return false;
      });
      const rows=additions.map(atom=>[atom.element,...atom.fractional,atom.occupancy].join(' ')).join('\n');
      const next=replace?rows:(atoms.value.trimEnd()+(atoms.value.trim()?'\n':'')+rows);
      if(next.length>atoms.maxLength)throw new Error('The atom list is too large for the editor.');
      // Validate the complete candidate before replacing any of the user's text.
      buildManualStructure({name:$('#manual-name').value,...readCell(),atoms:parseManualAtomRows(next)});
      if(additions.length||replace)atoms.value=next;$('#manual-error').hidden=true;
      message.textContent=additions.length+' reference site'+(additions.length===1?'':'s')+(replace?' replaced the atom list.':' added to the atom list.')+(skipped?' '+skipped+' identical site'+(skipped===1?' was':'s were')+' already present.':'');
    }catch(problem){message.textContent=problem.message;message.classList.add('warning');}
  };
  presetSelection(false);
  return {readCell,useCustomCell(){select.value='custom';presetSelection(false);}};
}
