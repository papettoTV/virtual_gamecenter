// Trusted publisher: fetch data only; never execute or reinterpret candidate code.
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {lstat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
export const MAX_IMAGE_BYTES=2*1024*1024, MAX_ASSET_BYTES=8*1024*1024;
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function need(ok){if(!ok)throw Error('画像素材の形式・取得元・保存先・容量・ハッシュ検査に失敗しました。');}
export const imagePath=path=>typeof path==='string'&&path.length<=240&&/^apps\/web\/public\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:png|jpg|jpeg)$/.test(path);
const attachment=url=>typeof url==='string'&&/^https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(url);
export function assetPlan(assets=[]){
 need(Array.isArray(assets)&&assets.length<=8);
 const paths=new Set();
 for(const a of assets){
  need(a&&Object.keys(a).sort().join(',')==='path,sha256,url'&&imagePath(a.path)&&attachment(a.url)&&/^[a-f0-9]{64}$/.test(a.sha256)&&!paths.has(a.path));paths.add(a.path);
 }
 return assets;
}
function crc32(bytes){let n=0xffffffff;for(const byte of bytes){n^=byte;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function validatePng(bytes,expected){
 need(Buffer.isBuffer(bytes)&&bytes.length>32&&bytes.length<=MAX_IMAGE_BYTES&&bytes.subarray(0,8).equals(signature));
 need(createHash('sha256').update(bytes).digest('hex')===expected);
 let at=8,width,height,channels,depth,seenData=false,endedData=false,palette=false,ended=false,count=0;const data=[];
 while(at<bytes.length){
  need(++count<=2000&&at+12<=bytes.length);const length=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),start=at+8,end=start+length;
  need(end+4<=bytes.length&&/^[A-Za-z]{4}$/.test(type)&&crc32(bytes.subarray(at+4,end))===bytes.readUInt32BE(end));
  if(count===1)need(type==='IHDR');
  if(type==='IHDR'){
   need(count===1&&length===13);width=bytes.readUInt32BE(start);height=bytes.readUInt32BE(start+4);depth=bytes[start+8];const color=bytes[start+9];
   const legal={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};channels={0:1,2:3,3:1,4:2,6:4}[color];
   need(width>0&&height>0&&width<=4096&&height<=4096&&width*height<=16000000&&legal[color]?.includes(depth)&&bytes[start+10]===0&&bytes[start+11]===0&&bytes[start+12]===0);
   palette=color!==3;
  }else if(type==='PLTE'){need(!seenData&&length>=3&&length<=768&&length%3===0);palette=true;}
  else if(type==='IDAT'){need(!endedData&&palette);seenData=true;data.push(bytes.subarray(start,end));}
  else if(type==='IEND'){need(length===0&&seenData&&end+4===bytes.length);ended=true;}
  else {need(!['acTL','fcTL','fdAT'].includes(type)&&type[0]===type[0].toLowerCase());}
  if(seenData&&type!=='IDAT')endedData=true;
  at=end+4;if(ended)break;
 }
 need(ended&&at===bytes.length);
 const stride=Math.ceil(width*channels*depth/8)+1,expectedBytes=stride*height;need(expectedBytes<=64*1024*1024);
 let pixels;try{pixels=inflateSync(Buffer.concat(data),{maxOutputLength:expectedBytes});}catch{need(false);}
 need(pixels.length===expectedBytes);for(let row=0;row<height;row++)need(pixels[row*stride]<=4);
 return {width,height,bytes:bytes.length,sha256:expected};
}
function validateJpeg(bytes,expected){
 need(Buffer.isBuffer(bytes)&&bytes.length>20&&bytes.length<=MAX_IMAGE_BYTES&&bytes[0]===255&&bytes[1]===216&&createHash('sha256').update(bytes).digest('hex')===expected);
 let at=2,width,height,components,scans=0,markers=0,frame=false,ended=false;
 while(at<bytes.length){
  need(++markers<=2000&&bytes[at++]===255);while(bytes[at]===255)at++;const marker=bytes[at++];
  if(marker===217){need(scans>0&&at===bytes.length);ended=true;break;}
  need(marker!==0&&marker!==216&&marker!==1&&!(marker>=208&&marker<=215)&&at+2<=bytes.length);
  const length=bytes.readUInt16BE(at),end=at+length;need(length>=2&&end<=bytes.length);
  if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){
   need(!frame&&[192,194].includes(marker)&&length>=11&&bytes[at+2]===8);
   height=bytes.readUInt16BE(at+3);width=bytes.readUInt16BE(at+5);components=bytes[at+7];
   need([1,3,4].includes(components)&&length===8+components*3&&width>0&&height>0&&width<=4096&&height<=4096&&width*height<=16000000);frame=true;
  }
  if(marker===218){
   need(frame&&length>=6);const count=bytes[at+2];need(count>0&&count<=components&&length===6+2*count);scans++;at=end;let data=0;
   while(at<bytes.length){if(bytes[at]!==255){at++;data++;continue;}let next=at+1;while(bytes[next]===255)next++;const code=bytes[next];if(code===0||(code>=208&&code<=215)){at=next+1;data++;continue;}break;}
   need(data>0);continue;
  }
  need([192,194,196,219,221,254].includes(marker)||(marker>=224&&marker<=239));at=end;
 }
 need(frame&&ended);return {width,height,bytes:bytes.length,sha256:expected};
}
export function validateImage(bytes,expected,path='apps/web/public/test.png'){
 need(imagePath(path));return path.endsWith('.png')?validatePng(bytes,expected):validateJpeg(bytes,expected);
}
export async function downloadImage(asset,request=fetch){
 assetPlan([asset]);let url=asset.url;
 for(let hop=0;hop<3;hop++){
  const r=await request(url,{redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(20000),headers:{Accept:'image/png, image/jpeg'}});
  if([301,302,303,307,308].includes(r.status)){
   const next=r.headers.get('location');await r.body?.cancel();need(typeof next==='string');const u=new URL(next);
   // Exact public GitHub asset host only; signed URLs never enter logs or output.
   need(hop===0&&u.protocol==='https:'&&u.hostname==='github-production-user-asset-6210df.s3.amazonaws.com'&&!u.username&&!u.password&&!u.port&&!u.hash);url=next;continue;
  }
  need(r.status===200);
  const mime=r.headers.get('content-type')?.split(';')[0].trim();need(mime==='image/png'||mime==='image/jpeg'); // Attachment MIME can be mislabeled; bytes + destination decide format.
  const length=r.headers.get('content-length');need(length===null||/^\d+$/.test(length)&&Number(length)<=MAX_IMAGE_BYTES);
  need(r.body);const reader=r.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;need(size<=MAX_IMAGE_BYTES);parts.push(Buffer.from(value));}}finally{await reader.cancel();}
  const bytes=Buffer.concat(parts);validateImage(bytes,asset.sha256,asset.path);return bytes;
 }
 need(false);
}
export async function writeImage(root,path,bytes){
 need(imagePath(path));const target=resolve(root,path);need(!relative(root,target).startsWith('..'));
 const parts=relative(root,dirname(target)).split('/');let parent=resolve(root);
 for(const part of parts){parent=resolve(parent,part);try{await mkdir(parent);}catch(error){if(error.code!=='EEXIST')throw error;}const st=await lstat(parent);need(st.isDirectory()&&!st.isSymbolicLink());}
 try{const st=await lstat(target);need(st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o111)===0);}catch(error){if(error.code!=='ENOENT')throw error;}
 await writeFile(target,bytes,{mode:0o644});
}
export async function prepareImageAssets(assets,request=fetch){
 assetPlan(assets);const prepared=[];let size=0;
 for(const asset of assets){const bytes=await downloadImage(asset,request);size+=bytes.length;need(size<=MAX_ASSET_BYTES);prepared.push({...asset,bytes});}
 return prepared;
}
