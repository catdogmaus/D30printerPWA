// ui.js - minimal changes: wire image scale slider and ensure QR/Barcode libs are available
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

function $(id){ return document.getElementById(id); }
function saveSetting(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
function loadSetting(k,def){ const v = localStorage.getItem(k); if(!v) return def; try{return JSON.parse(v);}catch(e){return def;} }

let previewTimer = null;
const DEBOUNCE = 150;

function setActiveTab(name){
  document.querySelectorAll('.tab-content').forEach(el=>el.style.display='none');
  const el = $(name); if(el) el.style.display='block';
  document.querySelectorAll('#tabBar .tab').forEach(t=>t.classList.remove('active'));
  const act = document.querySelector('#tabBar .tab[data-tab="'+name+'"]'); if(act) act.classList.add('active');
  saveSetting('ui.selectedTab', name);
  updatePreviewDebounced();
}

function placePreviewCanvas(sourceCanvas){
  const wrap = $('previewCanvasWrap');
  if(!wrap) return;
  wrap.innerHTML = '';
  const maxW = Math.min(680, window.innerWidth * 0.9);
  const maxH = Math.min(350, window.innerHeight * 0.35);
  const scale = Math.min(maxW / sourceCanvas.width, maxH / sourceCanvas.height, 1);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  cv.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,cv.width,cv.height);
  ctx.drawImage(sourceCanvas, 0, 0, cv.width, cv.height);
  cv.className = 'preview-canvas';
  cv.style.maxHeight = '350px';
  wrap.appendChild(cv);
}

function updatePreviewDebounced(){
  if(previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, DEBOUNCE);
}

async function updatePreview(){
  try {
    // find active tab
    let shown = 'tab-text';
    document.querySelectorAll('.tab-content').forEach(el=>{ if(el.style.display!='none') shown = el.id; });
    const labelW = Number($('labelWidth')?.value || printer.settings.labelWidthMM || 12);
    const labelH = Number($('labelLength')?.value || printer.settings.labelLengthMM || 40);
    const dpi = printer.settings.dpiPerMM || 8;

    let obj = null;
    if(shown === 'tab-text'){
      const text = $('textInput')?.value || '';
      const fontSize = Number($('fontSize')?.value || 36);
      const align = $('alignment')?.value || 'center';
      const invert = !!$('invertInput')?.checked;
      const bold = !!$('fontBold')?.checked;
      const ff = $('fontFamily')?.value || printer.settings.fontFamily;
      const fontFamily = bold ? ff + ' bold' : ff;
      obj = renderTextCanvas(text, fontSize, align, invert, labelW, labelH, dpi, fontFamily);
    } else if (shown === 'tab-image'){
      const cd = $('imagePreview')?.dataset?.canvas;
      if(cd){
        const img = new Image();
        img.onload = ()=>{
          const invert = !!$('imageInvert')?.checked;
          const scaleFactor = Number($('imageScale')?.value || 100)/100;
          const obj2 = renderImageCanvas(img, Number($('imageThreshold')?.value||128), invert, labelW, labelH, dpi, scaleFactor);
          const p = makePreviewFromPrintCanvas(obj2.canvas);
          placePreviewCanvas(p);
        };
        img.src = cd;
        return;
      } else {
        const wrap = $('previewCanvasWrap');
        if(wrap) wrap.innerHTML = '<div class="small">No image uploaded</div>';
        return;
      }
    } else if (shown === 'tab-barcode'){
      obj = renderBarcodeCanvas($('barcodeInput')?.value||'', $('barcodeType')?.value||'CODE128', Number($('barcodeScale')?.value||2), labelW, labelH, dpi);
    } else if (shown === 'tab-qr'){
      obj = await renderQRCanvas($('qrInput')?.value||'', Number($('qrSize')?.value||256), labelW, labelH, dpi);
    } else {
      obj = renderTextCanvas($('textInput')?.value||'', Number($('fontSize')?.value||36), $('alignment')?.value||'center', !!$('invertInput')?.checked, labelW, labelH, dpi, $('fontFamily')?.value||printer.settings.fontFamily);
    }

    if(obj && obj.canvas){
      const previewCanvas = makePreviewFromPrintCanvas(obj.canvas);
      placePreviewCanvas(previewCanvas);
    }

    const hint = $('previewHint');
    if(hint) hint.textContent = `Preview shown in label proportions (${labelW}×${labelH} mm). Change label size in Settings.`;
  } catch(e){
    console.warn('preview error', e);
  }
}

function wireSimple(id, key){
  const el = $(id); if(!el) return;
  const handler = ()=>{ const v = (el.type === 'checkbox') ? el.checked : el.value; saveSetting(key, v); updatePreviewDebounced(); };
  el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', handler);
  const sv = loadSetting(key, null);
  if(sv !== null){
    if(el.type === 'checkbox') el.checked = !!sv; else el.value = sv;
  }
}

// image upload helper
function handleImageFile(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>{
      const img = new Image();
      img.onload = ()=>{
        // create label-sized canvas and store dataURL for preview/printing
        const labelW = Number($('labelWidth')?.value || printer.settings.labelWidthMM);
        const labelH = Number($('labelLength')?.value || printer.settings.labelLengthMM);
        const dpi = printer.settings.dpiPerMM || 8;
        const widthPx = Math.round(labelW * dpi);
        const heightPx = Math.round(labelH * dpi);
        const bytesPerRow = Math.ceil(widthPx / 8);
        const alignedW = bytesPerRow * 8;
        const c = document.createElement('canvas'); c.width = alignedW; c.height = heightPx;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0,0,c.width,c.height);
        const ratio = Math.min(c.width / img.width, c.height / img.height);
        ctx.drawImage(img, (c.width - img.width*ratio)/2, (c.height - img.height*ratio)/2, img.width*ratio, img.height*ratio);
        resolve(c.toDataURL());
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// setup wiring
function setup(){
  // tabs wiring (do not alter existing DOM structure)
  document.querySelectorAll('#tabBar .tab').forEach(t=> t.addEventListener('click', ()=> setActiveTab(t.dataset.tab)));
  const lastTab = loadSetting('ui.selectedTab', 'tab-text'); setActiveTab(lastTab);

  // connect button
  $('connectBtn')?.addEventListener('click', async ()=>{
    if(!printer.connected) await connect(); else await disconnect();
    updatePreviewDebounced();
  });

  // wire commonly persisted controls (minimal set)
  ['labelWidth','labelLength','fontSize','alignment','barcodeScale','qrSize','imageThreshold','barcodeType','protocolSelect','fontFamily','fontPreset','copiesInput','imageScale'].forEach(k => wireSimple(k,k));
  ['invertInput','imageInvert','fontBold','forceInvert'].forEach(k => wireSimple(k,k));

  // image file upload
  $('imageFile')?.addEventListener('change', async (ev)=>{
    const f = ev.target.files && ev.target.files[0]; if(!f) { updatePreviewDebounced(); return; }
    try{
      const dataUrl = await handleImageFile(f);
      $('imagePreview').dataset.canvas = dataUrl;
      $('imagePreview').innerHTML = '';
      const img = new Image(); img.src = dataUrl; $('imagePreview').appendChild(img);
      updatePreviewDebounced();
    }catch(e){
      console.warn('image load failed', e);
    }
  });

  // image scale slider wiring (already persisted by wireSimple) but update its label
  const imgScaleEl = $('imageScale');
  if(imgScaleEl){
    const lbl = $('imageScaleLabel');
    imgScaleEl.addEventListener('input', ()=>{ if(lbl) lbl.textContent = imgScaleEl.value + '%'; updatePreviewDebounced(); });
    const sv = loadSetting('imageScale', null); if(sv !== null) { imgScaleEl.value = sv; if(lbl) lbl.textContent = sv + '%'; }
  }

  // detect label button (placeholder)
  $('detectLabelBtn')?.addEventListener('click', async ()=>{
    try{
      const res = await detectLabel();
      if(res){ alert('Detected label width mm: ' + res); $('labelWidth').value = res; saveSetting('labelWidth', res); updatePreviewDebounced(); }
      else alert('Auto detect not available.');
    }catch(e){ alert('Detect failed: ' + e); }
  });

  // print button wiring - minimal changes: apply image scale to printed image
  $('fab-print')?.addEventListener('click', async ()=>{
    try{
      // determine active tab
      let shown = 'tab-text';
      document.querySelectorAll('.tab-content').forEach(el=>{ if(el.style.display!='none') shown = el.id; });
      const labelW = Number($('labelWidth')?.value || printer.settings.labelWidthMM);
      const labelH = Number($('labelLength')?.value || printer.settings.labelLengthMM);
      const dpi = printer.settings.dpiPerMM || 8;
      const copies = Number($('copiesInput')?.value || 1);

      if(shown === 'tab-text'){
        const obj = renderTextCanvas($('textInput')?.value||'', Number($('fontSize')?.value||36), $('alignment')?.value||'center', !!$('invertInput')?.checked, labelW, labelH, dpi, $('fontFamily')?.value||printer.settings.fontFamily);
        await printCanvasObject(obj, copies, !!$('invertInput')?.checked);
      } else if (shown === 'tab-image'){
        const dataURL = $('imagePreview')?.dataset?.canvas;
        if(!dataURL) { alert('Please upload an image'); return; }
        const img = new Image();
        img.onload = async ()=>{
          const scaleFactor = Number($('imageScale')?.value || 100)/100;
          const obj = renderImageCanvas(img, Number($('imageThreshold')?.value||128), !!$('imageInvert')?.checked, labelW, labelH, dpi, scaleFactor);
          await printCanvasObject(obj, copies, !!$('imageInvert')?.checked);
        };
        img.src = dataURL;
      } else if (shown === 'tab-barcode'){
        const obj = renderBarcodeCanvas($('barcodeInput')?.value||'', $('barcodeType')?.value||'CODE128', Number($('barcodeScale')?.value||2), labelW, labelH, dpi);
        await printCanvasObject(obj, copies, false);
      } else if (shown === 'tab-qr'){
        const obj = await renderQRCanvas($('qrInput')?.value||'', Number($('qrSize')?.value||256), labelW, labelH, dpi);
        await printCanvasObject(obj, copies, false);
      }
    }catch(e){
      console.error('Print failed', e);
      alert('Print failed: ' + e);
    }
  });

  // restore simple persisted controls (values already handled by wireSimple but ensure imageScale label)
  const restoreKeys = ['labelWidth','labelLength','fontSize','alignment','barcodeScale','qrSize','imageThreshold','barcodeType','protocolSelect','fontFamily','copiesInput','imageScale'];
  restoreKeys.forEach(k=>{ const v = loadSetting(k, null); if(v!==null){ const el = $(k); if(el) { if(el.type === 'checkbox') el.checked = !!v; else el.value = v; } } });
  ['invertInput','imageInvert','fontBold','forceInvert'].forEach(k=>{ const v = loadSetting(k, null); if(v!==null){ const el = $(k); if(el) el.checked = !!v; } });

  updatePreviewDebounced();
}

window.addEventListener('DOMContentLoaded', setup);
