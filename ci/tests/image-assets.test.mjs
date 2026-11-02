import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {assetPlan,imagePath,validateImage,downloadImage,writeImage,MAX_IMAGE_BYTES} from '../image-assets.mjs';
import {allowedPath} from '../policy.mjs';
import {validatePublicationResult} from '../publication-result.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function chunk(type,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;}
function png({width=1,height=1,interlace=0,raw=Buffer.from([0,12,34,56,255]),extra=Buffer.alloc(0)}={}){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;ihdr[12]=interlace;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),extra,chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const bytes=png(),asset={path:'apps/web/public/share/test-v1.png',url:'https://github.com/user-attachments/assets/00000000-1111-2222-3333-444444444444',sha256:hash(bytes)};
const response=(b=bytes,headers={})=>new Response(b,{status:200,headers:{'Content-Type':'image/png',...headers}});
test('PNGの保存先だけを許可し、CI/CD・偽装拡張子・パストラバーサルは拒否',()=>{
 assert.equal(allowedPath(asset.path),true);assert.equal(imagePath(asset.path),true);
 for(const path of ['ci/a.png','apps/web/src/pages/a.png','apps/web/public/../a.png','apps/web/public/_worker.js','apps/web/public/a.png.js','apps/web/public/a/../../a.png','apps/web/public/.github/a.png'])assert.equal(imagePath(path),false,path);
});
test('素材だけの変更・既存テキスト出力を受理し、任意バイナリ差分は拒否',()=>{
 assert.ok(validatePublicationResult({summary:'画像だけ',patch:'',assets:[asset]}));
 assert.ok(validatePublicationResult({summary:'テキスト',patch:'diff'}));
 assert.throws(()=>validatePublicationResult({summary:'bad',patch:'GIT binary patch',assets:[asset]}));
});
test('URL・余分な属性・重複保存先・件数・ハッシュを検査',()=>{
 for(const change of [{url:'https://evil.test/a.png'},{url:asset.url+'?secret=value'},{url:'http://github.com/user-attachments/assets/00000000-1111-2222-3333-444444444444'},{path:'apps/web/public/../x.png'},{sha256:'g'.repeat(64)},{extra:'bad'}])assert.throws(()=>assetPlan([{...asset,...change}]));
 assert.throws(()=>assetPlan([asset,asset]));assert.throws(()=>assetPlan(Array(9).fill(asset)));assert.throws(()=>assetPlan(null));
});
test('実PNGをCRC・展開結果・寸法・SHAまで検査',()=>{
 assert.deepEqual(validateImage(bytes,asset.sha256),{width:1,height:1,bytes:bytes.length,sha256:asset.sha256});
 assert.throws(()=>validateImage(bytes,'0'.repeat(64)));
 for(const invalid of [Buffer.from('JPEG disguised as PNG'),Buffer.concat([bytes,Buffer.from('tail')]),png({width:4097}),png({interlace:1}),png({raw:Buffer.from([9,1,2,3,4])}),png({raw:Buffer.alloc(100)}),png({extra:chunk('acTL',Buffer.alloc(8))})])assert.throws(()=>validateImage(invalid,hash(invalid)));
 const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=1;assert.throws(()=>validateImage(corrupt,hash(corrupt)));
});
test('添付取得は無認証・手動リダイレクトでGitHubの実ホストだけに限定',async()=>{
 const calls=[];
 const fetcher=async(url,options)=>{calls.push({url,options});return calls.length===1?new Response(null,{status:302,headers:{location:'https://github-production-user-asset-6210df.s3.amazonaws.com/example?signature=not-a-secret'}}):response();};
 assert.deepEqual(await downloadImage(asset,fetcher),bytes);assert.equal(calls.length,2);
 for(const {options} of calls){assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.deepEqual(options.headers,{Accept:'image/png, image/jpeg'});}
 for(const location of ['http://127.0.0.1/a','https://evil.test/a','https://github-production-user-asset-6210df.s3.amazonaws.com.evil.test/a','https://user:password@github-production-user-asset-6210df.s3.amazonaws.com/a'])await assert.rejects(downloadImage(asset,async()=>new Response(null,{status:302,headers:{location}})));
});
test('HTTP失敗・MIME偽装・ヘッダーと実受信の過大・破損を拒否',async()=>{
 for(const fetcher of [async()=>new Response(null,{status:403}),async()=>response(bytes,{'Content-Type':'text/html'}),async()=>response(bytes,{'Content-Length':String(MAX_IMAGE_BYTES+1)}),async()=>response(Buffer.alloc(MAX_IMAGE_BYTES+1)),async()=>response(Buffer.from('bad'))])await assert.rejects(downloadImage(asset,fetcher));
});
test('保存時も親ディレクトリ・最終ファイルのリンクや実行可能ファイルを拒否',async()=>{
 const root=await mkdtemp(join(tmpdir(),'png-safe-'));try{
 await writeImage(root,asset.path,bytes);assert.deepEqual(await readFile(join(root,asset.path)),bytes);
 await rm(join(root,asset.path));await symlink(join(root,'outside'),join(root,asset.path));await assert.rejects(writeImage(root,asset.path,bytes));
 await rm(join(root,'apps/web/public/share'),{recursive:true});await symlink(root,join(root,'apps/web/public/share'));await assert.rejects(writeImage(root,asset.path,bytes));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('隔離GitでテキストとPNGをコミット・pushし、PNG単独も許可し偽装パッチは止める',async()=>{
 for(const mode of ['mixed','asset-only','png-text']){
  const root=await mkdtemp(join(tmpdir(),'png-publish-')),work=join(root,'work');const git=(...args)=>execFileSync('git',args,{cwd:work,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try{
   await mkdir(work);git('init','-b','develop');git('config','user.name','Test');git('config','user.email','test@example.invalid');await writeFile(join(work,'README'),'base');git('add','.');git('commit','-m','base');const base=git('rev-parse','HEAD');
   execFileSync('git',['init','--bare',join(root,'remote')],{stdio:'ignore'});git('remote','add','origin',join(root,'remote'));
   const file=mode==='png-text'?'apps/web/public/fake.png':'docs/png.md';
   const patch=mode==='asset-only'?'':`diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1 @@\n+text\n`;
   const result=join(root,'result.json');await writeFile(result,JSON.stringify({summary:'検証画像',patch,assets:[asset]}));
   const preload=join(root,'fetch.mjs');await writeFile(preload,`globalThis.fetch=async()=>new Response(Buffer.from('${bytes.toString('base64')}','base64'),{headers:{'content-type':'image/png'}});`);
   const env={...process.env,ISSUE_NUMBER:'105',BASE_SHA:base,TRUSTED_BASE_SHA:base,PULL_NUMBER:'',RESULT_FILE:result,PATCH_FILE:join(root,'patch'),PR_BODY_FILE:join(root,'body'),GITHUB_OUTPUT:join(root,'out'),GITHUB_STEP_SUMMARY:join(root,'summary')};
   const run=()=>execFileSync(process.execPath,['--import',preload,fileURLToPath(new URL('../publish-patch.mjs',import.meta.url))],{cwd:work,env,stdio:['ignore','pipe','pipe']});
   if(mode==='png-text'){assert.throws(run);assert.equal(git('rev-parse','HEAD'),base);}else{run();assert.equal(git('rev-parse','--abbrev-ref','HEAD'),'codex/issue-105');assert.equal(git('ls-files','-s',asset.path).split(' ')[0],'100644');assert.equal(git('show',`HEAD:${asset.path}`).length>0,true);assert.match(git('ls-remote','origin','refs/heads/codex/issue-105'),/refs\/heads\/codex\/issue-105/);}
  }finally{await rm(root,{recursive:true,force:true});}
 }
});

const jpeg=Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,1,255,217]);
test('JPEGは実形式と拡張子・寸法・SHAを照合しPNG偽装を拒否',async()=>{
 const a={...asset,path:'apps/web/public/share/test.jpg',sha256:hash(jpeg)};
 assert.equal(allowedPath(a.path),true);assert.equal(imagePath(a.path),true);assert.equal(imagePath('apps/web/public/test.jpeg'),true);
 assert.deepEqual(validateImage(jpeg,a.sha256,a.path),{width:1,height:1,bytes:jpeg.length,sha256:a.sha256});
 assert.throws(()=>validateImage(jpeg,a.sha256,asset.path));assert.throws(()=>validateImage(bytes,asset.sha256,a.path));
 for(const bad of [jpeg.subarray(0,-2),Buffer.concat([jpeg,Buffer.from('tail')]),Buffer.from([255,216,...Buffer.alloc(50),255,217])])assert.throws(()=>validateImage(bad,hash(bad),a.path));
 assert.deepEqual(await downloadImage(a,async()=>response(jpeg,{'Content-Type':'image/jpeg'})),jpeg);
 assert.deepEqual(await downloadImage(a,async()=>response(jpeg)),jpeg); // GitHub attachment advertises PNG for these JPEG bytes.
});
