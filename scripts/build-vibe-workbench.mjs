import {readFile,copyFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {brandVibeWorkbench} from './brand-vibe-workbench.mjs';

const upstream = process.argv[2];
if (!upstream) throw Error('请传入灵动 VibeCoding 源码根目录');
const root = resolve(upstream, 'packages/web');
const require = createRequire(resolve(root, 'package.json'));
const {build} = await import(pathToFileURL(require.resolve('vite')).href);
const entry = await readFile(new URL('../integrations/vibecoding/course-entry.tsx', import.meta.url), 'utf8');
const original = resolve(root, 'src/main.tsx');
const serviceHooks = new Set(['Task','Agent','Session'].map(name => resolve(root,`../ui/src/hooks/useZCode${name}Service.ts`)));
// A course workspace arrives after RPC bootstrap. Keep the same hooks on both renders.
async function loadCourseSource(id) {
  if (resolve(id) === original) return entry;
  // The classroom owns the learner's session and wallet, including sign-in and sign-out.
  if (resolve(id) === resolve(root,'../ui/src/WorkspaceSidebarFooter.tsx')) {
    return readFile(new URL('../integrations/vibecoding/course-footer.tsx',import.meta.url),'utf8');
  }
  // The course shell has no full settings surface, but its native directory picker is
  // still available through the classroom bridge. Do not replace folder selection with
  // a hidden conversation-workspace fallback.
  if (resolve(id) === resolve(root,'../ui/src/root/useRootWorkspaceActions.ts')) {
    const source = await readFile(id, 'utf8');
    const next = source.replaceAll(
      'if (!supportsSettings) {',
      'if (!supportsSettings && !platform.canSelectFilePath) {',
    );
    if (next === source) throw Error('灵动打开工作区入口变化，请核对课程适配');
    return next;
  }
  // In the course edition entitlement is supplied by the course gateway. A model is
  // optional for editing, so the upstream provider setup dialog must not block the editor.
  if (resolve(id) === resolve(root,'../ui/src/Root.tsx')) {
    const source = await readFile(id, 'utf8');
    const gate = 'shouldEnableProviderAvailabilityLoginEntryGuard();';
    if (source.split(gate).length !== 2) throw Error('灵动工作台入口变化，请核对课程适配');
    return source.replace(gate,'false;');
  }
  if (resolve(id) === resolve(root,'../ui/src/hooks/useAppPanels.ts')) {
    const source = await readFile(id, 'utf8');
    const hook = 'const prepareWorkPreview = platform?.classroom?.prepareWorkPreview;';
    if (source.split(hook).length !== 2) throw Error('灵动作品预览入口变化，请核对课程适配');
    return source.replace(hook, `const classroom = platform?.classroom as {openCourseHtmlPreview?(url: string): boolean} | undefined;
      if (classroom?.openCourseHtmlPreview?.(payload.url)) return;
      ${hook}`);
  }
  if (!serviceHooks.has(resolve(id))) return null;
  const source = await readFile(id,'utf8');
  const conditional = /const services = workspacePath\s*\? useWorkspaceServices\(([^)]*)\)\s*: useServices\(\);/;
  return source.replace(conditional,`const base = useServices();
  const workspace = useWorkspaceServices($1);
  const services = workspacePath ? workspace : base;`);
}
const output = process.argv.includes('--candidate') ? '../release/vibe-workbench-candidate/' : '../release/vibe-course-web/';
await build({root, configFile:resolve(root, 'vite.config.ts'), base:'/kuaixue/workbench/',
  resolve:{alias:{
    'kuaixue-course-html-preview':fileURLToPath(new URL('../integrations/vibecoding/course-html-preview.mjs',import.meta.url)),
    'kuaixue-course-preview.css':fileURLToPath(new URL('../integrations/vibecoding/course-html-preview.css',import.meta.url)),
    'kuaixue-classroom-font.css':fileURLToPath(new URL('../electron/classroom-font.css',import.meta.url))}},
  plugins:[
    {name:'kuaixue-upstream-compat',enforce:'pre',async load(id){
      if(!/(?:session-store\.port|zcode-protocol-legacy-types)\.ts$/.test(id)) return null;
      let source=await readFile(id,'utf8');
      source=source.replace(/"shared_context",?(\r?\n)(\s*)\]\)/g,
        (match,lineBreak,indent)=>`"shared_context",${lineBreak}${indent}"agent_listing_delta",${lineBreak}${indent}]);`);
      source=source.replace(/"shared_context",?(\r?\n)(\s*)\]( as const;)?/g,
        (match,lineBreak,indent,suffix)=>`"shared_context",${lineBreak}${indent}"agent_listing_delta",${lineBreak}${indent}]${suffix||''}`);
      return source;
    }},
    {name:'kuaixue-course-entry', enforce:'pre', load:loadCourseSource},
  ],
  build:{outDir:fileURLToPath(new URL(output, import.meta.url)), emptyOutDir:true, sourcemap:false},
});

await copyFile(resolve(upstream,'LICENSE'),fileURLToPath(new URL(output+'LICENSE',import.meta.url)));
await brandVibeWorkbench(fileURLToPath(new URL(output, import.meta.url)));
