import {readdir,lstat,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
export function localUiUrl(value){try{const url=new URL(value);return ['http:','ws:'].includes(url.protocol)&&['127.0.0.1','[::1]'].includes(url.hostname)&&url.port==='5174'&&!url.username&&!url.password;}catch{return false;}}
export async function discoverUiTests(directory){
 let names;try{names=await readdir(directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const specs=names.filter(x=>/^[a-z0-9-]+\.spec\.mjs$/.test(x));
 if(specs.length>20)throw Error('UIケースのファイル数が過大です');
 for(const name of specs){const s=await lstat(join(directory,name));if(!s.isFile()||s.isSymbolicLink()||s.size>90000)throw Error('UIケースは通常テキストファイルだけです');}
 return specs.sort();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw Error('UI検査の任意パス指定は許可しません');
 const files=await discoverUiTests(fileURLToPath(new URL('../apps/web/tests/ui/',import.meta.url)));
 await mkdir(new URL('./ui-results/',import.meta.url),{recursive:true});
 await writeFile(new URL('./ui-results/discovery.json',import.meta.url),JSON.stringify({required:files.length>0,files}));
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`enabled=${files.length>0}\n`);
 console.log(`ローカルUI検査: ${files.length}ファイル`);
}
