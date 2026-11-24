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
  if (resolve(id) === resolve(root,'../ui/src/lib/modelSelectionGroups.ts')) {
    const source = await readFile(id, 'utf8');
    const marker = 'name: modelId,';
    if (!source.includes(marker)) throw Error('ZCode 模型选择显示名结构变化，请核对课程适配');
    return source.replace(
      marker,
      'name: (globalThis as typeof globalThis & { __kuaixueModelLabel?: (modelId: string) => string | undefined }).__kuaixueModelLabel?.(modelId) ?? modelId,',
    );
  }
  // In the course edition entitlement is supplied by the course gateway. A model is
  // optional for editing, so the upstream provider setup dialog must not block the editor.
  if (resolve(id) === resolve(root,'../ui/src/Root.tsx')) {
    const source = await readFile(id, 'utf8');
    const legacyGate = 'shouldEnableProviderAvailabilityLoginEntryGuard();';
    if (source.includes(legacyGate)) return source.replace(legacyGate,'false;');
    // ZCode 4.x 把启动供应商门禁改为带参数调用。课堂权益已由课程服务校验，
    // 不能再用个人账号或供应商登录门禁阻塞编辑和课堂模型。
    const gate = /const providerAvailabilityLoginEntryGuardEnabled\s*=\s*shouldEnableProviderAvailabilityLoginEntryGuard\(\{[\s\S]*?\n\s*\}\);/;
    if (!gate.test(source)) throw Error('ZCode 工作台供应商启动门禁变化，请核对课程适配');
    return source.replace(gate,'const providerAvailabilityLoginEntryGuardEnabled = false;');
  }
  if (resolve(id) === resolve(root,'../ui/src/v4/ConversationComposer.tsx')) {
    let source = await readFile(id, 'utf8');
    source = source.replace(/\r\n/g,'\n');
    const snapshot = 'const { snapshot: classroomSnapshot } = useClassroomPlatformSnapshot();';
    if (!source.includes(snapshot)) throw Error('ZCode 课程额度快照入口变化，请核对课程适配');
    source = source.replace(snapshot,'const { snapshot: classroomSnapshot } = useClassroomPlatformSnapshot({ pollMs: 1_000 });');
    const prep = 'const prepModeRef = useRef(prepMode);';
    if (!source.includes(prep)) throw Error('ZCode 课程 Composer 状态入口变化，请核对课程适配');
    source = source.replace(prep, `const classroomQuota = classroomSnapshot?.quota ?? null;
  const classroomQuotaRemaining = classroomQuota?.limit == null ? null : Math.max(0, classroomQuota.remaining ?? classroomQuota.limit - classroomQuota.used);
  const classroomQuotaExhausted = Boolean(classroomQuota && classroomQuotaRemaining !== null && classroomQuotaRemaining <= 0);
  const classroomQuotaLabel = !classroomQuota ? "" : classroomQuota.limit === null ? "Vibe 不限次数" : classroomQuotaRemaining === 0 ? "Vibe 0 次可用" : \`Vibe 剩余 \${classroomQuotaRemaining} 次\`;
  const classroomQuotaTitle = !classroomQuota ? "" : classroomQuota.limit === null ? "本课程 VibeCoding 不限发送次数" : classroomQuotaExhausted ? \`本课程 VibeCoding 次数已用完（已用 \${classroomQuota.used} 次，上限 \${classroomQuota.limit} 次），发送按钮已停用\` : \`本课程 VibeCoding 剩余 \${classroomQuotaRemaining} 次，已用 \${classroomQuota.used} 次，上限 \${classroomQuota.limit} 次\`;
  ${prep}`);
    const canSend = `  const canSend =
    !disabled &&
    !pending &&`;
    if (!source.includes(canSend)) throw Error('ZCode Composer 发送门禁变化，请核对课程适配');
    source = source.replace(canSend,`  const canSend =
    !disabled &&
    !pending &&
    !classroomQuotaExhausted &&`);
    const submitGuard = `        !submissionReady ||
        (createSubmissionFromComposer !== undefined && submission === null) ||`;
    if (!source.includes(submitGuard)) throw Error('ZCode Composer 提交门禁变化，请核对课程适配');
    source = source.replace(submitGuard,`        !submissionReady ||
        classroomQuotaExhausted ||
        (createSubmissionFromComposer !== undefined && submission === null) ||`);
    const submitDisabled = 'submitDisabled={pending || !routingAllowsSend || !attachmentsReady || !submissionReady}';
    if (!source.includes(submitDisabled)) throw Error('ZCode Composer 输入发送门禁变化，请核对课程适配');
    source = source.replace(submitDisabled,'submitDisabled={pending || !routingAllowsSend || !attachmentsReady || !submissionReady || classroomQuotaExhausted}');
    const dependency = `      createSubmissionFromComposer,
      submissionReady,`;
    if (!source.includes(dependency)) throw Error('ZCode Composer 提交依赖变化，请核对课程适配');
    source = source.replace(dependency,`      createSubmissionFromComposer,
      submissionReady,
      classroomQuotaExhausted,`);
    const leadingMarker = `        />
        {/* 附件画廊重构曾整段覆盖 leadingActions，误删 CUA 常驻入口。`;
    if (!source.includes(leadingMarker)) throw Error('ZCode Composer 底栏结构变化，请核对课程适配');
    source = source.replace(leadingMarker,`        />
        {classroomQuotaLabel ? <span
          className={\`inline-flex h-7 shrink-0 items-center rounded-full border px-2.5 text-ui-sm font-medium tabular-nums \${classroomQuotaExhausted ? "border-[var(--color-warning)]/45 bg-[var(--color-warning)]/10 text-[var(--color-warning)]" : "border-input-border bg-input text-foreground-subtle"}\`}
          title={classroomQuotaTitle}
          aria-label={classroomQuotaTitle}
          aria-live="polite"
          data-kuaixue-vibe-quota="true"
        >{classroomQuotaLabel}</span> : null}
        {/* 附件画廊重构曾整段覆盖 leadingActions，误删 CUA 常驻入口。`);
    return source;
  }
  if (resolve(id) === resolve(root,'../ui/src/v4/composer/V4ComposerToolbar.tsx')) {
    const source = await readFile(id, 'utf8');
    const quota = /  const classroomQuotaLabel = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[classroomSnapshot\?\.quota\?\.limit, classroomSnapshot\?\.quota\?\.used\]\);/;
    if (!quota.test(source)) throw Error('ZCode 课程模型栏额度结构变化，请核对课程适配');
    return source.replace(quota,'  const classroomQuotaLabel = "";');
  }
  if (resolve(id) === resolve(root,'../ui/src/hooks/useAppPanels.ts')) {
    const source = await readFile(id, 'utf8');
    const hook = 'const prepareWorkPreview = platform?.classroom?.prepareWorkPreview;';
    const payload = /const payload: EmbeddedBrowserOpenUrlRequest =\r?\n\s*typeof request === "string" \? \{ url: request, disposition: "foreground-tab" \} : request;/;
    const payloadMatch = source.match(payload);
    if (!payloadMatch) throw Error('ZCode 浏览器打开入口变化，请核对课程适配');
    const patched = source.replace(payload, `${payloadMatch[0]}
      const openCourseHtml = (globalThis as typeof globalThis & {
        __kuaixueOpenCourseHtmlPreview?: (url: string) => boolean;
      }).__kuaixueOpenCourseHtmlPreview;
      if (/^file:.*\\.html?(?:[?#].*)?$/iu.test(payload.url) && openCourseHtml?.(payload.url)) return;`);
    // ZCode 4.x 的 HTML 产物预览已经统一走 browser side pane。课堂仍保留自己的
    // 受保护静态预览，后续通过平台回调接入；不再依赖已经移除的旧 hook。
    if (!patched.includes(hook)) return patched;
    return patched.replace(hook, `const classroom = platform?.classroom as {openCourseHtmlPreview?(url: string): boolean} | undefined;
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
  resolve:{dedupe:['react','react-dom','react/jsx-runtime','react/jsx-dev-runtime'],alias:{
    'kuaixue-presets-dialog':fileURLToPath(new URL('../integrations/vibecoding/LingdongPresetsDialog.tsx',import.meta.url)),
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
