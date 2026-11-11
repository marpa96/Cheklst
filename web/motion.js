// Motion helpers: page transitions, rolling numbers, confetti, haptics and a swipe recognizer.
export const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- page transitions ----------
// Uses the View Transitions API where available (slides forward/back), otherwise a CSS fade-up.
const DEPTH={home:0,all:1,category:1,settings:1,categories:1,run:2,edit:2,history:3};
export function pageTransition(from,to,update){
  const direction=(DEPTH[to]??1)>=(DEPTH[from]??1)?(from===to?'same':'forward'):'back';
  const root=document.documentElement,main=document.querySelector('#main');
  if(reduced()||from===to){update();return;}
  root.dataset.nav=direction;
  // New page content also rises in, slightly staggered.
  const enter=()=>{update();main.classList.remove('entering');void main.offsetWidth;main.classList.add('entering');clearTimeout(enterTimer);enterTimer=setTimeout(()=>main.classList.remove('entering'),800);};
  viewTransition(enter).finally(()=>{if(root.dataset.nav===direction)delete root.dataset.nav;});
}
let enterTimer;

// Run `update` inside a view transition when possible. The update always runs exactly once:
// browsers abort transitions (hidden tab, overlapping transition) and may then skip the callback.
export function viewTransition(update){
  let ran=false;const once=()=>{if(!ran){ran=true;update();}};
  if(!document.startViewTransition||document.hidden||reduced()){once();return Promise.resolve();}
  try{
    const t=document.startViewTransition(once);
    t.ready.catch(()=>{});
    t.updateCallbackDone.catch(()=>{}).finally(once);
    // A transition waits for the next frame; if none comes (page not painting), don't hang.
    setTimeout(()=>{if(!ran){try{t.skipTransition();}catch{}once();}},500);
    return t.finished.catch(()=>{});
  }catch{once();return Promise.resolve();}
}

// ---------- rolling numbers (in the spirit of NumberFlow) ----------
// Mark up a value with flowHTML(key, text); after each render, animateFlows() rolls each digit
// from the value that was on screen before. setFlow() updates one element in place.
const last=new Map();
const strip='<span class="strip" aria-hidden="true">'+[...'0123456789'].map(d=>`<span>${d}</span>`).join('')+'</span>';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function digits(text,from){
  const t=String(text),f=String(from??t).padStart(t.length,' ').slice(-t.length);
  return [...t].map((ch,i)=>/\d/.test(ch)?`<span class="digit" data-to="${ch}" data-from="${/\d/.test(f[i])?f[i]:ch}">${strip}</span>`:`<span class="sym">${esc(ch)}</span>`).join('');
}
export function flowHTML(key,text){
  text=String(text);
  return `<span class="flow" data-flow="${esc(key)}" aria-label="${esc(text)}" role="text">${digits(text,last.get(key))}</span>`;
}
function settle(el){
  const strips=el.querySelectorAll('.digit');
  strips.forEach(d=>{d.firstChild.style.transform=`translateY(${-Number(d.dataset.from)*10}%)`;});
  if(reduced()){strips.forEach(d=>{d.firstChild.style.transform=`translateY(${-Number(d.dataset.to)*10}%)`;});return;}
  requestAnimationFrame(()=>requestAnimationFrame(()=>strips.forEach(d=>{d.firstChild.style.transform=`translateY(${-Number(d.dataset.to)*10}%)`;})));
}
export function animateFlows(root=document){
  root.querySelectorAll('.flow[data-flow]').forEach(el=>{settle(el);last.set(el.dataset.flow,el.getAttribute('aria-label'));});
}
export function setFlow(el,text){
  if(!el)return;text=String(text);
  const key=el.dataset.flow,prev=last.get(key)??el.getAttribute('aria-label');
  if(prev===text)return;
  el.setAttribute('aria-label',text);el.innerHTML=digits(text,prev);settle(el);last.set(key,text);
}

// ---------- haptics ----------
export function haptic(pattern=8){try{navigator.vibrate?.(pattern);}catch{}}

// ---------- confetti ----------
export function confetti(hues=[260,330,40]){
  if(reduced())return;
  const canvas=document.createElement('canvas'),dpr=Math.min(2,devicePixelRatio||1);
  canvas.className='confetti';canvas.setAttribute('aria-hidden','true');
  const w=innerWidth,h=innerHeight;canvas.width=w*dpr;canvas.height=h*dpr;
  document.body.append(canvas);
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  // Two cannons in the lower corners, firing up and inward.
  const pieces=Array.from({length:150},(_,i)=>{const left=i%2===0;return {
    x:left?w*.12:w*.88,y:h*.8,vx:(left?1:-1)*(2+Math.random()*7),vy:-(9+Math.random()*9),
    r:Math.random()*Math.PI,vr:(Math.random()-.5)*.35,s:5+Math.random()*7,
    color:`oklch(${68+Math.random()*14}% .2 ${hues[i%hues.length]+Math.random()*30})`,shape:i%3};});
  let frame=0;
  (function tick(){
    ctx.clearRect(0,0,w,h);frame++;
    for(const p of pieces){
      p.vy+=.32;p.vx*=.99;p.x+=p.vx;p.y+=p.vy;p.r+=p.vr;
      ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.r);ctx.fillStyle=p.color;ctx.globalAlpha=Math.max(0,1-frame/160);
      if(p.shape===0)ctx.fillRect(-p.s/2,-p.s/4,p.s,p.s/2);
      else if(p.shape===1){ctx.beginPath();ctx.arc(0,0,p.s/2.6,0,7);ctx.fill();}
      else ctx.fillRect(-p.s/6,-p.s/2,p.s/3,p.s);
      ctx.restore();
    }
    if(frame<170)requestAnimationFrame(tick);else canvas.remove();
  })();
}

// ---------- swipe recognizer ----------
// Horizontal swipe on an element that also lets the page scroll vertically.
// onMove(dx) while dragging; onEnd(dx, velocity) returns true to keep the element where it is.
let suppressClickUntil=0;
globalThis.document?.addEventListener('click',e=>{if(performance.now()<suppressClickUntil){e.stopPropagation();e.preventDefault();}},true);
export function swipeable(el,{onMove,onEnd,axis='x'}){
  let start=null,locked=null,lastX=0,lastT=0,velocity=0,pointer=null;
  el.addEventListener('pointerdown',e=>{
    if(e.button!==0||e.target.closest('input,textarea,select,a,[data-no-swipe]'))return;
    start={x:e.clientX,y:e.clientY};locked=null;lastX=e.clientX;lastT=e.timeStamp;velocity=0;pointer=e.pointerId;
  });
  el.addEventListener('pointermove',e=>{
    if(!start||e.pointerId!==pointer)return;
    const dx=e.clientX-start.x,dy=e.clientY-start.y;
    if(locked===null&&Math.hypot(dx,dy)>8){locked=(axis==='x'?Math.abs(dx)>Math.abs(dy)*1.2:Math.abs(dy)>Math.abs(dx)*1.2);if(locked){el.setPointerCapture(pointer);el.classList.add('dragging');}}
    if(!locked)return;
    const dt=e.timeStamp-lastT||16;velocity=((axis==='x'?e.clientX:e.clientY)-lastX)/dt;lastX=axis==='x'?e.clientX:e.clientY;lastT=e.timeStamp;
    onMove(axis==='x'?dx:dy);
  });
  const finish=e=>{
    if(!start||e.pointerId!==pointer)return;
    const dx=(axis==='x'?e.clientX-start.x:e.clientY-start.y);start=null;
    if(!locked)return;
    el.classList.remove('dragging');
    suppressClickUntil=performance.now()+350; // the click that follows a drag isn't a tap
    onEnd(dx,velocity);
  };
  el.addEventListener('pointerup',finish);
  el.addEventListener('pointercancel',e=>{if(start&&locked){start=null;el.classList.remove('dragging');onEnd(0,0);}start=null;});
}
