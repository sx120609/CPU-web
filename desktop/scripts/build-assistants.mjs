import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(desktop, 'dist/assistants');
const settings = JSON.parse(await fs.readFile(path.join(desktop, 'assistants/release.json'), 'utf8'));
await fs.mkdir(root, { recursive: true });
const releases = {};
async function filesIn(dir, prefix = '') {
  const files = {};
  for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (entry.name === '__pycache__') continue;
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(files, await filesIn(path.join(dir, entry.name), name + '/'));
    else files[name] = (await fs.readFile(path.join(dir, entry.name))).toString('base64');
  }
  return files;
}
for (const [kind, file] of Object.entries({ chaoxing: 'monkey.js', multiplatform: 'multiplatform.js', weban: 'weban.js', zhihuishu: '' })) {
  let files, version;
  if (kind === 'zhihuishu') {
    files = await filesIn(path.join(desktop, 'dist/zhihuishu'), 'ui/');
    const source = path.join(desktop, '../server/python/zhihuishu');
    files['worker/worker.py'] = (await fs.readFile(path.join(source, 'worker.py'))).toString('base64');
    for (const name of (await fs.readdir(path.join(source, 'vendor'))).sort()) {
      if (name.endsWith('.py') || name === 'LICENSE') files['worker/vendor/' + name] = (await fs.readFile(path.join(source, 'vendor', name))).toString('base64');
    }
    version = settings.zhihuishu;
  } else {
    const source = await fs.readFile(path.join(desktop, 'assets/userscripts', file), 'utf8');
    version = source.match(/^\s*\/\/\s*@version\s+(\S+)/m)[1];
    files = { [file]: Buffer.from(source).toString('base64') };
  }
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, kind, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, Buffer.from(content, 'base64'));
  }
  const bytes = gzipSync(Buffer.from(JSON.stringify({ schema: 1, kind, version, files })), { level: 9 });
  const filename = `${kind}-${version}.json.gz`;
  await fs.writeFile(path.join(root, filename), bytes);
  releases[kind] = { version, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, filename, protocol: settings.protocol, runtime: settings.runtime, minClient: settings.minClient };
}
await fs.writeFile(path.join(root, 'builtin.json'), JSON.stringify(releases));
console.log('Independent assistant packages:', Object.fromEntries(Object.entries(releases).map(([k,v])=>[k,v.size])));
