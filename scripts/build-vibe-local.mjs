import {createRequire} from 'node:module';
import {mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]);
const runtime=resolve('release/vibe-local-runtime');
const require=createRequire(join(root,'packages/server/package.json'));
const {build}=require('esbuild');
await mkdir(runtime,{recursive:true});
const options={bundle:true,platform:'node',target:'node22',logLevel:'warning',minify:false,legalComments:'eof',plugins:[{name:'course-local-only',setup(b){
  b.onResolve({filter:/^(ssh2|node-pty|@lydell\/.*)$/}, args=>({path:args.path,namespace:'local-only'}));
  b.onLoad({filter:/.*/,namespace:'local-only'},()=>({contents:`export function spawn(){throw Error('课程演示未启用终端或远程连接')} export class Client {connect(){spawn()}} export default {Client,spawn};`}));
}}],external:['bufferutil','utf-8-validate','*.node']};
// Local preview uses the Lingdong service collection and course-specific model registry.
const demoModelRule = {modelMatch:'^kuaixue-local-preview$', config:{enabled:true,properties:{contextWindow:8192,inputFormat:{supportsText:true,supportsImage:false,supportsVideo:false,supportsAudio:false,supportsPdf:false},outputFormat:{supportsText:true},supportsToolCall:false,supportsJsonSchemaOutput:false,supportsNativeWebSearch:false,supportsMidConversationSystem:false,requiresMfjsToolSchema:false},optionSpecs:{maxOutputTokens:{max:1024,map:'{}'},reasoningLevel:{values:['disabled'],map:'{}'}}}};
const source=`import {createLocalServices,materializeZCodeBuiltinProviderConfig,getAppConfigDir} from '@zcode/services/node';
import {createHttpServer} from './src/http.ts';
const zcodeBuiltinProviderConfigFilePath=await materializeZCodeBuiltinProviderConfig({environmentConfigRoot:getAppConfigDir(),content:JSON.stringify({schemaVersion:1,revision:1,config:{providerConfigRules:{templateRules:[],providerRules:[]},modelConfigRules:{modelRules:[${JSON.stringify(demoModelRule)}],modelApiRules:[],providerSiteRules:[],templateModelRules:[],builtinProviderModelRules:[]}}})});
const services=createLocalServices({providerProvisioningTargetEnabled:false,zcodeBuiltinProviderConfigFilePath});
createHttpServer(services,Number(process.env.PORT),{host:'127.0.0.1',authToken:process.env.ZCODE_SERVER_AUTH_TOKEN,authRequired:true});`;
await build({...options,stdin:{contents:source,resolveDir:join(root,'packages/server'),loader:'ts'},format:'esm',outfile:join(runtime,'course-runtime.mjs'),banner:{js:`import {createRequire as __kxRequire} from 'node:module';const require=__kxRequire(import.meta.url);`},define:{__ZCODE_VERSION__:JSON.stringify('course-preview'),__ZCODE_ENV__:JSON.stringify('test'),__ZCODE_BUILTIN_PROVIDER_CONFIG_JSON__:'undefined'}});
await build({...options,entryPoints:[require.resolve('ws')],format:'cjs',outfile:join(runtime,'socket.cjs')});
await copyFile(join(root,'THIRD-PARTY-NOTICES.md'),join(runtime,'THIRD-PARTY-NOTICES.md'));
await copyFile(join(root,'LICENSE'),join(runtime,'LICENSE'));
