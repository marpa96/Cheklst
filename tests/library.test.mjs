import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {validatePackage,applyLibrary,setOffline,repoName,downloadLibrary} from '../web/library.js';
import {newState,openChecklist,validateState,persistable,markdownOf} from '../web/core.js';
const item=(n,extra={})=>({id:'lib-'+String(n).padStart(16,'0'),path:`Travel/${n}.md`,title:'T'+n,category:'Travel',sequence:null,markdown:`- [ ] item ${n}`,hash:'h'+n,...extra});
const pkg=(items,categories=['Travel'])=>({format:'cheklst-library-v1',categories,checklists:items});

test('package validation',()=>{
  validatePackage(pkg([item(1)]));
  assert.throws(()=>validatePackage({format:'flitechek-library-v1'}));
  assert.throws(()=>validatePackage(pkg([item(1),item(1)])),/Duplicate/);
  assert.throws(()=>validatePackage(pkg([item(1,{path:'../x.md'})])),/path/);
  assert.throws(()=>validatePackage(pkg([item(1,{id:'nope'})])),/ID/);
});
test('sync adds, updates, keeps offline text current, and removes',()=>{
  const s=newState(),session={};
  let counts=applyLibrary(s,pkg([item(1),item(2)]),session,{repo:'me/lib'});
  assert.deepEqual(counts,{added:2,updated:0,removed:0});assert.equal(s.categories[0].name,'Travel');
  assert.equal(session[item(1).id],'- [ ] item 1');
  setOffline(s,item(1).id,true,session);
  assert.equal(persistable(s).checklists[0].markdown,'- [ ] item 1');
  openChecklist(s,item(2).id,session[item(2).id]);
  counts=applyLibrary(s,pkg([item(1,{markdown:'- [ ] changed',hash:'new'})]),session);
  assert.deepEqual(counts,{added:0,updated:1,removed:1});
  assert.equal(s.checklists[0].markdown,'- [ ] changed','saved-offline copy updated');
  assert.equal(s.checklists[1].retired,true,'removed but in use → kept hidden');
  assert.equal(s.runs[item(2).id].markdown,'- [ ] item 2','active run untouched');
  validateState(s);
});
test('offline toggle needs the text; turning off forgets it on device only',()=>{
  const s=newState();applyLibrary(s,pkg([item(1)]),{});
  assert.throws(()=>setOffline(s,item(1).id,true,{}),/internet/);
  const session={[item(1).id]:'- [ ] x'};setOffline(s,item(1).id,true,session);
  setOffline(s,item(1).id,false,session);
  assert.equal(s.checklists[0].markdown,undefined);assert.equal(markdownOf(s.checklists[0],session),'- [ ] x');
});
test('device checklists are never overwritten by sync',()=>{
  const s=newState();s.checklists.push({id:item(1).id,source:'device',title:'Mine',category:'X',revisions:[{id:'r',date:new Date().toISOString(),markdown:'mine'}]});
  applyLibrary(s,pkg([item(1)]),{});assert.equal(s.checklists[0].title,'Mine');
});
test('repo names',()=>{
  assert.equal(repoName('https://github.com/marpa96/Cheklst-Checklists.git'),'marpa96/Cheklst-Checklists');
  assert.equal(repoName(''),'');assert.throws(()=>repoName('not a repo'));
});
test('download prefers the API and falls back to raw; reports unpublished',async()=>{
  const body=JSON.stringify(pkg([item(1)]));const calls=[];
  const ok=url=>{calls.push(url);return url.includes('api.github.com')?new Response('rate limited',{status:403}):new Response(body);};
  assert.equal((await downloadLibrary('me/lib',{fetcher:ok})).checklists.length,1);
  assert.equal(calls.length,2);assert.match(calls[1],/raw\.githubusercontent\.com\/me\/lib\/cheklst-library\/library\.json/);
  await assert.rejects(downloadLibrary('me/lib',{fetcher:()=>new Response('',{status:404})}),/Nothing published/);
  await assert.rejects(downloadLibrary('me/lib',{fetcher:()=>Promise.reject(new Error('offline'))}),/Could not reach/);
});

const content=new URL('../../Cheklst-Checklists/',import.meta.url);
test('checklist repo build: folders → categories, order prefixes, titles, errors',{skip:!fs.existsSync(content)&&'Cheklst-Checklists not alongside'},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cheklst-build-'));
  try{
    const build=new URL('.cheklst/build.mjs',content).pathname,out=path.join(dir,'out.json');
    fs.mkdirSync(dir+'/2. Car');fs.mkdirSync(dir+'/1. Travel/sub',{recursive:true});fs.mkdirSync(dir+'/.hidden');
    fs.writeFileSync(dir+'/README.md','# ignored');fs.writeFileSync(dir+'/.hidden/x.md','- [ ] x');
    fs.writeFileSync(dir+'/1. Travel/02 Second.md','- [ ] b');fs.writeFileSync(dir+'/1. Travel/01 First.md','# Packing\n- [ ] a');fs.writeFileSync(dir+'/1. Travel/sub/Deep.md','- [ ] c');
    fs.writeFileSync(dir+'/2. Car/Oil.md','- [ ] oil');
    execFileSync(process.execPath,[build,out,dir]);
    const p=validatePackage(JSON.parse(fs.readFileSync(out,'utf8')));
    assert.deepEqual(p.categories,['Travel','Car']);
    assert.deepEqual(p.checklists.map(c=>[c.title,c.category,c.sequence]),[['Packing','Travel',1],['Second','Travel',2],['Deep','Travel',null],['Oil','Car',null]]);
    fs.writeFileSync(dir+'/2. Car/Bad.md','```calc\ninput a = 1\n');
    assert.throws(()=>execFileSync(process.execPath,[build,out,dir],{stdio:'pipe'}),e=>e.stderr.toString().includes('not closed'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('bundled starter library is valid',()=>{
  const p=validatePackage(JSON.parse(fs.readFileSync(new URL('../web/library.json',import.meta.url))));
  const s=newState();applyLibrary(s,p,{});validateState(s);assert.ok(p.checklists.length>0);
});
