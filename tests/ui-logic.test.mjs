import test from 'node:test';import assert from 'node:assert/strict';
import {detectTimer,detectCount,clock,stepFor,stepValue} from '../web/widgets.js';
import {palette,phase,hueFor} from '../web/ambient.js';
import {score,filterItems} from '../web/command.js';

test('timers are detected from durations in item text',()=>{
  assert.equal(detectTimer('Let the engine idle 2 min').seconds,120);
  assert.equal(detectTimer('Simmer for 1.5 hours').seconds,5400);
  assert.equal(detectTimer('Rest 30m').seconds,1800);
  assert.equal(detectTimer('Stretch 1h 30m').seconds,5400);
  assert.equal(detectTimer('Hold for 45 seconds').seconds,45);
  assert.equal(detectTimer('Walk 100 m to the trailhead'),null,'meters are not minutes');
  assert.equal(detectTimer('Pack 3 shirts'),null);
  assert.equal(detectTimer('Wait 2 s'),null,'too short and spaced single letter');
  assert.equal(detectTimer('Soak 48 hours'),null,'over a day');
});
test('counters are detected from quantities',()=>{
  assert.deepEqual(detectCount('3 pairs of socks'),{target:3});
  assert.deepEqual(detectCount('Water bottle ×2'),{target:2});
  assert.deepEqual(detectCount('Snacks x 4'),{target:4});
  assert.equal(detectCount('1 toothbrush'),null);
  assert.equal(detectCount('10 minutes of stretching'),null,'a duration is a timer');
  assert.equal(detectCount('Check oil'),null);
  assert.equal(detectCount('2026 tax forms'),null);
});
test('clock and stepper math',()=>{
  assert.equal(clock(65),'1:05');assert.equal(clock(3725),'1:02:05');assert.equal(clock(-3),'0:00');
  assert.equal(stepFor('3.50'),0.01);assert.equal(stepFor('30'),1);assert.equal(stepFor('900'),10);assert.equal(stepFor('12000'),100);
  assert.equal(stepValue('3.50',1),'3.51');assert.equal(stepValue('30',-1),'29');assert.equal(stepValue('900',3,10),'930');assert.equal(stepValue('1,200',1,100),'1300');
});
test('time-of-day palette and category hues',()=>{
  const at=h=>new Date(2026,0,1,h,0);
  for(let h=0;h<24;h++){const p=palette(at(h));assert.equal(p.length,3);p.forEach(x=>assert.ok(x>=0&&x<360));}
  assert.notDeepEqual(palette(at(7)),palette(at(23)));
  assert.equal(phase(at(8)).greeting,'Good morning');assert.equal(phase(at(19)).greeting,'Good evening');
  assert.equal(hueFor('Travel'),hueFor('travel'));assert.ok(hueFor('Travel')!==hueFor('Hiking'));
});
test('command menu fuzzy matching ranks sensibly',()=>{
  assert.ok(score('pack','Packing list')>score('pack','Before leaving home'));
  assert.ok(score('rtp','Road trip prep')>0);
  assert.equal(score('zzz','Road trip prep'),0);
  const items=[{label:'Day hike',order:0},{label:'Road trip prep',order:1},{label:'Monthly home check',order:2}];
  assert.deepEqual(filterItems(items,'home').map(x=>x.label),['Monthly home check']);
  assert.equal(filterItems(items,'').length,3);
});
