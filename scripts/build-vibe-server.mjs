import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {mkdir,copyFile,readFile} from 'node:fs/promises';
const upstream = resolve(process.argv[2]);
const upstreamRequire = createRequire(join(upstream,'packages/server/package.json'));
const {build} = upstreamRequire('esbuild');
const output = resolve('release/vibe-server');
const upstreamCompatibility={name:'upstream-compatibility',setup(builder){
  builder.onLoad({filter:/(?:session-store\.port|zcode-protocol-legacy-types)\.ts$/},async args=>{
    let source=await readFile(args.path,'utf8');
    source=source.replace(/"shared_context",?(\r?\n)(\s*)\]\)/g,
      (match,lineBreak,indent)=>`"shared_context",${lineBreak}${indent}"agent_listing_delta",${lineBreak}${indent}]);`);
    source=source.replace(/"shared_context",?(\r?\n)(\s*)\]( as const;)?/g,
      (match,lineBreak,indent,suffix)=>`"shared_context",${lineBreak}${indent}"agent_listing_delta",${lineBreak}${indent}]${suffix||''}`);
    return {contents:source,loader:'ts'};
  });
}};
await mkdir(output,{recursive:true});
const options = {bundle:true, platform:'node', target:'node24', legalComments:'eof', logLevel:'error'};
await build({...options, entryPoints:['integrations/vibecoding/deploy/entry.mjs'], format:'cjs',
  alias:{ws:upstreamRequire.resolve('ws')}, external:['bufferutil','utf-8-validate'], outfile:join(output,'gateway.cjs')});
// This course build registers the original RPC services with remote SSH and PTY disabled.
const hostSource = await readFile('integrations/vibecoding/deploy/host-entry.ts','utf8');
await build({...options, stdin:{contents:hostSource, resolveDir:join(upstream,'packages/server'),loader:'ts'},
  format:'esm', outfile:join(output,'host.mjs'), external:['bufferutil','utf-8-validate','*.node','playwright-core'],
  banner:{js:`import {createRequire as __kxRequire} from 'node:module'; const require=__kxRequire(import.meta.url);`},
  define:{__ZCODE_ENV__:JSON.stringify('production'),__ZCODE_VERSION__:JSON.stringify(JSON.parse(await readFile(join(upstream,'package.json'),'utf8')).version)},
  plugins:[upstreamCompatibility,{name:'course-host',setup(b){b.onResolve({filter:/^(ssh2|node-pty|@lydell\/.*)$/},args=>({path:args.path,namespace:'restricted'}));
    b.onLoad({filter:/.*/,namespace:'restricted'},()=>({contents:`export function spawn(){throw Error('课程宿主未启用终端和 SSH')} export class Client {connect(){spawn()}} export default {Client,spawn};` }));}}]});
for(const name of ['LICENSE','THIRD-PARTY-NOTICES.md']) await copyFile(join(upstream,name),join(output,name));
