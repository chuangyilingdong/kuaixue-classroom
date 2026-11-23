import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer,get} from 'node:http';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {servePreview} from '../integrations/vibecoding/gateway.mjs';

function request(origin,path,headers={}) {
  return new Promise((resolve,reject)=>{
    get(origin+path,{headers},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    }).on('error',reject);
  });
}

test('作品预览服务相对资源、目录和越界路径',async t=>{
  const root=await mkdtemp(join(tmpdir(),'kx-preview-'));
  const context={userId:'learner',courseId:'course',versionId:'v1',runId:'run',mode:'VIBECODING'};
  const key=createHash('sha256').update(JSON.stringify([context.userId,context.courseId,context.versionId])).digest('hex');
  const workspace=join(root,key,'workspace');
  await mkdir(join(workspace,'assets'),{recursive:true});
  await writeFile(join(workspace,'index.html'),'<!doctype html><script src="assets/app.js"></script><h1>作品</h1>');
  await writeFile(join(workspace,'assets','app.js'),'document.body.dataset.ready="yes";');
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    void servePreview({hostRoot:root,context,pathname:url.pathname,publicPath:`/preview${url.pathname}`,req,res});
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const page=await request(origin,'/');
  assert.equal(page.status,200);
  assert.match(page.body.toString(),/assets\/app\.js/);
  assert.match(page.headers['content-security-policy'],/frame-ancestors 'self'/);
  assert.equal(page.headers['access-control-allow-origin'],'*');
  const script=await request(origin,'/assets/app.js');
  assert.equal(script.status,200);
  assert.match(script.body.toString(),/dataset\.ready/);
  const redirect=await request(origin,'/assets');
  assert.equal(redirect.status,308);
  assert.equal(redirect.headers.location,'/preview/assets/');
  assert.equal((await request(origin,'/..%2Fcourse.sqlite')).status,403);
  await writeFile(join(workspace,'assets','video.mp4'),Buffer.from('0123456789'));
  const media=await request(origin,'/assets/video.mp4',{Range:'bytes=2-5'});
  assert.equal(media.status,206);
  assert.equal(media.headers['content-range'],'bytes 2-5/10');
  assert.equal(media.headers['accept-ranges'],'bytes');
  assert.equal(media.body.toString(),'2345');
});
