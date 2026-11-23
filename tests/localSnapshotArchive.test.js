import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  SnapshotArchiveError,createSnapshotZip,extractSnapshotZip,inspectSnapshotZip,replaceWorkspaceFromSnapshot,
} from '../shared/local-snapshot.mjs';

const crcTable=Array.from({length:256},(_,value)=>{
  let crc=value;
  for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;
  return crc>>>0;
});
function crc32(buffer){
  let crc=0xffffffff;
  for(const byte of buffer)crc=crcTable[(crc^byte)&0xff]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}
function storedZip(entries){
  const locals=[],centrals=[];
  let offset=0;
  for(const entry of entries){
    const name=Buffer.from(entry.name);
    const body=entry.body||Buffer.alloc(0);
    const checksum=crc32(body);
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);
    local.writeUInt32LE(checksum,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);
    local.writeUInt16LE(name.length,26);
    locals.push(local,name,body);
    const central=Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(0x031e,4);central.writeUInt16LE(20,6);
    central.writeUInt16LE(0x0800,8);central.writeUInt32LE(checksum,16);central.writeUInt32LE(body.length,20);
    central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
    central.writeUInt32LE(((entry.mode??0o100644)<<16)>>>0,38);central.writeUInt32LE(offset,42);
    centrals.push(central,name);
    offset+=local.length+name.length+body.length;
  }
  const central=Buffer.concat(centrals);
  const end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,central,end]);
}

test('整目录快照可打包、校验并在新目录恢复',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'kx-snapshot-archive-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const source=join(dir,'source'),target=join(dir,'target');
  mkdirSync(join(source,'assets'),{recursive:true});mkdirSync(join(source,'empty'),{recursive:true});
  writeFileSync(join(source,'index.html'),'<!doctype html><link rel="stylesheet" href="assets/app.css">');
  writeFileSync(join(source,'assets','app.css'),'body{color:#111}');
  writeFileSync(join(source,'assets','app.js'),'document.body.dataset.ready="1";');
  const archive=await createSnapshotZip(source);
  assert.match(archive.sha256,/^[a-f0-9]{64}$/);
  assert.equal(archive.fileCount,3);
  const inspected=await inspectSnapshotZip(archive.bytes);
  assert.equal(inspected.sha256,archive.sha256);
  assert.equal(inspected.fileCount,3);
  await extractSnapshotZip(archive.bytes,target);
  assert.equal(readFileSync(join(target,'index.html'),'utf8'),readFileSync(join(source,'index.html'),'utf8'));
  assert.equal(readFileSync(join(target,'assets','app.js'),'utf8'),readFileSync(join(source,'assets','app.js'),'utf8'));
  writeFileSync(join(target,'index.html'),'旧作品');
  const replaced=await replaceWorkspaceFromSnapshot(archive.bytes,target,{backupRoot:join(dir,'backups')});
  assert.equal(readFileSync(join(target,'index.html'),'utf8'),readFileSync(join(source,'index.html'),'utf8'));
  assert.equal(readFileSync(join(replaced.backup,'index.html'),'utf8'),'旧作品');
});

test('快照校验拒绝路径穿越、反斜杠、重复路径、符号链接和缺失入口',async()=>{
  const cases=[
    ['路径穿越',[{name:'../secret',body:Buffer.from('x')},{name:'index.html',body:Buffer.from('x')}],/不安全路径|无法读取/],
    ['反斜杠',[{name:'src\\app.js',body:Buffer.from('x')},{name:'index.html',body:Buffer.from('x')}],/不安全路径|无法读取/],
    ['重复路径',[{name:'INDEX.HTML',body:Buffer.from('x')},{name:'index.html',body:Buffer.from('x')}],/重复路径/],
    ['符号链接',[{name:'index.html',body:Buffer.from('x')},{name:'link',body:Buffer.from('x'),mode:0o120777}],/普通文件/],
    ['缺少入口',[{name:'src/app.js',body:Buffer.from('x')}],/缺少 index\.html/],
  ];
  for(const [label,entries,pattern] of cases){
    await assert.rejects(inspectSnapshotZip(storedZip(entries)),error=>{
      assert.ok(error instanceof SnapshotArchiveError);
      assert.match(error.message,pattern);
      return true;
    },label);
  }
});
