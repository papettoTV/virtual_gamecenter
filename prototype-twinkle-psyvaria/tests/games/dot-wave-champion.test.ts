import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {PlayerRoster,crownTier} from '../../src/games/mochi-beat/duel/PlayerRoster';
it('uses three crown tiers and renders names safely without a crown for CPU',()=>{
 expect([0,1,2,3,4,5,20].map(crownTier)).toEqual([0,1,1,2,2,3,3]);
 const html=renderToStaticMarkup(createElement(PlayerRoster,{players:[{name:'<img src=x>',wins:5},{name:'CPU',wins:0}],entrance:true}));
 expect(html).toContain('&lt;img src=x&gt;');
 expect(html).not.toContain('<img');
 expect(html.match(/チャンピオンの王冠/g)).toHaveLength(1);
 expect(html).toContain('tier-3');
 expect(html).toContain('連勝');
 expect(html).toContain('CPU');
});
