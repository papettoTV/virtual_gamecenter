import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseTicket,repairBudget,authorisedTicket,numericId,marker} from '../repair-ticket.mjs';
const base='a'.repeat(40),head='b'.repeat(40),now=Date.now();
const ticket={version:1,issue:124,pull:125,head,base,round:1,dispatcherRun:41500000000,diagnostics:[]};
const comment=t=>({user:{login:'github-actions[bot]',type:'Bot'},body:`<!-- ${marker} ${JSON.stringify(t)} -->\n開始`,issue_url:'https://api.github.com/repos/papettoTV/virtual_gamecenter/issues/124'});
test('人の偽ticket・本文への埋込・壊れたIDを拒否',()=>{
 assert.equal(numericId(41500000000),'41500000000');assert.ok(parseTicket(comment(ticket)));
 assert.equal(parseTicket({...comment(ticket),user:{login:'someone',type:'User'}}),null);
 assert.equal(parseTicket({...comment(ticket),body:'untrusted prefix '+comment(ticket).body}),null);
 assert.equal(parseTicket(comment({...ticket,round:4})),null);
 assert.throws(()=>numericId('../run'));
});
test('同じhead/baseを重複起動せず、上限3回を別headでも維持する',()=>{
 const scope={issue:124,pull:125,head,base};assert.equal(repairBudget([],scope).round,1);
 assert.equal(repairBudget([comment(ticket)],scope).reason,'duplicate-snapshot');
 const history=[1,2,3].map((round,i)=>comment({...ticket,head:String(i).repeat(40),round}));
 assert.equal(repairBudget(history,scope).reason,'repair-limit');
});
test('初回の信頼されたdevelop受付runと現在snapshotだけを許可',async()=>{
 const run={path:'.github/workflows/automatic-repair.yml',head_sha:base,head_repository:{full_name:'papettoTV/virtual_gamecenter'},event:'workflow_run',run_attempt:1,created_at:new Date(now).toISOString(),conclusion:null};
 const api=async p=>p.startsWith('issues/')?comment(ticket):run;
 assert.equal((await authorisedTicket(api,'6590000000',{issue:124,base,now})).pull,125);
 for(const patch of [{run_attempt:2},{path:'.github/workflows/web-checks.yml'},{head_sha:head},{created_at:new Date(now-3600000).toISOString()},{conclusion:'failure'}])await assert.rejects(authorisedTicket(async p=>p.startsWith('issues/')?comment(ticket):{...run,...patch},'6590000000',{issue:124,base,now}));
});
