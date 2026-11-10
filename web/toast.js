// Stacking toasts in the spirit of Sonner: newest in front, older ones tucked behind it,
// fanned out while you hover or touch the stack; timers pause meanwhile; swipe to dismiss.
import {swipeable,reduced} from './motion.js';

const MAX=3,GAP=8;
let list,expanded=false;
const toasts=[];

function container(){
  if(list)return list;
  list=document.createElement('ol');list.className='toasts';list.setAttribute('aria-label','Notifications');
  document.body.append(list); // outside .app, so toasts stay usable while a sheet makes the app inert
  const expand=on=>{expanded=on;layout();toasts.forEach(t=>on?pause(t):resume(t));};
  list.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')expand(true);});
  list.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')expand(false);});
  list.addEventListener('focusin',()=>expand(true));
  list.addEventListener('focusout',e=>{if(!list.contains(e.relatedTarget))expand(false);});
  list.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse'&&!expanded&&toasts.length>1){expand(true);setTimeout(()=>expand(false),3500);}});
  document.addEventListener('visibilitychange',()=>toasts.forEach(t=>document.hidden?pause(t):expanded||resume(t)));
  return list;
}
function layout(){
  let offset=0;
  toasts.forEach((t,i)=>{
    const front=i===0,hiddenBehind=i>=MAX;
    t.el.style.setProperty('--y',expanded?`${-offset}px`:`${-i*10}px`);
    t.el.style.setProperty('--scale',expanded?1:Math.max(.8,1-i*.05));
    t.el.style.zIndex=String(100-i);
    t.el.dataset.front=String(front);
    t.el.style.opacity=hiddenBehind?'0':'';
    t.el.style.pointerEvents=hiddenBehind?'none':'';
    // Collapsed toasts behind the front one take its height so the stack looks even.
    t.el.style.setProperty('--h',`${toasts[0].height}px`);
    t.el.classList.toggle('behind',!front&&!expanded);
    offset+=t.height+GAP;
  });
  list.classList.toggle('expanded',expanded);
}
function pause(t){if(t.timer){clearTimeout(t.timer);t.timer=null;t.remaining-=performance.now()-t.started;}}
function resume(t){if(!t.timer&&t.remaining>0&&!t.closing){t.started=performance.now();t.timer=setTimeout(()=>dismiss(t),t.remaining);}}
function dismiss(t,{swipe=0}={}){
  if(t.closing)return;t.closing=true;clearTimeout(t.timer);
  t.el.classList.add('leaving');if(swipe)t.el.style.setProperty('--x',`${swipe>0?120:-120}%`);
  const i=toasts.indexOf(t);if(i>=0)toasts.splice(i,1);
  layout();t.onClose?.();
  setTimeout(()=>t.el.remove(),reduced()?0:320);
}

/** Show a toast. Returns {dismiss}. type: info | success | error. action: {label, run}. */
export function toast(message,{type='info',action=null,duration=null,icon=null}={}){
  const root=container();
  const el=document.createElement('li');
  el.className=`toast ${type}`;el.setAttribute('role',type==='error'?'alert':'status');
  const glyph=icon??{success:'✓',error:'!',info:'•'}[type];
  el.innerHTML=`<span class="toast-icon" aria-hidden="true"></span><span class="toast-text"></span>`;
  el.querySelector('.toast-icon').textContent=glyph;el.querySelector('.toast-text').textContent=message;
  const t={el,remaining:duration??(type==='error'?7000:action?6000:3800),timer:null,started:0,height:0,closing:false};
  if(action){
    const b=document.createElement('button');b.type='button';b.className='toast-action';b.textContent=action.label;
    b.addEventListener('click',e=>{e.stopPropagation();action.run();dismiss(t);});
    el.append(b);
  }
  root.prepend(el);
  t.height=el.offsetHeight;
  toasts.unshift(t);
  while(toasts.length>MAX+2)dismiss(toasts.at(-1));
  layout();
  requestAnimationFrame(()=>el.classList.add('shown'));
  swipeable(el,{
    onMove:dx=>{el.style.setProperty('--x',`${dx}px`);el.style.opacity=String(Math.max(.2,1-Math.abs(dx)/260));},
    onEnd:(dx,v)=>{if(Math.abs(dx)>80||Math.abs(v)>.45)dismiss(t,{swipe:dx||v});else{el.style.setProperty('--x','0px');el.style.opacity='';}},
  });
  if(!expanded&&!document.hidden)resume(t);
  return {dismiss:()=>dismiss(t)};
}
