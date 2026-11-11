import test from 'node:test';import assert from 'node:assert/strict';
import {executeCalc,JS_TEMPLATE} from '../web/jsrunner.js';
import {parse} from '../web/core.js';
import {markdownToRows,rowsToMarkdown} from '../web/editor.js';
import {substitute} from '../web/calc.js';

test('the template runs and reacts to saved inputs',()=>{
  let r=executeCalc(JS_TEMPLATE);
  assert.equal(r.ok,true);assert.equal(r.title,'Water to carry');
  assert.deepEqual(r.inputs.map(i=>[i.type,i.label,i.raw]),[['number','Hours on the trail','4'],['number','Temperature (°F)','70'],['bool','Strenuous terrain?','no']]);
  assert.deepEqual(r.outputs,[{label:'Liters of water',value:2.4,name:'liters'}]);
  r=executeCalc(JS_TEMPLATE,{saved:{'Strenuous terrain?':'yes','Hours on the trail':'5'}});
  assert.equal(r.outputs[0].value,6);
});
test('choices, vars, strings, booleans and console',()=>{
  const r=executeCalc(`const t = choice("Terrain", {flat: 1, steep: 1.25}, "steep");
const c = choice("Color", ["red", "blue"]);
console.log("t is", t);
show("Factor", t * vars.base);
show("Color", c, "color");
show("Hot?", vars.base > 1);
show("Nothing", undefined);`,{vars:{base:2}});
  assert.equal(r.ok,true);
  assert.deepEqual(r.outputs.map(o=>o.value),[2.5,'red','Yes',null]);
  assert.deepEqual(r.inputs[0].options,[{label:'flat'},{label:'steep'}]);
  assert.equal(r.inputs[0].value,1.25);assert.equal(r.logs[0],'t is 1.25');
  assert.equal(substitute('Wear {{color}}',{color:'red'}),'Wear red');
});
test('errors keep the user’s line number and any inputs already made',()=>{
  const r=executeCalc('const a = input("A", 1);\nconst b = input("B", 2);\nnope();');
  assert.equal(r.ok,false);assert.match(r.error,/^Line 3: ReferenceError: nope is not defined/);
  assert.equal(r.inputs.length,2);
  assert.match(executeCalc('input("A"); input("A");').error,/both labeled “A”/);
  assert.match(executeCalc('show("x", 1, "two words")').error,/one word/);
  assert.equal(executeCalc('const = ;').ok,false);
  assert.equal(executeCalc('vars.x = 1').ok,false,'vars is read-only');
});
test('js fences are calculations and round-trip through the editor',()=>{
  const md='# T\n\n```js\nshow("A", 1);\n\nshow("B", 2);\n```\n\n```javascript\nshow("C", 3)\n```\n\n```python\nprint(1)\n```\n';
  assert.deepEqual(parse(md).filter(b=>b.kind!=='heading').map(b=>b.kind),['js','js','code']);
  const rows=markdownToRows(md);
  assert.deepEqual(rows.map(r=>r.type),['heading','js','js','text']);
  assert.equal(rows[1].text,'show("A", 1);\n\nshow("B", 2);');
  assert.match(rowsToMarkdown(rows),/```js\nshow\("A", 1\);\n\nshow\("B", 2\);\n```/);
});

test('the sandbox script matches the hash the app’s security policy allows',async()=>{
  const {SANDBOX_SCRIPT,SANDBOX_HASH,SANDBOX_HTML}=await import('../web/jscalc.js');
  const crypto=await import('node:crypto');const fs=await import('node:fs');
  const hash='sha256-'+crypto.createHash('sha256').update(SANDBOX_SCRIPT,'utf8').digest('base64');
  assert.equal(SANDBOX_HASH,hash,'update SANDBOX_HASH and index.html after editing SANDBOX_SCRIPT');
  const index=fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
  assert.ok(index.includes(`'${hash}'`),'index.html Content-Security-Policy must allow the sandbox script');
  assert.match(index,/worker-src 'self' blob:/);
  assert.match(SANDBOX_HTML,/connect-src 'none'/);
});
test('syntax errors are reported',()=>{
  const r=executeCalc('const = 1;');
  assert.equal(r.ok,false);assert.match(r.error,/SyntaxError/);
});
