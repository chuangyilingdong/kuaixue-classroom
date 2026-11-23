import {createServer,createConnection} from 'node:net';
import {chmod,unlink} from 'node:fs/promises';
import {readFile,writeFile} from 'node:fs/promises';
import {createLocalServices,materializeZCodeBuiltinProviderConfig,getAppConfigDir} from '@zcode/services/node';
import {createHttpServer} from './src/http.ts';
import {createManagedCdpBrowserRuntime} from '../../apps/zcode-cli/packages/adapters/src/browser/index.ts';
// The operator mounts a course-scoped provider file, a private RPC token and one persistent project.
const authToken = (await readFile('/run/secrets/rpc-token','utf8')).trim();
if (!/^[\w-]{32,256}$/.test(authToken)) throw Error('RPC identity missing');
try { await writeFile('/workspace/index.html','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>课程作品</title><h1>我的课程作品</h1></html>',{flag:'wx'}); }
catch(error){if(error.code !== 'EEXIST') throw error;}
const builtin = JSON.stringify({schemaVersion:1,revision:1,config:{providerConfigRules:{templateRules:[],providerRules:[]},modelConfigRules:{modelRules:[],modelApiRules:[],providerSiteRules:[],templateModelRules:[],builtinProviderModelRules:[]}}});
const zcodeBuiltinProviderConfigFilePath = await materializeZCodeBuiltinProviderConfig({environmentConfigRoot:getAppConfigDir(),content:builtin});
const browserExecutable=process.env.KUAIXUE_BROWSER_EXECUTABLE?.trim();
const browserRuntime=browserExecutable?createManagedCdpBrowserRuntime({
  executablePath:browserExecutable,
  loadPlaywright:()=>import('playwright-core'),
}):undefined;
const services = createLocalServices({providerProvisioningTargetEnabled:false,zcodeBuiltinProviderConfigFilePath,
  browserControlExecutor:browserRuntime?.browserControlPort});
createHttpServer(services,3030,{host:'127.0.0.1',authToken,authRequired:true});
process.once('SIGTERM',()=>{void browserRuntime?.close();});

const path = '/ipc/rpc.sock';
await unlink(path).catch(error => {if(error.code !== 'ENOENT') throw error;});
const relay = createServer(socket => {
  const target = createConnection({host:'127.0.0.1',port:3030});
  socket.on('error', () => target.destroy()); target.on('error', () => socket.destroy());
  socket.on('close', () => target.destroy()); target.on('close', () => socket.destroy());
  socket.pipe(target).pipe(socket);
});
relay.listen(path, () => {void chmod(path, 0o660);});
