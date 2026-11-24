import {createRequire} from 'node:module';
import {access,copyFile,cp,mkdir,mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {extractAll} from '@electron/asar';
const root=resolve(process.argv[2]);
const installed=resolve(process.argv[3]||'E:/灵动code/@zcodedesktop/resources/glm');
const cliSource=resolve(process.argv[4]||join(root,'apps/zcode-cli/packages/cli/dist/zcode.cjs'));
const runtime=resolve(process.argv.includes('--candidate')?'release/vibe-local-runtime-candidate':'release/vibe-local-runtime');
const runtimeOnly=process.argv.includes('--runtime-only');
const require=createRequire(join(root,'packages/server/package.json'));
const {build}=require('esbuild');
await mkdir(runtime,{recursive:true});
await mkdir(join(runtime,'node'),{recursive:true});
await copyFile(process.execPath,join(runtime,'node','node.exe'));
const options={bundle:true,platform:'node',target:'node22',logLevel:'warning',minify:false,legalComments:'eof',plugins:[{name:'course-local-only',setup(b){
  b.onResolve({filter:/^(ssh2|node-pty|@lydell\/.*)$/}, args=>({path:args.path,namespace:'local-only'}));
  b.onLoad({filter:/.*/,namespace:'local-only'},()=>({contents:`export function spawn(){throw Error('课程演示未启用终端或远程连接')} export class Client {connect(){spawn()}} export default {Client,spawn};`}));
}}],external:['bufferutil','utf-8-validate','*.node','playwright-core','@napi-rs/keyring']};
options.plugins.unshift({name:'upstream-compatibility',setup(builder){
  builder.onLoad({filter:/(?:session-store\.port|zcode-protocol-legacy-types)\.ts$/},async args=>{
    let source=await import('node:fs/promises').then(fs=>fs.readFile(args.path,'utf8'));
    source=source.replace(/"shared_context",?(\r?\n)(\s*)\]\)/g,
      (match,lineBreak,indent)=>`"shared_context",${lineBreak}${indent}"agent_listing_delta",${lineBreak}${indent}]);`);
    source=source.replace(/"shared_context",?(\r?\n)(\s*)\]( as const;)?/g,
      (match,lineBreak,indent,suffix)=>`"shared_context",${lineBreak}${indent}"agent_listing_delta",${lineBreak}${indent}]${suffix||''}`);
    return {contents:source,loader:'ts'};
  });
  builder.onLoad({filter:/zcodeAgentProcessManager\.ts$/},async args=>{
    let source=await import('node:fs/promises').then(fs=>fs.readFile(args.path,'utf8'));
    const pattern=/const windowsRuntime\s*=\s*process\.platform === "win32"\s*\?\s*await spawnWindowsRuntimeHost\(\{[\s\S]*?\}\)\s*:\s*undefined;/;
    // Newer ZCode versions removed this dedicated runtime-host branch. Only patch
    // the legacy shape; an absent marker is the supported current layout.
    if(pattern.test(source))source=source.replace(pattern,'const windowsRuntime = undefined;');
    return {contents:source,loader:'ts'};
  });
  builder.onLoad({filter:/zcodeStdioTransport\.ts$/},async args=>{
    let source=await import('node:fs/promises').then(fs=>fs.readFile(args.path,'utf8'));
    const marker=/if \(process\.platform === "win32"\)\r?\n\s*throw new Error\("Windows CLI cleanup requires a runtime Job owner"\);/;
    // Current ZCode owns Windows process cleanup internally. Keep the legacy
    // compatibility patch only when that guard is still present.
    if(marker.test(source))source=source.replace(marker,'// The course runtime owns a private agent and uses the process-tree fallback below.');
    return {contents:source,loader:'ts'};
  });
}});
// Local preview uses the Lingdong service collection and course-specific model registry.
const demoModelRule = {modelMatch:'^.+$', config:{enabled:true,properties:{contextWindow:200000,inputFormat:{supportsText:true,supportsImage:true,supportsVideo:false,supportsAudio:false,supportsPdf:true},outputFormat:{supportsText:true},supportsToolCall:true,supportsJsonSchemaOutput:true,supportsNativeWebSearch:true,supportsMidConversationSystem:false,requiresMfjsToolSchema:false},optionSpecs:{maxOutputTokens:{max:32768,map:'{}'},reasoningLevel:{values:['disabled','low','high','max'],map:'{}'}}}};
const source=`import {createLocalServices,materializeZCodeBuiltinProviderConfig,getAppConfigDir} from '@zcode/services/node';
import {createHttpServer} from './src/http.ts';
import {createManagedCdpBrowserRuntime} from '../../apps/zcode-cli/packages/adapters/src/browser/index.ts';
const zcodeBuiltinProviderConfigFilePath=await materializeZCodeBuiltinProviderConfig({environmentConfigRoot:getAppConfigDir(),content:JSON.stringify({schemaVersion:1,revision:1,config:{providerConfigRules:{templateRules:[],providerRules:[]},modelConfigRules:{modelRules:[${JSON.stringify(demoModelRule)}],modelApiRules:[],providerSiteRules:[],templateModelRules:[],builtinProviderModelRules:[]}}})});
const browserExecutable=process.env.KUAIXUE_BROWSER_EXECUTABLE?.trim();
const browserRuntime=browserExecutable?createManagedCdpBrowserRuntime({executablePath:browserExecutable,loadPlaywright:()=>import('playwright-core')}):undefined;
const services=createLocalServices({providerProvisioningTargetEnabled:false,zcodeBuiltinProviderConfigFilePath,browserControlExecutor:browserRuntime?.browserControlPort});
process.once('SIGTERM',()=>{void browserRuntime?.close();});
createHttpServer(services,Number(process.env.PORT),{host:'127.0.0.1',authToken:process.env.ZCODE_SERVER_AUTH_TOKEN,authRequired:true});`;
await build({...options,stdin:{contents:source,resolveDir:join(root,'packages/server'),loader:'ts'},format:'esm',outfile:join(runtime,'course-runtime.mjs'),banner:{js:`import {createRequire as __kxRequire} from 'node:module';const require=__kxRequire(import.meta.url);`},define:{__ZCODE_VERSION__:JSON.stringify('course-preview'),__ZCODE_ENV__:JSON.stringify('test'),__ZCODE_BUILTIN_PROVIDER_CONFIG_JSON__:'undefined'}});
await build({...options,entryPoints:[require.resolve('ws')],format:'cjs',outfile:join(runtime,'socket.cjs')});
await copyFile(join(root,'THIRD-PARTY-NOTICES.md'),join(runtime,'THIRD-PARTY-NOTICES.md'));
await copyFile(join(root,'LICENSE'),join(runtime,'LICENSE'));

if(!runtimeOnly){
  await rm(join(runtime,'packages'),{recursive:true,force:true});
  await rm(join(runtime,'provider'),{recursive:true,force:true});
  await rm(join(runtime,'node_modules'),{recursive:true,force:true});
  await cp(join(installed,'packages'),join(runtime,'packages'),{recursive:true,dereference:true});
  await copyFile(cliSource,join(runtime,'zcode.cjs'));
  await mkdir(join(runtime,'provider'),{recursive:true});
  await copyFile(join(root,'config/provider/zcode-builtin.json'),join(runtime,'provider','zcode-builtin.json'));
  const localPlaywright=resolve('release/vibe-server/asar-extract/node_modules/playwright-core');
  let playwrightSource=localPlaywright,temporary;
  try {await access(join(localPlaywright,'package.json'));}
  catch {
    temporary=await mkdtemp(join(tmpdir(),'kx-local-asar-'));
    await extractAll(resolve(installed,'../app.asar'),temporary);
    playwrightSource=join(temporary,'node_modules','playwright-core');
  }
  await mkdir(join(runtime,'node_modules'),{recursive:true});
  await cp(playwrightSource,join(runtime,'node_modules','playwright-core'),{recursive:true,dereference:true});
  const sourceKeyringRoot=join(root,'node_modules','@napi-rs');
  const keyringRoot=await access(join(sourceKeyringRoot,'keyring')).then(()=>sourceKeyringRoot,async()=>{
    for(const fallback of [
      join(resolve('release/vibe-local-runtime-candidate'),'node_modules','@napi-rs'),
      join(resolve('release/vibe-local-runtime'),'node_modules','@napi-rs'),
    ]) {
      if(await access(join(fallback,'keyring')).then(()=>true,()=>false))return fallback;
    }
    throw Error('找不到 @napi-rs/keyring 构建依赖');
  });
  await access(join(keyringRoot,'keyring'));
  await cp(join(keyringRoot,'keyring'),join(runtime,'node_modules','@napi-rs','keyring'),{recursive:true,dereference:true});
  for(const name of await readdir(keyringRoot)){
    if(!name.startsWith('keyring-'))continue;
    await cp(join(keyringRoot,name),join(runtime,'node_modules','@napi-rs',name),{recursive:true,dereference:true});
  }
  if(temporary) await rm(temporary,{recursive:true,force:true});
}
