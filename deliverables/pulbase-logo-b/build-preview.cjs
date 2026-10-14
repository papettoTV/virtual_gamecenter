const path = require('node:path');
const fs = require('node:fs/promises');
const {pathToFileURL}=require('node:url');
const deps='/Users/eijiyokota/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const sharp=require(require.resolve('sharp',{paths:[deps]}));
const {chromium}=require(require.resolve('playwright',{paths:[deps]}));
(async()=>{
 for(const [theme,ink,bg] of [['dark','white','#000'],['light','black','#fff']]){
  for(const size of [16,32]){
   const out=path.join(__dirname,`favicon-${theme}-${size}.png`);
   await sharp(path.join(__dirname,`pulbase-b-${ink}.svg`),{density:768}).resize(size,size).flatten({background:bg}).png().toFile(out);
   const meta=await sharp(out).metadata();
   if(meta.width!==size||meta.height!==size)throw Error('Invalid favicon dimensions');
  }
 }
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
 const page=await browser.newPage({viewport:{width:1200,height:1000},deviceScaleFactor:1});
 await page.goto(pathToFileURL(path.join(__dirname,'preview.html')).href);
 await page.evaluate(()=>Promise.all(Array.from(document.images).map(i=>i.decode())));
 await page.screenshot({path:path.join(__dirname,'comparison.png'),fullPage:true});
 const failed=await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>!i.complete||!i.naturalWidth).map(i=>i.src));
 if(failed.length)throw Error('Failed images '+failed.join(','));
 await page.setViewportSize({width:390,height:844});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 if(overflow){console.log(await page.locator('body *').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().right>390).map(e=>[e.tagName,e.className,e.getBoundingClientRect().right])));throw Error('Mobile overflow');}
 const mobileHeight=await page.evaluate(()=>document.documentElement.scrollHeight);
 await page.setViewportSize({width:390,height:mobileHeight});
 await page.screenshot({path:path.join(__dirname,'comparison-mobile.png')});
 console.log('Verified: four exact 16/32px PNGs; all preview images load; 390px preview has no horizontal overflow.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
