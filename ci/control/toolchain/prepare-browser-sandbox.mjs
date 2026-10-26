// Only ephemeral Ubuntu GitHub runners; keep Chromium sandbox enabled.
import {readFile,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function chromiumAppArmorProfile(executable){
 if(!/^\/home\/runner\/\.cache\/ms-playwright\/chromium-[0-9]+\/chrome-linux64\/chrome$/.test(executable??''))throw Error('固定Chromium以外のuserns許可は拒否します');
 return `abi <abi/4.0>,\ninclude <tunables/global>\nprofile pulbase-staging-chromium "${executable}" flags=(unconfined) {\n  userns,\n}\n`;
}
async function main(){
 if(process.platform!=='linux')return;
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.CI!=='true'||process.getuid?.()===0)throw Error('GitHubの使い捨て非root runnerだけを許可します');
 const os=await readFile('/etc/os-release','utf8');
 if(!/^ID=ubuntu$/m.test(os)||!/^VERSION_ID="24\.04"$/m.test(os))throw Error('検証済みUbuntu 24.04以外では停止します');
 const metadata=JSON.parse(await readFile(new URL('./node_modules/@playwright/test/package.json',import.meta.url),'utf8'));
 if(metadata.version!=='1.61.1')throw Error('固定Playwrightの版が不一致');
 const {chromium}=await import('@playwright/test');
 const profile=chromiumAppArmorProfile(await realpath(chromium.executablePath()));
 const options={env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin'},encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']};
 const target='/etc/apparmor.d/pulbase-staging-chromium';
 try{
  execFileSync('/usr/bin/sudo',['-n','/usr/bin/tee',target],{...options,input:profile});
  execFileSync('/usr/bin/sudo',['-n','/usr/sbin/apparmor_parser','-r',target],options);
 }catch{throw Error('固定Chromiumのsandbox用profileを設定できません');}
 console.log('固定Chromiumだけのuserns許可を設定しました。Chromium sandboxは有効です。');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
