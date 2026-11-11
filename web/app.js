import {renderInline,webLinks} from './links.js';
import {inProgress,syncCompletion,parse,latest,newState,markdownOf,openChecklist,versionOf,tasks,current,complete,setItem,restart,closeRun,nextChecklist,sortChecklists,saveDraft,restore,deleteChecklist,copyChecklist,addCategory,renameCategory,deleteCategory,moveCategory,ensureCategory,validateState,persistable,automaticTarget,UNCATEGORIZED} from './core.js';
import {runCalcs,substitute,format,CALC_TEMPLATE} from './calc.js';
import {applyLibrary,setOffline,downloadLibrary,repoName,DEFAULT_REPO} from './library.js';
import {ROW_TYPES,CALLOUTS,markdownToRows,rowsToMarkdown,newRow,moveRow} from './editor.js';
import {detectWidgets,clock,stepFor,stepValue} from './widgets.js';
import {startAmbient,phase,hueFor,palette,ambientEnabled,setAmbientEnabled} from './ambient.js';
import {pageTransition,viewTransition,flowHTML,animateFlows,setFlow,haptic,confetti,swipeable,reduced} from './motion.js';
import {toast} from './toast.js';
import {openSheet,closeSheet} from './sheet.js';
import {openCommand} from './command.js';
import {dueInfo,dueList,lastDone,nextDue,relativeDay,describeSchedule,addInterval,dayKey,setSchedule,recordCompletion,UNITS} from './schedule.js';

export const BUILD='3';
const KEY='cheklst.state.v1',MODE_KEY='cheklst.runMode.v1';
const $=s=>document.querySelector(s), main=$('#main');
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,text,cls='',extra='')=>`<button type="button" data-action="${action}" class="${cls}" ${extra}>${text}</button>`;
const isMac=/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent);

let state, page='home', categoryId=null, editingCategory=null, backupCandidate=null, locked=false;
let session={};                     // library checklist text for this app session (not persisted unless saved offline)
let library={busy:false,message:''};
let scrollTimer;
let runMode='list';try{runMode=localStorage.getItem(MODE_KEY)==='focus'?'focus':'list';}catch{}

// ---------- state ----------
function notice(message){if(message)toast(message,{type:'error'});}
function save(next){localStorage.setItem(KEY,JSON.stringify(persistable(next)));}
function change(action,redraw=true){
  if(locked){notice('Saved data needs recovery first. Download it from the recovery screen.');return false;}
  try{const next=structuredClone(state);action(next);validateState(next);save(next);state=next;if(redraw)render();return true;}
  catch(e){notice(e.message);return false;}
}
// Do something right away and offer Undo, instead of asking "are you sure?" first.
function undoable(message,action,{redraw=true}={}){
  const before=structuredClone(state),beforePage=page,beforeCategory=categoryId;
  if(!change(action,redraw))return false;
  toast(message,{type:'success',action:{label:'Undo',run:()=>{try{validateState(before);save(before);state=before;categoryId=beforeCategory;go(beforePage);}catch(e){notice(e.message);}}}});
  return true;
}
const active=()=>state.checklists.find(c=>c.id===state.active);
const run=()=>state.runs[state.active];
const visible=()=>state.checklists.filter(c=>!c.retired);
const category=()=>state.categories.find(c=>c.id===categoryId);
const categoryNamed=name=>state.categories.find(c=>c.name===name);
const available=c=>markdownOf(c,session)!==null;
const progressOf=r=>{const t=tasks(r);return {total:t.length,done:t.filter(b=>r.states[b.line]==='done').length,pending:t.filter(b=>r.states[b.line]==='pending').length};};
function checklistsIn(name){return sortChecklists(visible().filter(c=>c.category===name));}

// ---------- navigation ----------
function go(where,{after}={}){
  savePosition();closeSheet();
  const from=page;
  pageTransition(from,where,()=>{page=where;editingCategory=null;render();main.scrollTop=0;after?.();});
}
function open(id){
  const c=state.checklists.find(c=>c.id===id);if(!c)return;
  if(!state.runs[id]&&!available(c)){notice(`“${c.title}” isn’t saved on this device. Connect to the internet, or turn on Save offline while connected.`);return;}
  savePosition();
  const prev=active(),prevRun=run();
  if(!change(s=>openChecklist(s,id,markdownOf(c,session)),false))return;
  go('run',{after:restorePosition});
  // Switching mid-checklist is fine: say where the other one went.
  if(prev&&prev.id!==id&&prevRun&&state.runs[prev.id]&&!complete(prevRun)){const p=progressOf(prevRun);toast(`“${prev.title}” is saved at ${p.done} of ${p.total}. It’s under In progress on Home.`,{icon:'⏸'});}
}
function contextHue(){
  if(page==='category')return category()?hueFor(category().name):null;
  if(['run','history'].includes(page)&&active())return hueFor(active().category);
  if(page==='edit'&&state.draft)return hueFor(state.draft.category);
  return null;
}
function render(){
  if(!state)return;
  const views={home,category:categoryPage,all:allPage,run:runner,edit:editor,categories:categoriesPage,settings,history};
  if(page==='run'&&!active())page='home';
  main.innerHTML=views[page]();
  main.dataset.page=page;
  const hue=contextHue(),root=document.documentElement;
  if(hue===null)root.style.removeProperty('--ctx');else root.style.setProperty('--ctx',hue);
  $('#resume').hidden=!active()||page==='run';
  document.querySelectorAll('.bottom [data-action]').forEach(b=>b.setAttribute('aria-current',b.dataset.action===page||(b.dataset.action==='home'&&['category','all'].includes(page))?'page':'false'));
  renderHeader();updateReturn();bindGestures();animateFlows(document);updateBadge();
}

// ---------- shared pieces ----------
function categoryIcon(cat){return cat?.icon?escape(cat.icon):'☷';}
const hueStyle=name=>`style="--cat:${hueFor(name)}"`;
function offlineToggle(c){
  if(c.source==='device')return '<span class="chip" title="Created in the app; always stored on this device">On device</span>';
  const label=c.offline?'Saved offline':'Online only';
  return `<label class="switch" title="Save this checklist on this device so it works without internet"><input type="checkbox" data-offline="${escape(c.id)}" ${c.offline?'checked':''} aria-label="Save “${escape(c.title)}” offline"><span class="slider" aria-hidden="true"></span><span class="switch-label">${label}</span></label>`;
}
const dueChip=info=>`<span class="due-chip ${info.tone}">${escape(info.label)}</span>`;
function ring(fraction,content='',cls=''){return `<span class="ring ${cls}" style="--p:${Math.round(Math.max(0,Math.min(1,fraction))*100)}" aria-hidden="true"><span>${content}</span></span>`;}
function checklistRow(c,i=0){
  const r=state.runs[c.id],p=r?progressOf(r):null;
  const last=lastDone(c),due=dueInfo(c);
  const status=r?`In progress · ${p.done}/${p.total}`:last?`Done ${relativeDay(last)}`:c.source==='library'?'From GitHub':'Created in app';
  const unavailable=!r&&!available(c);
  return `<div class="procedure-row ${unavailable?'unavailable':''}" style="--i:${i}" data-search="${escape(c.title+' '+c.category)}"><button type="button" class="procedure" data-action="open" data-id="${escape(c.id)}">${r?ring(p.total?p.done/p.total:0):'<span class="ring empty" aria-hidden="true"></span>'}<span class="copy"><strong>${escape(c.title)}</strong><small>${escape(status)}${c.schedule?` · ${escape(describeSchedule(c.schedule))}`:''}${unavailable?' · needs internet':''}</small>${due?dueChip(due):''}</span><span class="chevron">›</span></button>${offlineToggle(c)}</div>`;
}
function libraryLine(){
  const l=state.library;
  if(library.busy)return 'Syncing with GitHub…';
  if(library.message)return library.message;
  if(!l.repo)return 'No GitHub library set. Add one in Settings.';
  if(l.bundled)return 'Showing the starter library bundled with the app. Your GitHub library hasn’t been reached yet.';
  return l.syncedAt?`Synced ${new Date(l.syncedAt).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})}`:'Not synced with GitHub yet.';
}
const shortcut=isMac?'⌘K':'Ctrl K';
const SEARCH_ICON='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>';

// ---------- pages ----------
function home(){
  const p=phase();
  let html=`<header class="hero"><span class="eyebrow">${escape(new Date().toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'}))}</span><h1 class="greeting"><span class="grad">${p.greeting}</span> <span class="wave" aria-hidden="true">${p.icon}</span></h1></header>`;
  html+=`<button type="button" class="search-pill" data-action="command">${SEARCH_ICON}<span>Search checklists, items, actions</span><kbd>${shortcut}</kbd></button>`;
  const running=inProgress(state);
  if(running.length){
    const [{c:first,run:r}]=running,pr=progressOf(r),next=tasks(r).find(b=>b.line===current(r));
    html+=`<button type="button" class="resume-card" data-action="open" data-id="${escape(first.id)}" ${hueStyle(first.category)}>${ring(pr.total?pr.done/pr.total:0,`${Math.round(pr.total?pr.done/pr.total*100:0)}%`,'big')}<span class="copy"><span class="eyebrow">CONTINUE · ${escape(first.category)}</span><strong>${escape(first.title)}</strong><small>${next?`Next: ${escape(substitute(next.text,runCalcs(parse(r.markdown),r.calc||{}).vars))}`:'All done'}</small>${(()=>{const d=dueInfo(first);return d&&d.tone!=='later'?dueChip(d):'';})()}</span><span class="go" aria-hidden="true">→</span></button>`;
    if(running.length>1){
      html+=`<div class="section-label">Also in progress</div><div class="mini-list">`;
      for(const {c,run:r} of running.slice(1)){const p=progressOf(r);html+=`<button type="button" class="mini-row" data-action="open" data-id="${escape(c.id)}" ${hueStyle(c.category)}>${ring(p.total?p.done/p.total:0)}<span class="copy"><strong>${escape(c.title)}</strong><small>${p.done} of ${p.total} · last touched ${escape(relativeDay(new Date(r.touched||r.started||Date.now())))}</small></span>${(()=>{const d=dueInfo(c);return d&&d.tone!=='later'?dueChip(d):'<span class="chevron">›</span>';})()}</button>`;}
      html+='</div>';
    }
  }
  const due=dueList(visible().filter(c=>!state.runs[c.id]));
  if(due.length){
    html+=`<div class="section-label">Due</div><div class="mini-list">`;
    for(const {c,info} of due){const last=lastDone(c);html+=`<button type="button" class="mini-row due ${info.tone}" data-action="open" data-id="${escape(c.id)}" ${hueStyle(c.category)}><span class="cat-icon">${categoryIcon(categoryNamed(c.category))}</span><span class="copy"><strong>${escape(c.title)}</strong><small>${escape(describeSchedule(c.schedule))} · ${last?`last done ${escape(relativeDay(last))}`:'never done'}</small></span>${dueChip(info)}</button>`;}
    html+='</div>';
  }
  html+=`<div class="row between section-head"><h2>Categories</h2>${button('categories','Edit','small quiet','aria-label="Manage categories"')}</div>`;
  if(!state.categories.length)html+=`<div class="card empty"><p>No categories yet.</p>${button('categories','Create a category','primary')}</div>`;
  html+='<div class="category-grid">';
  state.categories.forEach((cat,i)=>{
    const list=checklistsIn(cat.name),running=list.filter(c=>state.runs[c.id]).length;
    html+=button('category',`<span class="cat-icon">${categoryIcon(cat)}</span><strong>${escape(cat.name)}</strong><span class="count">${flowHTML(`cat-${cat.id}`,list.length)}</span>${running?`<span class="live">${running} in progress</span>`:''}`,'category-button',`data-id="${escape(cat.id)}" style="--cat:${hueFor(cat.name)};--i:${i}"`);
  });
  html+='</div>';
  html+=`<div class="library-line"><span class="dot ${library.busy?'busy':state.library.syncedAt&&!state.library.bundled?'ok':''}" aria-hidden="true"></span><p class="help" id="library-status">${escape(libraryLine())}</p>${button('sync',library.busy?'Syncing…':'Sync','small outline',library.busy?'disabled':'')}</div>`;
  return html;
}
function categoryPage(){
  const cat=category();if(!cat){page='home';return home();}
  const list=checklistsIn(cat.name);
  let html=`${button('home','← Home','quiet back')}<header class="category-hero" ${hueStyle(cat.name)}><span class="cat-icon big">${categoryIcon(cat)}</span><div><h1>${escape(cat.name)}</h1><p class="subtitle">${list.length} checklist${list.length===1?'':'s'}</p></div></header>`;
  html+=list.length?list.map(checklistRow).join(''):'<div class="card empty"><p>No checklists here yet.</p></div>';
  html+=button('new','＋ New checklist in '+escape(cat.name),'primary full',`data-category="${escape(cat.name)}"`);
  if(list.some(c=>c.source==='library'))html+='<p class="help">“Save offline” keeps a GitHub checklist on this device so it opens without internet. Checklists you create in the app are always on this device.</p>';
  return html;
}
function allPage(){
  let html=`${button('home','← Home','quiet back')}<h1>All checklists</h1><label for="search">Search</label><input id="search" type="search" placeholder="Find a checklist…" autocomplete="off"><div id="procedures">`;
  for(const cat of state.categories){
    const list=checklistsIn(cat.name);if(!list.length)continue;
    html+=`<section data-group><h2>${categoryIcon(cat)} ${escape(cat.name)}</h2>${list.map(checklistRow).join('')}</section>`;
  }
  return html+'</div><p id="no-results" class="help" hidden>No matching checklists.</p>';
}

// ---------- running a checklist ----------
function headingHTML(b,vars){
  const level=Math.min(6,Math.max(2,b.level));
  return `<h${level} data-line="${b.line}" id="line-${b.line}" class="source-heading level-${b.level}">${renderInline(substitute(b.text,vars))}</h${level}>`;
}
function calcHTML(b,result){
  if(result.error)return `<div class="calc card" data-line="${b.line}" id="line-${b.line}"><span class="eyebrow">CALCULATION</span><p class="calc-error">${escape(result.error)}</p></div>`;
  const inputs=result.inputs.map(i=>`<div class="calc-field"><label for="calc-${escape(i.name)}" data-scrub="${escape(i.name)}" title="Drag sideways to adjust">${escape(i.label)} <span class="scrub-hint" aria-hidden="true">⇔</span></label><div class="stepper">${button('calc-step','−','',`data-name="${escape(i.name)}" data-dir="-1" aria-label="Decrease ${escape(i.label)}"`)}<input id="calc-${escape(i.name)}" data-calc="${escape(i.name)}" inputmode="decimal" autocomplete="off" value="${escape(i.raw)}" ${i.error?'aria-invalid="true"':''}>${button('calc-step','+','',`data-name="${escape(i.name)}" data-dir="1" aria-label="Increase ${escape(i.label)}"`)}</div></div>`).join('');
  const outputs=result.outputs.map(o=>`<div class="calc-output"><span>${escape(o.label)}</span><strong data-output="${escape(o.name)}" title="${escape(o.error||'')}">${o.error?'—':flowHTML(`out-${o.name}`,format(o.value))}</strong></div>`).join('');
  return `<div class="calc card" data-line="${b.line}" id="line-${b.line}"><span class="eyebrow">CALCULATION</span>${result.title?`<h3>${escape(result.title)}</h3>`:''}<div class="calc-grid">${inputs}</div>${outputs}</div>`;
}
// Timer / counter controls chosen from what the item says.
function widgetsHTML(b,r,text){
  const {timer,count}=detectWidgets(text);let html='';
  if(timer&&r.states[b.line]!=='done'){
    const t=r.timers?.[b.line],now=Date.now();
    const left=t?.end?(t.end-now)/1000:t?.remaining??timer.seconds,running=!!t?.end;
    const frac=1-left/timer.seconds;
    html+=`<button type="button" class="widget timer ${running?'running':t?'paused':''}" data-action="timer" data-line="${b.line}" data-seconds="${timer.seconds}" aria-label="${running?'Pause':'Start'} ${escape(timer.label)} timer">${ring(t?frac:0,running?'❚❚':'▶','mini')}<span data-timer-line="${b.line}">${flowHTML(`timer-${state.active}-${b.line}`,clock(left))}</span></button>`;
    if(t)html+=button('timer-reset','↺','widget icon',`data-line="${b.line}" aria-label="Reset timer"`);
  }
  if(count){
    const done=r.states[b.line]==='done',n=done?count.target:Math.min(count.target,r.counts?.[b.line]??0);
    const dots=count.target<=12?`<span class="dots" aria-hidden="true">${Array.from({length:count.target},(_,i)=>`<i class="${i<n?'on':''}"></i>`).join('')}</span>`:'';
    html+=`<button type="button" class="widget counter ${n>=count.target?'filled':''}" data-action="count" data-line="${b.line}" data-target="${count.target}" aria-label="Count one (${n} of ${count.target})">${dots}<span>${flowHTML(`count-${state.active}-${b.line}`,`${n}/${count.target}`)}</span></button>`;
    if(n>0&&!done)html+=button('count-down','−','widget icon',`data-line="${b.line}" aria-label="Count one fewer"`);
  }
  return html?`<div class="task-widgets">${html}</div>`:'';
}
function taskHTML(b,r,vars){
  const status=r.states[b.line],now=current(r)===b.line,text=substitute(b.text,vars);
  return `<div class="task ${status==='done'?'done':''} ${status==='pending'?'skipped':''} ${now?'current':''}" id="line-${b.line}" data-line="${b.line}" style="margin-left:${Math.min(b.depth,8)*4}px"><button type="button" class="check" data-action="check" data-line="${b.line}" aria-pressed="${status==='done'}"><span class="box" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span class="item-copy">${now&&b.sectionPath.length?`<span class="item-context">${escape(b.sectionPath.join(' › '))}</span>`:''}${renderInline(text,{links:false})}</span></button><button type="button" class="pending-button" data-action="pending" data-line="${b.line}" aria-label="${status==='pending'?'Return item to checklist':'Skip for now'}" title="${status==='pending'?'Return to checklist':'Skip for now'}">${status==='pending'?'↩':'◷'}</button>${widgetsHTML(b,r,text)}${webLinks(text).map(link=>`<a class="external-link task-reference" data-web-link href="${escape(link.url)}" target="_blank" rel="noopener noreferrer">${escape(link.label)} ↗</a>`).join('')}</div>`;
}
function blockHTML(b,r,calc){
  const vars=calc.vars;
  if(b.kind==='task')return taskHTML(b,r,vars);
  if(b.kind==='heading')return headingHTML(b,vars);
  if(b.kind==='calc')return calcHTML(b,calc.results[b.line]);
  if(b.callout)return `<aside data-line="${b.line}" id="line-${b.line}" class="note callout ${b.callout}"><strong class="callout-label">${['caution','warning'].includes(b.callout)?'⚠':'ⓘ'} ${b.callout.toUpperCase()}</strong><div>${renderInline(substitute(b.body,vars))}</div></aside>`;
  if(b.kind==='note')return `<aside data-line="${b.line}" id="line-${b.line}" class="note">${renderInline(substitute(b.text,vars))}</aside>`;
  if(b.kind==='table'){
    const rows=b.text.split('\n').filter(l=>!/^\s*\|[\s:|\-]+\|?\s*$/.test(l));
    return `<div data-line="${b.line}" id="line-${b.line}" class="table-wrap"><table>${rows.map((l,i)=>`<tr>${l.trim().replace(/^\||\|$/g,'').split('|').map(c=>`<${i?'td':'th'}>${renderInline(substitute(c.trim(),vars))}</${i?'td':'th'}>`).join('')}</tr>`).join('')}</table></div>`;
  }
  if(b.kind==='code')return `<pre data-line="${b.line}" id="line-${b.line}">${escape(b.body)}</pre>`;
  return `<div data-line="${b.line}" id="line-${b.line}" class="source-text">${renderInline(substitute(b.text,vars))}</div>`;
}
function renderHeader(){
  const header=$('.brand'),c=active();
  header.classList.toggle('running',page==='run'&&!!c);
  const search=button('command',SEARCH_ICON,'icon-button',`aria-label="Search (${shortcut})" title="Search (${shortcut})"`);
  if(page!=='run'||!c){header.innerHTML=`<div><span class="brand-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><strong>Cheklst</strong></div><div class="brand-tools"><span id="connection" class="status-dot ${navigator.onLine?'online':''}" title="${navigator.onLine?'Online':'Offline'}" aria-label="${navigator.onLine?'Online':'Offline'}"></span>${search}</div>`;return;}
  const r=run(),p=progressOf(r);
  header.innerHTML=`<div class="run-title-row"><h1>${escape(c.title)}</h1>${search}${button('options','•••','icon-button','aria-label="Checklist options"')}</div><div class="progress" role="progressbar" aria-label="Checklist progress" aria-valuemin="0" aria-valuemax="${p.total||1}" aria-valuenow="${p.done}"><div style="width:${p.total?p.done/p.total*100:0}%"></div></div><div class="run-meta"><span class="stat">${escape(c.category)} · ${flowHTML('run-done',p.done)} of ${p.total} done${p.pending?` · ${p.pending} skipped`:''}</span><div class="mode-toggle" role="group" aria-label="View">${button('mode','☰ List',runMode==='list'?'selected':'',`data-mode="list" aria-pressed="${runMode==='list'}"`)}${button('mode','◎ Focus',runMode==='focus'?'selected':'',`data-mode="focus" aria-pressed="${runMode==='focus'}"`)}</div></div>`;
}
function scheduleStrip(c){
  const last=lastDone(c),info=dueInfo(c);
  const parts=[c.schedule?`🔁 ${describeSchedule(c.schedule)}`:'🔁 Set a repeat',last?`Last done ${relativeDay(last)}`:'Never done'];
  return `<button type="button" class="schedule-strip" data-action="schedule" data-id="${escape(c.id)}"><span>${parts.map(escape).join(' · ')}</span>${info?dueChip(info):''}</button>`;
}
function runBanners(c,r){
  const strip=scheduleStrip(c);
  if(c.retired)return strip+'<div class="note">This checklist was removed from your GitHub library. Your progress is kept until you close it.</div>';
  if(r.version!==versionOf(c)&&available(c))return strip+`<div class="note">A newer version of this checklist is saved. You’re still using the version you started with.${button('reset-one','Switch to the new version','outline full')}</div>`;
  return strip;
}
function completionHTML(){
  const next=nextChecklist(state);
  return `<div class="card completion"><div class="burst" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h2>All done.</h2><p class="help">Every item in “${escape(active().title)}” is checked. Logged as done ${escape(relativeDay(lastDone(active())??new Date()))}.${nextDue(active())?` Next due ${escape(relativeDay(nextDue(active())))}.`:''}</p>${next?button('open',`Next: ${escape(next.title)} →`,'primary full',`data-id="${escape(next.id)}"`):''}${button('finish','Finish & clear progress','outline full')}${button('home','Back home','quiet full')}</div>`;
}
function runner(){
  const c=active(),r=run(),t=tasks(r),blocks=parse(r.markdown).filter(b=>!(b.kind==='heading'&&b.level===1&&b.text.trim()===c.title)),calc=runCalcs(blocks,r.calc||{});
  let html=runBanners(c,r);
  if(runMode==='focus'&&t.length&&!complete(r))return html+focusHTML(blocks,r,calc);
  html+=blocks.map(b=>blockHTML(b,r,calc)).join('');
  if(complete(r))html+=completionHTML();
  else if(!t.length)html+=`<div class="card"><h3>No checkbox items yet.</h3><p class="help">${c.source==='device'?'Edit this checklist to add items.':'Add items in GitHub, or make an editable copy.'}</p></div>`;
  return html;
}
// Focus mode: one item at a time as a card. Swipe right = done, left = skip.
function focusHTML(blocks,r,calc){
  const line=current(r),index=blocks.findIndex(b=>b.line===line),b=blocks[index];
  let start=index-1;while(start>=0&&blocks[start].kind!=='task')start--;
  const context=blocks.slice(start+1,index).map(x=>blockHTML(x,r,calc)).join('');
  const upcoming=tasks(r).filter(x=>!r.states[x.line]&&x.line!==line).slice(0,2);
  const text=substitute(b.text,calc.vars),p=progressOf(r);
  let html=`<div class="focus">${context}<div class="focus-stack">`;
  upcoming.slice().reverse().forEach((u,i)=>{html+=`<div class="focus-peek depth-${upcoming.length-i}" aria-hidden="true">${renderInline(substitute(u.text,calc.vars),{links:false})}</div>`;});
  html+=`<article class="focus-card" data-line="${b.line}" id="line-${b.line}" aria-live="polite"><div class="focus-top"><span class="eyebrow">${b.sectionPath.length?escape(b.sectionPath.join(' › ')):`ITEM ${p.done+p.pending+1-(r.states[line]==='pending'?1:0)} OF ${p.total}`}</span>${r.states[line]==='pending'?'<span class="chip">Skipped earlier</span>':''}</div><p class="focus-text">${renderInline(text,{links:false})}</p>${widgetsHTML(b,r,text)}${webLinks(text).map(link=>`<a class="external-link" data-web-link href="${escape(link.url)}" target="_blank" rel="noopener noreferrer">${escape(link.label)} ↗</a>`).join('')}<div class="focus-actions">${button('focus-skip','◷ Skip','outline',`data-line="${b.line}"`)}${button('focus-done','✓ Done','primary',`data-line="${b.line}"`)}</div><span class="swipe-tag done" aria-hidden="true">DONE</span><span class="swipe-tag skip" aria-hidden="true">SKIP</span></article></div>`;
  html+=`<p class="help center">${upcoming.length?`Up next: ${renderInline(substitute(upcoming[0].text,calc.vars),{links:false})}`:'Last one!'} · Swipe right for done, left to skip.</p></div>`;
  return html;
}

// Check, skip, count — every path that changes an item goes through here.
function setTask(line,action,{advance=true}={}){
  const was=complete(run());
  // Checking an item off also stops its timer.
  if(!change(s=>{const r=s.runs[s.active];setItem(r,line,action);if(r.states[line]==='done'&&r.timers)delete r.timers[line];syncCompletion(s,s.active);}))return;
  const nowDone=run().states[line]==='done';
  if(action==='done'&&nowDone){haptic(10);document.getElementById(`line-${line}`)?.classList.add('just-checked');}
  if(complete(run())&&!was){celebrate();return;}
  if(!advance||runMode==='focus')return;
  const next=current(run());if(next!==null&&run().states[line])jump(automaticTarget(run()));
}
function celebrate(){
  haptic([15,60,30]);
  const h=Number(getComputedStyle(document.documentElement).getPropertyValue('--ctx'))||palette()[0];
  confetti([h,(h+40)%360,(h+300)%360,palette()[1]]);
  requestAnimationFrame(()=>main.querySelector('.completion')?.scrollIntoView({behavior:reduced()?'instant':'smooth',block:'center'}));
}
function bindGestures(){
  if(page!=='run')return;
  if(runMode==='list'){
    main.querySelectorAll('.task').forEach(el=>{
      const line=Number(el.dataset.line);
      swipeable(el,{
        onMove:dx=>{el.style.transform=`translateX(${dx*.85}px)`;el.dataset.swipe=dx>0?'done':'skip';el.style.setProperty('--reveal',Math.min(1,Math.abs(dx)/90));},
        onEnd:dx=>{
          const commit=Math.abs(dx)>90;el.style.transform='';delete el.dataset.swipe;
          if(commit)setTask(line,dx>0?'done':'pending');
        },
      });
    });
  }
  const card=main.querySelector('.focus-card');
  if(card){
    const line=Number(card.dataset.line);
    swipeable(card,{
      onMove:dx=>{card.style.transform=`translateX(${dx}px) rotate(${dx/22}deg)`;card.style.setProperty('--swipe-done',Math.max(0,Math.min(1,dx/110)));card.style.setProperty('--swipe-skip',Math.max(0,Math.min(1,-dx/110)));},
      onEnd:(dx,v)=>{
        if(Math.abs(dx)>110||Math.abs(v)>.6){flyOut(card,dx>0||v>0?1:-1,()=>setTask(line,dx>0||v>0?'done':'pending'));return;}
        card.style.transform='';card.style.setProperty('--swipe-done',0);card.style.setProperty('--swipe-skip',0);
      },
    });
  }
}
function flyOut(card,dir,then){
  if(reduced()){then();return;}
  card.classList.add('flying');card.style.transform=`translateX(${dir*130}%) rotate(${dir*18}deg)`;card.style.opacity='0';
  setTimeout(then,230);
}

// ---------- timers ----------
let audio;
function beep(){
  try{
    audio??=new (window.AudioContext||window.webkitAudioContext)();
    const t0=audio.currentTime;
    for(let i=0;i<3;i++){const o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.value=880;g.gain.setValueAtTime(0,t0+i*.28);g.gain.linearRampToValueAtTime(.25,t0+i*.28+.02);g.gain.exponentialRampToValueAtTime(.001,t0+i*.28+.22);o.connect(g).connect(audio.destination);o.start(t0+i*.28);o.stop(t0+i*.28+.24);}
  }catch{}
}
function unlockAudio(){try{audio??=new (window.AudioContext||window.webkitAudioContext)();audio.resume?.();}catch{}}
function tickTimers(){
  if(!state||locked)return;
  const now=Date.now();
  for(const [id,r] of Object.entries(state.runs))for(const [line,t] of Object.entries(r.timers||{})){
    if(!t.end)continue;
    if(t.end<=now){fireTimer(id,Number(line));continue;}
    if(id===state.active)setFlow(document.querySelector(`[data-timer-line="${line}"] .flow`),clock((t.end-now)/1000));
  }
}
function fireTimer(id,line){
  const c=state.checklists.find(c=>c.id===id),item=tasks(state.runs[id]).find(b=>b.line===line);
  change(s=>{delete s.runs[id].timers[line];},id===state.active&&page==='run');
  beep();haptic([200,100,200]);
  toast(`Time’s up${c&&id!==state.active?` in ${c.title}`:''}: ${item?.text??'timer'}`,{type:'success',icon:'⏰',duration:12000,action:id===state.active?{label:'Check off',run:()=>{if(run()?.states[line]!=='done')setTask(line,'done');}}:{label:'Open',run:()=>open(id)}});
}
setInterval(tickTimers,500);

// ---------- calculations ----------
function updateCalcLive(name,value){
  change(s=>{const r=s.runs[s.active];r.calc??={};r.calc[name]=value;},false);
  const calc=runCalcs(parse(run().markdown),run().calc);
  for(const result of Object.values(calc.results))for(const o of result.outputs){
    const el=main.querySelector(`[data-output="${CSS.escape(o.name)}"]`);if(!el)continue;
    el.title=o.error||'';
    if(o.error){el.textContent='—';continue;}
    const flow=el.querySelector('.flow');if(flow)setFlow(flow,format(o.value));else el.innerHTML=flowHTML(`out-${o.name}`,format(o.value));
  }
}
// Drag sideways on a calculation label to scrub its value.
let scrub=null;
main.addEventListener('pointerdown',e=>{
  const label=e.target.closest('[data-scrub]');if(!label||e.button!==0)return;
  const input=main.querySelector(`[data-calc="${CSS.escape(label.dataset.scrub)}"]`);if(!input)return;
  scrub={name:label.dataset.scrub,input,x:e.clientX,base:input.value,step:stepFor(input.value),moved:false,id:e.pointerId,label};
  label.setPointerCapture(e.pointerId);
});
main.addEventListener('pointermove',e=>{
  if(!scrub||e.pointerId!==scrub.id)return;
  const steps=Math.trunc((e.clientX-scrub.x)/10);if(!steps&&!scrub.moved)return;
  if(!scrub.moved){scrub.moved=true;scrub.label.classList.add('scrubbing');}
  e.preventDefault();
  const value=stepValue(scrub.base,steps,scrub.step);
  if(value!==scrub.input.value){scrub.input.value=value;updateCalcLive(scrub.name,value);haptic(3);}
});
const endScrub=e=>{if(!scrub||e.pointerId!==scrub.id)return;const moved=scrub.moved;scrub.label.classList.remove('scrubbing');scrub=null;if(moved){e.preventDefault();render();}};
main.addEventListener('pointerup',endScrub);main.addEventListener('pointercancel',endScrub);

// ---------- editor ----------
function startEditing({id=null,categoryName=null}={}){
  const c=id&&state.checklists.find(c=>c.id===id&&c.source==='device');
  if(state.draft&&(state.draft.checklistId??null)===(c?.id??null)){go('edit');return;} // resume unsaved draft
  const markdown=c?latest(c).markdown:'- [ ] \n';
  const draft={checklistId:c?.id??null,title:c?.title??'',category:c?.category??categoryName??state.categories[0]?.name??UNCATEGORIZED,mode:'visual',rows:markdownToRows(markdown),markdown};
  if(!draft.rows.length)draft.rows=[newRow('item')];
  if(change(s=>{s.draft=draft;},false))go('edit');
}
function draftMarkdown(d){return d.mode==='visual'?rowsToMarkdown(d.rows):d.markdown;}
function editor(){
  const d=state.draft;if(!d){page='home';return home();}
  const cats=[...new Set([...state.categories.map(c=>c.name),d.category])];
  let html=`<div class="eyebrow">${d.checklistId?'EDIT CHECKLIST':'NEW CHECKLIST'}</div><label for="draft-title">Name</label><input id="draft-title" data-draft="title" value="${escape(d.title)}" placeholder="e.g. Weekend camping" autocomplete="off">`;
  html+=`<label for="draft-category">Category</label><div class="row"><select id="draft-category" data-draft="category">${cats.map(n=>`<option ${n===d.category?'selected':''}>${escape(n)}</option>`).join('')}</select>${button('new-category-inline','＋ New','outline small')}</div>`;
  html+=`<div class="segmented" role="tablist">${button('mode-visual','Visual',d.mode==='visual'?'selected':'',`role="tab" aria-selected="${d.mode==='visual'}"`)}${button('mode-markdown','Markdown',d.mode==='markdown'?'selected':'',`role="tab" aria-selected="${d.mode==='markdown'}"`)}</div>`;
  if(d.mode==='markdown'){
    html+=`<textarea id="draft-markdown" class="source" data-draft="markdown" spellcheck="false">${escape(d.markdown)}</textarea><p class="help">Use <code>- [ ] item</code> for checkboxes, <code>## Heading</code> for sections, <code>&gt; note</code> for notes, and a <code>\`\`\`calc</code> block for calculations.</p>`;
  }else{
    d.rows.forEach((row,i)=>{html+=rowEditor(row,i,d.rows.length);});
    html+=`<div class="add-row">${[['item','＋ Item'],['heading','＋ Heading'],['note','＋ Note'],['calc','＋ Calculation']].map(([t,l])=>button('add-row',l,'outline small',`data-type="${t}"`)).join('')}</div>`;
    html+='<p class="help">Tip: items that mention a time (“simmer 10 min”) get a timer, and items that start with a number (“3 pairs of socks”) get a counter.</p>';
  }
  html+=`<div class="editor-actions">${button('save-draft','Save checklist','primary full')}${button('discard-draft','Discard changes','quiet full')}</div>`;
  return html;
}
function rowEditor(row,i,count){
  const typeSelect=`<select data-row-type="${i}" aria-label="Row type">${ROW_TYPES.map(([v,l])=>`<option value="${v}" ${v===row.type?'selected':''}>${l}</option>`).join('')}</select>`;
  let body='';
  if(row.type==='calc'){
    let preview='';
    try{const result=runCalcs([{kind:'calc',line:0,body:row.text}]).results[0];preview=result.error?`<p class="calc-error">${escape(result.error)}</p>`:`<p class="help">✓ ${result.inputs.length} input${result.inputs.length===1?'':'s'}, ${result.outputs.length} result${result.outputs.length===1?'':'s'}${result.outputs.map(o=>` · ${escape(o.label)} = ${o.error?escape(o.error):escape(format(o.value))}`).join('')}</p>`;}catch(e){preview=`<p class="calc-error">${escape(e.message)}</p>`;}
    body=`<textarea class="mono" data-row="${i}" rows="6" spellcheck="false" placeholder="${escape(CALC_TEMPLATE)}">${escape(row.text)}</textarea><div class="calc-preview" data-preview="${i}">${preview}</div><details class="calc-help"><summary>How calculations work</summary><p class="help"><code>input name = 10 | Label</code> — a number you type while using the checklist.<br><code>let name = formula</code> — a hidden working value.<br><code>show name = formula | Label</code> — a result shown on the card.<br>Formulas use + − * / ^ %, parentheses, comparisons, and min, max, round(x, digits), floor, ceil, abs, sqrt, pow, if(test, a, b). Write <code>{{name}}</code> in any item or note to show a value there.</p>${button('calc-template','Insert example','outline small',`data-row="${i}"`)}</details>`;
  }else{
    const placeholder={item:'What to check or do',heading:'Section name',note:'Something to keep in mind',text:'Any Markdown'}[row.type];
    body=`<textarea data-row="${i}" rows="${row.type==='text'||row.type==='note'?3:1}" placeholder="${placeholder}">${escape(row.text)}</textarea>`;
    if(row.type==='item'){const w=detectWidgets(row.text);if(w.timer||w.count)body+=`<span class="widget-hint">${w.timer?`⏱ ${escape(clock(w.timer.seconds))} timer`:''}${w.timer&&w.count?' · ':''}${w.count?`🔢 counts to ${w.count.target}`:''}</span>`;}
    if(row.type==='note')body+=`<select data-row-callout="${i}" aria-label="Note style">${CALLOUTS.map(c=>`<option value="${c}" ${c===(row.callout||'')?'selected':''}>${c?c[0].toUpperCase()+c.slice(1):'Plain note'}</option>`).join('')}</select>`;
  }
  const indent=row.type==='item'?`${button('indent','⇤','',`data-row="${i}" data-dir="-1" aria-label="Outdent" ${row.depth?'':'disabled'}`)}${button('indent','⇥','',`data-row="${i}" data-dir="1" aria-label="Indent" ${row.depth>=4?'disabled':''}`)}`:'';
  return `<div class="editor-row type-${row.type}" style="margin-left:${(row.depth||0)*14}px">${body}<div class="tools">${typeSelect}${indent}${button('move-row','↑','',`data-row="${i}" data-dir="-1" aria-label="Move up" ${i?'':'disabled'}`)}${button('move-row','↓','',`data-row="${i}" data-dir="1" aria-label="Move down" ${i<count-1?'':'disabled'}`)}${button('remove-row','✕','',`data-row="${i}" aria-label="Remove row"`)}</div></div>`;
}

// ---------- categories ----------
function categoriesPage(){
  let html=`${button('home','← Home','quiet back')}<h1>Manage categories</h1><div class="card"><label for="new-category">New category</label><div class="row"><input id="new-category-icon" class="icon-input" maxlength="4" placeholder="🙂" aria-label="Icon (emoji)"><input id="new-category" placeholder="e.g. Travel, Hiking, Car" autocomplete="off"></div>${button('add-category','Add category','primary full')}</div>`;
  state.categories.forEach((cat,i)=>{
    const count=checklistsIn(cat.name).length,fromLibrary=visible().some(c=>c.source==='library'&&c.category===cat.name);
    if(editingCategory===cat.id){
      html+=`<div class="card stack" ${hueStyle(cat.name)}><div class="row"><input id="edit-category-icon" class="icon-input" maxlength="4" value="${escape(cat.icon||'')}" placeholder="🙂" aria-label="Icon"><input id="edit-category-name" value="${escape(cat.name)}" ${fromLibrary?'readonly title="Set by the folder name in GitHub"':''}></div>${fromLibrary?'<p class="help">This name comes from a folder in your GitHub library; rename the folder there. You can change the icon here.</p>':''}<div class="row">${button('save-category','Save','primary',`data-id="${cat.id}"`)}${button('cancel','Cancel','outline')}</div>${fromLibrary?'':button('delete-category','Delete category','quiet danger-text',`data-id="${cat.id}"`)}</div>`;
    }else{
      html+=`<div class="category-row" style="--cat:${hueFor(cat.name)};--i:${i}"><span class="cat-icon">${categoryIcon(cat)}</span><span class="copy"><strong>${escape(cat.name)}</strong><small>${count} checklist${count===1?'':'s'}${fromLibrary?' · GitHub folder':''}</small></span>${button('move-category','↑','small quiet',`data-id="${cat.id}" data-dir="-1" aria-label="Move up" ${i?'':'disabled'}`)}${button('move-category','↓','small quiet',`data-id="${cat.id}" data-dir="1" aria-label="Move down" ${i<state.categories.length-1?'':'disabled'}`)}${button('edit-category','Edit','small outline',`data-id="${cat.id}"`)}</div>`;
    }
  });
  return html;
}

// ---------- settings ----------
function themeControl(){return `<label for="theme-choice">Appearance</label><select id="theme-choice">${[['auto','Match device'],['light','Light'],['dark','Dark']].map(([v,l])=>`<option value="${v}" ${window.cheklstTheme.preference===v?'selected':''}>${l}</option>`).join('')}</select><label class="switch inline"><input type="checkbox" id="ambient-choice" ${ambientEnabled()?'checked':''}><span class="slider" aria-hidden="true"></span><span>Colors follow the time of day</span></label><p class="help">Mornings run warm, afternoons cool and bright, evenings golden, nights deep indigo. Each category also keeps its own color.</p>`;}
function settings(){
  return `<h1>Settings</h1><div class="card">${themeControl()}</div>
  <div class="card stack"><h3>GitHub library</h3><label for="library-repo">Repository (owner/name)</label><input id="library-repo" value="${escape(state.library.repo)}" placeholder="${DEFAULT_REPO}" autocomplete="off" autocapitalize="off" spellcheck="false">${button('save-repo','Save & sync','primary')}<p class="help">${escape(libraryLine())}</p><p class="help">Checklists are Markdown files in category folders of that repository. Pushing to <code>main</code> publishes them; the app picks up changes when it syncs. The repository must be public for the app to read it.</p></div>
  <div class="card stack"><h3>Offline</h3><p class="help">The app itself is cached after your first visit. Checklists you create here are always stored on this device. GitHub checklists are stored only when “Save offline” is on for them.</p><p class="help" id="offline-status">Checking…</p></div>
  <div class="card stack"><h3>Backup</h3>${button('backup','Download full backup','outline')}${button('import-backup','Restore from backup…','outline')}<p class="help">A backup includes your checklists, revisions, categories, progress and offline copies. There’s no automatic sync between devices.</p></div>
  <p class="help">Cheklst · build ${BUILD} · press ${shortcut} anywhere to search</p>`;
}
function history(){
  const c=active();if(!c||c.source!=='device')return '<p>Open a checklist created in the app first.</p>';
  return `${button('resume','← Back to checklist','quiet back')}<h1>Revision history</h1><p class="subtitle">${escape(c.title)}</p><p class="help">Restoring adds a new revision; nothing is lost. Restart the checklist to use it.</p>${c.revisions.map((r,i)=>({r,i})).reverse().map(({r,i})=>`<details><summary>Revision ${i+1} · ${escape(new Date(r.date).toLocaleString())}</summary><pre>${escape(r.markdown)}</pre>${r.id!==latest(c).id?button('restore','Restore this version','primary',`data-id="${escape(r.id)}"`):'<span class="chip">Current version</span>'}</details>`).join('')}`;
}
function confirmSheet(title,description,action,{label='Confirm',danger=true}={}){
  openSheet(`<h2 class="sheet-title">${title}</h2><p class="help">${description}</p><div class="sheet-actions">${button(action,label,danger?'danger full':'primary full')}${button('close-sheet','Cancel','outline full')}</div>`,{label:title.replace(/<[^>]+>/g,'')});
}
function optionsSheet(){
  const c=active();
  let html=`<h2 class="sheet-title">${escape(c.title)}</h2><div class="sheet-list">`;
  if(c.source==='device')html+=button('edit','✎ Edit checklist')+button('history','🕘 Revision history');
  else html+=`<div class="row between sheet-row"><span>Save offline</span>${offlineToggle(c)}</div>`+button('copy','⧉ Make an editable copy');
  html+=button('schedule',`🔁 Repeat & due date${c.schedule?` · ${escape(describeSchedule(c.schedule))}`:''}`,'',`data-id="${escape(c.id)}"`);
  html+=button('export','⇩ Export Markdown')+button('reset-one','↺ Restart checklist')+button('close-run','✕ Close checklist (clear progress)');
  if(c.source==='device')html+=button('delete','🗑 Delete checklist…','danger-text');
  openSheet(html+'</div>',{label:'Checklist options'});
}
const UNIT_LABEL={day:'days',week:'weeks',month:'months',year:'years'};
const sameSchedule=(a,b)=>(!a&&!b)||(!!a&&!!b&&a.every===b.every&&a.unit===b.unit);
function scheduleSheet(id){
  const c=state.checklists.find(c=>c.id===id);if(!c)return;
  const sch=c.schedule,hist=(c.completions||[]).slice(-6).reverse(),due=nextDue(c),dueValue=due?dayKey(due):'';
  const presets=[['Never',null],['Daily',{every:1,unit:'day'}],['Weekly',{every:1,unit:'week'}],['Monthly',{every:1,unit:'month'}],['Yearly',{every:1,unit:'year'}]];
  let html=`<h2 class="sheet-title">Repeat &amp; due date</h2><p class="subtitle">${escape(c.title)}</p>`;
  html+=`<div class="preset-row" role="group" aria-label="How often">${presets.map(([label,v])=>button('sched-preset',label,sameSchedule(v,sch)?'selected':'',`data-keep data-every="${v?.every??''}" data-unit="${v?.unit??''}" aria-pressed="${sameSchedule(v,sch)}"`)).join('')}</div>`;
  html+=`<input type="hidden" id="sched-on" value="${sch?1:0}"><div id="sched-fields" class="sched-fields ${sch?'':'off'}"><label for="sched-every">Repeat every</label><div class="row"><input id="sched-every" type="number" min="1" max="365" inputmode="numeric" value="${sch?.every??1}"><select id="sched-unit" aria-label="Unit">${UNITS.map(u=>`<option value="${u}" ${u===(sch?.unit??'month')?'selected':''}>${UNIT_LABEL[u]}</option>`).join('')}</select></div></div>`;
  html+=`<label for="sched-due">Next due</label><input id="sched-due" type="date" value="${dueValue}" data-initial="${dueValue}"><p class="help">${sch?'Counted from the last time you finished it. Pick a date to override just the next one.':'Optional: a one-time due date.'}</p>`;
  html+=`<div class="sheet-actions">${button('sched-save','Save','primary full',`data-keep data-id="${escape(id)}"`)}${button('sched-log','✓ Log as done today','outline full',`data-keep data-id="${escape(id)}"`)}</div>`;
  html+=`<div class="history"><h3>History</h3>${hist.length?`<p class="help">Done ${c.completions.length} time${c.completions.length===1?'':'s'}.</p><ul>${hist.map(d=>`<li><span>${escape(new Date(d).toLocaleDateString([], {weekday:'short',month:'short',day:'numeric',year:'numeric'}))}</span><small>${escape(relativeDay(new Date(d)))}</small></li>`).join('')}</ul>`:'<p class="help">Not completed yet. Checking off every item logs it here.</p>'}</div>`;
  openSheet(html,{label:'Repeat and due date'});
}
function setScheduleFields(on){
  $('#sched-on').value=on?'1':'0';$('#sched-fields')?.classList.toggle('off',!on);
}
function updateBadge(){
  try{const n=dueList(visible(),new Date(),{within:0}).filter(x=>x.info.due).length;(n?navigator.setAppBadge?.(n):navigator.clearAppBadge?.())?.catch?.(()=>{});}catch{}
}
function newCategorySheet(){
  openSheet(`<h2 class="sheet-title">New category</h2><div class="row"><input id="sheet-category-icon" class="icon-input" maxlength="4" placeholder="🙂" aria-label="Icon (emoji)"><input id="sheet-category-name" placeholder="e.g. Camping" autocomplete="off" autofocus></div><div class="sheet-actions">${button('sheet-add-category','Add category','primary full')}</div>`,{label:'New category'});
}

// ---------- command menu ----------
function commandItems(){
  const items=[];
  if(page==='run'&&run()){
    const r=run(),vars=runCalcs(parse(r.markdown),r.calc||{}).vars;
    for(const b of tasks(r))if(r.states[b.line]!=='done')items.push({group:'In this checklist',label:substitute(b.text,vars),hint:b.sectionPath.join(' › '),icon:r.states[b.line]==='pending'?'◷':'○',run:()=>{if(runMode==='focus')setMode('list');jumpAndFlash(b.line);}});
  }
  for(const c of sortChecklists(visible())){
    const r=state.runs[c.id],p=r&&progressOf(r);
    const due=dueInfo(c);
    items.push({group:'Checklists',label:c.title,hint:`${c.category}${p?` · ${p.done}/${p.total}`:due&&due.tone!=='later'?` · ${due.label}`:''}`,icon:categoryNamed(c.category)?.icon||'☑',keywords:c.category,run:()=>open(c.id)});
  }
  for(const cat of state.categories)items.push({group:'Categories',label:cat.name,icon:cat.icon||'☷',hint:`${checklistsIn(cat.name).length} checklists`,run:()=>{categoryId=cat.id;go('category');}});
  const actions=[
    ['＋','New checklist','create add',()=>startEditing({categoryName:page==='category'?category()?.name:null})],
    active()&&page!=='run'&&['↩',`Resume “${active().title}”`,'continue',()=>go('run',{after:restorePosition})],
    page==='run'&&['◎',runMode==='list'?'Switch to focus mode':'Switch to list mode','view one at a time',()=>setMode(runMode==='list'?'focus':'list')],
    page==='run'&&['↺','Restart this checklist','reset',()=>restartActive()],
    ['⟳','Sync with GitHub','refresh library update',()=>sync()],
    ['☷','Manage categories','edit categories',()=>go('categories')],
    ['▦','Browse all checklists','list',()=>go('all')],
    ['⚙','Settings','preferences backup',()=>go('settings')],
    ['◐',document.documentElement.dataset.theme==='dark'?'Switch to light appearance':'Switch to dark appearance','theme dark light mode',()=>{window.cheklstTheme.set(document.documentElement.dataset.theme==='dark'?'light':'dark');render();}],
    ['⌂','Home','start',()=>go('home')],
  ].filter(Boolean);
  for(const [icon,label,keywords,fn] of actions)items.push({group:'Actions',label,icon,keywords,run:fn});
  return items;
}
function jumpAndFlash(line){jump(line);const el=document.getElementById(`line-${line}`);el?.classList.remove('flash');void el?.offsetWidth;el?.classList.add('flash');}
function setMode(mode){
  if(mode===runMode)return;
  runMode=mode;try{localStorage.setItem(MODE_KEY,mode);}catch{}
  const update=()=>{render();restorePosition();};
  viewTransition(update);
}
function restartActive(){
  const c=active();if(!available(c)){notice('The latest version isn’t on this device. Connect to the internet first.');return;}
  if(undoable('Checklist restarted.',s=>restart(s,c.id,markdownOf(c,session)),{redraw:false})){render();main.scrollTop=0;}
}

// ---------- run position ----------
function updateReturn(){
  const bar=$('#return-bar');bar.hidden=page!=='run'||runMode==='focus'||!run()||current(run())===null;
  if(bar.hidden)return;
  const pending=tasks(run()).find(t=>run().states[t.line]==='pending');
  bar.innerHTML=`<div class="row between">${button('current','↓ Next unchecked')}${pending?button('jump-pending','◷ Skipped item','','data-line="'+pending.line+'"'):''}</div>`;
}
function jump(line,smooth=true){
  const el=document.getElementById(`line-${line}`);if(!el)return;
  main.scrollTo({top:main.scrollTop+el.getBoundingClientRect().top-main.getBoundingClientRect().top-14,behavior:smooth&&!reduced()?'smooth':'instant'});
}
function restorePosition(){if(page==='run'&&run()&&runMode==='list')jump(run().position??automaticTarget(run()),false);}
function savePosition(){
  if(page!=='run'||!run()||locked||runMode!=='list')return;
  const top=main.getBoundingClientRect().top;
  const row=[...main.querySelectorAll('[data-line][id]')].find(el=>el.getBoundingClientRect().bottom>top+8);
  if(row&&run().position!==Number(row.dataset.line))change(s=>{s.runs[s.active].position=Number(row.dataset.line);},false);
}
function download(name,text,type='text/plain'){
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}

// ---------- library sync ----------
async function sync({quiet=false}={}){
  if(library.busy||locked)return;
  if(!state.library.repo){if(!quiet)notice('No GitHub library set. Add one in Settings.');return;}
  library.busy=true;library.message='';if(!quiet)render();
  try{
    const pkg=await downloadLibrary(state.library.repo);
    let counts;
    if(change(s=>{counts=applyLibrary(s,pkg,session);},false)){
      const changed=counts.added+counts.updated+counts.removed;
      const parts=[counts.added&&`${counts.added} new`,counts.updated&&`${counts.updated} updated`,counts.removed&&`${counts.removed} removed`].filter(Boolean);
      if(changed||!quiet)toast(changed?`Library synced: ${parts.join(', ')}.`:'Library is up to date.',{type:'success',icon:'⟳'});
    }
  }catch(e){library.message=e.message;if(!quiet)notice(e.message);await loadBundledIfEmpty();}
  library.busy=false;if(!['edit','run'].includes(page)||!quiet)render();
}
// First run without a reachable GitHub library: show the starter checklists bundled with the app.
async function loadBundledIfEmpty(){
  if(state.library.syncedAt&&!state.library.bundled)return;
  try{const r=await fetch('./library.json');if(!r.ok)return;const pkg=await r.json();change(s=>{applyLibrary(s,{...pkg,bundled:true},session,{repo:s.library.repo});},false);}catch{}
}

// ---------- events ----------
document.addEventListener('click',e=>{
  const link=e.target.closest('a[data-web-link]');if(link){if(!navigator.onLine){e.preventDefault();notice('This link needs internet.');}else savePosition();return;}
  const b=e.target.closest('[data-action]');if(!b||b.disabled||!state)return;
  // Buttons inside a sheet close it first (input values stay readable while it animates out).
  if(b.closest('.sheet')&&!b.hasAttribute('data-keep')&&b.dataset.action!=='sheet-add-category')closeSheet();
  handle(b.dataset.action,b);
});
function handle(action,b){
  const id=b.dataset.id;
  switch(action){
    case 'home':case 'all':case 'categories':case 'settings':return go(action);
    case 'category':categoryId=id;return go('category');
    case 'open':return open(id);
    case 'resume':if(active())go('run',{after:restorePosition});return;
    case 'sync':return sync();
    case 'command':return openCommand(commandItems);
    case 'close-sheet':return;
    case 'new':return startEditing({categoryName:b.dataset.category??(page==='category'?category()?.name:null)});
    case 'options':return optionsSheet();
    case 'schedule':return scheduleSheet(id);
    case 'sched-preset':{
      const on=!!b.dataset.unit;setScheduleFields(on);
      if(on){$('#sched-every').value=b.dataset.every;$('#sched-unit').value=b.dataset.unit;}
      b.parentElement.querySelectorAll('button').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));});
      return;
    }
    case 'sched-save':{
      const c=state.checklists.find(c=>c.id===id);if(!c)return;
      const on=$('#sched-on').value==='1',schedule=on?{every:Number($('#sched-every').value),unit:$('#sched-unit').value}:null;
      const due=$('#sched-due'),key=due.value!==due.dataset.initial?(due.value||undefined):c.nextDue;
      if(change(s=>setSchedule(s.checklists.find(x=>x.id===id),schedule,key))){
        closeSheet();const info=dueInfo(state.checklists.find(x=>x.id===id));
        toast(`${describeSchedule(schedule)}${info?` · ${info.label.toLowerCase()}`:''}.`,{type:'success',icon:'🔁'});
      }
      return;
    }
    case 'sched-log':{
      const title=state.checklists.find(c=>c.id===id)?.title;
      if(undoable(`Logged “${title}” as done today.`,s=>recordCompletion(s.checklists.find(x=>x.id===id))))closeSheet();
      return;
    }
    case 'mode':return setMode(b.dataset.mode);
    case 'cancel':editingCategory=null;render();return;
    case 'check':case 'pending':return setTask(Number(b.dataset.line),action==='check'?'done':'pending');
    case 'focus-done':case 'focus-skip':{
      const card=main.querySelector('.focus-card'),line=Number(b.dataset.line),dir=action==='focus-done'?1:-1;
      return card?flyOut(card,dir,()=>setTask(line,dir>0?'done':'pending')):setTask(line,dir>0?'done':'pending');
    }
    case 'timer':{
      unlockAudio();const line=Number(b.dataset.line),seconds=Number(b.dataset.seconds);
      return change(s=>{const r=s.runs[s.active];r.timers??={};const t=r.timers[line];const now=Date.now();
        if(t?.end)r.timers[line]={seconds,remaining:Math.max(0,(t.end-now)/1000)};
        else r.timers[line]={seconds,end:now+(t?.remaining??seconds)*1000};});
    }
    case 'timer-reset':return change(s=>{delete s.runs[s.active].timers?.[Number(b.dataset.line)];});
    case 'count':case 'count-down':{
      const line=Number(b.dataset.line),target=Number(b.dataset.target)||Infinity,r=run();
      if(action==='count'&&r.states[line]==='done'){setTask(line,'done',{advance:false});change(s=>{s.runs[s.active].counts??={};s.runs[s.active].counts[line]=0;});return;}
      const n=Math.max(0,Math.min(target,(r.counts?.[line]??0)+(action==='count'?1:-1)));
      haptic(6);
      if(!change(s=>{s.runs[s.active].counts??={};s.runs[s.active].counts[line]=n;},n<target))return;
      if(n>=target)setTask(line,'done');
      return;
    }
    case 'calc-step':{
      const input=main.querySelector(`[data-calc="${CSS.escape(b.dataset.name)}"]`);if(!input)return;
      const value=stepValue(input.value,Number(b.dataset.dir));input.value=value;updateCalcLive(b.dataset.name,value);render();
      main.querySelector(`[data-action="calc-step"][data-name="${CSS.escape(b.dataset.name)}"][data-dir="${b.dataset.dir}"]`)?.focus({preventScroll:true});
      return;
    }
    case 'current':return jump(current(run()));
    case 'jump-pending':return jumpAndFlash(Number(b.dataset.line));
    case 'reset-one':return restartActive();
    case 'close-run':{const title=active().title;if(undoable(`Closed “${title}”.`,s=>closeRun(s,s.active),{redraw:false}))go('home');return;}
    case 'finish':if(change(s=>closeRun(s,s.active),false)){go('home');toast('Nice work. Progress cleared.',{type:'success',icon:'🎉'});}return;
    case 'delete':return confirmSheet(`Delete “${escape(active().title)}”?`,'This removes the checklist and its revision history from this device. You can undo right after.','do-delete',{label:'Delete checklist'});
    case 'do-delete':{const name=active().title;if(undoable(`Deleted “${name}”.`,s=>deleteChecklist(s,s.active),{redraw:false}))go('home');return;}
    case 'copy':{const c=active();let newId;if(change(s=>{newId=copyChecklist(s,c.id,markdownOf(c,session)??run().markdown);},false)){startEditing({id:newId});}return;}
    case 'edit':return startEditing({id:state.active});
    case 'history':return go('history');
    case 'restore':if(change(s=>restore(s,s.active,id)))toast('Revision restored as the newest version.',{type:'success'});return;
    case 'export':{const c=active();return download(`${c.title.replace(/[\\/:*?"<>|]/g,'-')}.md`,markdownOf(c,session)??run().markdown,'text/markdown');}
    // editor
    case 'mode-visual':case 'mode-markdown':{
      const mode=action==='mode-visual'?'visual':'markdown';
      return change(s=>{const d=s.draft;if(d.mode===mode)return;if(mode==='markdown')d.markdown=rowsToMarkdown(d.rows);else{d.rows=markdownToRows(d.markdown);if(!d.rows.length)d.rows=[newRow('item')];}d.mode=mode;});
    }
    case 'add-row':{change(s=>{s.draft.rows.push(newRow(b.dataset.type));});const last=[...main.querySelectorAll('textarea[data-row]')].at(-1);last?.focus();last?.closest('.editor-row')?.classList.add('just-added');return;}
    case 'remove-row':return change(s=>{s.draft.rows.splice(Number(b.dataset.row),1);if(!s.draft.rows.length)s.draft.rows.push(newRow('item'));});
    case 'move-row':return change(s=>{s.draft.rows=moveRow(s.draft.rows,Number(b.dataset.row),Number(b.dataset.dir));});
    case 'indent':return change(s=>{const r=s.draft.rows[Number(b.dataset.row)];r.depth=Math.max(0,Math.min(4,(r.depth||0)+Number(b.dataset.dir)));});
    case 'calc-template':return change(s=>{const r=s.draft.rows[Number(b.dataset.row)];r.text=r.text.trim()?r.text+'\n'+CALC_TEMPLATE:CALC_TEMPLATE;});
    case 'new-category-inline':return newCategorySheet();
    case 'sheet-add-category':{
      const name=$('#sheet-category-name')?.value,icon=$('#sheet-category-icon')?.value;
      if(change(s=>{const cat=addCategory(s,name,icon);if(s.draft)s.draft.category=cat.name;})){closeSheet();toast(`Added “${name.trim()}”.`,{type:'success'});}
      return;
    }
    case 'save-draft':{
      let newId;const editing=!!state.draft?.checklistId;
      if(change(s=>{s.draft.markdown=draftMarkdown(s.draft);newId=saveDraft(s);},false)){
        const r=state.runs[newId],c=state.checklists.find(c=>c.id===newId);
        // Restart automatically only if nothing has been checked yet.
        if(r&&!Object.keys(r.states).length)change(s=>restart(s,newId,latest(c).markdown),false);
        open(newId);toast(editing?'Saved a new revision.':'Checklist created.',{type:'success'});
      }return;
    }
    case 'discard-draft':{const back=state.draft?.checklistId&&state.runs[state.draft.checklistId];if(undoable('Draft discarded.',s=>{s.draft=null;},{redraw:false}))go(back?'run':'home');return;}
    // categories
    case 'add-category':{
      const name=$('#new-category').value,icon=$('#new-category-icon').value;
      if(change(s=>addCategory(s,name,icon))){$('#new-category')?.focus();toast(`Added “${name.trim()}”.`,{type:'success'});}return;
    }
    case 'edit-category':editingCategory=id;render();return;
    case 'save-category':if(change(s=>renameCategory(s,id,$('#edit-category-name').value,$('#edit-category-icon').value),false)){editingCategory=null;render();}return;
    case 'move-category':return change(s=>moveCategory(s,id,Number(b.dataset.dir)));
    case 'delete-category':{const name=state.categories.find(c=>c.id===id)?.name;let moved=0;if(undoable(`Deleted “${name}”.`,s=>{moved=deleteCategory(s,id);},{redraw:false})){editingCategory=null;render();if(moved)toast(`${moved} checklist${moved===1?'':'s'} moved to ${UNCATEGORIZED}.`);}return;}
    // settings
    case 'save-repo':{let repo;try{repo=repoName($('#library-repo').value);}catch(err){notice(err.message);return;}if(change(s=>{s.library.repo=repo;s.library.syncedAt=null;}))sync();return;}
    case 'backup':return download(`Cheklst-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state,null,2),'application/json');
    case 'import-backup':$('#backup-import').value='';$('#backup-import').click();return;
    case 'restore-backup':if(backupCandidate&&change(s=>{for(const k of Object.keys(s))delete s[k];Object.assign(s,backupCandidate);},false)){backupCandidate=null;go('home');toast('Backup restored.',{type:'success'});}return;
  }
}
main.addEventListener('input',e=>{
  const t=e.target;
  if(t.id==='search'){
    const q=t.value.toLowerCase();let count=0;
    main.querySelectorAll('[data-search]').forEach(el=>{el.hidden=!el.dataset.search.toLowerCase().includes(q);if(!el.hidden)count++;});
    main.querySelectorAll('[data-group]').forEach(el=>{el.hidden=![...el.querySelectorAll('[data-search]')].some(n=>!n.hidden);});
    $('#no-results').hidden=!!count;return;
  }
  if(t.dataset.draft==='title'||t.dataset.draft==='markdown'){change(s=>{s.draft[t.dataset.draft]=t.value;},false);return;}
  if(t.dataset.row!==undefined&&t.tagName==='TEXTAREA'){
    const i=Number(t.dataset.row);change(s=>{s.draft.rows[i].text=t.value;},false);
    if(state.draft.rows[i].type==='calc'){const p=main.querySelector(`[data-preview="${i}"]`);if(p){const result=runCalcs([{kind:'calc',line:0,body:t.value}]).results[0];p.innerHTML=result.error?`<p class="calc-error">${escape(result.error)}</p>`:`<p class="help">✓ ${result.outputs.map(o=>`${escape(o.label)} = ${o.error?escape(o.error):escape(format(o.value))}`).join(' · ')||'No results yet'}</p>`;}}
    if(state.draft.rows[i].type==='item'){
      const row=t.closest('.editor-row'),w=detectWidgets(t.value);let hint=row.querySelector('.widget-hint');
      const text=`${w.timer?`⏱ ${clock(w.timer.seconds)} timer`:''}${w.timer&&w.count?' · ':''}${w.count?`🔢 counts to ${w.count.target}`:''}`;
      if(text&&!hint){hint=document.createElement('span');hint.className='widget-hint';t.after(hint);}
      if(hint){if(text)hint.textContent=text;else hint.remove();}
    }
    return;
  }
  if(t.dataset.calc)updateCalcLive(t.dataset.calc,t.value); // results update in place so the field keeps focus
});
document.addEventListener('change',e=>{
  const t=e.target;
  if(t.dataset.offline){
    const id=t.dataset.offline,on=t.checked;
    if(!change(s=>setOffline(s,id,on,session)))t.checked=!on;
    else{toast(on?'Saved for offline use.':'Removed from this device. It opens when online.',{type:'success',icon:on?'⤓':'☁'});document.querySelectorAll(`[data-offline="${CSS.escape(id)}"]`).forEach(el=>{el.checked=on;el.closest('.switch').querySelector('.switch-label').textContent=on?'Saved offline':'Online only';});}
    return;
  }
  if(t.dataset.calc){render();return;} // refresh {{values}} in items after editing an input
  if(t.dataset.draft==='category'){change(s=>{s.draft.category=t.value;});return;}
  if(t.dataset.rowType!==undefined){const i=Number(t.dataset.rowType);change(s=>{const r=s.draft.rows[i];r.type=t.value;if(t.value==='item')r.depth??=0;if(t.value==='note')r.callout??='';});return;}
  if(t.dataset.rowCallout!==undefined){const i=Number(t.dataset.rowCallout);change(s=>{s.draft.rows[i].callout=t.value;},false);return;}
  if(t.id==='theme-choice'){try{window.cheklstTheme.set(t.value);}catch{notice('Appearance could not be saved.');}}
  if(t.id==='ambient-choice')setAmbientEnabled(t.checked);
  if(t.id==='sched-every'||t.id==='sched-unit'){setScheduleFields(true);document.querySelectorAll('[data-action="sched-preset"]').forEach(x=>{const match=x.dataset.unit===$('#sched-unit').value&&x.dataset.every===$('#sched-every').value;x.classList.toggle('selected',match);x.setAttribute('aria-pressed',String(match));});}
});
main.addEventListener('keydown',e=>{
  // Enter in an item adds the next item, like a notes app.
  const t=e.target;
  if(e.key==='Enter'&&!e.shiftKey&&t.dataset.row!==undefined&&state.draft?.rows[Number(t.dataset.row)]?.type==='item'){
    e.preventDefault();const i=Number(t.dataset.row),depth=state.draft.rows[i].depth||0;
    change(s=>{s.draft.rows.splice(i+1,0,{...newRow('item'),depth});});
    const next=main.querySelector(`textarea[data-row="${i+1}"]`);next?.focus();next?.closest('.editor-row')?.classList.add('just-added');
  }
  if(e.key==='Enter'&&t.id==='new-category'){e.preventDefault();main.querySelector('[data-action="add-category"]').click();}
});
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&e.target.id==='sheet-category-name'){e.preventDefault();document.querySelector('[data-action="sheet-add-category"]')?.click();return;}
  const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)||e.target.isContentEditable;
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(state&&!locked&&!document.querySelector('.command'))openCommand(commandItems);return;}
  if(e.key==='/'&&!typing&&state&&!locked&&!document.querySelector('.sheet-layer')){e.preventDefault();openCommand(commandItems);}
});
$('#backup-import').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>20_000_000)throw new Error('Backup is too large.');
    backupCandidate=validateState(JSON.parse(await file.text()));
    confirmSheet('Replace everything on this device?',`The backup has ${backupCandidate.checklists.length} checklists and ${backupCandidate.categories.length} categories. Download a backup of your current data first.`,'restore-backup',{label:'Replace with backup'});
  }catch(err){notice(`Backup was not loaded: ${err.message}`);}
});
main.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(savePosition,200);},{passive:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden)savePosition();else tickTimers();});
window.addEventListener('pagehide',savePosition);
window.addEventListener('online',()=>{renderHeader();sync({quiet:true});});
window.addEventListener('offline',renderHeader);
window.addEventListener('storage',e=>{if(e.key===KEY&&e.newValue){try{state=validateState(JSON.parse(e.newValue));render();}catch{notice('Another window changed saved data. Close extra windows.');}}});

async function offlineStatus(){
  const el=()=>$('#offline-status');
  try{
    if(!('serviceWorker' in navigator)||!isSecureContext)throw new Error('Offline use needs HTTPS (or localhost).');
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    const persisted=await navigator.storage?.persist?.().catch(()=>false);
    if(el())el().textContent=`✓ App files cached for offline use.${persisted?' Storage is persistent.':''}`;
  }catch(e){if(el())el().textContent=e.message;}
}

async function init(){
  startAmbient();
  try{
    const saved=localStorage.getItem(KEY);
    state=saved?validateState(JSON.parse(saved)):null;
    if(!state){
      state=newState();state.library.repo=DEFAULT_REPO;
      for(const [name,icon] of [['Travel','✈️'],['Hiking','🥾'],['Car','🚗'],['Home','🏠']])ensureCategory(state,name,{icon});
      save(state);
    }
    // Saved-offline library text doubles as this session's copy.
    for(const c of state.checklists)if(c.source==='library'&&c.markdown)session[c.id]=c.markdown;
    page=active()?'run':'home';main.classList.add('entering');render();if(page==='run')restorePosition();
    setTimeout(()=>main.classList.remove('entering'),900);
    offlineStatus();tickTimers();
    if(navigator.onLine)sync({quiet:true});else await loadBundledIfEmpty(),render();
  }catch(e){
    locked=true;
    $('#error').textContent=`Could not open saved data. Nothing was overwritten. ${e.message}`;$('#error').hidden=false;
    main.innerHTML='<h1>Let’s keep your data safe.</h1><p class="help">Your saved data is still on this device. Download a copy, then contact support or restore it later.</p><button id="recover">Download saved data</button>';
    $('#recover').onclick=()=>download('Cheklst-recovery.txt',localStorage.getItem(KEY)??'No saved data found.');
  }
}
init();
