import {renderInline,webLinks} from './links.js';
import {parse,latest,newState,markdownOf,openChecklist,versionOf,tasks,current,complete,setItem,restart,closeRun,nextChecklist,sortChecklists,saveDraft,restore,deleteChecklist,copyChecklist,addCategory,renameCategory,deleteCategory,moveCategory,ensureCategory,validateState,persistable,automaticTarget,UNCATEGORIZED} from './core.js';
import {runCalcs,substitute,format,CALC_TEMPLATE} from './calc.js';
import {applyLibrary,setOffline,downloadLibrary,repoName,DEFAULT_REPO} from './library.js';
import {ROW_TYPES,CALLOUTS,markdownToRows,rowsToMarkdown,newRow,moveRow} from './editor.js';

export const BUILD='1';
const KEY='cheklst.state.v1';
const $=s=>document.querySelector(s), main=$('#main');
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,text,cls='',extra='')=>`<button type="button" data-action="${action}" class="${cls}" ${extra}>${text}</button>`;

let state, page='home', categoryId=null, editingCategory=null, confirmAction=null, backupCandidate=null, locked=false;
let session={};                     // library checklist text for this app session (not persisted unless saved offline)
let library={busy:false,message:''};
let scrollTimer;

// ---------- state ----------
function notice(message){$('#error').textContent=message;$('#error').hidden=!message;}
function save(next){localStorage.setItem(KEY,JSON.stringify(persistable(next)));}
function change(action,redraw=true){
  if(locked){notice('Saved data needs recovery first. Download it from the recovery screen.');return false;}
  try{const next=structuredClone(state);action(next);validateState(next);save(next);state=next;notice('');if(redraw)render();return true;}
  catch(e){notice(e.message);return false;}
}
const active=()=>state.checklists.find(c=>c.id===state.active);
const run=()=>state.runs[state.active];
const visible=()=>state.checklists.filter(c=>!c.retired);
const category=()=>state.categories.find(c=>c.id===categoryId);
const available=c=>markdownOf(c,session)!==null;
function checklistsIn(name){return sortChecklists(visible().filter(c=>c.category===name));}

// ---------- navigation ----------
function go(where,{keepScroll=false}={}){
  savePosition();page=where;confirmAction=null;editingCategory=null;render();if(!keepScroll)main.scrollTop=0;
}
function open(id){
  const c=state.checklists.find(c=>c.id===id);if(!c)return;
  if(!state.runs[id]&&!available(c)){notice(`“${c.title}” isn’t saved on this device. Connect to the internet, or turn on Save offline while connected.`);return;}
  savePosition();
  if(change(s=>openChecklist(s,id,markdownOf(c,session)),false)){page='run';confirmAction=null;render();restorePosition();}
}
function render(){
  if(!state)return;
  const views={home,category:categoryPage,all:allPage,run:runner,edit:editor,categories:categoriesPage,settings,history};
  if(page==='run'&&!active())page='home';
  main.innerHTML=views[page]();
  $('#resume').hidden=!active()||page==='run';
  document.querySelectorAll('.bottom [data-action]').forEach(b=>b.setAttribute('aria-current',b.dataset.action===page||(b.dataset.action==='home'&&['category','all'].includes(page))?'page':'false'));
  renderHeader();updateReturn();
}

// ---------- shared pieces ----------
function categoryIcon(cat){return cat?.icon?escape(cat.icon):'☷';}
function offlineToggle(c){
  if(c.source==='device')return '<span class="chip" title="Created in the app; always stored on this device">On device</span>';
  const label=c.offline?'Saved offline':'Online only';
  return `<label class="switch" title="Save this checklist on this device so it works without internet"><input type="checkbox" data-offline="${escape(c.id)}" ${c.offline?'checked':''} aria-label="Save “${escape(c.title)}” offline"><span class="slider" aria-hidden="true"></span><span class="switch-label">${label}</span></label>`;
}
function checklistRow(c){
  const r=state.runs[c.id],t=r?tasks(r):[],done=t.filter(b=>r.states[b.line]==='done').length;
  const status=r?`${done}/${t.length} done`:c.source==='library'?'From GitHub':'Created in app';
  const unavailable=!r&&!available(c);
  return `<div class="procedure-row ${unavailable?'unavailable':''}" data-search="${escape(c.title+' '+c.category)}"><button type="button" class="procedure" data-action="open" data-id="${escape(c.id)}"><span class="copy"><strong>${escape(c.title)}</strong><small>${escape(status)}${unavailable?' · needs internet':''}</small></span><span class="chevron">›</span></button>${offlineToggle(c)}</div>`;
}
function libraryLine(){
  const l=state.library;
  if(library.busy)return 'Syncing with GitHub…';
  if(library.message)return library.message;
  if(!l.repo)return 'No GitHub library set. Add one in Settings.';
  if(l.bundled)return 'Showing the starter library bundled with the app. Your GitHub library hasn’t been reached yet.';
  return l.syncedAt?`GitHub library synced ${new Date(l.syncedAt).toLocaleString()}`:'Not synced with GitHub yet.';
}

// ---------- pages ----------
function home(){
  let html='';
  const a=active();
  if(a)html+=`<div class="card resume-card"><div><span class="eyebrow">IN PROGRESS</span><h3>${escape(a.title)}</h3></div>${button('resume','Resume →','primary')}</div>`;
  html+=`<div class="row between"><h1>Categories</h1>${button('categories','Edit','small quiet','aria-label="Manage categories"')}</div>`;
  if(!state.categories.length)html+=`<div class="card empty"><p>No categories yet.</p>${button('categories','Create a category','primary')}</div>`;
  html+='<div class="category-grid">';
  for(const cat of state.categories){
    const count=checklistsIn(cat.name).length;
    html+=button('category',`<span class="cat-icon">${categoryIcon(cat)}</span><strong>${escape(cat.name)}</strong><span class="count">${count}</span>`,'category-button',`data-id="${escape(cat.id)}"`);
  }
  html+='</div>';
  html+=`${button('all','Search all checklists','outline full')}`;
  html+=`<div class="section-label">Library</div><div class="card stack"><p class="help" id="library-status">${escape(libraryLine())}</p>${button('sync',library.busy?'Syncing…':'Sync with GitHub','outline full',library.busy?'disabled':'')}</div>`;
  return html;
}
function categoryPage(){
  const cat=category();if(!cat){page='home';return home();}
  const list=checklistsIn(cat.name);
  let html=`${button('home','← Categories','quiet back')}<h1><span class="cat-icon big">${categoryIcon(cat)}</span> ${escape(cat.name)}</h1>`;
  html+=list.length?list.map(checklistRow).join(''):'<p class="help empty">No checklists here yet.</p>';
  html+=button('new','+ New checklist in '+escape(cat.name),'primary full',`data-category="${escape(cat.name)}"`);
  if(list.some(c=>c.source==='library'))html+='<p class="help">“Save offline” keeps a GitHub checklist on this device so it opens without internet. Checklists you create in the app are always on this device.</p>';
  return html;
}
function allPage(){
  let html=`${button('home','← Categories','quiet back')}<h1>All checklists</h1><label for="search">Search</label><input id="search" type="search" placeholder="Find a checklist…" autocomplete="off"><div id="procedures">`;
  for(const cat of state.categories){
    const list=checklistsIn(cat.name);if(!list.length)continue;
    html+=`<section data-group><h2>${categoryIcon(cat)} ${escape(cat.name)}</h2>${list.map(checklistRow).join('')}</section>`;
  }
  return html+'</div><p id="no-results" class="help" hidden>No matching checklists.</p>';
}

function headingHTML(b,vars){
  const level=Math.min(6,Math.max(2,b.level));
  return `<h${level} data-line="${b.line}" id="line-${b.line}" class="source-heading level-${b.level}">${renderInline(substitute(b.text,vars))}</h${level}>`;
}
function calcHTML(b,result){
  if(result.error)return `<div class="calc card" data-line="${b.line}" id="line-${b.line}"><span class="eyebrow">CALCULATION</span><p class="calc-error">${escape(result.error)}</p></div>`;
  return `<div class="calc card" data-line="${b.line}" id="line-${b.line}"><span class="eyebrow">CALCULATION</span>${result.title?`<h3>${escape(result.title)}</h3>`:''}<div class="calc-grid">${result.inputs.map(i=>`<label>${escape(i.label)}<input data-calc="${escape(i.name)}" inputmode="decimal" autocomplete="off" value="${escape(i.raw)}" ${i.error?'aria-invalid="true"':''}></label>`).join('')}</div>${result.outputs.map(o=>`<div class="calc-output"><span>${escape(o.label)}</span><strong data-output="${escape(o.name)}" title="${escape(o.error||'')}">${o.error?'—':escape(format(o.value))}</strong></div>`).join('')}</div>`;
}
function blockHTML(b,r,calc){
  const vars=calc.vars;
  if(b.kind==='task'){
    const status=r.states[b.line],now=current(r)===b.line,text=substitute(b.text,vars);
    return `<div class="task ${status==='done'?'done':''} ${now?'current':''}" id="line-${b.line}" data-line="${b.line}" style="margin-left:${Math.min(b.depth,8)*4}px"><button type="button" class="check" data-action="check" data-line="${b.line}" aria-pressed="${status==='done'}"><span class="box" aria-hidden="true">${status==='done'?'✓':status==='pending'?'◷':''}</span><span class="item-copy">${now&&b.sectionPath.length?`<span class="item-context">${escape(b.sectionPath.join(' › '))}</span>`:''}${renderInline(text,{links:false})}</span></button><button type="button" class="pending-button" data-action="pending" data-line="${b.line}" aria-label="${status==='pending'?'Return item to checklist':'Skip for now'}" title="${status==='pending'?'Return to checklist':'Skip for now'}">${status==='pending'?'↩':'◷'}</button>${webLinks(text).map(link=>`<a class="external-link task-reference" data-web-link href="${escape(link.url)}" target="_blank" rel="noopener noreferrer">${escape(link.label)} ↗</a>`).join('')}</div>`;
  }
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
  if(page!=='run'||!c){header.innerHTML=`<div><span class="brand-icon">✓</span><strong>Cheklst</strong></div><span id="connection" class="eyebrow">${navigator.onLine?'ONLINE':'OFFLINE'}</span>`;return;}
  const r=run(),t=tasks(r),done=t.filter(b=>r.states[b.line]==='done').length,pending=t.filter(b=>r.states[b.line]==='pending').length;
  header.innerHTML=`<div class="run-title-row"><h1>${escape(c.title)}</h1>${button('options','•••','small quiet','aria-label="Checklist options"')}</div><div class="progress" role="progressbar" aria-label="Checklist progress" aria-valuemin="0" aria-valuemax="${t.length||1}" aria-valuenow="${done}"><div style="width:${t.length?done/t.length*100:0}%"></div></div><div class="stat">${escape(c.category)} · ${done} of ${t.length} done${pending?` · ${pending} skipped`:''}</div>`;
}
function runner(){
  const c=active(),r=run(),t=tasks(r),blocks=parse(r.markdown),calc=runCalcs(blocks,r.calc||{});
  let html='';
  if(confirmAction==='options'){
    html+=`<div class="card stack">`;
    if(c.source==='device')html+=button('edit','Edit checklist')+button('history','Revision history');
    else html+=`<div class="row between"><span>Save offline</span>${offlineToggle(c)}</div>`+button('copy','Make an editable copy');
    html+=button('export','Export Markdown')+button('restart','Restart checklist…','quiet')+button('close-run','Close checklist (clear progress)…','quiet');
    if(c.source==='device')html+=button('delete','Delete checklist…','quiet danger-text');
    html+='</div>';
  }
  if(confirmAction==='restart')html+=confirmation('Restart this checklist?','Checks and calculation values reset. The latest saved version is loaded.','reset-one');
  if(confirmAction==='close-run')html+=confirmation('Close this checklist?','Progress is cleared. The checklist itself stays saved.','do-close-run');
  if(confirmAction==='delete')html+=confirmation(`Delete “${escape(c.title)}”?`,'This removes the checklist and its revision history from this device. Download a backup first if unsure.','do-delete');
  if(c.retired)html+='<div class="note">This checklist was removed from your GitHub library. Your progress is kept until you close it.</div>';
  else if(r.version!==versionOf(c)&&available(c))html+=`<div class="note">A newer version of this checklist is saved. You’re still using the version you started with.${button('restart','Use the new version…','outline full')}</div>`;
  // The title is already in the header; don't repeat a matching "# Title" line.
  html+=blocks.filter(b=>!(b.kind==='heading'&&b.level===1&&b.text.trim()===c.title)).map(b=>blockHTML(b,r,calc)).join('');
  if(complete(r)){const next=nextChecklist(state);html+=`<div class="card completion"><span class="success">✓</span><h2>All done.</h2>${next?button('open',`Next: ${escape(next.title)} →`,'primary full',`data-id="${escape(next.id)}"`):''}${button('finish','Finish & clear progress','outline full')}${button('home','Back to categories','quiet full')}</div>`;}
  else if(!t.length)html+=`<div class="card"><h3>No checkbox items yet.</h3><p class="help">${c.source==='device'?'Edit this checklist to add items.':'Add items in GitHub, or make an editable copy.'}</p></div>`;
  return html;
}

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
  html+=`<label for="draft-category">Category</label><div class="row"><select id="draft-category" data-draft="category">${cats.map(n=>`<option ${n===d.category?'selected':''}>${escape(n)}</option>`).join('')}</select>${button('new-category-inline','+ New','outline small')}</div>`;
  html+=`<div class="segmented" role="tablist">${button('mode-visual','Visual',d.mode==='visual'?'selected':'',`role="tab" aria-selected="${d.mode==='visual'}"`)}${button('mode-markdown','Markdown',d.mode==='markdown'?'selected':'',`role="tab" aria-selected="${d.mode==='markdown'}"`)}</div>`;
  if(d.mode==='markdown'){
    html+=`<textarea id="draft-markdown" class="source" data-draft="markdown" spellcheck="false">${escape(d.markdown)}</textarea><p class="help">Use <code>- [ ] item</code> for checkboxes, <code>## Heading</code> for sections, <code>&gt; note</code> for notes, and a <code>\`\`\`calc</code> block for calculations.</p>`;
  }else{
    d.rows.forEach((row,i)=>{html+=rowEditor(row,i,d.rows.length);});
    html+=`<div class="add-row">${[['item','+ Item'],['heading','+ Heading'],['note','+ Note'],['calc','+ Calculation']].map(([t,l])=>button('add-row',l,'outline small',`data-type="${t}"`)).join('')}</div>`;
  }
  html+=`<div class="editor-actions">${button('save-draft','Save checklist','primary full')}${button('discard-draft','Discard changes','quiet full')}</div>`;
  if(confirmAction==='discard-draft')html+=confirmation('Discard your changes?','The saved checklist is not affected.','do-discard');
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
    if(row.type==='note')body+=`<select data-row-callout="${i}" aria-label="Note style">${CALLOUTS.map(c=>`<option value="${c}" ${c===(row.callout||'')?'selected':''}>${c?c[0].toUpperCase()+c.slice(1):'Plain note'}</option>`).join('')}</select>`;
  }
  const indent=row.type==='item'?`${button('indent','⇤','',`data-row="${i}" data-dir="-1" aria-label="Outdent" ${row.depth?'':'disabled'}`)}${button('indent','⇥','',`data-row="${i}" data-dir="1" aria-label="Indent" ${row.depth>=4?'disabled':''}`)}`:'';
  return `<div class="editor-row type-${row.type}" style="margin-left:${(row.depth||0)*14}px">${body}<div class="tools">${typeSelect}${indent}${button('move-row','↑','',`data-row="${i}" data-dir="-1" aria-label="Move up" ${i?'':'disabled'}`)}${button('move-row','↓','',`data-row="${i}" data-dir="1" aria-label="Move down" ${i<count-1?'':'disabled'}`)}${button('remove-row','✕','',`data-row="${i}" aria-label="Remove row"`)}</div></div>`;
}

// ---------- categories ----------
function categoriesPage(){
  let html=`${button('home','← Categories','quiet back')}<h1>Manage categories</h1><div class="card"><label for="new-category">New category</label><div class="row"><input id="new-category-icon" class="icon-input" maxlength="4" placeholder="🙂" aria-label="Icon (emoji)"><input id="new-category" placeholder="e.g. Travel, Hiking, Car" autocomplete="off"></div>${button('add-category','Add category','primary full')}</div>`;
  state.categories.forEach((cat,i)=>{
    const count=checklistsIn(cat.name).length,fromLibrary=visible().some(c=>c.source==='library'&&c.category===cat.name);
    if(editingCategory===cat.id){
      html+=`<div class="card stack"><div class="row"><input id="edit-category-icon" class="icon-input" maxlength="4" value="${escape(cat.icon||'')}" placeholder="🙂" aria-label="Icon"><input id="edit-category-name" value="${escape(cat.name)}" ${fromLibrary?'readonly title="Set by the folder name in GitHub"':''}></div>${fromLibrary?'<p class="help">This name comes from a folder in your GitHub library; rename the folder there. You can change the icon here.</p>':''}<div class="row">${button('save-category','Save','primary',`data-id="${cat.id}"`)}${button('cancel','Cancel','outline')}</div>${confirmAction==='delete-category'?confirmation(`Delete “${escape(cat.name)}”?`,count?`Its ${count} checklist${count===1?'':'s'} move to ${UNCATEGORIZED}.`:'It has no checklists.','do-delete-category',cat.id):fromLibrary?'':button('delete-category','Delete category…','quiet danger-text',`data-id="${cat.id}"`)}</div>`;
    }else{
      html+=`<div class="category-row"><span class="cat-icon">${categoryIcon(cat)}</span><span class="copy"><strong>${escape(cat.name)}</strong><small>${count} checklist${count===1?'':'s'}${fromLibrary?' · GitHub folder':''}</small></span>${button('move-category','↑','small quiet',`data-id="${cat.id}" data-dir="-1" aria-label="Move up" ${i?'':'disabled'}`)}${button('move-category','↓','small quiet',`data-id="${cat.id}" data-dir="1" aria-label="Move down" ${i<state.categories.length-1?'':'disabled'}`)}${button('edit-category','Edit','small outline',`data-id="${cat.id}"`)}</div>`;
    }
  });
  return html;
}

// ---------- settings ----------
function themeControl(){return `<label for="theme-choice">Appearance</label><select id="theme-choice">${[['auto','Match device'],['light','Light'],['dark','Dark']].map(([v,l])=>`<option value="${v}" ${window.cheklstTheme.preference===v?'selected':''}>${l}</option>`).join('')}</select>`;}
function settings(){
  return `<h1>Settings</h1><div class="card">${themeControl()}</div>
  <div class="card stack"><h3>GitHub library</h3><label for="library-repo">Repository (owner/name)</label><input id="library-repo" value="${escape(state.library.repo)}" placeholder="${DEFAULT_REPO}" autocomplete="off" autocapitalize="off" spellcheck="false">${button('save-repo','Save & sync','primary')}<p class="help">${escape(libraryLine())}</p><p class="help">Checklists are Markdown files in category folders of that repository. Pushing to <code>main</code> publishes them; the app picks up changes when it syncs. The repository must be public for the app to read it.</p></div>
  <div class="card stack"><h3>Offline</h3><p class="help">The app itself is cached after your first visit. Checklists you create here are always stored on this device. GitHub checklists are stored only when “Save offline” is on for them.</p><p class="help" id="offline-status">Checking…</p></div>
  <div class="card stack"><h3>Backup</h3>${button('backup','Download full backup','outline')}${button('import-backup','Restore from backup…','outline')}${backupCandidate?confirmation('Replace everything on this device?',`The backup has ${backupCandidate.checklists.length} checklists and ${backupCandidate.categories.length} categories. Download a backup of your current data first.`,'restore-backup'):''}<p class="help">A backup includes your checklists, revisions, categories, progress and offline copies. There’s no automatic sync between devices.</p></div>
  <p class="help">Cheklst · build ${BUILD}</p>`;
}
function history(){
  const c=active();if(!c||c.source!=='device')return '<p>Open a checklist created in the app first.</p>';
  return `${button('resume','← Back to checklist','quiet back')}<h1>Revision history</h1><p class="subtitle">${escape(c.title)}</p><p class="help">Restoring adds a new revision; nothing is lost. Restart the checklist to use it.</p>${c.revisions.map((r,i)=>({r,i})).reverse().map(({r,i})=>`<details><summary>Revision ${i+1} · ${escape(new Date(r.date).toLocaleString())}</summary><pre>${escape(r.markdown)}</pre>${r.id!==latest(c).id?button('restore','Restore this version','primary',`data-id="${escape(r.id)}"`):'<span class="chip">Current version</span>'}</details>`).join('')}`;
}
function confirmation(title,description,action,id=''){return `<div class="card confirm"><h3>${title}</h3><p class="help">${description}</p><div class="row">${button(action,'Confirm','danger',id?`data-id="${escape(id)}"`:'')}${button('cancel','Cancel','outline')}</div></div>`;}

// ---------- run position ----------
function updateReturn(){
  const bar=$('#return-bar');bar.hidden=page!=='run'||!run()||current(run())===null;
  if(bar.hidden)return;
  const pending=tasks(run()).find(t=>run().states[t.line]==='pending');
  bar.innerHTML=`<div class="row between">${button('current','↓ Next unchecked item')}${pending?button('jump-pending','Skipped item','','data-line="'+pending.line+'"'):''}</div>`;
}
function jump(line,smooth=true){
  const el=document.getElementById(`line-${line}`);if(!el)return;
  main.scrollTo({top:main.scrollTop+el.getBoundingClientRect().top-main.getBoundingClientRect().top-14,behavior:smooth&&!matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'instant'});
}
function restorePosition(){requestAnimationFrame(()=>{if(page==='run'&&run())jump(run().position??automaticTarget(run()),false);});}
function savePosition(){
  if(page!=='run'||!run()||locked)return;
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
  if(!state.library.repo){if(!quiet){library.message='No GitHub library set. Add one in Settings.';render();}return;}
  library.busy=true;library.message='';if(!quiet)render();
  try{
    const pkg=await downloadLibrary(state.library.repo);
    let counts;
    if(change(s=>{counts=applyLibrary(s,pkg,session);},false)){
      const changed=counts.added+counts.updated+counts.removed;
      library.message=changed?`Synced: ${counts.added} new, ${counts.updated} updated, ${counts.removed} removed.`:'';
    }
  }catch(e){library.message=e.message;await loadBundledIfEmpty();}
  library.busy=false;if(!['edit','run'].includes(page)||!quiet)render();
}
// First run without a reachable GitHub library: show the starter checklists bundled with the app.
async function loadBundledIfEmpty(){
  if(state.library.syncedAt&&!state.library.bundled)return;
  try{const r=await fetch('./library.json');if(!r.ok)return;const pkg=await r.json();change(s=>{applyLibrary(s,{...pkg,bundled:true},session,{repo:s.library.repo});},false);}catch{}
}

// ---------- events ----------
document.addEventListener('click',async e=>{
  const link=e.target.closest('a[data-web-link]');if(link){if(!navigator.onLine){e.preventDefault();notice('This link needs internet.');}else savePosition();return;}
  const b=e.target.closest('[data-action]');if(!b||b.disabled||!state)return;
  const action=b.dataset.action,id=b.dataset.id;
  switch(action){
    case 'home':case 'all':case 'categories':case 'settings':return go(action);
    case 'category':categoryId=id;return go('category');
    case 'open':return open(id);
    case 'resume':if(active()){go('run');restorePosition();}return;
    case 'sync':return sync();
    case 'new':return startEditing({categoryName:b.dataset.category??(page==='category'?category()?.name:null)});
    case 'options':case 'restart':case 'close-run':case 'delete':case 'discard-draft':case 'delete-category':
      confirmAction=confirmAction===action?null:action;render();if(action!=='options'&&page!=='categories')main.scrollTop=0;return;
    case 'cancel':if(confirmAction)confirmAction=null;else editingCategory=null;backupCandidate=null;render();return;
    case 'check':case 'pending':{
      const line=Number(b.dataset.line);
      if(change(s=>setItem(s.runs[s.active],line,action==='check'?'done':'pending'))){
        if(action==='check'&&run().states[line]==='done'){const row=document.getElementById(`line-${line}`);row?.classList.add('just-checked');}
        const next=current(run());if(next!==null&&run().states[line])jump(automaticTarget(run()));else if(next===null)main.scrollTo({top:main.scrollHeight,behavior:'smooth'});
      }return;
    }
    case 'current':return jump(current(run()));
    case 'jump-pending':return jump(Number(b.dataset.line));
    case 'reset-one':{const c=active();if(!available(c)){notice('The latest version isn’t on this device. Connect to the internet first.');return;}if(change(s=>restart(s,c.id,markdownOf(c,session)),false)){confirmAction=null;render();main.scrollTop=0;}return;}
    case 'do-close-run':case 'finish':if(change(s=>closeRun(s,s.active),false))go('home');return;
    case 'do-delete':{const name=active().title;if(change(s=>deleteChecklist(s,s.active),false)){go('home');notice(`Deleted “${name}”.`);}return;}
    case 'copy':{const c=active();let newId;if(change(s=>{newId=copyChecklist(s,c.id,markdownOf(c,session)??run().markdown);},false)){startEditing({id:newId});}return;}
    case 'edit':return startEditing({id:state.active});
    case 'history':return go('history');
    case 'restore':return change(s=>restore(s,s.active,id));
    case 'export':{const c=active();return download(`${c.title.replace(/[\\/:*?"<>|]/g,'-')}.md`,markdownOf(c,session)??run().markdown,'text/markdown');}
    // editor
    case 'mode-visual':case 'mode-markdown':{
      const mode=action==='mode-visual'?'visual':'markdown';
      return change(s=>{const d=s.draft;if(d.mode===mode)return;if(mode==='markdown')d.markdown=rowsToMarkdown(d.rows);else{d.rows=markdownToRows(d.markdown);if(!d.rows.length)d.rows=[newRow('item')];}d.mode=mode;});
    }
    case 'add-row':{change(s=>{s.draft.rows.push(newRow(b.dataset.type));});const rows=main.querySelectorAll('[data-row]');const last=[...rows].filter(el=>el.tagName==='TEXTAREA').at(-1);last?.focus();return;}
    case 'remove-row':return change(s=>{s.draft.rows.splice(Number(b.dataset.row),1);if(!s.draft.rows.length)s.draft.rows.push(newRow('item'));});
    case 'move-row':return change(s=>{s.draft.rows=moveRow(s.draft.rows,Number(b.dataset.row),Number(b.dataset.dir));});
    case 'indent':return change(s=>{const r=s.draft.rows[Number(b.dataset.row)];r.depth=Math.max(0,Math.min(4,(r.depth||0)+Number(b.dataset.dir)));});
    case 'calc-template':return change(s=>{const r=s.draft.rows[Number(b.dataset.row)];r.text=r.text.trim()?r.text+'\n'+CALC_TEMPLATE:CALC_TEMPLATE;});
    case 'new-category-inline':{
      const name=prompt('New category name');if(!name)return;
      return change(s=>{const cat=addCategory(s,name);s.draft.category=cat.name;});
    }
    case 'save-draft':{
      let newId;
      if(change(s=>{s.draft.markdown=draftMarkdown(s.draft);newId=saveDraft(s);},false)){
        const r=state.runs[newId],c=state.checklists.find(c=>c.id===newId);
        // Restart automatically only if nothing has been checked yet.
        if(r&&!Object.keys(r.states).length)change(s=>restart(s,newId,latest(c).markdown),false);
        open(newId);
      }return;
    }
    case 'do-discard':{const back=state.draft?.checklistId&&state.runs[state.draft.checklistId];if(change(s=>{s.draft=null;},false))go(back?'run':'home');return;}
    // categories
    case 'add-category':{
      const name=$('#new-category').value,icon=$('#new-category-icon').value;
      if(change(s=>addCategory(s,name,icon)))$('#new-category')?.focus();return;
    }
    case 'edit-category':editingCategory=id;confirmAction=null;render();return;
    case 'save-category':if(change(s=>renameCategory(s,id,$('#edit-category-name').value,$('#edit-category-icon').value),false)){editingCategory=null;render();}return;
    case 'move-category':return change(s=>moveCategory(s,id,Number(b.dataset.dir)));
    case 'do-delete-category':{let moved=0;if(change(s=>{moved=deleteCategory(s,id);},false)){editingCategory=null;confirmAction=null;render();if(moved)notice(`${moved} checklist${moved===1?'':'s'} moved to ${UNCATEGORIZED}.`);}return;}
    // settings
    case 'save-repo':{let repo;try{repo=repoName($('#library-repo').value);}catch(err){notice(err.message);return;}if(change(s=>{s.library.repo=repo;s.library.syncedAt=null;}))sync();return;}
    case 'backup':return download(`Cheklst-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state,null,2),'application/json');
    case 'import-backup':$('#backup-import').value='';$('#backup-import').click();return;
    case 'restore-backup':if(backupCandidate&&change(s=>{for(const k of Object.keys(s))delete s[k];Object.assign(s,backupCandidate);},false)){backupCandidate=null;go('home');}return;
  }
});
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
    return;
  }
  if(t.dataset.calc){
    // Update results in place so the field keeps focus while typing.
    const name=t.dataset.calc;change(s=>{const r=s.runs[s.active];r.calc??={};r.calc[name]=t.value;},false);
    const calc=runCalcs(parse(run().markdown),run().calc);
    for(const result of Object.values(calc.results))for(const o of result.outputs){const el=main.querySelector(`[data-output="${CSS.escape(o.name)}"]`);if(el){el.textContent=o.error?'—':format(o.value);el.title=o.error||'';}}
  }
});
document.addEventListener('change',e=>{
  const t=e.target;
  if(t.dataset.offline){
    const id=t.dataset.offline,on=t.checked;
    if(!change(s=>setOffline(s,id,on,session)))t.checked=!on;
    return;
  }
  if(t.dataset.calc){render();return;} // refresh {{values}} in items after editing an input
  if(t.dataset.draft==='category'){change(s=>{s.draft.category=t.value;},false);return;}
  if(t.dataset.rowType!==undefined){const i=Number(t.dataset.rowType);change(s=>{const r=s.draft.rows[i];r.type=t.value;if(t.value==='item')r.depth??=0;if(t.value==='note')r.callout??='';});return;}
  if(t.dataset.rowCallout!==undefined){const i=Number(t.dataset.rowCallout);change(s=>{s.draft.rows[i].callout=t.value;},false);return;}
  if(t.id==='theme-choice'){try{window.cheklstTheme.set(t.value);}catch{notice('Appearance could not be saved.');}}
});
main.addEventListener('keydown',e=>{
  // Enter in an item adds the next item, like a notes app.
  const t=e.target;
  if(e.key==='Enter'&&!e.shiftKey&&t.dataset.row!==undefined&&state.draft?.rows[Number(t.dataset.row)]?.type==='item'){
    e.preventDefault();const i=Number(t.dataset.row),depth=state.draft.rows[i].depth||0;
    change(s=>{s.draft.rows.splice(i+1,0,{...newRow('item'),depth});});
    main.querySelector(`textarea[data-row="${i+1}"]`)?.focus();
  }
  if(e.key==='Enter'&&t.id==='new-category'){e.preventDefault();main.querySelector('[data-action="add-category"]').click();}
});
$('#backup-import').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{if(file.size>20_000_000)throw new Error('Backup is too large.');backupCandidate=validateState(JSON.parse(await file.text()));render();}
  catch(err){notice(`Backup was not loaded: ${err.message}`);}
});
main.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(savePosition,200);},{passive:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden)savePosition();});
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
    page=active()?'run':'home';render();if(page==='run')restorePosition();
    offlineStatus();
    if(navigator.onLine)sync({quiet:true});else await loadBundledIfEmpty(),render();
  }catch(e){
    locked=true;notice(`Could not open saved data. Nothing was overwritten. ${e.message}`);
    main.innerHTML='<h1>Let’s keep your data safe.</h1><p class="help">Your saved data is still on this device. Download a copy, then contact support or restore it later.</p><button id="recover">Download saved data</button>';
    $('#recover').onclick=()=>download('Cheklst-recovery.txt',localStorage.getItem(KEY)??'No saved data found.');
  }
}
init();
