import {expect,it} from 'vitest';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {musicStage,visibleMusicStage} from '../../src/games/mochi-beat/duel/musicMood';
import {MusicBackdrop} from '../../src/games/mochi-beat/duel/DotScene';
import type {Resolution} from '../../src/games/mochi-beat/duel/core';
const round=(a:number,d:number):Resolution=>({attacker:0,power:22,damage:0,blocked:22,counter:false,attackQuality:a,defenseQuality:d});
it('builds from both players and accepts mostly good timing',()=>{
 expect(musicStage([])).toBe(0);
 expect(musicStage([round(.6,.6)])).toBe(1);
 expect(musicStage([round(.6,.6),round(.6,.6)])).toBe(2);
 expect(musicStage([round(1,0),round(0,1)])).toBe(1);
});
it('does not drop on one poor round and fades one layer at a time',()=>{
 const h=[round(1,1),round(1,1)];
 h.push(round(0,0));expect(musicStage(h)).toBe(2);
 h.push(round(0,0));expect(musicStage(h)).toBe(1);
 h.push(round(0,0));expect(musicStage(h)).toBe(1);
 h.push(round(0,0));expect(musicStage(h)).toBe(0);
 h.push(round(.6,.6));expect(musicStage(h)).toBe(1);
});
it('changes at the next four-beat boundary and is reproducible from spectator snapshots',()=>{
 const h=[round(1,1),round(1,1)];
 expect(visibleMusicStage(h,3.99)).toBe(1);
 expect(visibleMusicStage(h,4)).toBe(2);
 expect(visibleMusicStage(JSON.parse(JSON.stringify(h)),4)).toBe(2);
 const original=JSON.stringify(h);musicStage(h);expect(JSON.stringify(h)).toBe(original);
});
it('adds only background decorations at each stage',()=>{
 const draw=(stage:0|1|2)=>renderToStaticMarkup(createElement(MusicBackdrop,{stage,beat:4}));
 expect(draw(0)).toBe('');expect(draw(1)).toContain('床の光');expect(draw(2)).toContain('伴奏');
 expect(draw(2).match(/<rect/g)!.length).toBeGreaterThan(draw(1).match(/<rect/g)!.length);
});
