import { build } from 'esbuild';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import raw from '../eo/site-config.mjs';
import { normalizeConfig } from '../src/config.mjs';
import { createState } from '../src/state.mjs';
import { buildView } from '../src/view.mjs';
import { renderPage } from '../src/page.mjs';

const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'output','upload');
await mkdir(output,{recursive:true});
const routes=[['index.js','status-page.js'],['healthz.js','healthz.js'],['api/status.js','api/status.js'],['api/internal/tick.js','api/internal/tick.js']];for(const [source,destination] of routes){
  await build({entryPoints:[path.join(root,'cloud-functions',source)],outfile:path.join(output,'cloud-functions',destination),bundle:true,platform:'node',format:'esm',target:'node20',sourcemap:false,minify:false,legalComments:'eof'});
  // Makers scans exported names before building. Esbuild's `onRequest as
  // default` is ignored by its analyzer; retain the named handler export.
  const bundled = await readFile(path.join(output,'cloud-functions',destination),'utf8');
  if (!/export\s*\{\s*onRequest\s*\}/.test(bundled)) throw new Error(`Missing named handler: ${destination}`);
}
// Direct upload requires a root index. Route the public entry to the existing
// dynamic page; if rewriting fails, the static fallback honestly shows unknown.
await writeFile(path.join(output,'index.html'),renderPage(buildView(createState(),normalizeConfig(raw),Date.now())));
await writeFile(path.join(output,'package.json'),JSON.stringify({private:true,type:'module'}));
await writeFile(path.join(output,'edgeone.json'),JSON.stringify({cloudFunctions:{mainlandRegions:['ap-nanjing']},rewrites:[{source:'/',destination:'/status-page'},{source:'/index.html',destination:'/status-page'}]},null,2));
const files=[];
async function inventory(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()){await inventory(file);continue;}
    const contents=await readFile(file);
    if(/-----BEGIN .*PRIVATE KEY-----|AKID[A-Za-z0-9]{28,}|ghp_[A-Za-z0-9]{30,}/.test(contents.toString('utf8')))throw new Error('Possible secret in upload');
    files.push({path:path.relative(output,file).replaceAll('\\','/'),bytes:contents.length,sha256:createHash('sha256').update(contents).digest('hex')});
  }
}
await inventory(output);
await writeFile(path.join(root,'output','upload-manifest.json'),JSON.stringify({files},null,2));
console.log(JSON.stringify({output,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0)}));
