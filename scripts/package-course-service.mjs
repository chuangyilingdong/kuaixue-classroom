import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,cp,mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {courseServiceFiles} from './course-service-files.mjs';
import {courseServiceRuntimeDependencies,courseServiceRuntimePackages} from './course-service-runtime.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=courseServiceFiles;
const runtimePackages=courseServiceRuntimePackages(root);

function argument(name){
  const index=process.argv.indexOf(name);
  return index>=0?process.argv[index+1]:'';
}
function stamp(date){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).formatToParts(date).map(part=>[part.type,part.value]));
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`;
}
async function hash(file){
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

const releaseId=argument('--release-id')||`kuaixue-service-${stamp(new Date())}`;
const output=resolve(argument('--out')||join(root,'release-artifacts',releaseId));
await mkdir(output,{recursive:false});

for(const relative of files){
  const source=join(root,relative);
  const destination=join(output,relative);
  await mkdir(dirname(destination),{recursive:true});
  await copyFile(source,destination);
}

for(const dependency of courseServiceRuntimeDependencies){
  await cp(runtimePackages[dependency],join(output,'node_modules',dependency),{
    recursive:true,
    dereference:true,
  });
}

execFileSync(process.execPath,['-e','require("yauzl")'],{cwd:output,stdio:'inherit'});

const archive=join(output,'kuaixue-service-release.tar.gz');
const result=spawnSync('tar',['-czf',archive,'-C',output,...files,'node_modules'],{stdio:'inherit'});
if(result.status!==0)throw new Error(`tar failed with status ${result.status}`);
const bytes=(await stat(archive)).size;
const sha256=await hash(archive);
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dirtyFiles=execFileSync('git',['status','--porcelain=v1'],{cwd:root,encoding:'utf8'})
  .split(/\r?\n/).filter(Boolean);
const manifest={
  releaseId,
  createdAt:new Date().toISOString(),
  source:{directory:root,commit,state:dirtyFiles.length?'dirty working tree':'clean working tree',
    ...(dirtyFiles.length?{dirtyFiles}:{})},
  artifact:'kuaixue-service-release.tar.gz',
  bytes,
  sha256,
  runtimeDependencies:courseServiceRuntimeDependencies,
  files:Object.fromEntries(await Promise.all(files.map(async file=>[file,await hash(join(output,file))]))),
};
await writeFile(join(output,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({releaseId,output,archive,bytes,sha256},null,2));
