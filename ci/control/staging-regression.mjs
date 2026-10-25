// Fixed staging-only HTTP/browser checks. No default network or process transport.
const origin='https://develop.virtual-gamecenter.pages.dev';
function need(v,m){if(!v)throw Error(m);}
export function regressionEnvironment(sha,credentials={}){
 need(/^[a-f0-9]{40}$/.test(sha??''),'回帰対象SHA不正');
 need((!credentials.username&&!credentials.password)||(credentials.username&&credentials.password),'Basic認証が不完全');
 return {PATH:process.env.PATH,PULBASE_BROWSER_ENVIRONMENT:'staging',PULBASE_EXPECTED_SHA:sha,
  ...(credentials.username?{PULBASE_CHECK_USERNAME:credentials.username,PULBASE_CHECK_PASSWORD:credentials.password}:{})};
}
export async function stagingRegression(sha,{request,browser,guard,credentials={}}={}){
 const env=regressionEnvironment(sha,credentials);
 need(typeof request==='function'&&typeof browser==='function'&&typeof guard==='function','回帰の明示transportとguardが必要');
 await guard();
 let response;
 try{response=await request(`${origin}/?release-check=${sha}`,{method:'GET',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(15000),
  headers:credentials.username?{Authorization:`Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`}:{}});
  await response.body?.cancel();
  need(response.status===200&&response.headers.get('x-pulbase-revision')===sha&&response.headers.get('x-pulbase-gateway-revision')===sha,'SHA不一致');
 }catch{throw Error('検証環境HTTP回帰が不合格です。認証値・応答本文は表示しません');}
 await guard();let result;
 try{result=await browser({environment:env,config:'ci/control/toolchain/staging-browser.config.mjs'});}catch{throw Error('検証環境ブラウザ回帰が不合格です');}
 need(result?.exitCode===0&&result.stats?.expected===8&&result.stats.unexpected===0&&result.stats.flaky===0&&result.stats.skipped===0,'ブラウザ結果が不完全・不合格');
 await guard();return {passed:true,environment:'staging',sha,httpPassed:true,browserPassed:true};
}
