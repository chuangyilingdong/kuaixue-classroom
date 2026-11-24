import http from 'node:http';
import {once} from 'node:events';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,chmod,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

function json(res,status,data) {res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));}
async function jsonBody(stream) {
  const chunks=[];let count=0;
  for await(const chunk of stream){count+=chunk.length;if(count>2*1024*1024) throw Error('oversize');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks));
}
function call(socketPath,path,data,headers={}) {
  return new Promise((resolve,reject)=>{
    const request=http.request({socketPath,path,method:data?'POST':'GET',headers:{...headers,'content-type':'application/json'},agent:false},resolve);
    request.setTimeout(190000,()=>request.destroy(Error('timeout')));request.on('error',reject);request.end(data && JSON.stringify(data));
  });
}
export function withCourseModels(platform,identity,{root='/var/lib/kx-models',backend='/run/kx-chat/bridge.sock',modelGateway}={}) {
  if(!modelGateway?.chat) throw Error('主站模型网关未配置');
  const hosts=new Map();
  async function models(grant) {
    const response=await call(backend,'/models');
    const result=await jsonBody(response);
    if(response.statusCode!==200 || !Array.isArray(result.data)) throw Error('directory unavailable');
    const selected=platform.detail(grant.courseId,grant.versionId,grant.userId).vibeModelIds;
    // Existing Vibe courses with an empty selection inherit the site's two chat channels.
    return result.data.filter(m=>!selected?.length || selected.includes(m.id));
  }
  function current(grant) {return grant && identity(grant.session)?.userId===grant.userId && platform.hasRuntimeAccess(grant);}
  async function listen(entry,dir) {
    await mkdir(dir,{mode:0o2750,recursive:true});
    const path=join(dir,'m');await unlink(path).catch(e=>{if(e.code!=='ENOENT') throw e;});
    const server=http.createServer(async(req,res)=>{try{
      const g=entry.grant;
      if(!current(g)) return json(res,403,{error:{message:'请重新打开已购课程'}});
      const listing=await models(g);
      if(req.method==='GET' && req.url==='/binding') return json(res,200,{models:listing,key:g.key});
      if(req.headers.authorization!=='Bearer '+g.key) return json(res,403,{error:{message:'课程会话已更新'}});
      if(req.method==='GET' && req.url==='/v1/models') return json(res,200,{object:'list',data:listing.map(m=>({id:m.id.split('::')[1],name:m.name,object:'model'}))});
      if(req.method!=='POST' || req.url!=='/v1/chat/completions') return json(res,404,{});
      const message=await jsonBody(req);const model=listing.find(m=>m.id.split('::')[1]===message?.model);
      if(!model || entry.grant!==g || !current(g)) return json(res,403,{error:{message:'课程未授权此模型'}});
      const remote=await modelGateway.chat(g,{...message,model:model.id});
      const headers={'content-type':remote.headers.get('content-type')||'application/json','cache-control':'no-store'};
      for(const name of ['x-kuaixue-usage-limit','x-kuaixue-usage-used','x-kuaixue-usage-remaining']) {
        const value=remote.headers.get(name);
        if(value) headers[name]=value;
      }
      headers['access-control-expose-headers']='X-Kuaixue-Usage-Limit, X-Kuaixue-Usage-Used, X-Kuaixue-Usage-Remaining';
      res.writeHead(remote.status,headers);
      if(remote.body) await pipeline(Readable.fromWeb(remote.body),res);
      else res.end();
    }catch{if(!res.headersSent) json(res,503,{error:{message:'课程模型服务暂不可用'}});else res.destroy();}});
    server.listen(path);await once(server,'listening');await chmod(path,0o660);return server;
  }
  async function attach(user,run,session) {
    const ctx={userId:user,courseId:run.course.id,versionId:run.course.versionId,runId:run.id,mode:run.mode,session};
    if(!current(ctx)) throw Error('course session unavailable');
    const scope=createHash('sha256').update(JSON.stringify([user,ctx.courseId,ctx.versionId])).digest('hex');
    let entry=hosts.get(scope);
    if(!entry){entry={};hosts.set(scope,entry);entry.ready=listen(entry,join(root,scope)).catch(e=>{hosts.delete(scope);throw e;});}
    await entry.ready;
    if(entry.grant?.session!==session) entry.grant={...ctx,key:randomBytes(32).toString('base64url')};
  }
  return {...platform,async start(user,args,session){
    const run=await platform.start(user,args);
    if(run.mode==='VIBECODING') await attach(user,run,session);
    return run;
  },close(){for(const h of hosts.values()) h.ready.then(s=>s.close()).catch(()=>{});platform.close();}};
}
