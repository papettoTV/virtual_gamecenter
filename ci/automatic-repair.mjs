// Trusted develop coordinator. No checkout/execute of PR code, no deployment keys.
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {assertAutomatedPr,assertChanges,assertIssueNumber,assertSha} from './policy.mjs';
import {assertAutomaticAssignment,issueImplementationMode} from './issue-routing.mjs';
import {collectDiagnostics,boundedDiagnostics,safeText} from './repair-diagnostics.mjs';
import {repairBudget,marker,numericId} from './repair-ticket.mjs';
const repository='papettoTV/virtual_gamecenter';
export async function coordinateRepair({github,repo,event,eventName,runId,bot,actor,definitionSha,diagnostics,notify,dispatch,now=Date.now()}){
 if(repo.owner+'/'+repo.repo!==repository)throw Error('別repoは対象外');
 let issue,pull,source=event.workflow_run;
 if(eventName==='workflow_run'){
  if(!['success','failure'].includes(source?.conclusion)||source.run_attempt!==1||source.head_repository?.full_name!==repository||!['pull_request','workflow_dispatch','issues'].includes(source.event))return {status:'ignored',reason:'source-not-eligible'};
  if(source.path==='.github/workflows/codex-issue.yml'){
   const match=String(source.display_title??'').match(/^Issue #([1-9][0-9]*) の自動実装$/);if(!match)return {status:'ignored',reason:'source-issue-unknown'};issue=assertIssueNumber(match[1]);
  }else{
   if(!['.github/workflows/web-checks.yml','.github/workflows/codex-pr.yml'].includes(source.path))return {status:'ignored',reason:'source-workflow'};
   const match=String(source.head_branch??'').match(/^codex\/issue-([1-9][0-9]*)$/);if(!match)return {status:'ignored',reason:'source-branch'};issue=assertIssueNumber(match[1]);
  }
 }else if(eventName==='push'){
  if(event.ref!=='refs/heads/develop')return {status:'ignored',reason:'not-develop'};issue=assertIssueNumber(event.inputs?.issue);
 }else if(eventName==='issues'){
  if(event.action!=='labeled'||event.label?.name!=='実装:再開')return {status:'ignored',reason:'not-resume'};issue=assertIssueNumber(event.issue?.number);
 }else if(eventName==='workflow_dispatch')issue=assertIssueNumber(event.inputs?.issue);
 else return {status:'ignored',reason:'event'};
 if(!['workflow_run','push'].includes(eventName)){const {data:permission}=await github.rest.repos.getCollaboratorPermissionLevel({...repo,username:actor});if(!['admin','maintain','write'].includes(permission.permission))throw Error('修正の明示起動はwrite以上の担当者だけです');}
 const prs=await github.paginate(github.rest.pulls.list,{...repo,state:'open',head:`${repo.owner}:codex/issue-${issue}`,per_page:100});
 if(prs.length===0)return {status:'ignored',reason:'no-open-target'};
 if(prs.length!==1)throw Error('既存の自動PRを一意に確認できません');
 ({data:pull}=await github.rest.pulls.get({...repo,pull_number:prs[0].number}));assertAutomatedPr(pull,{repository,bot});
 await assertAutomaticAssignment({github,repo,issueNumber:issue,exceptPullNumber:pull.number});
 assertChanges(await github.paginate(github.rest.pulls.listFiles,{...repo,pull_number:pull.number,per_page:100}));
 if(source&&source.path!=='.github/workflows/codex-issue.yml'&&source.head_sha!==pull.head.sha)return {status:'ignored',reason:'stale-head'};
 const {data:branch}=await github.rest.repos.getBranch({...repo,branch:'develop'});const base=assertSha(branch.commit.sha),head=pull.head.sha;
 if(definitionSha&&definitionSha!==base)return {status:'ignored',reason:'trusted-base-moved'};
 if(eventName==='push'&&event.after!==base)return {status:'ignored',reason:'stale-develop-push'};
 let baseIncluded=pull.base.sha===base&&pull.mergeable===true;
 if(github.rest.repos.compareCommitsWithBasehead){const {data:comparison}=await github.rest.repos.compareCommitsWithBasehead({...repo,basehead:`${base}...${head}`});baseIncluded=comparison.merge_base_commit?.sha===base;}
 const {data:comments}=await github.rest.issues.listComments({...repo,issue_number:issue,per_page:100});if(comments.length>=100)throw Error('修正履歴が過大です');
 const budget=repairBudget(comments,{issue,pull:pull.number,head,base});
 if(!budget.eligible){
  if(budget.reason==='repair-limit'&&!comments.some(c=>c.user?.login==='github-actions[bot]'&&c.body?.startsWith(`<!-- pulbase-repair-stop:${issue}:${head}:${base} -->`)))await notify(issue,`<!-- pulbase-repair-stop:${issue}:${head}:${base} -->\n自動修正を3回実施したため停止しました。既存PR #${pull.number}の残る失敗を確認してください。承認・保護は維持しています。`);
  return {status:'stopped',reason:budget.reason,issue,pull:pull.number};
 }
 const result=await diagnostics(pull);
 const needsSync=!baseIncluded;
 if(!result.ready&&!(result.reason==='missing-ci'&&needsSync))return {status:'waiting',reason:'checks-in-progress',issue,pull:pull.number};
 if(!result.failed&&!needsSync)return {status:'ignored',reason:'no-repair-needed'};
 if(result.failed&&!needsSync&&!result.entries.some(x=>['ui','unit','review'].includes(x.kind))){
  const key=`<!-- pulbase-repair-stop:${issue}:${head}:${base}:diagnostics -->`;
  if(!comments.some(c=>c.user?.login==='github-actions[bot]'&&c.body?.startsWith(key)))await notify(issue,`${key}\n自動修正に必要なアプリ検査・レビュー診断を取得できませんでした。実行環境・API利用枠・保護対象の失敗を確認してください。失敗を無視したマージや盲目的な再試行は行いません。`);
  return {status:'stopped',reason:'diagnostic-unavailable',issue,pull:pull.number};
 }
 const entries=boundedDiagnostics([...(result.entries??[]),...(needsSync?[{kind:'synchronization',message:'最新developとの同期・アプリ内競合を解消し、その候補でCIと独立レビューを最初から確認してください。'}]:[])]);
 const ticket={version:1,issue,pull:pull.number,head,base,round:budget.round,dispatcherRun:Number(runId),sourceRun:source?.id??null,diagnostics:entries,createdAt:now};
 const {data:fresh}=await github.rest.pulls.get({...repo,pull_number:pull.number});
 const {data:latest}=await github.rest.repos.getBranch({...repo,branch:'develop'});
 if(fresh.head.sha!==head||latest.commit.sha!==base)throw Error('受付中にhead/baseが変更されました');
 const details=entries.slice(0,5).map(x=>`- ${x.kind} ${x.file??''} ${x.title??''}: ${safeText(x.message,250).replaceAll('\n',' ')}`).join('\n');
 const comment=await notify(issue,`<!-- ${marker} ${JSON.stringify(ticket)} -->\nPR #${pull.number}の同じブランチで自動修正 ${budget.round}/3 を開始します。対象head: ${head}、develop: ${base}。CI/レビュー診断${entries.length}件を引き継ぎ、同期・アプリ内競合も隔離環境で処理します。staging承認・strict・公開権限は変更しません。\n\n${details}`);
 await dispatch({issue:String(issue),resume:true,repair_ticket:String(comment.id)});
 return {status:'dispatched',issue,pull:pull.number,head,base,round:budget.round,commentId:comment.id};
}
export async function repairBatch(prs,{issue,execute,notify}){
 const results=[];
 for(const pr of prs){
  const number=assertIssueNumber(pr.head.ref.replace('codex/issue-',''));let active=false;
  try{
   const current=await issue(number);
   if(current.state!=='open'||issueImplementationMode(current)!=='automatic'){results.push({status:'ignored',issue:number,reason:'closed-or-manual'});continue;}
   active=true;results.push(await execute(number));
  }catch{
   if(active)try{await notify(number,`PR #${pr.number}の自動修正受付が停止しました。担当・head/base・許可範囲・実行結果を確認してください。他のIssueの修正は継続します。`);}catch{}
   results.push({status:'stopped',issue:number,pull:pr.number,reason:'target-check-failed'});
  }
 }
 return results;
}
export function readPorts(token){
 if(!token)throw Error('読取認証がありません');
 const api=async path=>{
  if(!/^(?:actions\/(?:runs(?:\?head_sha=[a-f0-9]{40}&event=pull_request&per_page=100|\/[1-9][0-9]*(?:\/(?:jobs\?filter=latest&per_page=100|artifacts\?per_page=100))?)|artifacts\/[1-9][0-9]*\/zip)|issues\/comments\/[1-9][0-9]*)$/.test(path))throw Error('対象外の診断API');
  const r=await fetch(`https://api.github.com/repos/${repository}/${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok){await r.body?.cancel();throw Error('診断APIの読み取りに失敗しました');}return r.json();
 };
 const get=(path,maxBuffer)=>execFileSync('gh',['api',`repos/${repository}/${path}`],{env:{PATH:process.env.PATH,HOME:process.env.HOME,GH_HOST:'github.com',GH_TOKEN:token},maxBuffer,timeout:20000,stdio:['ignore','pipe','pipe']});
 return {api,artifact:id=>get(`actions/artifacts/${numericId(id)}/zip`,262144000),log:id=>get(`actions/jobs/${numericId(id)}/logs`,16*1024*1024).toString('utf8')};
}
// Runtime is invoked by github-script with its authenticated, trusted API client.
export async function runCoordinator({github,context,core}){
 try{
  if(context.ref!=='refs/heads/develop'||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('developの初回受付だけを許可します');
  const ports=readPorts(process.env.GH_TOKEN);
  const execute=event=>coordinateRepair({github,repo:context.repo,event,eventName:context.eventName,runId:context.runId,bot:process.env.AUTOMATION_BOT,actor:context.actor,definitionSha:context.sha,
   diagnostics:pr=>collectDiagnostics(ports,pr),notify:async(issue,body)=>(await github.rest.issues.createComment({...context.repo,issue_number:issue,body})).data,
   dispatch:inputs=>github.rest.actions.createWorkflowDispatch({...context.repo,workflow_id:'codex-issue.yml',ref:'develop',inputs})});
  let result;
  if(context.eventName==='push'){
   const prs=await github.paginate(github.rest.pulls.list,{...context.repo,state:'open',base:'develop',per_page:100});
   const targets=prs.filter(p=>p.user?.login===process.env.AUTOMATION_BOT&&/^codex\/issue-[1-9][0-9]*$/.test(p.head?.ref??''));
   if(targets.length>20)throw Error('同期対象が過大です');
   result=await repairBatch(targets,{issue:async n=>(await github.rest.issues.get({...context.repo,issue_number:n})).data,execute:n=>execute({...context.payload,inputs:{issue:String(n)}}),notify:async(n,body)=>github.rest.issues.createComment({...context.repo,issue_number:n,body})});
   if(result.some(x=>x.status==='stopped'))core.warning('一部の自動修正受付が停止しました。Issueと結果JSONを確認してください。成功した他の受付は維持します。');
  }else result=await execute(context.payload);
  await writeFile('automatic-repair-result.json',JSON.stringify(result,null,2));core.info(JSON.stringify(result));
 }catch(error){
  const match=String(context.payload.workflow_run?.head_branch??'').match(/^codex\/issue-([1-9][0-9]*)$/);
  const raw=context.payload.issue?.number??context.payload.inputs?.issue??match?.[1];
  const reason=/protected path|保護ファイル/.test(String(error.message))?'protected-path':/head|base|対象/.test(String(error.message))?'snapshot-changed':'coordinator-check-failed';
  try{if(raw){const issue=assertIssueNumber(raw);await assertAutomaticAssignment({github,repo:context.repo,issueNumber:issue,exceptPullNumber:Number((await github.rest.pulls.list({...context.repo,state:'open',head:`${context.repo.owner}:codex/issue-${issue}`,per_page:2})).data[0]?.number)});await github.rest.issues.createComment({...context.repo,issue_number:issue,body:`自動修正受付が停止しました（${reason}）。実行: https://github.com/papettoTV/virtual_gamecenter/actions/runs/${context.runId} 。既存PR・担当・保護条件を確認してください。`});}}catch{}
  await writeFile('automatic-repair-result.json',JSON.stringify({status:'stopped',reason}));throw Error('自動修正の受付を停止しました。対象runとhead/base・担当・診断を確認してください。認証値・元応答は表示していません。');}
}
