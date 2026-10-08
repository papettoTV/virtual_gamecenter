import {expect,it} from 'vitest';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {musicStage,visibleMusicStage} from '../../src/games/dot-wave/duel/musicMood';
import {MusicBackdrop} from '../../src/games/dot-wave/duel/DotScene';
import type {Resolution} from '../../src/games/dot-wave/duel/core';
const round=(a:number,d:number):Resolution=>({attacker:0,power:22,damage:0,blocked:22,counter:false,attackQuality:a,defenseQuality:d});
const rounds=(count:number,a:number,d:number):Resolution[]=>Array.from({length:count},(_,i)=>({...round(a,d),attacker:i%2 as 0|1}));
it('builds the base layer over at least three exchanges and never unlocks the top with good-only timing',()=>{
 expect(musicStage([])).toBe(0);
 expect(musicStage(rounds(2,1,1))).toBe(0);
 expect(musicStage(rounds(3,.6,.6))).toBe(1);
 expect(musicStage(rounds(20,.6,.6))).toBe(1);
 expect(musicStage(rounds(5,1,0))).toBe(0);
 expect(musicStage(rounds(6,1,0))).toBe(1);
});
it('requires six recent exchanges of skilled play by the same player across both roles',()=>{
 expect(musicStage(rounds(5,1,1))).toBe(1);
 for(const side of [0,1] as const) {
  const skilled=rounds(6,.6,.6).map(r=>({...r,...(r.attacker===side?{attackQuality:.85}:{defenseQuality:.85})}));
  expect(musicStage(skilled.slice(0,5))).toBe(1);
  expect(musicStage(skilled)).toBe(2);
 }
 expect(musicStage(rounds(6,.84,.84))).toBe(1);
 expect(musicStage(rounds(6,1,.6))).toBe(1);
 // Earlier weak play leaves the rolling window after six skilled exchanges.
 expect(musicStage([...rounds(10,.6,.6),...rounds(6,.9,.9)])).toBe(2);
});
it('keeps an earned top layer through ordinary play and fades one layer per two poor exchanges',()=>{
 const h=[...rounds(6,1,1),...rounds(6,.6,.6)];
 expect(musicStage(h)).toBe(2);
 h.push(round(0,0));expect(musicStage(h)).toBe(2);
 h.push(round(0,0));expect(musicStage(h)).toBe(1);
 h.push(round(0,0));expect(musicStage(h)).toBe(1);
 h.push(round(0,0));expect(musicStage(h)).toBe(0);
 h.push(...rounds(3,.6,.6));expect(musicStage(h)).toBe(1);
 h.push(...rounds(3,.6,.6));expect(musicStage(h)).toBe(1);
 h.push(...rounds(6,1,1));expect(musicStage(h)).toBe(2);
});
it('changes at the next four-beat boundary and is reproducible from spectator snapshots',()=>{
 for(const count of [3,6]) {
  const h=rounds(count,1,1);
  expect(visibleMusicStage(h,3.99)).toBe(count===3?0:1);
  expect(visibleMusicStage(h,4)).toBe(count===3?1:2);
  expect(visibleMusicStage(JSON.parse(JSON.stringify(h)),4)).toBe(visibleMusicStage(h,4));
  const original=JSON.stringify(h);musicStage(h);expect(JSON.stringify(h)).toBe(original);
 }
});
it('adds only background decorations at each stage',()=>{
 const draw=(stage:0|1|2)=>renderToStaticMarkup(createElement(MusicBackdrop,{stage,beat:4}));
 expect(draw(0)).toBe('');expect(draw(1)).toContain('床の光');expect(draw(2)).toContain('伴奏');
 expect(draw(2).match(/<rect/g)!.length).toBeGreaterThan(draw(1).match(/<rect/g)!.length);
});
