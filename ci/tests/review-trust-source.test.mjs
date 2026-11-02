import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const policy=JSON.parse(await readFile(new URL('../control/review-trust.json',import.meta.url),'utf8'));
test('信頼manifestの原本は現在の定義に一致し、workflowでの自動再生成はしない',async()=>{
 for(const [path,expected] of Object.entries(policy.files)){
  const b=await readFile(new URL('../../'+path,import.meta.url));assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`),b])).digest('hex'),expected,path);
 }
 const {readdir}=await import('node:fs/promises');for(const name of await readdir(new URL('../../.github/workflows/',import.meta.url))){assert.ok(!(await readFile(new URL('../../.github/workflows/'+name,import.meta.url),'utf8')).includes('build-review-trust.py'));}
});
