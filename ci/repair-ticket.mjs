import {assertSha,assertIssueNumber} from './policy.mjs';
export const marker='pulbase-auto-repair:v1';
const repo='papettoTV/virtual_gamecenter';
export function numericId(v){if(!/^[1-9][0-9]{0,19}$/.test(String(v))||!Number.isSafeInteger(Number(v)))throw Error('数値ID不正');return String(v);}
export function parseTicket(comment){
 if(comment?.user?.login!=='github-actions[bot]'||comment.user.type!=='Bot')return null;
 const match=String(comment.body??'').match(/^<!-- pulbase-auto-repair:v1 (\{[^\n]+\}) -->\n/);
 if(!match||Buffer.byteLength(match[1])>14000)return null;
 try{const t=JSON.parse(match[1]);assertIssueNumber(t.issue);assertIssueNumber(t.pull);numericId(t.dispatcherRun);assertSha(t.head);assertSha(t.base);
  if(t.version!==1||!Number.isSafeInteger(t.round)||t.round<1||t.round>3||!Array.isArray(t.diagnostics)||Buffer.byteLength(JSON.stringify(t.diagnostics))>10000)return null;return t;
 }catch{return null;}
}
export function repairBudget(comments,{issue,pull,head,base}){
 const tickets=comments.map(parseTicket).filter(x=>x&&x.issue===Number(issue)&&x.pull===Number(pull));
 if(tickets.some(t=>t.head===head&&t.base===base))return {eligible:false,reason:'duplicate-snapshot'};
 if(tickets.length>=3)return {eligible:false,reason:'repair-limit'};
 return {eligible:true,round:tickets.length+1};
}
export async function authorisedTicket(api,commentId,{issue,base,now=Date.now()}){
 numericId(commentId);const comment=await api(`issues/comments/${commentId}`),ticket=parseTicket(comment);
 if(!ticket||ticket.issue!==Number(issue)||ticket.base!==base||!comment.issue_url?.endsWith(`/issues/${issue}`))throw Error('修正ticketの対象・発行元が不一致です');
 const run=await api(`actions/runs/${ticket.dispatcherRun}`),at=Date.parse(run.created_at);
 if(run.path!=='.github/workflows/automatic-repair.yml'||run.head_sha!==base||run.head_repository?.full_name!==repo||!['workflow_run','issues','workflow_dispatch','push'].includes(run.event)||run.run_attempt!==1||!Number.isFinite(at)||at>now+30000||now-at>1800000||run.conclusion&&run.conclusion!=='success')throw Error('信頼された初回の修正受付runを確認できません');
 return ticket;
}
