import test from 'node:test';import assert from 'node:assert/strict';
import {evaluate,parseCalc,runCalcs,substitute,format} from '../web/calc.js';
import {parse} from '../web/core.js';
test('arithmetic, precedence, functions, comparisons',()=>{
  assert.equal(evaluate('1 + 2 * 3'),7);
  assert.equal(evaluate('(1 + 2) * 3'),9);
  assert.equal(evaluate('2 ^ 3 ^ 2'),512);
  assert.equal(evaluate('-2 ^ 2'),-4);
  assert.equal(evaluate('10 % 4'),2);
  assert.equal(evaluate('round(2.345, 2)'),2.35);
  assert.equal(evaluate('max(1, x, 3)',{x:5}),5);
  assert.equal(evaluate('if(t >= 85, 1, 0.5)',{t:90}),1);
  assert.equal(evaluate('1 < 2 && 2 < 1'),0);
  assert.equal(evaluate('pi > 3'),1);
});
test('evaluator rejects code and bad input',()=>{
  for(const bad of ['alert(1)','constructor','x.y','1 +','"a"','a=1','1/0','sqrt(-1)'])assert.throws(()=>evaluate(bad),bad);
  assert.throws(()=>evaluate('__proto__'));
});
test('calc block parsing',()=>{
  const def=parseCalc('title Fuel\n// comment\ninput d = 100 | Distance\nlet g = d / 25\nshow c = g * 3 | Cost');
  assert.equal(def.title,'Fuel');assert.equal(def.lines.length,3);assert.equal(def.lines[0].label,'Distance');
  assert.throws(()=>parseCalc('input a = 1\ninput a = 2'),/twice/);
  assert.throws(()=>parseCalc('input round = 1'),/built-in/);
  assert.throws(()=>parseCalc('input a = abc'),/number/);
  assert.throws(()=>parseCalc('show a ='),/formula/);
  assert.throws(()=>parseCalc('whatever'),/line 1/);
});
test('blocks share variables; saved inputs override defaults; errors stay local',()=>{
  const md='```calc\ninput d = 100\nlet g = d / 25\n```\n\n- [ ] Need {{c}}\n\n```calc\nshow c = g * 3 | Cost\nshow bad = nope + 1 | Bad\n```\n';
  let {vars,results}=runCalcs(parse(md));
  assert.equal(vars.c,12);
  assert.equal(Object.values(results)[1].outputs[1].error,'“nope” has no value yet.');
  ({vars}=runCalcs(parse(md),{d:'250'}));assert.equal(vars.c,30);
  const r=runCalcs(parse(md),{d:'x'});assert.equal(Object.values(r.results)[0].inputs[0].error,'Not a number.');assert.equal(r.vars.c,undefined);
  assert.equal(substitute('Need {{ c }} and {{zz}}',{c:12.5}),'Need 12.5 and zz?');
  assert.equal(format(1234.56789),(1234.5679).toLocaleString(undefined,{maximumFractionDigits:4}));
});
