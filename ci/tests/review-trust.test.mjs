import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {trustPolicy,verifyReviewTrust} from '../control/review-trust.mjs';
const policy=JSON.parse(await readFile(new URL('../control/review-trust.json',import.meta.url),'utf8'));
const now=Date.parse('2026-10-25T02:00:00Z'), repo='papettoTV/virtual_gamecenter';
function fixture(){
 const receipt={head:'a'.repeat(40),base:'b'.repeat(40),candidate:'c'.repeat(40),reviewRun:'10',buildRun:'20',pullNumber:'44'};
 const pr={number:44,base:{ref:'develop',sha:receipt.base,repo:{url:`https://api.github.com/repos/${repo}`}},head:{sha:receipt.head,repo:{url:`https://api.github.com/repos/${repo}`}}};
 const runs={10:{id:10,path:'.github/workflows/codex-pr.yml'},20:{id:20,path:'.github/workflows/web-checks.yml'}};
 for(const r of Object.values(runs))Object.assign(r,{created_at:'2026-10-25T01:00:00Z',pull_requests:[structuredClone(pr)],head_sha:receipt.head,event:'pull_request',head_repository:{full_name:repo},status:'completed',conclusion:'success',run_attempt:1});
 const trees=Object.fromEntries([receipt.base,receipt.head,receipt.candidate].map(s=>[s,{truncated:false,tree:Object.entries(policy.files).map(([path,sha])=>({path,sha,type:'blob',mode:'100644'}))}]));
 const api=async path=>path.startsWith('actions/runs/')?runs[path.split('/')[2]]:trees[path.split('/')[2].split('?')[0]];
 return {receipt,runs,trees,api};
}
test('実行時のPR snapshotとbase/head/候補の固定定義すべてが一致した場合だけ信頼',async()=>{
 const f=fixture(),r=await verifyReviewTrust(f.api,f.receipt,policy,now);assert.equal(r.reviewTrustVerified,true);assert.match(r.policyDigest,/^[a-f0-9]{64}$/);
});
test('定義の1ファイルでもどのrevisionでも改変・欠落・リンクなら拒否',async()=>{
 for(const revision of ['base','head','candidate'])for(const mutate of [t=>t.tree[0].sha='e'.repeat(40),t=>t.tree.shift(),t=>t.tree[0].mode='120000']){
 const f=fixture();mutate(f.trees[f.receipt[revision]]);await assert.rejects(verifyReviewTrust(f.api,f.receipt,policy,now));}
});
test('runのPR snapshot欠落・古いbase・別head・別repo・rerun・期限切れを拒否',async()=>{
 for(const mutate of [r=>r.pull_requests=[],r=>r.pull_requests[0].base.sha='e'.repeat(40),r=>r.pull_requests[0].head.sha='e'.repeat(40),r=>r.pull_requests[0].head.repo.url='https://api.github.com/repos/other/repo',r=>r.run_attempt=2,r=>r.created_at='2026-10-23T00:00:00Z',r=>r.path='.github/workflows/fake.yml']){
 const f=fixture();mutate(f.runs[10]);await assert.rejects(verifyReviewTrust(f.api,f.receipt,policy,now));}
});
test('後付けagent設定・取得不完全・空の信頼定義を拒否',async()=>{
 const f=fixture();f.trees[f.receipt.head].tree.push({path:'.codex/config.toml',sha:'e'.repeat(40),type:'blob',mode:'100644'});await assert.rejects(verifyReviewTrust(f.api,f.receipt,policy,now));
 const g=fixture();g.trees[g.receipt.base].truncated=true;await assert.rejects(verifyReviewTrust(g.api,g.receipt,policy,now));assert.throws(()=>trustPolicy({...policy,files:{}}));
});
