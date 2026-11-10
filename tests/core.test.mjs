import test from 'node:test';import assert from 'node:assert/strict';
import {parse,newState,openChecklist,tasks,current,complete,setItem,saveDraft,restore,restart,closeRun,nextChecklist,validateState,persistable,copyChecklist,deleteChecklist,addCategory,renameCategory,deleteCategory,moveCategory,markdownOf,latest,UNCATEGORIZED} from '../web/core.js';
const md='## Section\n\n- [ ] Parent\n  - [ ] Child\n- [x] Last\n\n> [!WARNING]\n> Keep visible\n\n```md\n- [ ] Example only\n```\n\n```calc\ninput a = 1\n```\n';
function setup(){const s=newState();s.draft={title:'Camping',category:'Outdoors',markdown:md};const id=saveDraft(s);openChecklist(s,id,markdownOf(s.checklists[0]));return {s,id};}

test('parser: fenced examples are not items; calc fences are calc blocks',()=>{
  const blocks=parse(md);
  assert.equal(blocks.filter(b=>b.kind==='task').length,3);
  assert.equal(blocks.find(b=>b.kind==='calc').body,'input a = 1');
  assert.equal(blocks.find(b=>b.kind==='code').lang,'md');
});
test('saving a draft creates the checklist and its category',()=>{
  const {s,id}=setup();
  assert.equal(s.checklists[0].source,'device');assert.equal(s.categories[0].name,'Outdoors');
  assert.equal(s.active,id);assert.equal(s.draft,null);validateState(s);
});
test('fresh runs ignore source check marks; skip/pending flow',()=>{
  const {s,id}=setup(),r=s.runs[id];
  assert.deepEqual(r.states,{});assert.equal(current(r),2);
  setItem(r,2,'pending');assert.equal(current(r),3);
  setItem(r,3,'done');setItem(r,4,'done');assert.equal(current(r),2);assert.equal(complete(r),false);
  setItem(r,2,'done');assert.ok(complete(r));
});
test('edits add revisions, keep active run snapshot, and restore appends',()=>{
  const {s,id}=setup(),first=latest(s.checklists[0]).id;
  s.draft={checklistId:id,title:'Camping trip',category:'Outdoors',markdown:md+'- [ ] New\n'};saveDraft(s);
  assert.equal(s.checklists[0].revisions.length,2);assert.equal(s.runs[id].markdown,md);
  s.draft={checklistId:id,title:'Camping trip',category:'Outdoors',markdown:md+'- [ ] New\n'};saveDraft(s);
  assert.equal(s.checklists[0].revisions.length,2,'unchanged save adds no revision');
  restore(s,id,first);assert.equal(s.checklists[0].title,'Camping');assert.equal(s.checklists[0].revisions.length,3);
  restart(s,id,markdownOf(s.checklists[0]));assert.equal(s.runs[id].markdown,md);
});
test('draft needs a name',()=>{const s=newState();s.draft={title:' ',category:'',markdown:'- [ ] x'};assert.throws(()=>saveDraft(s),/name/);});
test('next checklist stays in the same category',()=>{
  const s=newState();
  for(const [title,category] of [['A','Trip'],['B','Home'],['C','Trip']]){s.draft={title,category,markdown:'- [ ] x'};saveDraft(s);}
  const a=s.checklists.find(c=>c.title==='A');openChecklist(s,a.id,'- [ ] x');
  assert.equal(nextChecklist(s).title,'C');
});
test('copy and delete',()=>{
  const {s,id}=setup();const copy=copyChecklist(s,id,'<!-- cheklst-id: 1 -->\n- [ ] x');
  assert.equal(markdownOf(s.checklists.find(c=>c.id===copy)),'- [ ] x');
  deleteChecklist(s,id);assert.equal(s.active,null);assert.equal(s.runs[id],undefined);
  closeRun(s,copy);validateState(s);
});
test('categories: add, duplicate, rename moves checklists, delete moves to Uncategorized, reorder',()=>{
  const {s}=setup();const cat=s.categories[0];
  assert.throws(()=>addCategory(s,'outdoors'),/already exists/);
  const car=addCategory(s,'Car','🚗🚙🚕');assert.equal(car.icon,'🚗🚙');
  renameCategory(s,cat.id,'Camping','⛺');assert.equal(s.checklists[0].category,'Camping');
  moveCategory(s,car.id,-1);assert.equal(s.categories[0].name,'Car');
  assert.equal(deleteCategory(s,cat.id),1);assert.equal(s.checklists[0].category,UNCATEGORIZED);
  validateState(s);
});
test('library categories cannot be renamed or deleted in the app',()=>{
  const s=newState();const cat=addCategory(s,'Travel');
  s.checklists.push({id:'lib-0000000000000001',source:'library',title:'Pack',category:'Travel',path:'Travel/Pack.md',hash:'h',offline:false});
  assert.throws(()=>renameCategory(s,cat.id,'Trips'),/GitHub/);
  renameCategory(s,cat.id,'Travel','✈️');assert.equal(cat.icon,'✈️');
  assert.throws(()=>deleteCategory(s,cat.id),/GitHub/);
});
test('persistable drops text of library checklists not saved offline',()=>{
  const s=newState();
  s.checklists.push({id:'lib-a',source:'library',title:'A',category:'X',path:'X/A.md',hash:'1',offline:false,markdown:'- [ ] a'});
  s.checklists.push({id:'lib-b',source:'library',title:'B',category:'X',path:'X/B.md',hash:'2',offline:true,markdown:'- [ ] b'});
  const saved=persistable(s);
  assert.equal(saved.checklists[0].markdown,undefined);assert.equal(saved.checklists[1].markdown,'- [ ] b');
  assert.equal(s.checklists[0].markdown,'- [ ] a','in-memory state untouched');
});
test('backup round trip and rejection of damaged data',()=>{
  const {s,id}=setup();setItem(s.runs[id],2,'done');s.runs[id].calc={a:'3'};
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))),s);
  assert.throws(()=>validateState({schema:99}));
  const dup=structuredClone(s);dup.checklists.push(dup.checklists[0]);assert.throws(()=>validateState(dup));
  const bad=structuredClone(s);bad.runs[id].states['99']='done';assert.throws(()=>validateState(bad));
});
