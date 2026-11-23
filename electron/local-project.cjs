const {createHash,randomUUID}=require('node:crypto');
const fsp=require('node:fs/promises');
const path=require('node:path');

function projectKey({userId,courseId,versionId}){
  return createHash('sha256').update(JSON.stringify([userId,courseId,versionId])).digest('hex');
}

function projectPaths(dataRoot,context){
  const root=path.join(dataRoot,'vibe-projects',projectKey(context));
  return {
    root,
    workspace:path.join(root,'workspace'),
    metadata:path.join(root,'local-snapshot.json'),
    backups:path.join(root,'snapshot-backups'),
  };
}

async function readSnapshotMetadata(paths){
  try{
    const value=JSON.parse(await fsp.readFile(paths.metadata,'utf8'));
    return Number.isSafeInteger(value.revision)&&value.revision>=0&&
      typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256)&&
      typeof value.capturedAt==='string'&&!Number.isNaN(Date.parse(value.capturedAt))?value:null;
  }catch{return null;}
}

async function writeSnapshotMetadata(paths,value){
  await fsp.mkdir(paths.root,{recursive:true,mode:0o700});
  const temporary=`${paths.metadata}.${randomUUID()}.tmp`;
  await fsp.writeFile(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});
  await fsp.rename(temporary,paths.metadata).catch(async error=>{
    if(['EEXIST','EPERM'].includes(error.code)){
      await fsp.rm(paths.metadata,{force:true});
      await fsp.rename(temporary,paths.metadata);
      return;
    }
    await fsp.rm(temporary,{force:true}).catch(()=>{});
    throw error;
  });
}

async function localProjectStatus(dataRoot,context){
  const paths=projectPaths(dataRoot,context);
  const exists=await fsp.stat(path.join(paths.workspace,'index.html')).then(info=>info.isFile(),()=>false);
  const metadata=await readSnapshotMetadata(paths);
  return {exists,directory:paths.workspace,revision:metadata?.revision??0,
    sha256:metadata?.sha256??null,capturedAt:metadata?.capturedAt??null};
}

module.exports={localProjectStatus,projectKey,projectPaths,readSnapshotMetadata,writeSnapshotMetadata};
