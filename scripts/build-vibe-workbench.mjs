import {readFile,copyFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

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
  if (!serviceHooks.has(resolve(id))) return null;
  const source = await readFile(id,'utf8');
  const conditional = /const services = workspacePath\s*\? useWorkspaceServices\(([^)]*)\)\s*: useServices\(\);/;
  return source.replace(conditional,`const base = useServices();
  const workspace = useWorkspaceServices($1);
  const services = workspacePath ? workspace : base;`);
}
await build({root, configFile:resolve(root, 'vite.config.ts'), base:'/kuaixue/workbench/',
  plugins:[{name:'kuaixue-course-entry', enforce:'pre', load:loadCourseSource}],
  build:{outDir:fileURLToPath(new URL('../release/vibe-course-web/', import.meta.url)), emptyOutDir:true, sourcemap:false},
});

await copyFile(resolve(upstream,'LICENSE'),fileURLToPath(new URL('../release/vibe-course-web/LICENSE',import.meta.url)));
