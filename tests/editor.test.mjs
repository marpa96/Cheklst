import test from 'node:test';import assert from 'node:assert/strict';
import {markdownToRows,rowsToMarkdown,moveRow} from '../web/editor.js';
test('rows round-trip through Markdown without losing unmodeled content',()=>{
  const md='## Packing\n\n- [ ] Socks\n  - [ ] Wool ones\n- [ ] Shoes\n\n> [!TIP]\n> Roll clothes\n\n> Plain note\n\n```calc\ninput a = 1 | A\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
  const rows=markdownToRows(md);
  assert.deepEqual(rows.map(r=>r.type),['heading','item','item','item','note','note','calc','text']);
  assert.equal(rows[2].depth,1);assert.equal(rows[4].callout,'tip');
  assert.equal(rowsToMarkdown(rows),md);
  assert.deepEqual(markdownToRows(rowsToMarkdown(rows)),rows);
});
test('empty rows are dropped; moving rows',()=>{
  assert.equal(rowsToMarkdown([{type:'item',text:'a',depth:0},{type:'item',text:'  ',depth:0},{type:'heading',text:''}]),'- [ ] a\n');
  const rows=[{type:'item',text:'a'},{type:'item',text:'b'}];
  assert.deepEqual(moveRow(rows,0,1).map(r=>r.text),['b','a']);assert.equal(moveRow(rows,0,-1),rows);
});
