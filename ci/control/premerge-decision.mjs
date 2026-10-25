// CI/review -> develop merge is independent of staging deployment. No default write transport.
import {liveEvidence} from './candidate-evidence.mjs';
import {verifyReviewTrust} from './review-trust.mjs';
export async function premergeDecision(api,receipt,policy,now=Date.now()){
 const evidence=await liveEvidence(api,receipt,receipt.reviewRun,{requireDryRunLabel:false});
 const trust=await verifyReviewTrust(api,receipt,policy,now);
 return {mode:'premerge-keyless',eligible:true,pullNumber:evidence.pullNumber,head:evidence.head,base:evidence.base,
  candidate:evidence.candidate,tree:evidence.tree,reviewTrust:trust,mergeRequest:{method:'PUT',path:`pulls/${evidence.pullNumber}/merge`,body:{sha:evidence.head,merge_method:'squash'}},
  stagingRequiredBeforeMerge:false,realMergeExecuted:false,productionRequested:false};
}
