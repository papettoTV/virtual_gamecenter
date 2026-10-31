// Probe the exact isolated process environment, without sites, accounts or keys.
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {runFixedTool,browserDiagnostics} from '../ci/control/fixed-process.mjs';
const root=new URL('../ci/control/toolchain/',import.meta.url);
const folder=await mkdtemp(join(tmpdir(),'pulbase-browser-process-'));
try{
 const config=join(folder,'probe.config.mjs');
 await writeFile(config,`import base from ${JSON.stringify(new URL('staging-browser.config.mjs',root).href)};\nexport default {...base,testDir:${JSON.stringify(folder)},testMatch:'regression.spec.mjs',outputDir:${JSON.stringify(join(folder,'output'))},use:{...base.use,screenshot:'off'}};\n`);
 // The fixed title lets the allowlisted diagnostic parser identify launch errors.
 // This checks only local rendering; it is not the real staging home regression.
 await writeFile(join(folder,'regression.spec.mjs'),`import {test,expect} from ${JSON.stringify(new URL('node_modules/@playwright/test/index.mjs',root).href)};\ntest('home renders active games and versioned Worker/Pages',async({page})=>{await page.route('**/*',route=>route.abort());await page.setContent('<p role="status">local process probe</p>');await expect(page.getByRole('status')).toHaveText('local process probe');});\n`);
 const environment={PATH:process.env.PATH,PULBASE_BROWSER_ENVIRONMENT:'staging',PULBASE_EXPECTED_SHA:'a'.repeat(40),PULBASE_CHECK_USERNAME:'probe-only',PULBASE_CHECK_PASSWORD:'probe-only'};
 // Local troubleshooting may use a separate cache; CI leaves this unset.
 if(process.env.PULBASE_PROCESS_PROBE_BROWSERS_PATH)environment.PLAYWRIGHT_BROWSERS_PATH=process.env.PULBASE_PROCESS_PROBE_BROWSERS_PATH;
 const result=await runFixedTool('playwright',['test','--config',config,'--reporter=json'],{cwd:fileURLToPath(root),timeout:90000,env:environment});
 let parsed;try{parsed=JSON.parse(result.stdout);}catch{}
 if(result.exitCode!==0||parsed?.stats?.expected!==2||parsed.stats.unexpected!==0||parsed.stats.skipped!==0||parsed.errors?.length){
  console.log(JSON.stringify({mode:'isolated-process-probe',diagnostic:browserDiagnostics(result.stdout,result.exitCode)}));
  throw Error('固定Chromiumの隔離プロセス検査が不合格です。生出力は保存しません');
 }
 console.log('隔離env・sandbox有効のChromiumでPC/スマホのローカル描画2件が成功（実環境回帰ではありません）。');
}finally{await rm(folder,{recursive:true,force:true});}
