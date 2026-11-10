// Bottom sheet in the spirit of Vaul: slides up over a dimmed, slightly receding app;
// drag the handle (or the content when it's scrolled to the top) down to close — a quick
// flick closes it too. Esc closes; focus stays inside while it's open and returns after.
import {reduced} from './motion.js';

let currentSheet=null;
const FOCUSABLE='button:not([disabled]),input:not([disabled]),select,textarea,a[href],[tabindex]:not([tabindex="-1"])';

export function closeSheet(){currentSheet?.close();}
export function sheetOpen(){return !!currentSheet;}

/** Open a sheet with trusted HTML. Returns {el, body, close}. */
export function openSheet(html,{label='Options',onClose,focus=true}={}){
  currentSheet?.close({instant:true});
  const app=document.querySelector('.app'),returnFocus=document.activeElement;
  const layer=document.createElement('div');layer.className='sheet-layer';
  layer.innerHTML=`<div class="sheet-overlay"></div><div class="sheet" role="dialog" aria-modal="true"><div class="sheet-handle" aria-hidden="true"><span></span></div><div class="sheet-body"></div></div>`;
  const sheet=layer.querySelector('.sheet'),body=layer.querySelector('.sheet-body'),overlay=layer.querySelector('.sheet-overlay');
  sheet.setAttribute('aria-label',label);body.innerHTML=html;
  document.body.append(layer);app?.setAttribute('inert','');
  requestAnimationFrame(()=>{layer.classList.add('open');document.documentElement.classList.add('sheet-open');});
  if(focus)setTimeout(()=>(body.querySelector('[autofocus]')||body.querySelector(FOCUSABLE))?.focus({preventScroll:true}),reduced()?0:240);

  let closed=false;
  function close({instant=false}={}){
    if(closed)return;closed=true;
    if(currentSheet?.el===layer)currentSheet=null;
    document.removeEventListener('keydown',keys,true);
    layer.classList.remove('open');layer.classList.add('closing');sheet.style.transform='';
    document.documentElement.classList.remove('sheet-open');
    app?.removeAttribute('inert');
    setTimeout(()=>layer.remove(),instant||reduced()?0:360);
    if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
    onClose?.();
  }
  function keys(e){
    if(e.key==='Escape'){e.preventDefault();close();return;}
    if(e.key!=='Tab')return;
    const items=[...sheet.querySelectorAll(FOCUSABLE)].filter(el=>el.offsetParent!==null);if(!items.length)return;
    const first=items[0],last=items.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
  document.addEventListener('keydown',keys,true);
  overlay.addEventListener('click',()=>close());

  // Drag to dismiss.
  let start=null,dy=0,lastY=0,lastT=0,velocity=0;
  sheet.addEventListener('pointerdown',e=>{
    const onHandle=!!e.target.closest('.sheet-handle');
    if(!onHandle&&(body.scrollTop>0||e.target.closest('input,textarea,select,[data-no-drag]')))return;
    start={y:e.clientY,onHandle,id:e.pointerId,captured:false};dy=0;lastY=e.clientY;lastT=e.timeStamp;velocity=0;
  });
  sheet.addEventListener('pointermove',e=>{
    if(!start||e.pointerId!==start.id)return;
    const d=e.clientY-start.y;
    if(!start.captured){if(Math.abs(d)<6)return;if(d<0&&!start.onHandle){start=null;return;}sheet.setPointerCapture(e.pointerId);start.captured=true;sheet.classList.add('dragging');}
    // Pulling up resists; pulling down follows the finger.
    dy=d<0?-Math.sqrt(-d)*2:d;
    velocity=(e.clientY-lastY)/((e.timeStamp-lastT)||16);lastY=e.clientY;lastT=e.timeStamp;
    sheet.style.transform=`translateY(${dy}px)`;
    overlay.style.opacity=String(Math.max(0,1-dy/(sheet.offsetHeight||1)));
  });
  const end=e=>{
    if(!start||e.pointerId!==start.id)return;
    const was=start.captured;start=null;sheet.classList.remove('dragging');
    if(!was)return;
    if(dy>sheet.offsetHeight*.3||velocity>.5){close();return;}
    sheet.style.transform='';overlay.style.opacity='';
  };
  sheet.addEventListener('pointerup',end);sheet.addEventListener('pointercancel',end);

  currentSheet={el:layer,body,close};
  return currentSheet;
}
