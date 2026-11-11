import test from 'node:test';
import assert from 'node:assert/strict';
import {newState,parse,noteKey,getNote,setNote,validateState,copyChecklist,revision,NOTE_LIMIT} from '../web/core.js';

const md='## Kitchen\n- [ ] Change the water filter\n## Garage\n- [ ] Change the water filter\n';
function setup(){
  const s=newState();
  s.checklists.push({id:'c1',source:'device',title:'Home',category:'Home',revisions:[revision(md)]});
  return s;
}

test('note keys include the section, so repeated items get their own notes',()=>{
  const [a,b]=parse(md).filter(x=>x.kind==='task');
  assert.equal(noteKey(a),'Kitchen › Change the water filter');
  assert.notEqual(noteKey(a),noteKey(b));
});

test('setting, replacing and clearing a note',()=>{
  const s=setup(),c=s.checklists[0],key='Kitchen › Change the water filter';
  assert.equal(setNote(c,key,'  Filter is 16x25x1\r\nin the hall closet  ',new Date('2026-11-01')),true);
  assert.deepEqual(getNote(c,key),{key,text:'Filter is 16x25x1\nin the hall closet',updated:'2026-11-01T00:00:00.000Z'});
  setNote(c,key,'Now 20x25x1');
  assert.equal(c.notes.length,1);assert.equal(getNote(c,key).text,'Now 20x25x1');
  assert.equal(setNote(c,key,'   '),false);
  assert.equal(c.notes,undefined);
  validateState(s);
});

test('odd keys like __proto__ are stored safely',()=>{
  const s=setup(),c=s.checklists[0];
  setNote(c,'__proto__','hi');
  assert.equal(getNote(c,'__proto__').text,'hi');
  validateState(JSON.parse(JSON.stringify(s)));
});

test('notes are limited in length and validated',()=>{
  const s=setup(),c=s.checklists[0];
  assert.throws(()=>setNote(c,'k','x'.repeat(NOTE_LIMIT+1)),/under/);
  c.notes=[{key:'k',text:5,updated:'2026-01-01'}];
  assert.throws(()=>validateState(s),/notes/);
  c.notes={k:'x'};
  assert.throws(()=>validateState(s),/notes/);
});

test('copies keep their notes',()=>{
  const s=setup();setNote(s.checklists[0],'k','keep me');
  const id=copyChecklist(s,'c1',md);
  assert.equal(getNote(s.checklists.find(c=>c.id===id),'k').text,'keep me');
});
