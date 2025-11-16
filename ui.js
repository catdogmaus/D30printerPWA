// ui.js - safe UI wiring, persistence, immediate preview update

import {
  printer,
  connect,
  disconnect,
  renderTextCanvas,
  renderImageCanvas,
  renderBarcodeCanvas,
  renderQRCanvas,
  printCanvasObject,
  detectLabel,
  makePreviewFromPrintCanvas
} from './printer.js';

function $(id){return document.getElementById(id);}
function saveSetting(k,v){localStorage.setItem(k,JSON.stringify(v));}
function loadSetting(k,def){const v=localStorage.getItem(k); if(!v) return def; try{return JSON.parse(v);} catch(e){return def;}}

let previewTimer=null;
const DEBOUNCE=160;

function setActiveTab(name){
  document.querySelectorAll('.tab-content').forEach(el=>el.style.display='none');
  const el=$(name); if(el) el.style.display='block';
  document.querySelectorAll('#tabBar .tab').forEach(t=>t.classList.remove('active'));
  const act=document.querySelector('#tabBar .tab[data-tab="'+name+'"]'); if(act) act.classList.add('active');
  saveSetting('ui.selectedTab', name);
  updatePreviewDebounced();
}

function placePreviewCanvas(sourceCanvas){
  const wrap = $('previewCanvasWrap');
  wrap.innerHTML='';
  // scale to available width
  const maxW = Math.min(680, window.innerWidth*0.9);
  const maxH = Math.min(350, window.innerHeight*0.35);
  const scale = Math.min(maxW / sourceCanvas.width, maxH / sourceCanvas.height, 1);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  cv.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = cv.getContext('2d');
  cv.style.maxHeight = '350px';
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,cv.width,cv.height);
  ctx.drawImage(sourceCanvas, 0, 0, cv.width, cv.height);
  cv.className = 'preview-canvas';
  wrap.appendChild(cv);
}

function updatePreviewDebounced(){
  if(previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, DEBOUNCE);
}

async function updatePreview(){
  const active = document.querySelectorAll('.tab-content');
  let shown = 'tab-text';
  for(const el of active){ if(el.style.display!='none'){ shown = el.id; break; } }
  const labelW = Number($('labelWidth').value || printer.settings.labelWidthMM || 12);
  const labelH = Number($('labelLength').value || printer.settings.labelLengthMM || 40);
  const dpi = printer.settings.dpiPerMM || 8;
  try{
    let obj = null;
    if(shown === 'tab-text'){
      const text = $('textInput').value || '';
      const fontSize = Number($('fontSize').value || 36);
      const align = $('alignment').value || 'center';
      const invert = $('invertInput').checked;
      const bold = $('fontBold') && $('fontBold').checked;
      const ff = $('fontFamily') ? $('fontFamily').value : printer.settings.fontFamily;
      const fontFamily = bold ? ff + ' bold' : ff;
      obj = renderTextCanvas(text, fontSize, align, invert, labelW, labelH, dpi, fontFamily);
    } else if (shown === 'tab-image') {
      const cdata = $('imagePreview') && $('imagePreview').dataset && $('imagePreview').dataset.canvas;
      if(cdata){
        const img = new Image();
        img.onload = ()=>{
          const invert = $('imageInvert').checked;
          const obj2 = renderImageCanvas(img, Number($('imageThreshold').value||128), invert, labelW, labelH, dpi);
          const p = makePreviewFromPrintCanvas(obj2.canvas);
          placePreviewCanvas(p);
        };
        img.src = cdata;
        return;
      } else {
        $('previewCanvasWrap').innerHTML = '<div class="small">No image uploaded</div>';
        return;
      }
    } else if (shown === 'tab-barcode') {
      obj = renderBarcodeCanvas($('barcodeInput').value||'', $('barcodeType').value||'CODE128', Number($('barcodeScale').value||2), labelW, labelH, dpi);
    } else if (shown === 'tab-qr') {
      obj = await renderQRCanvas($('qrInput').value||'', Number($('qrSize').value||256), labelW, labelH, dpi);
    } else {
      obj = renderTextCanvas($('textInput').value||'', Number($('fontSize').value||36), $('alignment').value||'center', $('invertInput').checked, labelW, labelH, dpi, $('fontFamily')?.value||printer.settings.fontFamily);
    }
    if(obj && obj.canvas){
      const previewCanvas = makePreviewFromPrintCanvas(obj.canvas);
      placePreviewCanvas(previewCanvas);
    }
    const hint = $('previewHint');
    if(hint) hint.textContent = `Preview shown in label proportions (${labelW}×${labelH} mm). Change label size in Settings.`;
  }catch(e){ console.warn('preview error', e); }
}

// persist helpers wiring
function wireSimple(id, key, transform = v=>v){
  const el = $(id); if(!el) return;
  const handler = ()=>{ const v = (el.type==='checkbox') ? el.checked : el.value; saveSetting(key, transform(v)); updatePreviewDebounced(); };
  el.addEventListener(el.type==='checkbox' ? 'change' : 'input', handler);
  // restore
  const sv = loadSetting(key, null);
  if(sv!==null){
    if(el.type==='checkbox') el.checked = !!sv; else el.value = sv;
  }
}

// setup
function setup(){
  document.querySelectorAll('#tabBar .tab').forEach(t=> t.addEventListener('click', ()=> setActiveTab(t.dataset.tab)));
  // restore tab
  const lastTab = loadSetting('ui.selectedTab', 'tab-text'); setActiveTab(lastTab);
  // connect button
  $('connectBtn').addEventListener('click', async ()=> { if(!printer.connected) await connect(); else await disconnect(); updatePreviewDebounced(); });
  // wire inputs to persistence & immediate update
  ['labelWidth','labelLength','fontSize','alignment','barcodeScale','qrSize','imageThreshold','barcodeType','protocolSelect','fontFamily','fontPreset','copiesInput'].forEach(k=> wireSimple(k,k));
  ['invertInput','imageInvert','fontBold','forceInvert'].forEach(k=> wireSimple(k,k, v=>v));
  // font increment/decrement
  $('fontInc').addEventListener('click', ()=> { $('fontSize').value = Number($('fontSize').value||36)+2; saveSetting('fontSize', Number($('fontSize').value)); updatePreviewDebounced(); });
  $('fontDec').addEventListener('click', ()=> { $('fontSize').value = Math.max(6, Number($('fontSize').value||36)-2); saveSetting('fontSize', Number($('fontSize').value)); updatePreviewDebounced(); });
  $('fontPreset').addEventListener('change', ()=> { $('fontSize').value = $('fontPreset').value; saveSetting('fontSize', Number($('fontSize').value)); updatePreviewDebounced(); });

  // image upload preview
  $('imageFile')?.addEventListener('change', (ev)=>{
    const f = ev.target.files && ev.target.files[0]; if(!f) { updatePreviewDebounced(); return; }
    const reader = new FileReader();
    reader.onload = ()=>{
      const img = new Image(); img.onload = ()=>{
        const labelW = Number($('labelWidth').value||printer.settings.labelWidthMM);
        const labelH = Number($('labelLength').value||printer.settings.labelLengthMM);
        const dpi = printer.settings.dpiPerMM || 8;
        const widthPx = Math.round(labelW * dpi);
        const heightPx = Math.round(labelH * dpi);
        const bytesPerRow = Math.ceil(widthPx / 8);
        const alignedW = bytesPerRow * 8;
        const c = document.createElement('canvas'); c.width = alignedW; c.height = heightPx;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0,0,c.width,c.height);
        const ratio = Math.min(c.width / img.width, c.height / img.height);
        ctx.drawImage(img, (c.width - img.width*ratio)/2, (c.height - img.height*ratio)/2, img.width*ratio, img.height*ratio);
        $('imagePreview').dataset.canvas = c.toDataURL();
        $('imagePreview').innerHTML = ''; $('imagePreview').appendChild(c);
        updatePreviewDebounced();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  });

  $('imageScale')?.addEventListener('input', ()=>{ $('imageScaleLabel').textContent = $('imageScale').value + '%'; updatePreviewDebounced(); });

  // detect label (placeholder if not supported)
  $('detectLabelBtn')?.addEventListener('click', async ()=>{
    try{
      const res = await detectLabel();
      if(res){ alert('Detected label width mm: ' + res); $('labelWidth').value = res; saveSetting('labelWidth', res); updatePreviewDebounced(); }
      else alert('Auto detect not available.');
    }catch(e){ alert('Detect failed: ' + e); }
  });

  // print
  $('fab-print').addEventListener('click', async ()=>{
    try{
      const active = document.querySelectorAll('.tab-content'); let shown = 'tab-text';
      for(const el of active){ if(el.style.display!='none'){ shown = el.id; break; } }
      const labelW = Number($('labelWidth').value||printer.settings.labelWidthMM);
      const labelH = Number($('labelLength').value||printer.settings.labelLengthMM);
      const dpi = printer.settings.dpiPerMM || 8;
      const copies = Number($('copiesInput').value||1);
      if(shown === 'tab-text'){
        const obj = renderTextCanvas($('textInput').value, Number($('fontSize').value||36), $('alignment').value, $('invertInput').checked, labelW, labelH, dpi, $('fontFamily')?.value||printer.settings.fontFamily);
        await printCanvasObject(obj, copies, $('invertInput').checked);
      } else if (shown === 'tab-image'){
        const dataURL = $('imagePreview')?.dataset?.canvas; if(!dataURL) return alert('Please upload an image');
        const img = new Image(); img.onload = async ()=>{ const obj = renderImageCanvas(img, Number($('imageThreshold').value||128), $('imageInvert').checked, labelW, labelH, dpi); await printCanvasObject(obj, copies, $('imageInvert').checked); }; img.src = dataURL;
      } else if (shown === 'tab-barcode'){
        const obj = renderBarcodeCanvas($('barcodeInput').value||'', $('barcodeType').value||'CODE128', Number($('barcodeScale').value||2), labelW, labelH, dpi);
        await printCanvasObject(obj, copies, false);
      } else if (shown === 'tab-qr'){
        const obj = await renderQRCanvas($('qrInput').value||'', Number($('qrSize').value||256), labelW, labelH, dpi);
        await printCanvasObject(obj, copies, false);
      }
    }catch(e){ alert('Print failed: ' + e); console.error(e); }
  });

  // initial restore of simple settings
  ['labelWidth','labelLength','fontSize','alignment','barcodeScale','qrSize','imageThreshold','barcodeType','protocolSelect','fontFamily','copiesInput'].forEach(k=>{
    const v = loadSetting(k, null); if(v!==null){ const el = $(k); if(el){ if(el.type==='checkbox') el.checked = !!v; else el.value = v; } }
  });
  ['invertInput','imageInvert','fontBold','forceInvert'].forEach(k=>{ const v = loadSetting(k, null); if(v!==null){ const el = $(k); if(el) el.checked = !!v; }});
  updatePreviewDebounced();
}

window.addEventListener('DOMContentLoaded', setup);
