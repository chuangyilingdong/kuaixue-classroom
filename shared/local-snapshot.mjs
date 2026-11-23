import {createHash,randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {lstat,mkdir,readdir,rename,rm,stat,writeFile} from 'node:fs/promises';
import {dirname,join,posix,relative,sep} from 'node:path';
import {pipeline} from 'node:stream/promises';

export const snapshotLimits = Object.freeze({
  archiveBytes:64*1024*1024,
  extractedBytes:256*1024*1024,
  files:20_000,
});

export class SnapshotArchiveError extends Error {
  constructor(code,message,status=400){super(message);this.name='SnapshotArchiveError';this.code=code;this.status=status;}
}

function fail(code,message,status=400){throw new SnapshotArchiveError(code,message,status);}

export function sha256Buffer(bytes){
  return createHash('sha256').update(bytes).digest('hex');
}

export function validateSnapshotName(name){
  if(typeof name!=='string'||!name||name.length>1024||name.includes('\0')||name.includes('\\')||
      name.startsWith('/')||/^[A-Za-z]:/.test(name)) fail('UNSAFE_SNAPSHOT_PATH','快照包含不安全路径');
  const directory=name.endsWith('/');
  const bare=directory?name.slice(0,-1):name;
  if(!bare||bare.includes('/')&&bare.split('/').some(part=>!part||part==='.'||part==='..')||
      !directory&&posix.normalize(name)!==name) fail('UNSAFE_SNAPSHOT_PATH','快照包含不安全路径');
  return directory;
}

async function openZip(buffer){
  const yauzl=(await import('yauzl')).default;
  return new Promise((resolve,reject)=>{
    yauzl.fromBuffer(buffer,{lazyEntries:true,decodeStrings:true,validateEntrySizes:true,strictFileNames:true},(error,zip)=>{
      if(error) reject(new SnapshotArchiveError('INVALID_SNAPSHOT','快照 ZIP 无法读取'));
      else resolve(zip);
    });
  });
}

export async function inspectSnapshotZip(buffer,{limits=snapshotLimits}={}){
  if(!Buffer.isBuffer(buffer)||!buffer.length) fail('INVALID_SNAPSHOT','快照为空');
  if(buffer.length>limits.archiveBytes) fail('SNAPSHOT_TOO_LARGE','快照压缩包超出大小限制',413);
  const zip=await openZip(buffer);
  return new Promise((resolve,reject)=>{
    const names=new Set();
    const files=new Set();
    let entryCount=0,fileCount=0,totalBytes=0,hasIndex=false,settled=false;
    const stop=(error)=>{
      if(settled)return;
      settled=true;
      zip.close();
      reject(error);
    };
    zip.on('error',()=>stop(new SnapshotArchiveError('INVALID_SNAPSHOT','快照 ZIP 无法读取')));
    zip.on('entry',entry=>{
      try {
        if(entry.generalPurposeBitFlag&0x1) fail('ENCRYPTED_SNAPSHOT','不支持加密 ZIP');
        const directory=validateSnapshotName(entry.fileName);
        entryCount++;
        if(entryCount>limits.files) fail('TOO_MANY_SNAPSHOT_FILES','快照条目数超出限制',413);
        const key=entry.fileName.toLocaleLowerCase('en-US');
        if(names.has(key)) fail('DUPLICATE_SNAPSHOT_PATH','快照包含重复路径');
        names.add(key);
        const mode=(entry.externalFileAttributes>>>16)&0xffff;
        if((entry.versionMadeBy>>>8)===3&&mode){
          const kind=mode&0o170000;
          if(kind&&kind!==0o040000&&kind!==0o100000) fail('UNSUPPORTED_SNAPSHOT_ENTRY','快照只能包含普通文件和目录');
          if(kind&&(directory&&kind!==0o040000||!directory&&kind!==0o100000)) fail('INVALID_SNAPSHOT_ENTRY','快照条目类型不正确');
        }
        if(!directory){
          fileCount++;
          if(!Number.isSafeInteger(entry.uncompressedSize)||entry.uncompressedSize<0) fail('INVALID_SNAPSHOT','快照文件大小无效');
          totalBytes+=entry.uncompressedSize;
          if(!Number.isSafeInteger(totalBytes)||totalBytes>limits.extractedBytes) fail('SNAPSHOT_TOO_LARGE','快照解压后超出大小限制',413);
          files.add(entry.fileName);
          if(entry.fileName==='index.html') hasIndex=true;
        }
        zip.readEntry();
      } catch(error){stop(error);}
    });
    zip.on('end',()=>{
      if(settled)return;
      try {
        for(const file of files){
          const parts=file.split('/');
          for(let index=1;index<parts.length;index++){
            if(files.has(parts.slice(0,index).join('/'))) fail('DUPLICATE_SNAPSHOT_PATH','快照包含文件路径冲突');
          }
        }
        if(!hasIndex) fail('MISSING_PROJECT_ENTRY','工程根目录缺少 index.html');
        settled=true;
        resolve({sha256:sha256Buffer(buffer),size:buffer.length,fileCount,totalBytes});
      } catch(error){stop(error);}
    });
    zip.readEntry();
  });
}

async function collectTree(root){
  const rootStat=await lstat(root).catch(()=>null);
  if(!rootStat?.isDirectory()) fail('SNAPSHOT_DIRECTORY_MISSING','本机工程目录不存在',404);
  const files=[],directories=[];
  let totalBytes=0;
  async function visit(directory,prefix=''){
    const entries=await readdir(directory,{withFileTypes:true});
    for(const entry of entries){
      const absolute=join(directory,entry.name);
      const name=prefix?`${prefix}/${entry.name}`:entry.name;
      if(entry.isSymbolicLink()) fail('UNSUPPORTED_SNAPSHOT_ENTRY','本机工程包含符号链接，无法安全备份');
      if(entry.isDirectory()){
        directories.push(name);
        if(files.length+directories.length>snapshotLimits.files) fail('TOO_MANY_SNAPSHOT_FILES','本机工程条目数超出限制',413);
        await visit(absolute,name);continue;
      }
      if(!entry.isFile()) fail('UNSUPPORTED_SNAPSHOT_ENTRY','本机工程包含不支持的条目');
      const info=await stat(absolute);
      files.push({absolute,name,mode:info.mode});
      if(files.length>snapshotLimits.files) fail('TOO_MANY_SNAPSHOT_FILES','本机工程文件数超出限制',413);
      totalBytes+=info.size;
      if(totalBytes>snapshotLimits.extractedBytes) fail('SNAPSHOT_TOO_LARGE','本机工程解压后超出大小限制',413);
    }
  }
  await visit(root);
  if(!files.some(file=>file.name==='index.html')) fail('MISSING_PROJECT_ENTRY','本机工程根目录缺少 index.html');
  return {files,directories,totalBytes};
}

export async function createSnapshotZip(root){
  const tree=await collectTree(root);
  const yazl=(await import('yazl')).default;
  const zip=new yazl.ZipFile();
  const chunks=[];
  let size=0;
  const output=new Promise((resolve,reject)=>{
    zip.outputStream.on('data',chunk=>{
      size+=chunk.length;
      if(size>snapshotLimits.archiveBytes){
        zip.outputStream.destroy(new SnapshotArchiveError('SNAPSHOT_TOO_LARGE','本机工程压缩后超出大小限制',413));
        return;
      }
      chunks.push(chunk);
    });
    zip.outputStream.once('error',error=>{
      if(error instanceof SnapshotArchiveError) reject(error);
      else reject(new SnapshotArchiveError('SNAPSHOT_PACK_FAILED','本机工程打包失败'));
    });
    zip.outputStream.once('end',()=>resolve(Buffer.concat(chunks,size)));
  });
  for(const directory of tree.directories)zip.addEmptyDirectory(directory);
  for(const file of tree.files){
    const executable=process.platform!=='win32'&&Boolean(file.mode&0o111);
    zip.addFile(file.absolute,file.name,{mode:executable?0o755:0o644});
  }
  zip.end();
  const bytes=await output;
  return {bytes,sha256:sha256Buffer(bytes),size:bytes.length,fileCount:tree.files.length,totalBytes:tree.totalBytes};
}

function extractionPath(root,name){
  const target=join(root,...name.split('/'));
  const rel=relative(root,target);
  if(!rel||rel.startsWith(`..${sep}`)||rel==='..'||rel.includes('\0')) fail('UNSAFE_SNAPSHOT_PATH','快照包含不安全路径');
  return target;
}

export async function extractSnapshotZip(buffer,targetRoot,{limits=snapshotLimits}={}){
  await inspectSnapshotZip(buffer,{limits});
  await mkdir(targetRoot,{recursive:true,mode:0o700});
  if((await readdir(targetRoot)).length) fail('SNAPSHOT_TARGET_NOT_EMPTY','恢复目录必须为空',409);
  const zip=await openZip(buffer);
  const files=[];
  await new Promise((resolve,reject)=>{
    let settled=false;
    const stop=error=>{
      if(settled)return;
      settled=true;zip.close();reject(error instanceof SnapshotArchiveError?error:new SnapshotArchiveError('INVALID_SNAPSHOT','快照解压失败'));
    };
    zip.on('error',stop);
    zip.on('entry',entry=>{
      const directory=entry.fileName.endsWith('/');
      const target=extractionPath(targetRoot,entry.fileName.replace(/\/$/,''));
      if(directory){
        void mkdir(target,{recursive:true,mode:0o700}).then(()=>zip.readEntry(),stop);
        return;
      }
      void mkdir(dirname(target),{recursive:true,mode:0o700}).then(()=>new Promise((done,error)=>{
        zip.openReadStream(entry,(streamError,stream)=>{
          if(streamError){error(streamError);return;}
          pipeline(stream,createWriteStream(target,{flags:'wx',mode:0o600})).then(done,error);
        });
      })).then(()=>{files.push(entry.fileName);zip.readEntry();},stop);
    });
    zip.on('end',()=>{if(!settled){settled=true;resolve();}});
    zip.readEntry();
  });
  if(!files.includes('index.html')) fail('MISSING_PROJECT_ENTRY','工程根目录缺少 index.html');
  return {fileCount:files.length};
}

export async function replaceWorkspaceFromSnapshot(buffer,workspace,{backupRoot}={}){
  const stage=join(dirname(workspace),`.restore-${randomUUID()}`);
  const backup=backupRoot?join(backupRoot,
    `workspace-before-restore-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`):null;
  let movedExisting=false;
  try {
    await extractSnapshotZip(buffer,stage);
    if(await lstat(workspace).then(()=>true,()=>false)){
      if(!backup) fail('SNAPSHOT_REPLACE_UNAVAILABLE','已有本机工程，需要先关闭并保留现有目录',409);
      await mkdir(dirname(backup),{recursive:true});
      await rename(workspace,backup);
      movedExisting=true;
    }
    await mkdir(dirname(workspace),{recursive:true,mode:0o700});
    await rename(stage,workspace);
    return {backup};
  } catch(error){
    await rm(stage,{recursive:true,force:true}).catch(()=>{});
    if(movedExisting&&backup){
      const exists=await lstat(workspace).then(()=>true,()=>false);
      if(!exists)await rename(backup,workspace).catch(()=>{});
    }
    throw error;
  }
}

export async function writeSnapshotToFile(buffer,filename){
  await mkdir(dirname(filename),{recursive:true,mode:0o750});
  await writeFile(filename,buffer,{flag:'wx',mode:0o640});
}
