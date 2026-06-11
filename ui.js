// ui.js - safe UI wiring, persistence, immediate preview update

import {
  printer,
  connect,
  disconnect,
  renderTextCanvas,
  renderImageCanvas,
  renderBarcodeCanvas,
  renderQRCanvas,
  renderCombinedCanvas,
  printCanvasObject,
  detectLabel,
  makePreviewFromPrintCanvas,
  makeLabelCanvas
} from './printer.js?v=50';

function $(id){return document.getElementById(id);}
function saveSetting(k,v){localStorage.setItem(k,JSON.stringify(v));}
function loadSetting(k,def){const v=localStorage.getItem(k); if(!v) return def; try{return JSON.parse(v);} catch(e){return def;}}

let previewTimer=null;
const DEBOUNCE=160;
let imageRotation = 0;

let currentTab = 'tab-text';
let lastPreviewTab = 'tab-text';
let combineLayout = { leftPct: 25, rightPct: 25, topPct: 20, bottomPct: 20 };

async function handleCustomFont(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const fontData = e.target.result;
      const fontName = 'CustomFont_' + Date.now(); 
      const fontFace = new FontFace(fontName, fontData);
      await fontFace.load();
      document.fonts.add(fontFace);
      const sel = $('fontFamily');
      const oldOpt = sel.querySelector('option[data-custom="true"]');
      if(oldOpt) oldOpt.remove();
      const opt = document.createElement('option');
      opt.value = fontName;
      opt.textContent = 'Custom: ' + file.name;
      opt.selected = true;
      opt.dataset.custom = "true";
      sel.insertBefore(opt, sel.lastElementChild);
      saveSetting('fontFamily', fontName); 
      updatePreviewDebounced();
      alert('Custom font loaded!');
    } catch(err) { alert('Failed: ' + err); }
  };
  reader.readAsArrayBuffer(file);
}

function checkInstallState() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const btn = $('installHelpBtn');
  if (!isStandalone && btn) btn.style.display = 'block';
  else if (btn) btn.style.display = 'none';
}

function setupModal() {
  const modal = $('installModal');
  const btn = $('installHelpBtn');
  const closeX = $('closeModalBtn');
  const closeAct = $('closeModalAction');
  const dontShow = $('dontShowAgain');
  const open = () => modal.style.display = 'flex';
  const close = () => {
    if (dontShow.checked) saveSetting('hideInstallHelp', true);
    modal.style.display = 'none';
  };
  if(btn) btn.onclick = open;
  if(closeX) closeX.onclick = close;
  if(closeAct) closeAct.onclick = close;
  window.onclick = (e) => { if (e.target === modal) close(); };
}

function updatePresetSelect() {
  const sel = $('presetSelect');
  sel.innerHTML = '<option value="">Select a preset...</option>';
  const presets = loadSetting('userPresets', {});
  Object.keys(presets).forEach(k => {
    const opt = document.createElement('option');
    opt.value = k; opt.textContent = k; sel.appendChild(opt);
  });
}

function saveCurrentAsPreset() {
  const name = prompt("Enter preset name:");
  if (!name) return;
  const presets = loadSetting('userPresets', {});
  
  presets[name] = {
    labelWidth: $('labelWidth').value,
    labelLength: $('labelLength').value,
    fontSize: $('fontSize').value,
    fontFamily: $('fontFamily').value,
    alignment: $('alignment').value,
    fontBold: $('fontBold').checked,
    frameStyle: $('frameStyle').value,
    combineLayout: combineLayout,
    mixText: $('mixText').checked,
    mixTextSize: $('mixTextSize').value,
    mixTextPos: $('mixTextPos').value,
    mixImage: $('mixImage').checked,
    mixImageScale: $('mixImageScale').value,
    mixImagePos: $('mixImagePos').value,
    mixBarcode: $('mixBarcode').checked,
    mixBarcodeScale: $('mixBarcodeScale').value,
    mixBarcodePos: $('mixBarcodePos').value,
    mixQR: $('mixQR').checked,
    mixQRSize: $('mixQRSize').value,
    mixQRPos: $('mixQRPos').value
  };
  
  saveSetting('userPresets', presets);
  updatePresetSelect();
  alert(`Preset "${name}" saved.`);
}

function loadPreset(name) {
  const presets = loadSetting('userPresets', {});
  const p = presets[name];
  if (p) {
    if (p.labelWidth) $('labelWidth').value = p.labelWidth;
    if (p.labelLength) $('labelLength').value = p.labelLength;
    if (p.fontSize) $('fontSize').value = p.fontSize;
    const sel = $('fontFamily');
    let fontExists = false;
    for(let i=0; i<sel.options.length; i++) { if(sel.options[i].value === p.fontFamily) fontExists = true; }
    if (p.fontFamily && fontExists) $('fontFamily').value = p.fontFamily;

    if (p.alignment) $('alignment').value = p.alignment;
    if (p.frameStyle) $('frameStyle').value = p.frameStyle;
    if (p.fontBold !== undefined) $('fontBold').checked = p.fontBold;
    
    if (p.combineLayout) {
        combineLayout = p.combineLayout;
        saveSetting('combineLayout', combineLayout);
    }
    const mixSettings = [
      { id: 'mixText', val: p.mixText, type: 'checkbox' },
      { id: 'mixTextSize', val: p.mixTextSize, type: 'input' },
      { id: 'mixTextPos', val: p.mixTextPos, type: 'input' },
      { id: 'mixImage', val: p.mixImage, type: 'checkbox' },
      { id: 'mixImageScale', val: p.mixImageScale, type: 'input' },
      { id: 'mixImagePos', val: p.mixImagePos, type: 'input' },
      { id: 'mixBarcode', val: p.mixBarcode, type: 'checkbox' },
      { id: 'mixBarcodeScale', val: p.mixBarcodeScale, type: 'input' },
      { id: 'mixBarcodePos', val: p.mixBarcodePos, type: 'input' },
      { id: 'mixQR', val: p.mixQR, type: 'checkbox' },
      { id: 'mixQRSize', val: p.mixQRSize, type: 'input' },
      { id: 'mixQRPos', val: p.mixQRPos, type: 'input' }
    ];

    mixSettings.forEach(s => {
      const el = $(s.id);
      if (el && s.val !== undefined) {
        if (s.type === 'checkbox') el.checked = !!s.val;
        else el.value = s.val;
        saveSetting(s.id, s.val); 
      }
    });

    saveSetting('labelWidth', p.labelWidth);
    saveSetting('labelLength', p.labelLength);
    saveSetting('fontSize', p.fontSize);
    
    updateGridPositions();
    updatePreviewDebounced();
  }
}

function deletePreset() {
  const sel = $('presetSelect');
  const name = sel.value;
  if (!name) return;
  if (confirm(`Delete preset "${name}"?`)) {
    const presets = loadSetting('userPresets', {});
    delete presets[name];
    saveSetting('userPresets', presets);
    updatePresetSelect();
  }
}

let isDraggingGrid = false;
let activeGridLine = null;

function setupGridInteraction() {
  const startGridDrag = (e, line) => {
      isDraggingGrid = true;
      activeGridLine = line;
      if (e.cancelable) e.preventDefault(); 
  };

  const attach = (id, line) => {
      const el = $(id);
      if (el) {
          el.addEventListener('mousedown', (e) => startGridDrag(e, line));
          el.addEventListener('touchstart', (e) => startGridDrag(e, line), {passive: false});
      }
  };

  attach('gl-left', 'left');
  attach('gl-right', 'right');
  attach('gl-top', 'top');
  attach('gl-bottom', 'bottom');

  const onGridMove = (e) => {
      if (!isDraggingGrid) return;
      const innerWrap = $('canvasInnerWrap');
      const rect = innerWrap.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      
      if (activeGridLine === 'left') {
          let pct = ((clientX - rect.left) / rect.width) * 100;
          combineLayout.leftPct = Math.max(0, Math.min(100 - combineLayout.rightPct - 5, Math.round(pct)));
      } else if (activeGridLine === 'right') {
          let pct = ((rect.right - clientX) / rect.width) * 100;
          combineLayout.rightPct = Math.max(0, Math.min(100 - combineLayout.leftPct - 5, Math.round(pct)));
      } else if (activeGridLine === 'top') {
          let pct = ((clientY - rect.top) / rect.height) * 100;
          combineLayout.topPct = Math.max(0, Math.min(100 - combineLayout.bottomPct - 5, Math.round(pct)));
      } else if (activeGridLine === 'bottom') {
          let pct = ((rect.bottom - clientY) / rect.height) * 100;
          combineLayout.bottomPct = Math.max(0, Math.min(100 - combineLayout.topPct - 5, Math.round(pct)));
      }
      
      updateGridPositions();
      updatePreviewDebounced();
  };

  const onGridEnd = () => {
      if (isDraggingGrid) {
          isDraggingGrid = false;
          activeGridLine = null;
          saveSetting('combineLayout', combineLayout);
      }
  };

  window.addEventListener('mousemove', onGridMove);
  window.addEventListener('touchmove', onGridMove, {passive: false});
  window.addEventListener('mouseup', onGridEnd);
  window.addEventListener('touchend', onGridEnd);
  
  $('resetLayoutBtn').addEventListener('click', () => {
      combineLayout = { leftPct: 25, rightPct: 25, topPct: 20, bottomPct: 20 };
      saveSetting('combineLayout', combineLayout);
      updateGridPositions();
      updatePreviewDebounced();
  });
}

function updateGridPositions() {
  $('gl-left').style.left = combineLayout.leftPct + '%';
  $('gl-right').style.right = combineLayout.rightPct + '%';
  $('gl-top').style.top = combineLayout.topPct + '%';
  $('gl-bottom').style.bottom = combineLayout.bottomPct + '%';
}

function getUsedPositions() {
  let used = { left: false, right: false, top: false, bottom: false };
  ['mixText','mixImage','mixBarcode','mixQR'].forEach(id => {
     if ($(id).checked) {
         let p = $(id + 'Pos').value;
         if (used[p] !== undefined) used[p] = true;
     }
  });
  return used;
}

function setActiveTab(name){
  document.querySelectorAll('.tab-content').forEach(el=>el.style.display='none');
  const el=$(name); if(el) el.style.display='block';
  document.querySelectorAll('#tabBar .tab').forEach(t=>t.classList.remove('active'));
  const act=document.querySelector('#tabBar .tab[data-tab="'+name+'"]'); if(act) act.classList.add('active');
  
  currentTab = name;
  saveSetting('ui.selectedTab', name);
  
  if (['tab-text', 'tab-image', 'tab-barcode', 'tab-qr', 'tab-combine'].includes(name)) {
      lastPreviewTab = name;
      saveSetting('lastPreviewTab', name);
  }
  
  updatePreviewDebounced();
}

function placePreviewCanvas(sourceCanvas){
  const wrap = $('previewCanvasWrap');
  const cv = $('mainPreviewCanvas');
  const innerWrap = $('canvasInnerWrap');
  
  const availableW = wrap.clientWidth || (window.innerWidth - 40);
  const availableH = Math.min(500, window.innerHeight * 0.6);
  const scale = Math.min(availableW / sourceCanvas.width, availableH / sourceCanvas.height, 1);
  
  cv.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  cv.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  cv.style.width = cv.width + 'px';
  cv.style.height = cv.height + 'px';
  innerWrap.style.width = cv.width + 'px';
  innerWrap.style.height = cv.height + 'px';
  
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; 
  ctx.fillRect(0,0,cv.width,cv.height);
  ctx.drawImage(sourceCanvas, 0, 0, cv.width, cv.height);
  
  const overlay = $('gridOverlay');
  const resetBtn = $('resetLayoutBtn');
  if (currentTab === 'tab-combine') {
      overlay.style.display = 'block';
      resetBtn.style.display = 'block';
      
      const used = getUsedPositions();
      $('gl-left').style.display = used.left ? 'flex' : 'none';
      $('gl-right').style.display = used.right ? 'flex' : 'none';
      $('gl-top').style.display = used.top ? 'flex' : 'none';
      $('gl-bottom').style.display = used.bottom ? 'flex' : 'none';

      updateGridPositions();
  } else {
      overlay.style.display = 'none';
      resetBtn.style.display = 'none';
  }
}

function updatePreviewDebounced(){
  if(previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, DEBOUNCE);
}

async function updatePreview(){
  const shown = lastPreviewTab;
  const labelW = Number($('labelWidth').value || printer.settings.labelWidthMM || 12);
  const labelH = Number($('labelLength').value || printer.settings.labelLengthMM || 40);
  const dpi = printer.settings.dpiPerMM || 8;
  try{
    let obj = null;
    if(shown === 'tab-text'){
      const text = $('textInput').value || $('textInput').placeholder || '';
      const fontSize = Number($('fontSize').value || 36);
      const align = $('alignment').value || 'center';
      const invert = $('invertInput').checked;
      const bold = $('fontBold') && $('fontBold').checked;
      const frame = $('frameStyle').value;
      const ff = $('fontFamily') ? $('fontFamily').value : printer.settings.fontFamily;
      const fontFamily = bold ? ff + ' bold' : ff;
      obj = renderTextCanvas(text, fontSize, align, invert, labelW, labelH, dpi, fontFamily, frame);
    } else if (shown === 'tab-image') {
      const cdata = $('imagePreview') && $('imagePreview').dataset && $('imagePreview').dataset.canvas;
      if(cdata){
        const img = new Image();
        img.onload = ()=>{
          const invert = $('imageInvert').checked;
          const dither = $('imageDither').checked;
          const scalePct = Number($('imageScale').value || 100);
          const obj2 = renderImageCanvas(img, Number($('imageThreshold').value||128), invert, labelW, labelH, dpi, dither, imageRotation, scalePct);
          const p = makePreviewFromPrintCanvas(obj2.canvas);
          placePreviewCanvas(p);
        };
        img.src = cdata;
        return;
      } else {
        const blankObj = makeLabelCanvas(labelW, labelH, dpi, false);
        const p = makePreviewFromPrintCanvas(blankObj.canvas);
        placePreviewCanvas(p);
        return;
      }
    } else if (shown === 'tab-barcode') {
      obj = renderBarcodeCanvas($('barcodeInput').value||'', $('barcodeType').value||'CODE128', Number($('barcodeScale').value||2), labelW, labelH, dpi);
    } else if (shown === 'tab-qr') {
      const ec = $('qrEc').value; 
      obj = await renderQRCanvas($('qrInput').value||'', ec, Number($('qrSize').value||70), labelW, labelH, dpi);
    } else if (shown === 'tab-combine') {
         const data = {
            layout: combineLayout,
            text: { enabled: $('mixText').checked, pos: $('mixTextPos').value, val: $('textInput').value||$('textInput').placeholder, fontSize: Number($('mixTextSize').value||36), fontFamily: $('fontFamily').value, bold: $('fontBold').checked },
            image: { enabled: $('mixImage').checked, pos: $('mixImagePos').value, scalePct: Number($('mixImageScale').value||100), threshold: Number($('imageThreshold').value||128), dither: $('imageDither').checked, invert: $('imageInvert').checked, rotation: imageRotation, img: null },
            barcode: { enabled: $('mixBarcode').checked, pos: $('mixBarcodePos').value, val: $('barcodeInput').value, scale: Number($('mixBarcodeScale').value||2) },
            qr: { enabled: $('mixQR').checked, pos: $('mixQRPos').value, val: $('qrInput').value, size: Number($('mixQRSize').value||70), type: $('qrEc').value }
         };
         if (data.image.enabled) {
            const cdata = $('imagePreview')?.dataset?.canvas;
            if (cdata) { const img = new Image(); img.src = cdata; await new Promise(r=>img.onload=r); data.image.img = img; }
         }
         obj = await renderCombinedCanvas(data, labelW, labelH, dpi);
    }
    
    if(obj && obj.canvas){
      const previewCanvas = makePreviewFromPrintCanvas(obj.canvas);
      placePreviewCanvas(previewCanvas);
    }
    const hint = $('previewHint');
    if(hint) hint.textContent = `Preview: ${labelW}×${labelH} mm`;
  }catch(e){ console.warn('preview error', e); }
}

function wireSimple(id, key, transform = v=>v){
  const el = $(id); if(!el) return;
  const handler = ()=>{ const v = (el.type==='checkbox') ? el.checked : el.value; saveSetting(key, transform(v)); updatePreviewDebounced(); };
  el.addEventListener(el.type==='checkbox' ? 'change' : 'input', handler);
  const sv = loadSetting(key, null);
  if(sv!==null){
    if(el.type==='checkbox') el.checked = !!sv; else el.value = sv;
  }
}

function setup(){
  lastPreviewTab = loadSetting('lastPreviewTab', 'tab-text');
  const savedTab = loadSetting('ui.selectedTab', 'tab-text');
  
  document.querySelectorAll('#tabBar .tab').forEach(t=> t.addEventListener('click', ()=> setActiveTab(t.dataset.tab)));
  setActiveTab(savedTab);
  
  $('connectBtn').addEventListener('click', async ()=> { 
    if(!printer.connected) {
      await connect(); 
      if(printer.connected && printer.device && printer.device.name) {
        const name = printer.device.name;
        $('headerTitle').textContent = name + ' Printer';
        $('headerSubtitle').textContent = name + ' — Web PWA';
        updatePreviewDebounced();
      }
    } else {
      await disconnect(); 
      $('headerTitle').textContent = 'D30 Printer';
      $('headerSubtitle').textContent = 'Phomemo D30C — Web PWA';
    }
    updatePreviewDebounced(); 
  });

  const savedLayout = loadSetting('combineLayout', null);
  if(savedLayout) combineLayout = savedLayout;

  ['labelWidth','labelLength','fontSize','alignment','barcodeScale','qrSize','imageThreshold','imageScale','barcodeType','protocolSelect','fontFamily','fontPreset','copiesInput','frameStyle','qrEc',
   'mixTextPos','mixImagePos','mixBarcodePos','mixQRPos',
   'mixTextSize','mixImageScale','mixBarcodeScale','mixQRSize'].forEach(k=>{
     if (k === 'qrSize' && !localStorage.getItem('qrSize')) {
        $('qrSize').value = 70;
        saveSetting('qrSize', 70);
     }
     wireSimple(k,k);
  });
  ['invertInput','imageInvert','imageDither','fontBold', 'mixText','mixImage','mixBarcode','mixQR'].forEach(k=> wireSimple(k,k, v=>v));
  
  $('textInput').addEventListener('input', ()=>{ saveSetting('textInput_v2', $('textInput').value); updatePreviewDebounced(); });
  const savedText = loadSetting('textInput_v2', null); 
  if(savedText !== null) $('textInput').value = savedText;

  $('fontInc').addEventListener('click', ()=> { $('fontSize').value = Number($('fontSize').value||36)+2; saveSetting('fontSize', Number($('fontSize').value)); updatePreviewDebounced(); });
  $('fontDec').addEventListener('click', ()=> { $('fontSize').value = Math.max(6, Number($('fontSize').value||36)-2); saveSetting('fontSize', Number($('fontSize').value)); updatePreviewDebounced(); });
  $('fontPreset').addEventListener('change', ()=> { $('fontSize').value = $('fontPreset').value; saveSetting('fontSize', Number($('fontSize').value)); updatePreviewDebounced(); });

  $('fontFamily').addEventListener('change', (e)=>{
     if(e.target.value === 'custom_load') {
        $('customFontFile').click();
     }
  });
  $('customFontFile').addEventListener('change', handleCustomFont);

  $('imageFile')?.addEventListener('change', (ev)=>{
    const f = ev.target.files && ev.target.files[0]; if(!f) { updatePreviewDebounced(); return; }
    const reader = new FileReader();
    reader.onload = ()=>{
      const img = new Image(); img.onload = ()=>{
        imageRotation = 0; 
        
        const maxDim = 800;
        let iw = img.width; let ih = img.height;
        if (iw > maxDim || ih > maxDim) {
            const r = Math.min(maxDim/iw, maxDim/ih);
            iw = Math.round(iw * r); ih = Math.round(ih * r);
        }
        
        const c = document.createElement('canvas'); c.width = iw; c.height = ih;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0,0,iw,ih);
        ctx.drawImage(img, 0, 0, iw, ih);
        
        $('imagePreview').dataset.canvas = c.toDataURL();
        updatePreviewDebounced();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  });

  $('imageRotateBtn')?.addEventListener('click', ()=>{
    imageRotation = (imageRotation + 90) % 360;
    updatePreviewDebounced();
  });

  $('detectLabelBtn')?.addEventListener('click', async ()=>{
    alert('Auto Detect is currently a placeholder and not fully implemented.');
  });

  $('fab-print').addEventListener('click', async ()=>{
    try{
      const shown = lastPreviewTab;
      const labelW = Number($('labelWidth').value||printer.settings.labelWidthMM);
      const labelH = Number($('labelLength').value||printer.settings.labelLengthMM);
      const dpi = printer.settings.dpiPerMM || 8;
      const copies = Number($('copiesInput').value||1);
      
      let obj = null;
      if (shown === 'tab-text') {
         const textToPrint = $('textInput').value || $('textInput').placeholder;
         const fs = Number($('fontSize').value||36);
         obj = renderTextCanvas(textToPrint, fs, $('alignment').value, $('invertInput').checked, labelW, labelH, dpi, $('fontFamily').value, $('frameStyle').value);
      } else if (shown === 'tab-image') {
         const cdata = $('imagePreview')?.dataset?.canvas;
         if(!cdata) return alert('No image');
         const img = new Image(); img.src = cdata;
         await new Promise(r=>img.onload=r);
         obj = renderImageCanvas(img, Number($('imageThreshold').value), $('imageInvert').checked, labelW, labelH, dpi, $('imageDither').checked, imageRotation, Number($('imageScale').value));
      } else if (shown === 'tab-barcode') {
         obj = renderBarcodeCanvas($('barcodeInput').value, $('barcodeType').value, Number($('barcodeScale').value), labelW, labelH, dpi);
      } else if (shown === 'tab-qr') {
         const ec = $('qrEc').value; 
         obj = await renderQRCanvas($('qrInput').value||'', ec, Number($('qrSize').value||70), labelW, labelH, dpi);
      } else if (shown === 'tab-combine') {
         const data = {
            layout: combineLayout,
            text: { enabled: $('mixText').checked, pos: $('mixTextPos').value, val: $('textInput').value||$('textInput').placeholder, fontSize: Number($('mixTextSize').value||36), fontFamily: $('fontFamily').value, bold: $('fontBold').checked },
            image: { enabled: $('mixImage').checked, pos: $('mixImagePos').value, scalePct: Number($('mixImageScale').value||100), threshold: Number($('imageThreshold').value||128), dither: $('imageDither').checked, invert: $('imageInvert').checked, rotation: imageRotation, img: null },
            barcode: { enabled: $('mixBarcode').checked, pos: $('mixBarcodePos').value, val: $('barcodeInput').value, scale: Number($('mixBarcodeScale').value||2) },
            qr: { enabled: $('mixQR').checked, pos: $('mixQRPos').value, val: $('qrInput').value, size: Number($('mixQRSize').value||70), type: $('qrEc').value }
         };
         if (data.image.enabled) {
            const cdata = $('imagePreview')?.dataset?.canvas;
            if (cdata) { const img = new Image(); img.src = cdata; await new Promise(r=>img.onload=r); data.image.img = img; }
         }
         obj = await renderCombinedCanvas(data, labelW, labelH, dpi);
      }

      if (obj) {
          await new Promise(resolve => setTimeout(resolve, 100));
          await printCanvasObject(obj, copies, (shown==='tab-image' || shown==='tab-combine') ? false : $('invertInput').checked);
      }
      
    }catch(e){ alert('Print failed: ' + e); console.error(e); }
  });

  updatePresetSelect();
  $('savePresetBtn').addEventListener('click', saveCurrentAsPreset);
  $('deletePresetBtn').addEventListener('click', deletePreset);
  $('presetSelect').addEventListener('change', (e) => loadPreset(e.target.value));
  
  setupModal();
  checkInstallState();
  setupGridInteraction();
  
  updatePreviewDebounced();
}

window.addEventListener('DOMContentLoaded', setup);
