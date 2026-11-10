// Command menu in the spirit of cmdk: ⌘K / Ctrl+K (or the search button) opens a search over
// checklists, categories, items in the open checklist, and app actions. Arrow keys move,
// Enter runs, Esc closes, typing filters with fuzzy matching.
import {openSheet,closeSheet} from './sheet.js';

// Score how well a query matches text: consecutive letters and word starts score higher.
export function score(query,text){
  query=query.toLowerCase().trim();text=String(text).toLowerCase();
  if(!query)return 1;
  if(text.startsWith(query))return 1000-text.length;
  const at=text.indexOf(query);
  if(at>=0)return 800-at-text.length*.1+(/[\s\-/›]/.test(text[at-1]||' ')?100:0);
  let total=0,ti=0,run=0;
  for(const ch of query.replace(/\s+/g,'')){
    const found=text.indexOf(ch,ti);if(found<0)return 0;
    run=found===ti?run+1:0;total+=1+run*3+(/[\s\-/›]/.test(text[found-1]||' ')?4:0);ti=found+1;
  }
  return total;
}
export function filterItems(items,query){
  return items.map(item=>({item,s:Math.max(score(query,item.label),score(query,item.keywords||'')*.8)}))
    .filter(x=>x.s>0).sort((a,b)=>b.s-a.s||a.item.order-b.item.order).map(x=>x.item);
}

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const GROUPS=['In this checklist','Checklists','Categories','Actions'];

/** items: [{group,label,hint,icon,keywords,run}] */
export function openCommand(getItems){
  const all=getItems().map((x,order)=>({...x,order,id:`cmd-${order}`}));
  const {body}=openSheet(`<div class="command" data-no-drag><div class="command-input"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input id="command-input" type="search" role="combobox" aria-expanded="true" aria-controls="command-list" aria-autocomplete="list" placeholder="Search checklists, items, actions…" autocomplete="off" spellcheck="false" autofocus><kbd>esc</kbd></div><div id="command-list" role="listbox" aria-label="Results"></div></div>`,{label:'Search'});
  const input=body.querySelector('input'),listEl=body.querySelector('#command-list');
  let results=[],active=0;
  function draw(){
    const q=input.value;
    results=q.trim()?filterItems(all,q):all.filter(x=>x.group!=='In this checklist'||all.filter(y=>y.group==='In this checklist').indexOf(x)<5);
    // Group, keeping groups in a fixed order (results within a group stay ranked).
    const ordered=[];for(const g of GROUPS)ordered.push(...results.filter(r=>r.group===g));results=ordered;
    active=Math.min(active,Math.max(0,results.length-1));
    let html='',group=null;
    results.forEach((r,i)=>{
      if(r.group!==group){group=r.group;html+=`<div class="command-group" role="presentation">${esc(group)}</div>`;}
      html+=`<div class="command-item" role="option" id="${r.id}" data-index="${i}" aria-selected="${i===active}"><span class="command-icon" aria-hidden="true">${esc(r.icon||'›')}</span><span class="command-label">${esc(r.label)}</span>${r.hint?`<span class="command-hint">${esc(r.hint)}</span>`:''}</div>`;
    });
    listEl.innerHTML=html||`<p class="command-empty">Nothing matches “${esc(q)}”.</p>`;
    input.setAttribute('aria-activedescendant',results[active]?.id||'');
  }
  function move(to){
    if(!results.length)return;active=(to+results.length)%results.length;
    listEl.querySelectorAll('[aria-selected]').forEach(el=>el.setAttribute('aria-selected',String(Number(el.dataset.index)===active)));
    const el=listEl.querySelector(`[data-index="${active}"]`);el?.scrollIntoView({block:'nearest'});
    input.setAttribute('aria-activedescendant',results[active]?.id||'');
  }
  function choose(i){const r=results[i];if(!r)return;closeSheet();setTimeout(()=>r.run(),0);}
  input.addEventListener('input',()=>{active=0;draw();listEl.scrollTop=0;});
  input.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'||(e.ctrlKey&&e.key==='n')){e.preventDefault();move(active+1);}
    else if(e.key==='ArrowUp'||(e.ctrlKey&&e.key==='p')){e.preventDefault();move(active-1);}
    else if(e.key==='Home'&&results.length){e.preventDefault();move(0);}
    else if(e.key==='End'&&results.length){e.preventDefault();move(results.length-1);}
    else if(e.key==='Enter'){e.preventDefault();choose(active);}
  });
  listEl.addEventListener('pointermove',e=>{const el=e.target.closest('.command-item');if(el&&Number(el.dataset.index)!==active)move(Number(el.dataset.index));});
  listEl.addEventListener('click',e=>{const el=e.target.closest('.command-item');if(el)choose(Number(el.dataset.index));});
  draw();
}
