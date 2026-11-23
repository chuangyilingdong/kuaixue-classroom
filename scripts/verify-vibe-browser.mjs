import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const cli=resolve(process.argv[2]||'/opt/kuaixue/zcode.cjs');
const builtin=resolve(process.argv[3]||'/opt/kuaixue/provider/zcode-builtin.json');
const chrome=resolve(process.argv[4]||'/usr/bin/chromium');
const profile=await mkdtemp(join(tmpdir(),'kx-browser-profile-'));
const workspace=await mkdtemp(join(tmpdir(),'kx-browser-workspace-'));
const model='browser-canary';
let requested=false;
let browserResult=false;

const modelServer=http.createServer(async(req,res)=>{
  if(req.url==='/fixture'){
    res.setHeader('content-type','text/html; charset=utf-8');
    return res.end('<!doctype html><title>Browser Canary</title><h1 id="proof">浏览器可用</h1>');
  }
  let raw='';for await(const chunk of req)raw+=chunk;
  if(req.method==='GET'){
    res.setHeader('content-type','application/json');
    return res.end(JSON.stringify({object:'list',data:[{id:model,object:'model'}]}));
  }
  const request=JSON.parse(raw||'{}');
  const tools=(request.tools||[]).map(tool=>tool.function.name);
  const toolName=tools.find(name=>name.endsWith('__js'));
  const messages=JSON.stringify(request.messages||[]);
  let delta,finish='stop';
  if(!requested && toolName){
    requested=true;
    const target=`http://127.0.0.1:${modelServer.address().port}/fixture`;
    const code=`const root=process.env.ZCODE_PLUGIN_ROOT;if(!root)throw new Error('missing plugin root');const {join}=await import('node:path');const {pathToFileURL}=await import('node:url');const {setupBrowserRuntime}=await import(pathToFileURL(join(root,'scripts','browser-client.mjs')).href);await setupBrowserRuntime({globals:globalThis});const browser=await agent.browsers.get('cdp');const tab=await browser.tabs.new();await tab.goto(${JSON.stringify(target)});await tab.playwright.waitForLoadState({state:'domcontentloaded'});const title=await tab.title();const body=await tab.playwright.locator('#proof').innerText();const shot=await tab.screenshot();nodeRepl.emitImage(shot);nodeRepl.write(JSON.stringify({title,body,screenshotBytes:shot.byteLength}));`;
    delta={role:'assistant',tool_calls:[{index:0,id:'call_browser_canary',type:'function',function:{name:toolName,arguments:JSON.stringify({title:'验证浏览器',code})}}]};
    finish='tool_calls';
  }else{
    browserResult=messages.includes('Browser Canary') && messages.includes('screenshotBytes');
    delta={role:'assistant',content:browserResult?'BROWSER_CANARY_OK':'BROWSER_CANARY_FAILED'};
  }
  res.writeHead(200,{'content-type':'text/event-stream'});
  for(const [part,reason] of [[delta,null],[{},finish]]) {
    res.write(`data: ${JSON.stringify({id:'chatcmpl-browser-canary',object:'chat.completion.chunk',created:10000,
      model,choices:[{index:0,delta:part,finish_reason:reason}]})}\n\n`);
  }
  res.end('data: [DONE]\n\n');
});
modelServer.listen(0,'127.0.0.1');
await once(modelServer,'listening');

const config={schemaVersion:1,config:{
  providerConfigRules:{providerRules:[{providerId:'qa-browser',providerName:'QA Browser',config:{
    group:'standard-personal',personalModelIds:[model],
    access:{type:'api-key',apiKey:'fixture'},
    api:{type:'openai-chat-completions',baseUrl:`http://127.0.0.1:${modelServer.address().port}/v1`},
    visibility:'visible',
  }}]},
  modelConfigRules:{providerModelRules:[{providerId:'qa-browser',modelId:model,config:{enabled:true}}],manualProviderModelRules:[]},
  defaultModelSelection:{providerId:'qa-browser',modelId:model},
}};
await mkdir(join(profile,'.zcode','v2'),{recursive:true});
const personal=join(profile,'.zcode','v2','provider_config.json');
await writeFile(personal,JSON.stringify(config));
const env={...process.env,ZCODE_DATA_BASE_DIR:profile,ZCODE_DESKTOP_HOME_DIR:profile,ZCODE_HOME:join(profile,'.zcode'),
  ZCODE_BUILTIN_PROVIDER_CONFIG_FILE:builtin,ZCODE_PERSONAL_PROVIDER_CONFIG_FILE:personal};
const child=spawn(process.execPath,[cli,'-p','Open the local browser test page and return its title, body, and screenshot.',
  '--surface','desktop','--browser-use=headless','--browser-executable',chrome,'--cwd',workspace,'--json'],
{env,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
const [code,signal]=await once(child,'exit');
clearTimeout(timer);modelServer.close();
if(code!==0 || !requested || !browserResult || !stdout.includes('BROWSER_CANARY_OK')) {
  console.error(JSON.stringify({code,signal,requested,browserResult,stdout:stdout.slice(-2000),stderr:stderr.slice(-3000)},null,2));
  process.exit(1);
}
console.log(JSON.stringify({browserBackend:'cdp',title:'Browser Canary',body:'浏览器可用',screenshot:true,result:'BROWSER_CANARY_OK'}));
