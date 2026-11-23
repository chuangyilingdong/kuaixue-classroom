import net from 'node:net';
import http from 'node:http';
import {mkdir,chmod,unlink,readFile,rename,writeFile,stat} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';

const modelSocket='/course-models/m';
const profile='/home/node/.zcode/v2/provider_config.json';
const id='lingdong-platform-gateway';
// Only the trusted host bootstrap reads /binding. The agent sees the models and chat routes.
const api=http.createServer((req,res)=>{
  if(!((req.url==='/v1/models' && req.method==='GET') || (req.url==='/v1/chat/completions' && req.method==='POST'))) {
    res.writeHead(404);return res.end();
  }
  const dest=http.request({socketPath:modelSocket,path:req.url,method:req.method,
    headers:{authorization:req.headers.authorization||'','content-type':req.headers['content-type']||'application/json'},agent:false},remote=>{
    res.writeHead(remote.statusCode,{'content-type':remote.headers['content-type']||'application/json'});
    remote.on('error',()=>res.destroy());remote.pipe(res);res.on('close',()=>remote.destroy());
  });
  dest.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end();});req.pipe(dest);
});
api.listen(3041,'127.0.0.1');await once(api,'listening');

async function binding() {
  return new Promise((resolve,reject)=>{
    const req=http.get({socketPath:modelSocket,path:'/binding',agent:false},async res=>{
      try {
        if(res.statusCode!==200) throw Error('inactive');
        let value='';for await(const chunk of res) value+=chunk;
        resolve(JSON.parse(value));
      } catch(error) {res.resume();reject(error);}
    });
    req.setTimeout(6000,()=>req.destroy(Error('timeout')));req.on('error',reject);
  });
}

let started=false,previous,pending=Promise.resolve();
async function prepare(){
  const grant=await binding().catch(()=>null);
  const ids=grant?.models?.map(model=>model.id.split('::')[1])||[];
  const signature=JSON.stringify([ids,grant?.key]);
  if(previous!==signature){
    const prior=JSON.parse(await readFile(profile,'utf8').catch(error=>{
      if(error.code==='ENOENT') return '{"schemaVersion":1,"config":{}}';
      throw error;
    }));
    const cfg=prior.config;
    cfg.providerConfigRules??={};cfg.modelConfigRules??={};cfg.modelConfigRules.manualProviderModelRules??=[];
    cfg.providerConfigRules.providerRules=(cfg.providerConfigRules.providerRules||[]).filter(provider=>provider.providerId!==id);
    cfg.modelConfigRules.providerModelRules=(cfg.modelConfigRules.providerModelRules||[]).filter(rule=>rule.providerId!==id);
    if(ids.length){
      cfg.providerConfigRules.providerRules.push({providerId:id,providerName:'主站对话模型',config:{
        group:'standard-personal',personalModelIds:ids,
        access:{type:'api-key',apiKey:grant.key},
        api:{type:'openai-chat-completions',baseUrl:'http://127.0.0.1:3041/v1'},visibility:'visible',
      }});
      cfg.modelConfigRules.providerModelRules.push(...ids.map(modelId=>({providerId:id,modelId,
        config:{enabled:true,optionSpecs:{reasoningLevel:{values:['disabled','low','high','max'],defaultLevel:'low'}}}})));
      if(cfg.defaultModelSelection?.providerId!==id || !ids.includes(cfg.defaultModelSelection?.modelId)) {
        cfg.defaultModelSelection={providerId:id,modelId:ids[0],options:{reasoningLevel:'low'}};
      }
    } else if(cfg.defaultModelSelection?.providerId===id) delete cfg.defaultModelSelection;
    await mkdir('/home/node/.zcode/v2',{recursive:true});
    await writeFile(profile+'.kx-new',JSON.stringify(prior),{mode:0o600});
    await rename(profile+'.kx-new',profile);previous=signature;
  }
  if(!started){await import('/opt/kuaixue/host.mjs');started=true;}
  for(let index=0;index<120;index++){
    if(await stat('/ipc/rpc.sock').then(value=>value.isSocket(),()=>false)) return;
    await delay(50);
  }
  throw Error('RPC unavailable');
}

const path='/course-rpc/rpc.sock';
await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});
const relay=net.createServer(client=>{
  client.on('error',()=>{});
  pending=pending.catch(()=>{}).then(prepare);
  pending.then(()=>{
    if(client.destroyed)return;
    const peer=net.createConnection('/ipc/rpc.sock');
    peer.on('error',()=>client.destroy());client.on('close',()=>peer.destroy());
    peer.on('close',()=>client.destroy());client.pipe(peer).pipe(client);
  },()=>client.destroy());
});
relay.listen(path);await once(relay,'listening');await chmod(path,0o660);
