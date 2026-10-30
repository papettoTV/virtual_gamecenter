import {assertAutomatedPr,assertChanges,assertSha} from './policy.mjs';
import {assertAutomaticAssignment,pullImplementsIssue} from './issue-routing.mjs';
export const resumeLabel='実装:再開';
export async function resumeTarget({github,repo,issueNumber,bot,base}){
 const prs=await github.paginate(github.rest.pulls.list,{...repo,state:'open',per_page:100});
 const matching=prs.filter(pr=>pullImplementsIssue(pr,issueNumber));
 if(matching.length===0)return null;
 if(matching.length!==1)throw Error('再開対象PRが一意ではありません。');
 const {data:pr}=await github.rest.pulls.get({...repo,pull_number:matching[0].number});
 assertAutomatedPr(pr,{repository:`${repo.owner}/${repo.repo}`,bot});
 if(pr.head.ref!==`codex/issue-${issueNumber}`||pr.base.repo?.full_name!==`${repo.owner}/${repo.repo}`
  ||pr.base.sha!==base||pr.mergeable!==true)throw Error('再開対象のbase・担当・マージ候補を確認できません。');
 const files=await github.paginate(github.rest.pulls.listFiles,{...repo,pull_number:pr.number,per_page:100});
 assertChanges(files);
 await assertAutomaticAssignment({github,repo,issueNumber,exceptPullNumber:pr.number});
 return {pull:String(pr.number),head:assertSha(pr.head.sha),candidate:assertSha(pr.merge_commit_sha)};
}
export function assertResumeSnapshot(pr,{issue,pull,head,candidate,trustedBase,bot,repository}){
 assertAutomatedPr(pr,{repository,bot});
 if(String(pr.number)!==String(pull)||pr.head.ref!==`codex/issue-${issue}`||pr.head.sha!==head
  ||pr.base.sha!==trustedBase||pr.merge_commit_sha!==candidate||pr.mergeable!==true
  ||pr.base.repo?.full_name!==repository)throw Error('修正中に既存PRのhead/base/候補が変わりました。');
 return true;
}
