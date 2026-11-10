// Cheklst core: Markdown parsing, runs, device checklists, categories and state validation.
// Derived from FliteChek's core with aviation-specific concepts (variants, emergency) removed.
export const uid = () => globalThis.crypto.randomUUID();
export const UNCATEGORIZED = 'Uncategorized';

export function parse(md,{plainLists=true}={}) {
  const lines = md.split('\n'), blocks = [];
  for (let i = 0; i < lines.length;) {
    const start = i, raw = lines[i], trimmed = raw.trim();
    if (!trimmed) { i++; continue; }
    if(trimmed.startsWith('<!--')){i++;if(!trimmed.includes('-->'))while(i<lines.length&&!lines[i++].includes('-->')){}continue;}
    const fence = trimmed.match(/^(`{3,}|~{3,})\s*([\w-]*)/);
    if (fence) {
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) i++;
      const body=lines.slice(start+1,i).join('\n');
      if (i < lines.length) i++;
      blocks.push({line:start,end:i,kind:fence[2]==='calc'?'calc':'code',lang:fence[2]||'',body,text:lines.slice(start,i).join('\n')}); continue;
    }
    const task = raw.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s+)(.*)$/);
    if (task) { blocks.push({line:i,end:++i,kind:'task',text:task[2],prefix:task[1],depth:raw.match(/^\s*/)[0].length}); continue; }
    const plain=raw.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(\S.*)$/);
    if(plainLists && plain && !/^\s*(?:[-*_]\s*){3,}$/.test(raw)){
      blocks.push({line:i,end:++i,kind:'task',text:plain[2],prefix:plain[1],depth:raw.match(/^\s*/)[0].length,implicit:true});continue;
    }
    if (/^\s*\|/.test(raw)) {
      i++; while (i < lines.length && /^\s*\|/.test(lines[i])) i++;
      blocks.push({line:start,end:i,kind:'table',text:lines.slice(start,i).join('\n')}); continue;
    }
    if (/^\s*>/.test(raw)) {
      i++; while (i < lines.length && /^\s*>/.test(lines[i])) i++;
      blocks.push({line:start,end:i,kind:'note',text:lines.slice(start,i).map(l=>l.replace(/^\s*>\s?/, '')).join('\n')}); continue;
    }
    const heading = raw.match(/^(#{1,6})\s+(.*)$/);
    blocks.push({line:i,end:++i,kind:heading?'heading':'text',text:heading?heading[2]:raw,level:heading?.[1].length});
  }
  // Recognize GitHub/Obsidian callouts while keeping the original Markdown intact.
  for(const b of blocks){
    if(b.kind!=='note' && b.kind!=='text')continue;
    const marker=b.text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][+-]?[ \t]*(?:\n)?([\s\S]*)$/i);
    if(marker){b.kind='note';b.callout=marker[1].toLowerCase();b.body=marker[2];}
  }
  let sectionPath=[];
  for(const block of blocks){
    if(block.kind==='heading'){
      if(block.level===1)sectionPath=[];
      else{sectionPath.length=block.level-2;sectionPath[block.level-2]=block.text;}
    }
    if(block.kind==='task')block.sectionPath=sectionPath.filter(Boolean);
  }
  return blocks;
}

export const latest = c => c.revisions?.at(-1);
export function revision(markdown,extra={}) { return {id:uid(),date:new Date().toISOString(),markdown,...extra}; }
export function newState() {
  return {schema:1,categories:[],checklists:[],runs:{},active:null,draft:null,library:{repo:'',syncedAt:null,commit:null}};
}

// Markdown for any checklist: device checklists keep revisions; library checklists
// carry markdown only when saved offline (otherwise the caller supplies a session copy).
export function markdownOf(c,session={}) {
  if(c.source==='device')return latest(c).markdown;
  return c.markdown ?? session[c.id] ?? null;
}

export function openChecklist(state,id,markdown) {
  const c=state.checklists.find(c=>c.id===id); if(!c) return false;
  if(!state.runs[id]){
    if(typeof markdown!=='string')return false;
    state.runs[id]={version:versionOf(c),markdown,states:{},position:null,calc:{}};
  }
  state.active=id;
  return true;
}
export function versionOf(c){return c.source==='device'?latest(c).id:c.hash;}
export const tasks = run => parse(run.markdown).filter(b=>b.kind==='task');
export function current(run) { return tasks(run).find(b=>!run.states[b.line])?.line ?? tasks(run).find(b=>run.states[b.line]==='pending')?.line ?? null; }
export function complete(run) { const t=tasks(run); return t.length>0 && t.every(b=>run.states[b.line]==='done'); }
export function setItem(run,line,action) {
  if(!tasks(run).some(t=>t.line===line)) return;
  if(run.states[line]===action) delete run.states[line]; else run.states[line]=action;
  run.position=current(run);
}
export function restart(state,id,markdown) {
  delete state.runs[id];
  return openChecklist(state,id,markdown);
}
export function closeRun(state,id){delete state.runs[id];if(state.active===id)state.active=null;}

// The next checklist in the same category, in display order.
export function nextChecklist(state) {
  const c=state.checklists.find(c=>c.id===state.active); if(!c) return null;
  const peers=sortChecklists(state.checklists.filter(n=>n.category===c.category&&!n.retired));
  return peers[peers.findIndex(n=>n.id===c.id)+1] ?? null;
}
export function sortChecklists(list){
  return [...list].sort((a,b)=>(a.sequence??1e9)-(b.sequence??1e9)||a.title.localeCompare(b.title));
}

// ---- Device checklists ----
export function saveDraft(state) {
  const d=state.draft;
  const title=d?.title?.trim(),category=d?.category?.trim()||UNCATEGORIZED;
  if(!title) throw new Error('Give the checklist a name.');
  if(typeof d.markdown!=='string')throw new Error('Nothing to save.');
  ensureCategory(state,category);
  let c=state.checklists.find(c=>c.id===d.checklistId&&c.source==='device');
  if(c) {
    if(latest(c).markdown!==d.markdown || c.title!==title || c.category!==category) c.revisions.push(revision(d.markdown,{title,category}));
    Object.assign(c,{title,category});
  } else {
    c={id:uid(),source:'device',title,category,revisions:[revision(d.markdown,{title,category})]};
    state.checklists.push(c);
  }
  state.draft=null;
  return c.id;
}
export function restore(state,id,revisionID) {
  const c=state.checklists.find(c=>c.id===id&&c.source==='device'), r=c?.revisions.find(r=>r.id===revisionID); if(!r) return;
  c.revisions.push({...r,id:uid(),date:new Date().toISOString()});
  if(r.title)c.title=r.title;
  if(r.category){c.category=r.category;ensureCategory(state,r.category);}
}
export function deleteChecklist(state,id){
  const c=state.checklists.find(c=>c.id===id);
  if(!c||c.source!=='device')throw new Error('Only checklists created in the app can be deleted here. Library checklists are removed in GitHub.');
  state.checklists=state.checklists.filter(c=>c.id!==id);closeRun(state,id);
}
// An editable device copy of any checklist (e.g. one from the GitHub library).
export function copyChecklist(state,id,markdown){
  const c=state.checklists.find(c=>c.id===id);if(!c||typeof markdown!=='string')throw new Error('That checklist is not available to copy right now.');
  const clean=markdown.split('\n').filter(l=>!/^\s*<!--\s*cheklst-id:.*-->\s*$/.test(l)).join('\n');
  const title=c.source==='device'?c.title+' (copy)':c.title;
  const copy={id:uid(),source:'device',title,category:c.category,revisions:[revision(clean,{title,category:c.category})]};
  state.checklists.push(copy);return copy.id;
}

// ---- Categories ----
const sameName=(a,b)=>a.trim().toLowerCase()===b.trim().toLowerCase();
export function ensureCategory(state,name,extra={}){
  name=name.trim();
  let cat=state.categories.find(c=>sameName(c.name,name));
  if(!cat){cat={id:uid(),name,icon:'',...extra};state.categories.push(cat);}
  return cat;
}
export function addCategory(state,name,icon=''){
  name=String(name??'').trim();
  if(!name)throw new Error('Name the category.');
  if(name.length>60)throw new Error('Keep category names under 60 characters.');
  if(state.categories.some(c=>sameName(c.name,name)))throw new Error(`A category named “${name}” already exists.`);
  return ensureCategory(state,name,{icon:cleanIcon(icon)});
}
export function cleanIcon(icon){return [...String(icon??'').trim()].slice(0,2).join('');}
export function renameCategory(state,id,name,icon){
  const cat=state.categories.find(c=>c.id===id);if(!cat)throw new Error('Category not found.');
  name=String(name??'').trim();
  if(!name)throw new Error('Name the category.');
  if(state.categories.some(c=>c.id!==id&&sameName(c.name,name)))throw new Error(`A category named “${name}” already exists.`);
  if(name!==cat.name&&state.checklists.some(c=>c.source==='library'&&c.category===cat.name&&!c.retired))
    throw new Error('This category comes from your GitHub library. Rename its folder there; you can still change the icon here.');
  for(const c of state.checklists)if(c.source==='device'&&c.category===cat.name)c.category=name;
  if(state.draft?.category===cat.name)state.draft.category=name;
  cat.name=name;if(icon!==undefined)cat.icon=cleanIcon(icon);
}
export function deleteCategory(state,id){
  const cat=state.categories.find(c=>c.id===id);if(!cat)return;
  if(state.checklists.some(c=>c.source==='library'&&c.category===cat.name&&!c.retired))throw new Error('This category still has GitHub library checklists. Move or delete them in GitHub first.');
  const moved=state.checklists.filter(c=>c.source==='device'&&c.category===cat.name);
  if(moved.length)ensureCategory(state,UNCATEGORIZED);
  for(const c of moved)c.category=UNCATEGORIZED;
  state.categories=state.categories.filter(c=>c.id!==id);
  return moved.length;
}
export function moveCategory(state,id,direction){
  const i=state.categories.findIndex(c=>c.id===id),j=i+direction;
  if(i<0||j<0||j>=state.categories.length)return;
  [state.categories[i],state.categories[j]]=[state.categories[j],state.categories[i]];
}

// ---- Validation (saved data and backups) ----
export function validateState(s) {
  const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
  const safeID=id=>typeof id==='string'&&/^[A-Za-z0-9_-]+$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
  if(s?.schema!==1 || !Array.isArray(s.checklists) || !Array.isArray(s.categories) || !record(s.runs)) throw new Error('Unsupported or damaged Cheklst data.');
  const catIDs=new Set();
  for(const c of s.categories){if(!safeID(c.id)||catIDs.has(c.id)||typeof c.name!=='string'||!c.name.trim())throw new Error('Invalid category data.');catIDs.add(c.id);}
  const ids=new Set();
  for(const c of s.checklists) {
    if(!safeID(c.id) || ids.has(c.id) || typeof c.title!=='string' || typeof c.category!=='string' || !['device','library'].includes(c.source)) throw new Error('Invalid checklist data.');
    ids.add(c.id);
    if(c.source==='device'){
      if(!Array.isArray(c.revisions)||!c.revisions.length)throw new Error('Invalid checklist revisions.');
      for(const r of c.revisions) if(typeof r.id!=='string' || typeof r.markdown!=='string' || !Number.isFinite(Date.parse(r.date))) throw new Error('Invalid revision data.');
    }else{
      if(typeof c.path!=='string'||typeof c.hash!=='string'||typeof c.offline!=='boolean')throw new Error('Invalid library checklist.');
      if(c.markdown!==undefined&&typeof c.markdown!=='string')throw new Error('Invalid saved library checklist.');
    }
  }
  for(const [id,r] of Object.entries(s.runs)) {
    if(!ids.has(id) || typeof r.markdown!=='string' || !record(r.states) || Object.values(r.states).some(v=>!['done','pending'].includes(v))) throw new Error('Invalid saved progress.');
    if(r.calc!==undefined&&!record(r.calc))throw new Error('Invalid saved calculation values.');
    if(r.counts!==undefined&&(!record(r.counts)||Object.values(r.counts).some(n=>!Number.isInteger(n)||n<0)))throw new Error('Invalid saved counters.');
    if(r.timers!==undefined&&(!record(r.timers)||Object.values(r.timers).some(t=>!record(t)||!Number.isFinite(t.seconds))))throw new Error('Invalid saved timers.');
    const lines=new Set(tasks(r).map(b=>String(b.line)));
    if(Object.keys(r.states).some(line=>!lines.has(line)))throw new Error('Saved progress references missing items.');
  }
  if(s.active!==null && (!ids.has(s.active)||!s.runs[s.active])) throw new Error('Invalid active checklist.');
  if(s.draft && (typeof s.draft.title!=='string' || typeof s.draft.category!=='string' || (s.draft.markdown!==undefined&&typeof s.draft.markdown!=='string') || (s.draft.rows!==undefined&&!Array.isArray(s.draft.rows)))) throw new Error('Invalid editing draft.');
  if(!record(s.library))throw new Error('Invalid library settings.');
  return s;
}

// What gets written to device storage: library checklists not saved offline lose their text.
export function persistable(state){
  return {...state,checklists:state.checklists.map(c=>c.source==='library'&&!c.offline?(({markdown,...rest})=>rest)(c):c)};
}

// Automatic movement lands on the first notice before the current step.
export function automaticTarget(run){
  const line=current(run);if(line===null)return null;
  const blocks=parse(run.markdown);
  const index=blocks.findIndex(b=>b.line===line);
  let start=index-1;
  while(start>=0 && blocks[start].kind!=='task')start--;
  return blocks.slice(start+1,index).find(b=>b.callout)?.line ?? line;
}
