import { afterEach, expect, it, vi } from 'vitest';
import { freshScore, scoreNote, scoreChart, comboMultiplier, awardBossBonus, readBest, saveBest } from '../../src/games/dot-wave/duel/score';
import { createExchange, tap, release, expire } from '../../src/games/dot-wave/duel/core';
import { freshDuel, advanceCampaign } from '../../src/games/dot-wave/duel/campaign';
afterEach(() => vi.unstubAllGlobals());
it('uses the current combo for three-note multiplier steps, caps at two, and keeps counting', () => {
  const score = freshScore();
  scoreNote(score, 'perfect'); scoreNote(score, 'good'); scoreNote(score, 'perfect');
  expect(score).toMatchObject({total:260, combo:3, maxCombo:3});
  for (let i=3;i<33;i++) scoreNote(score,'perfect');
  expect(score.combo).toBe(33);
  expect(comboMultiplier(29)).toBe(1.9); expect(comboMultiplier(30)).toBe(2); expect(comboMultiplier(100)).toBe(2);
  const total=score.total; scoreNote(score,'miss'); scoreNote(score,'good');
  expect(score).toMatchObject({total:total+50,combo:1,maxCombo:33});
});
it('scores holds only at successful release and consumes each final note once', () => {
  const score=freshScore(), e=createExchange(0,15,.5);
  tap(e,0,2.05); scoreChart(score,e.attack); expect(score.total).toBe(0);
  release(e,0,2.5); scoreChart(score,e.attack); scoreChart(score,e.attack);
  expect(score).toMatchObject({total:100,combo:1});
});
it('breaks combos on misses, extra taps and failed holds, but ignores wrong turns', () => {
  const score=freshScore(), e=createExchange(0,0,.5);
  tap(e,0,2); scoreChart(score,e.attack);
  tap(e,1,2); scoreChart(score,e.attack); expect(score.combo).toBe(1);
  tap(e,0,2); scoreChart(score,e.attack); expect(score.combo).toBe(0);
  tap(e,0,3); scoreChart(score,e.attack); // expires the missed note before this success
  expect(score.combo).toBe(1);
  const hold=createExchange(0,15,.5); tap(hold,0,2); release(hold,0,2.1); scoreChart(score,hold.attack);
  expect(score.combo).toBe(0);
  const late=createExchange(0,15,.5); tap(late,0,2); expire(late.attack,3,.5); scoreChart(score,late.attack);
  expect(score.total).toBe(200);
});
it('preserves score across bosses, awards unmultiplied HP bonuses and resets on retry', () => {
  const e=freshDuel(); e.score=freshScore();
  for(let i=0;i<30;i++) scoreNote(e.score,'perfect');
  const rhythmTotal=e.score.total; awardBossBonus(e.score,80);
  expect(e.score.total).toBe(rhythmTotal+400);
  e.phase='finished';e.match.winner=0;
  const next=advanceCampaign(e)!;
  expect(next.score).toEqual(e.score); expect(next.score).not.toBe(e.score);
  expect(next.match.hp).toEqual([100,100]);
  expect(freshDuel().score).toEqual(freshScore());
});
it('keeps browser bests separate by ending and tolerates unavailable storage', () => {
  const values=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
  expect(saveBest('limited',1200)).toBe(1200); expect(saveBest('limited',100)).toBe(1200);
  expect(readBest('knockout')).toBe(0);
  vi.stubGlobal('localStorage',{getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}});
  expect(readBest('limited')).toBe(0);expect(saveBest('limited',500)).toBe(500);
});

it('retains active play time across stages and resets it on a new course', () => {
  const e=freshDuel(); e.elapsedPlayMs=45000; e.phase='finished'; e.match.winner=0;
  expect(advanceCampaign(e)?.elapsedPlayMs).toBe(45000);
  expect(freshDuel().elapsedPlayMs).toBe(0);
});
