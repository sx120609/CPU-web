const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const desktop=path.resolve(__dirname,'..');
const executable=path.join(desktop,'zhihuishu-runtime','cpu-zhs-worker',process.platform==='win32'?'cpu-zhs-worker.exe':'cpu-zhs-worker');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cpu-worker-component-'));
try {
  fs.cpSync(path.join(desktop,'dist/assistants/zhihuishu/worker'),temp,{recursive:true});
  const worker=path.join(temp,'worker.py');
  let source=fs.readFileSync(worker,'utf8');
  source=source.replace('emit("stdio-check", text=', 'emit("stdio-check", component="updated-external", text=');
  assert.ok(source.includes('component="updated-external"'));
  fs.writeFileSync(worker,source);
  const probe=spawnSync(executable,['--component-dir',temp,'--check-component'],{encoding:'utf8',timeout:45000,windowsHide:true});
  assert.equal(probe.status,0,probe.stderr);assert.equal(JSON.parse(probe.stdout).type,'component-ready');
  const result=spawnSync(executable,['--component-dir',temp,'--check-stdio'],{input:JSON.stringify({text:'更新后的课程 🎓'})+'\n',encoding:'utf8',timeout:45000,windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{type:'stdio-check',component:'updated-external',text:'更新后的课程 🎓'});
  const builtin=spawnSync(executable,['--check-stdio'],{input:JSON.stringify({text:'内置版本'})+'\n',encoding:'utf8',timeout:45000,windowsHide:true});
  assert.equal(JSON.parse(builtin.stdout).component,undefined,'Updating external business code must not mutate the built-in runtime');
  console.log('Frozen runtime loaded updated external Python business code and vendor modules; built-in fallback and Unicode preserved');
} finally {fs.rmSync(temp,{recursive:true,force:true});}
