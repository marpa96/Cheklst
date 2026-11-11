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

test('logic words, yes/no, multi-line formulas and || inside calc lines',()=>{
  const body=`input temp = 70 | Temperature
input strenuous = no | Strenuous?
let rate = if(temp >= 85 or strenuous, 1,
              if(temp >= 75, 0.75, 0.5))
show a = if(temp >= 85 || strenuous, 1, 0) | A
show liters = round(4 * rate * 1.2, 1) | Liters`;
  let r=runCalcs([{kind:'calc',line:0,body}]).results[0];
  assert.equal(r.error,null);
  assert.deepEqual(r.outputs.map(o=>o.value),[0,2.4]);
  assert.deepEqual(r.inputs.map(i=>[i.type,i.raw,i.value]),[['number','70',70],['bool','no',0]]);
  r=runCalcs([{kind:'calc',line:0,body}],{strenuous:'yes'}).results[0];
  assert.deepEqual(r.outputs.map(o=>o.value),[1,4.8]);
  assert.equal(evaluate('not yes and true',{}),0);
});
test('choice inputs use the chosen option’s number',()=>{
  const body='input terrain = moderate | Terrain | flat: 1, moderate: 1.1, steep: 1.25\ninput mood = | Mood | calm, busy\nshow f = terrain | F\nshow m = mood | M';
  let r=runCalcs([{kind:'calc',line:0,body}]).results[0];
  assert.deepEqual(r.outputs.map(o=>o.value),[1.1,1],'blank default picks the first; bare names number from 1');
  r=runCalcs([{kind:'calc',line:0,body}],{terrain:'Steep',mood:'busy'}).results[0];
  assert.deepEqual(r.outputs.map(o=>o.value),[1.25,2]);
  assert.throws(()=>parseCalc('input t = rocky | T | flat: 1, steep: 2'),/isn’t one of the options/);
  assert.throws(()=>parseCalc('let t = 1 | T | a: 1, b: 2'),/only inputs/);
});
test('new functions',()=>{
  assert.equal(evaluate('clamp(12, 0, 10)'),10);
  assert.equal(evaluate('interpolate(77.5, 65, 0.5, 90, 1)'),0.75);
  assert.equal(evaluate('interpolate(100, 65, 0.5, 90, 1)'),1,'held flat beyond the range');
  assert.equal(evaluate('sum(1,2,3) + avg(2,4)'),9);
  assert.equal(evaluate('round(sin(30), 6)'),0.5);
  assert.equal(evaluate('log(1000)'),3);
});
test('show can display or refine a let; failed lets explain themselves',()=>{
  let r=runCalcs([{kind:'calc',line:0,body:'input length = 10 | L\ninput speed = 2.5 | S\nlet hours = length / speed\nshow hours = round(hours, 1) | Hours\nshow h2 | Again'}]).results[0];
  assert.equal(r.error,null);assert.equal(r.outputs[0].value,4);
  r=runCalcs([{kind:'calc',line:0,body:'let hours = 4\nshow hours | Hours'}]).results[0];
  assert.equal(r.outputs[0].value,4);
  r=runCalcs([{kind:'calc',line:0,body:'input x = 1 | X\nlet rate = if(x > 0, 1\nshow out = rate * 2 | Out'}]).results[0];
  assert.match(r.problems[0].error,/Expected/);
  assert.match(r.outputs[0].error,/needs “rate”, which couldn’t be calculated/);
  assert.throws(()=>parseCalc('input and = 1 | A'),/built-in/);
});
