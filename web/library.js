// The GitHub checklist library: validation, download and merge into device state.
// Library checklists are read-only in the app (make an editable copy to change one).
// Their text is kept on the device only when the checklist's "Save offline" toggle is on.
import {ensureCategory} from './core.js';

export const FORMAT='cheklst-library-v1';
export const DEFAULT_REPO='marpa96/Cheklst-Checklists';
export const BRANCH='cheklst-library';
const MAX=8_000_000;
const fail=message=>{throw new Error(message);};

export function validatePackage(pkg){
  if(pkg?.format!==FORMAT||!Array.isArray(pkg.checklists)||!Array.isArray(pkg.categories))fail('Not a Cheklst library package.');
  if(pkg.categories.some(c=>typeof c!=='string'||!c.trim()||c.length>60))fail('Invalid category name in library.');
  const ids=new Set();let bytes=0;
  for(const c of pkg.checklists){
    if(!c||typeof c!=='object')fail('Invalid library entry.');
    if(typeof c.id!=='string'||!/^lib-[a-f0-9]{16}$/.test(c.id))fail('Invalid library checklist ID.');
    if(ids.has(c.id))fail('Duplicate library checklist '+c.path);ids.add(c.id);
    for(const key of ['path','title','category','markdown','hash'])if(typeof c[key]!=='string'||(key!=='markdown'&&!c[key].trim()))fail(`${c.path||c.id}: ${key} is required.`);
    if(c.path.startsWith('/')||c.path.split(/[\\/]/).includes('..'))fail('Invalid library path '+c.path);
    if(c.sequence!==null&&c.sequence!==undefined&&!Number.isSafeInteger(c.sequence))fail(c.path+': invalid order.');
    bytes+=c.markdown.length;if(bytes>MAX)fail('Library exceeds 8 MB.');
  }
  return pkg;
}

// Merge a validated package. `session` receives every checklist's text for this app session.
export function applyLibrary(state,pkg,session={},{repo=state.library?.repo}={}){
  validatePackage(pkg);
  const counts={added:0,updated:0,removed:0};
  for(const name of pkg.categories)ensureCategory(state,name);
  const present=new Set();
  for(const item of pkg.checklists){
    present.add(item.id);session[item.id]=item.markdown;
    ensureCategory(state,item.category);
    const fields={path:item.path,title:item.title,category:item.category,sequence:item.sequence??null,hash:item.hash};
    const c=state.checklists.find(c=>c.id===item.id);
    if(c&&c.source!=='library')continue; // never touch a device checklist
    if(!c){state.checklists.push({id:item.id,source:'library',offline:false,...fields});counts.added++;continue;}
    if(c.hash!==item.hash||c.title!==item.title||c.category!==item.category||c.path!==item.path||c.retired)counts.updated++;
    Object.assign(c,fields);delete c.retired;
    if(c.offline)c.markdown=item.markdown;
  }
  // Gone from GitHub: keep hidden only while something on this device still depends on it.
  for(const c of [...state.checklists]){
    if(c.source!=='library'||present.has(c.id))continue;
    if(state.runs[c.id]||c.offline){if(!c.retired){c.retired=true;counts.removed++;}}
    else{state.checklists=state.checklists.filter(n=>n!==c);counts.removed++;}
  }
  state.library={...state.library,repo:repo??'',syncedAt:new Date().toISOString(),commit:pkg.source_commit??null,bundled:!!pkg.bundled};
  return counts;
}

export function setOffline(state,id,on,session={}){
  const c=state.checklists.find(c=>c.id===id&&c.source==='library');if(!c)return;
  if(on){
    const md=c.markdown??session[id];
    if(typeof md!=='string')fail('Connect to the internet once to save this checklist offline.');
    c.markdown=md;c.offline=true;
  }else{c.offline=false;session[id]??=c.markdown;delete c.markdown;}
}

export function repoName(value){
  const text=String(value??'').trim().replace(/^https?:\/\/github\.com\//i,'').replace(/\.git$/,'').replace(/\/+$/,'');
  if(!text)return '';
  if(!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(text))fail('Use the GitHub repository as owner/name, e.g. marpa96/Cheklst-Checklists.');
  return text;
}

async function readLimited(response){
  const reader=response.body.getReader(),parts=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX){await reader.cancel();fail('Library download is too large.');}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
// The contents API is fresh immediately after a publish; raw.githubusercontent.com can lag
// a few minutes, so it is only the fallback (e.g. when the hourly API limit is reached).
export async function downloadLibrary(repo,{fetcher=fetch,timeout=15000}={}){
  repo=repoName(repo);if(!repo)fail('No GitHub library is set. Add one in Settings.');
  const attempts=[
    [`https://api.github.com/repos/${repo}/contents/library.json?ref=${BRANCH}`,{headers:{Accept:'application/vnd.github.raw+json'}}],
    [`https://raw.githubusercontent.com/${repo}/${BRANCH}/library.json?t=${Date.now()}`,{}],
  ];
  let lastStatus=0;
  for(const [url,options] of attempts){
    let response;
    try{response=await fetcher(url,{...options,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(timeout)});}
    catch{continue;}
    if(response.ok)return validatePackage(await readLimited(response));
    lastStatus=response.status;
  }
  if(lastStatus===404)fail(`Nothing published yet at ${repo}. Push your checklists to GitHub and wait for “Publish Cheklst library” to finish. (The repository must be public.)`);
  fail(lastStatus?`GitHub returned ${lastStatus}. Your saved checklists are unchanged.`:'Could not reach GitHub. Your saved checklists are unchanged.');
}
