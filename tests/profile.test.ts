import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerProfile,dayKey,dailyChallenge} from '../src/profile.ts';
const memory=()=>{const entries=new Map<string,string>();return {getItem:(k:string)=>entries.get(k)||null,setItem:(k:string,v:string)=>{entries.set(k,v);}};};
test('daily challenge uses Israel day and is identical for all players',()=>{
  assert.equal(dayKey(new Date('2026-10-13T22:00:00Z')),'2026-10-14');
  assert.deepEqual(dailyChallenge('2026-10-13'),dailyChallenge('2026-10-13'));
  assert.notEqual(dailyChallenge('2026-10-13').metric,dailyChallenge('2026-10-14').metric);
});
test('records persist, daily reward is claimable exactly once, and resets on the next day',()=>{
  const storage=memory(),p=new PlayerProfile(storage,4),day='2026-10-13',challenge=dailyChallenge(day);
  p.start(day);p.win();p.observe(1200,3,challenge.target-1,day);assert(!p.claim(day));
  p.observe(900,2,challenge.target,day);assert(p.claim(day));assert(!p.claim(day));
  const restored=new PlayerProfile(storage);assert.equal(restored.records.bestScore,1200);assert.equal(restored.records.highestLevel,3);assert.equal(restored.records.wins,5);assert(restored.claimed(day));
  restored.observe(0,1,0,'2026-10-14');assert.equal(restored.dailyProgress('2026-10-14'),0);assert(!restored.claim('2026-10-14'));
});
test('corrupt or unavailable storage does not break play or local record tracking',()=>{
  const broken={getItem:()=>'{bad json',setItem:()=>{throw Error('blocked');}};
  const p=new PlayerProfile(broken);p.start('2026-10-13');p.observe(350,2,40,'2026-10-13');assert.equal(p.records.bestScore,350);assert.equal(p.records.attempts,1);
  const session=new PlayerProfile();session.start();assert.equal(session.records.attempts,1);
});
