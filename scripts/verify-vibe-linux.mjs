// Run the bundled smoke inside a Linux QA container with the dedicated host IPC volume mounted.
import {once} from 'node:events';
import {request} from 'node:http';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdir,symlink,writeFile} from 'node:fs/promises';
import {createGateway,origin} from '../integrations/vibecoding/gateway.mjs';
import {createRuntimeBroker} from '../integrations/vibecoding/runtime-broker.mjs';
import WebSocket from 'ws';
import {connectViaWebSocket} from '@zcode/client';
const ctx = {userId:'learner',courseId:'course',versionId:'v1',runId:'run',mode:'VIBECODING'};
const dir='/tmp/kx-check';
const project = dir+'/'+createHash('sha256').update(JSON.stringify([ctx.userId,ctx.courseId,ctx.versionId])).digest('hex');
await mkdir(project,{recursive:true}); await symlink('/ipc',project+'/ipc');
await writeFile(project+'/token','x'.repeat(43));
await mkdir(project+'/workspace',{recursive:true});
await writeFile(project+'/workspace/index.html','<!doctype html><script src="app.js"></script><h1>Preview</h1>');
await writeFile(project+'/workspace/app.js','document.body.dataset.ready="yes";');
const db=new DatabaseSync(dir+'/course.db');
db.exec(`CREATE TABLE kx_runs(id TEXT,user TEXT,version TEXT);CREATE TABLE kx_versions(course TEXT,version TEXT,body TEXT);CREATE TABLE kx_orders(user TEXT,version TEXT,status TEXT);
INSERT INTO kx_runs VALUES('run','learner','v1'); INSERT INTO kx_orders VALUES('learner','v1','confirmed');`);
db.prepare('INSERT INTO kx_versions VALUES(?,?,?)').run('course','v1',JSON.stringify({permittedDeliveryModes:['VIBECODING'],classroomConfig:{vibeCoding:{presetPrompts:[{title:'title',text:'prompt'}]}}}));
const issuer=createRuntimeBroker({filename:dir+'/ticket.db',checkAccess:()=>true});
const server=createGateway({courseFile:dir+'/course.db',ticketFile:dir+'/ticket.db',hostRoot:dir,WebSocket});
const socketPath=dir+'/gateway.sock'; server.listen(socketPath); await once(server,'listening');
async function exchange(ticket) {
  const req=request({method:'POST',socketPath,path:'/kuaixue/runtime/exchange',headers:{Origin:origin,'Content-Type':'application/json'}});
  const result=once(req,'response');req.end(JSON.stringify({runId:'run',ticket}));
  const [response]=await result;let body='';for await(const chunk of response) body+=chunk;
  return {status:response.statusCode,data:JSON.parse(body)};
}
async function preview(path) {
  const req=request({method:'GET',socketPath,path});
  const result=once(req,'response');req.end();
  const [response]=await result;let body='';for await(const chunk of response) body+=chunk;
  return {status:response.statusCode,headers:response.headers,body};
}
let ws;
globalThis.WebSocket=class extends WebSocket {constructor(url){super(url,{origin});ws=this;}};
const open=async()=>{
  const ticket=await issuer.issueRuntimeTicket(ctx);const launch=await exchange(ticket);
  assert.equal(launch.status,200);assert.equal((await exchange(ticket)).status,403);
  assert.equal(launch.data.presets[0].text,'prompt');assert.equal(launch.data.workspacePath,'/workspace');
  assert.match(launch.data.previewToken,/^[a-zA-Z0-9_-]{43}$/);
  const previewRoot=await preview(`/kuaixue/runtime/preview/${launch.data.previewToken}/`);
  assert.equal(previewRoot.status,200);assert.match(previewRoot.body,/Preview/);
  const previewScript=await preview(`/kuaixue/runtime/preview/${launch.data.previewToken}/app.js`);
  assert.equal(previewScript.status,200);assert.match(previewScript.body,/dataset.ready/);
  assert.equal((await preview(`/kuaixue/runtime/preview/${launch.data.previewToken}/..%2Fcourse.db`)).status,403);
  return connectViaWebSocket(`ws+unix://${socketPath}:/kuaixue/runtime/ws/${launch.data.socketId}`);
};
const first=await open();
const entries=await first.fileService.readdir({path:'/workspace'});assert.ok(entries.some(entry=>entry.name==='index.html'));
assert.equal((await first.modelSelectionService.getView()).providers.filter(p=>p.models.length).length,0);
const marker='student-persistence-check.txt';
await first.fileService.writeWorkspaceFileSearchIgnore({rootPath:'/workspace',content:marker});
ws.close();await once(ws,'close');
const second=await open();assert.ok((await second.fileService.readWorkspaceFileSearchIgnore({rootPath:'/workspace'})).content.includes(marker));
const closed=once(ws,'close');db.exec("UPDATE kx_orders SET status='revoked'");
assert.equal((await exchange(await issuer.issueRuntimeTicket(ctx))).status,403);await closed;
server.close();await once(server,'close');db.close();issuer.close();
console.log('PASS: Unix socket exchange, origin-scoped WS to real isolated ZCode RPC, file write/reopen, preset, no models, revoked connection closed');
