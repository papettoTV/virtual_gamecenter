import {expect,it} from 'vitest';
import {cometMotion} from '../../src/games/mochi-beat/duel/DotScene';
it('grows a tail, keeps it through a hold, and lets its end reach the shield',()=>{
 expect(cometMotion(.5,1.5)).toEqual({head:.5,length:204});
 expect(cometMotion(1,1.5)).toEqual({head:1,length:408});
 expect(cometMotion(2,1.5)).toEqual({head:1,length:204});
 expect(cometMotion(2.5,1.5)).toEqual({head:1,length:0});
 expect(cometMotion(.75,.5).length).toBeLessThan(cometMotion(.75,1.5).length);
});
