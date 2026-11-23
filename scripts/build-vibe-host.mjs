import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {access,copyFile,cp,mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractAll} from '@electron/asar';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const upstream=resolve(process.argv[2]||'E:/灵动code/@zcodedesktop/resources/glm');
const cli=resolve(process.argv[3]||'E:/灵动ai客户端/apps/zcode-cli/packages/cli/dist/zcode.cjs');
const provider=resolve(process.argv[4]||'E:/灵动ai客户端/config/provider/zcode-builtin.json');
const packageRoot=resolve(project,'release/vibe-server');
const stage=resolve(project,'release/vibe-server/host-context');
if(!stage.startsWith(packageRoot+sep)) throw Error('构建目录越界');
const containerCli='/opt/kuaixue/zcode.cjs';
const packages=join(upstream,'packages');
const image='kuaixue-vibe-host:20261123-full';
const archive=resolve(packageRoot,'host-image-full.tar');
const appAsar=resolve(upstream,'../app.asar');

function run(command,args,options={}) {
  return execFileSync(command,args,{cwd:project,stdio:'pipe',encoding:'utf8',maxBuffer:64*1024*1024,...options});
}
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const rawVersion=run(process.execPath,[cli,'version','--json']).trim();
const version=rawVersion.startsWith('"')?JSON.parse(rawVersion):rawVersion;
if(version!=='0.16.9') throw Error(`运行端必须与源码服务端统一为 0.16.9，实际为 ${version}`);
await readFile(join(packages,'browser-use-plugin/.zcode-plugin/plugin.json'));
await readFile(join(packages,'node-repl-host/dist/mcp/server.js'));
await readFile(provider);

await rm(stage,{recursive:true,force:true});
await mkdir(stage,{recursive:true});
for(const [source,target] of [
  [resolve(project,'release/vibe-server/host.mjs'),join(stage,'host.mjs')],
  [resolve(project,'integrations/vibecoding/deploy/host-models.mjs'),join(stage,'host-models.mjs')],
  [resolve(project,'integrations/vibecoding/deploy/Dockerfile.host'),join(stage,'Dockerfile')],
  [cli,join(stage,'zcode.cjs')],
]) await copyFile(source,target);
await cp(packages,join(stage,'packages'),{recursive:true,dereference:true});
const extractedPlaywright=resolve(packageRoot,'asar-extract/node_modules/playwright-core');
let playwrightSource=extractedPlaywright;
let temporaryAsar;
try {
  await access(join(playwrightSource,'package.json'));
} catch {
  temporaryAsar=await mkdtemp(join(tmpdir(),'kx-asar-'));
  await extractAll(appAsar,temporaryAsar);
  playwrightSource=join(temporaryAsar,'node_modules/playwright-core');
}
await mkdir(join(stage,'node_modules'),{recursive:true});
await cp(playwrightSource,join(stage,'node_modules/playwright-core'),{recursive:true,dereference:true});
if(temporaryAsar) await rm(temporaryAsar,{recursive:true,force:true});
await mkdir(join(stage,'provider'),{recursive:true});
await copyFile(provider,join(stage,'provider/zcode-builtin.json'));

run('docker',['build','--pull=false','--tag',image,stage],{stdio:'inherit',maxBuffer:128*1024*1024});
const browserCanary=resolve(project,'scripts/verify-vibe-browser.mjs');
run('docker',['run','--rm','--network','none',
  '--mount',`type=bind,source=${browserCanary},target=/tmp/verify-vibe-browser.mjs,readonly`,
  '--entrypoint','/usr/local/bin/node',image,'/tmp/verify-vibe-browser.mjs'],{maxBuffer:64*1024*1024});
const inventory=JSON.parse(run('docker',['run','--rm','--network','none','--entrypoint','/usr/local/bin/node',image,containerCli,'plugins','list','--json']));
const capabilities=JSON.parse(run('docker',['run','--rm','--network','none','--entrypoint','/usr/local/bin/node',image,containerCli,'skills','list','--json']));
const chromium=run('docker',['run','--rm','--network','none','--entrypoint','/usr/bin/chromium',image,'--version']).trim();
const enabled=inventory.filter(plugin=>plugin.enabled);
const required=['browser-use','documents','pdf','presentations','spreadsheets','node-repl-host'];
for(const name of required) {
  if(!enabled.some(plugin=>plugin.name===name)) throw Error(`缺少正式运行能力: ${name}`);
}
if(!capabilities.skills.some(skill=>skill.qualifiedName==='browser-use:control-browser')) {
  throw Error('缺少 Browser Use 的 control-browser 技能');
}

run('docker',['save','--output',archive,image],{stdio:'inherit',maxBuffer:128*1024*1024});
const imageId=run('docker',['image','inspect',image,'--format','{{.Id}}']).trim();
const manifest={
  image,
  imageId,
  zcodeVersion:version,
  chromium,
  browserCanary:'BROWSER_CANARY_OK',
  archiveSha256:sha256(await readFile(archive)),
  office:run('docker',['run','--rm','--network','none','--entrypoint','/usr/bin/soffice',image,'--version']).trim(),
  python:run('docker',['run','--rm','--network','none','--entrypoint','/usr/bin/python3',image,'-c',
    'import defusedxml,openpyxl,pptx,pypdf,reportlab,fitz,pdfplumber; print("python-docs-ok")']).trim(),
  plugins:inventory.map(({name,version,enabled,skillCount})=>({name,version,enabled,skillCount})),
  skills:capabilities.skills.map(({qualifiedName,pluginName,name})=>({qualifiedName,pluginName,name})),
};
await writeFile(join(packageRoot,'host-image-full.manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(join(packageRoot,'host-image-full.sha256'),`${manifest.archiveSha256}  ${archive.split(sep).at(-1)}\n`);
console.log(JSON.stringify({image,imageId,plugins:enabled.length,skills:capabilities.skills.length,chromium,archive},null,2));
