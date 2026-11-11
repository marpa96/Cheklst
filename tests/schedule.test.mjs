import test from 'node:test';import assert from 'node:assert/strict';
import {addInterval,nextDue,dueInfo,dueList,describeSchedule,parseRepeat,setSchedule,dayKey,relativeDay} from '../web/schedule.js';
import {newState,openChecklist,setItem,syncCompletion,inProgress,validateState,tasks} from '../web/core.js';
import {applyLibrary} from '../web/library.js';

const day=(y,m,d,h=12)=>new Date(y,m-1,d,h);
test('intervals add calendar days, weeks, months and years',()=>{
  assert.equal(dayKey(addInterval(day(2026,1,10),{every:3,unit:'day'})),'2026-01-13');
  assert.equal(dayKey(addInterval(day(2026,1,10),{every:2,unit:'week'})),'2026-01-24');
  assert.equal(dayKey(addInterval(day(2026,1,31),{every:1,unit:'month'})),'2026-02-28','clamps to month end');
  assert.equal(dayKey(addInterval(day(2028,2,29),{every:1,unit:'year'})),'2029-02-28');
  assert.equal(describeSchedule({every:1,unit:'month'}),'Monthly');assert.equal(describeSchedule({every:3,unit:'week'}),'Every 3 weeks');assert.equal(describeSchedule(null),'Doesn’t repeat');
});
test('due status from last completion, manual due date, or never done',()=>{
  const now=day(2026,11,10);
  const c={schedule:{every:1,unit:'month'},completions:[day(2026,10,1).toISOString()]};
  assert.equal(dayKey(nextDue(c)),'2026-11-01');
  assert.deepEqual([dueInfo(c,now).tone,dueInfo(c,now).label],['overdue','Overdue 9 days']);
  assert.equal(dueInfo({...c,completions:[day(2026,10,10).toISOString()]},now).label,'Due today');
  assert.equal(dueInfo({...c,completions:[day(2026,10,13).toISOString()]},now).label,'Due in 3 days');
  assert.equal(dueInfo({schedule:{every:1,unit:'week'}},now).label,'Not done yet');
  assert.equal(dueInfo({nextDue:'2026-11-11'},now).label,'Due tomorrow','one-off due date without repeat');
  assert.equal(dueInfo({},now),null);
  const list=dueList([{title:'B',...c},{title:'A',schedule:{every:1,unit:'year'},completions:[day(2026,6,1).toISOString()]},{title:'C',schedule:{every:1,unit:'week'}}],now);
  assert.deepEqual(list.map(x=>x.c.title),['B','C'],'later items stay out of the due list');
  assert.equal(relativeDay(day(2026,11,9),now),'yesterday');assert.equal(relativeDay(day(2026,10,29),now),'12 days ago');
});
test('repeat defaults from Markdown comments',()=>{
  assert.deepEqual(parseRepeat('# Home\n<!-- repeat: monthly -->'),{every:1,unit:'month'});
  assert.deepEqual(parseRepeat('<!-- repeat: every 2 weeks -->'),{every:2,unit:'week'});
  assert.equal(parseRepeat('<!-- repeat: whenever -->'),null);
  assert.throws(()=>setSchedule({}, {every:0,unit:'day'}));
});
test('completing a run logs once; unchecking takes it back; manual due date restored',()=>{
  const s=newState();
  s.checklists.push({id:'a',source:'device',title:'A',category:'Home',schedule:{every:1,unit:'week'},nextDue:'2026-11-05',revisions:[{id:'r',markdown:'- [ ] one\n- [ ] two',date:new Date().toISOString()}]});
  openChecklist(s,'a','- [ ] one\n- [ ] two');
  const run=s.runs.a,[t1,t2]=tasks(run);
  setItem(run,t1.line,'done');assert.equal(syncCompletion(s,'a'),false);
  setItem(run,t2.line,'done');assert.equal(syncCompletion(s,'a'),true);
  assert.equal(syncCompletion(s,'a'),false,'only once');
  const c=s.checklists[0];assert.equal(c.completions.length,1);assert.equal(c.nextDue,undefined);
  setItem(run,t2.line,'done');syncCompletion(s,'a');
  assert.equal(c.completions.length,0);assert.equal(c.nextDue,'2026-11-05');
  validateState(s);
});
test('several checklists stay in progress, most recent first',async()=>{
  const s=newState();
  for(const id of ['a','b'])s.checklists.push({id,source:'device',title:id,category:'Home',revisions:[{id:'r'+id,markdown:'- [ ] x',date:new Date().toISOString()}]});
  openChecklist(s,'a','- [ ] x');await new Promise(r=>setTimeout(r,5));openChecklist(s,'b','- [ ] x');
  assert.deepEqual(inProgress(s).map(x=>x.c.id),['b','a']);
});
test('library sync applies a Markdown repeat default but never overrides an app setting',()=>{
  const s=newState();const md='# Monthly\n<!-- repeat: monthly -->\n- [ ] x';
  const pkg={format:'cheklst-library-v1',categories:['Home'],checklists:[{id:'lib-0123456789abcdef',path:'Home/m.md',title:'Monthly',category:'Home',sequence:null,markdown:md,hash:'h1'}]};
  applyLibrary(s,pkg);assert.deepEqual(s.checklists[0].schedule,{every:1,unit:'month'});
  s.checklists[0].schedule=null;applyLibrary(s,{...pkg,checklists:[{...pkg.checklists[0],hash:'h2'}]});
  assert.equal(s.checklists[0].schedule,null);
  s.checklists[0].completions=[new Date().toISOString()];
  applyLibrary(s,{...pkg,checklists:[]});assert.equal(s.checklists[0].retired,true,'history keeps a removed checklist');
});
