// App side of JavaScript calculations.
//
// Security model: the code runs in a Web Worker created inside an iframe with
// sandbox="allow-scripts" (a throwaway origin: no access to the app's page, storage or
// cookies). The iframe is built from `srcdoc`, so it needs no download and works offline.
// Its only script is SANDBOX_SCRIPT, allowed by its SHA-256 hash in the app's
// Content-Security-Policy (index.html) and in the iframe's own stricter policy, which also
// blocks all network access. Each calculation gets a fresh worker that is terminated after
// LIMIT ms, so an endless loop can't freeze the app. A test checks the hash stays in sync.
import {workerSource} from './jsrunner.js';

export const SANDBOX_SCRIPT=`(()=>{const LIMIT=1000;let busy=null;const queue=[];
const fail=m=>({ok:false,error:m,title:'',inputs:[],outputs:[],logs:[]});
function next(){if(busy||!queue.length)return;const job=busy=queue.shift();
const url=URL.createObjectURL(new Blob([job.source],{type:'text/javascript'}));const w=new Worker(url);
const done=r=>{if(busy!==job)return;clearTimeout(timer);w.terminate();URL.revokeObjectURL(url);busy=null;parent.postMessage(Object.assign({},r,{type:'result',id:job.id}),'*');next();};
const timer=setTimeout(()=>done(fail('Stopped after 1 second: the calculation took too long (an endless loop?).')),LIMIT);
w.onmessage=e=>done(e.data);
w.onerror=e=>{e.preventDefault();const msg=String(e.message||'The calculation failed.').replace(/^Uncaught /,'');done(fail((e.lineno>job.offset?'Line '+(e.lineno-job.offset)+': ':'')+msg));};}
addEventListener('message',e=>{if(e.source!==parent)return;const d=e.data||{};if(d.type==='run'){queue.push(d);next();}});
parent.postMessage({type:'ready'},'*');})();`;
export const SANDBOX_HASH='sha256-IpbcSiJ0Tv/i9oeVWtqMBYGJIsEeOQt3ID+QjCs6cBM=';
export const SANDBOX_HTML=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src '${SANDBOX_HASH}'; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"><script>${SANDBOX_SCRIPT}</script>`;

let frame=null,booting=null,seq=0;
const pending=new Map(),cache=new Map();
const empty=error=>({ok:false,error,title:'',inputs:[],outputs:[],logs:[]});

function boot(){
  if(booting)return booting;
  booting=new Promise((resolve,reject)=>{
    frame=document.createElement('iframe');
    frame.setAttribute('sandbox','allow-scripts');   // no allow-same-origin: a throwaway origin
    frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;frame.title='Calculation sandbox';
    frame.style.cssText='position:absolute;width:0;height:0;border:0;visibility:hidden';
    frame.srcdoc=SANDBOX_HTML;
    const timer=setTimeout(()=>{booting=null;frame.remove();frame=null;reject(new Error('The calculation sandbox didn’t start. Reload the app and try again.'));},8000);
    const onReady=e=>{if(frame&&e.source===frame.contentWindow&&e.data?.type==='ready'){clearTimeout(timer);removeEventListener('message',onReady);resolve();}};
    addEventListener('message',onReady);
    document.body.append(frame);
  });
  return booting;
}
globalThis.addEventListener?.('message',e=>{
  if(!frame||e.source!==frame.contentWindow||e.data?.type!=='result')return;
  const done=pending.get(e.data.id);if(done){pending.delete(e.data.id);done(e.data);}
});

/** Run one calculation. Never rejects: problems come back as {ok:false, error}. */
export async function runJS(code,{saved={},vars={}}={}){
  const key=JSON.stringify([code,saved,vars]);
  if(cache.has(key))return cache.get(key);
  try{await boot();}catch(e){return empty(e.message);}
  const {source,offset}=workerSource(code,{saved,vars}),id=++seq;
  const result=await new Promise(resolve=>{
    pending.set(id,resolve);
    frame.contentWindow.postMessage({type:'run',id,source,offset},'*');
  });
  const clean={ok:!!result.ok,error:result.error??null,title:result.title??'',inputs:result.inputs??[],outputs:result.outputs??[],logs:result.logs??[]};
  cache.set(key,clean);if(cache.size>200)cache.delete(cache.keys().next().value);
  return clean;
}

/** Run every JS block in a checklist in order. Named results flow into later blocks and {{name}}. */
export async function runJSBlocks(blocks,saved={},baseVars={}){
  const vars={...baseVars},results={},own={};
  for(const b of blocks){
    if(b.kind!=='js')continue;
    // Inputs are only known once the code runs, so every block gets all saved values (keyed by label).
    const r=await runJS(b.body,{saved,vars});
    results[b.line]=r;
    for(const o of r.outputs)if(o.name&&o.value!==null){vars[o.name]=o.value;own[o.name]=o.value;}
  }
  return {results,vars:own};
}
