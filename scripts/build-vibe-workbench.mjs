import {readFile,copyFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {brandVibeWorkbench} from './brand-vibe-workbench.mjs';
import {courseIconsPlugin} from '../integrations/vibecoding/course-icons.mjs';

const upstream = process.argv[2];
if (!upstream) throw Error('请传入灵动 VibeCoding 源码根目录');
const root = resolve(upstream, 'packages/web');
const require = createRequire(resolve(root, 'package.json'));
const {build} = await import(pathToFileURL(require.resolve('vite')).href);
const entry = await readFile(new URL('../integrations/vibecoding/course-entry.tsx', import.meta.url), 'utf8');
const original = resolve(root, 'src/main.tsx');
const courseTestIdsModule = '\0kuaixue-zcode-test-ids';
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
    let source = await readFile(id, 'utf8');
    const quota = /  const classroomQuotaLabel = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[classroomSnapshot\?\.quota\?\.limit, classroomSnapshot\?\.quota\?\.used\]\);/;
    if (!quota.test(source)) throw Error('ZCode 课程模型栏额度结构变化，请核对课程适配');
    source = source.replace(quota,'  const classroomQuotaLabel = "";');
    const thoughtImport = 'import { getNextThoughtLevelValue } from "@/chat-input-toolbar/thoughtLevelOptions.js";';
    if (!source.includes(thoughtImport)) throw Error('ZCode 思考档位入口变化，请核对课程模型面板');
    source = source.replace(
      thoughtImport,
      'import { getNextThoughtLevelValue, getThoughtLevelLabel } from "@/chat-input-toolbar/thoughtLevelOptions.js";',
    );
    const shortcutLabel = '  const thoughtShortcutLabel = useShortcutCommandLabel("cycleThoughtLevel");';
    if (!source.includes(shortcutLabel)) throw Error('ZCode 思考档位快捷键入口变化，请核对课程模型面板');
    source = source.replace(shortcutLabel,`${shortcutLabel}
  const classroomComposerOptions = {
    providerLabel: "模型供应商",
    modelsLabel: "模型",
    effortLabel: "思考强度",
    effortShortcutLabel: thoughtShortcutLabel,
    selectModelLabel: "选择模型",
    levels:
      thoughtOption?.options?.map((entry) => ({
        value: entry.value,
        label: getThoughtLevelLabel(intl, displayProvider, thoughtOption, entry),
      })) ?? [],
    value: String(thoughtOption?.currentValue ?? ""),
    onValueChange: handleThoughtValueChange,
  };`);
    const start = source.indexOf('      ) : modelMenuVisible ? (');
    const end = source.indexOf('      {classroomQuotaLabel ? (',start);
    if (start < 0 || end < 0) throw Error('ZCode 模型/思考档工具栏结构变化，请核对课程模型面板');
    source = source.slice(0,start) + `      ) : modelMenuVisible ? (
        <ModelConfigSelect
          modelGroups={classroomModelSelectGroups}
          normalizedValue={normalizedModelValue}
          triggerLabel={modelTriggerDisplay.fullLabel}
          triggerLabelPrefix={modelTriggerDisplay.providerPrefix}
          triggerLabelValue={modelTriggerDisplay.modelLabel}
          triggerLabelPrefixClassName="composer-provider-prefix inline group-data-[composer-provider-compact=true]/toolbar:hidden"
          composerOptions={classroomComposerOptions}
          showManageModelsAction={showManageModelsAction}
          manageModelsLabel={manageModelsLabel}
          onManageModels={handleOpenModelProviderSettings}
          lockReasonMessage={intl.formatMessage({
            id: "chat.toolbar.modelSwitch.lockedByRunningTask",
          })}
          isItemLocked={isModelOptionLocked}
          onValueChange={handleModelValueChange}
          disabled={disabled || recoveryPending || modelSelectionState.status !== "ready"}
          tooltipTitle={modelTriggerDisplay.fullLabel}
          shortcutLabel={modelShortcutLabel}
          triggerRef={modelTriggerRef}
          open={activeConfigPicker === "model"}
          onOpenChange={handleModelPickerOpenChange}
          openRequestKey={modelMenuOpenRequestKey}
          labelVisibilityClassName="hidden @sm/composer:inline-flex"
          indicatorClassName="block group-data-[composer-model-icon=true]/toolbar:hidden"
          triggerLabelClassName="block min-w-0 text-left group-data-[composer-model-icon=true]/toolbar:hidden [&>span]:max-w-full [&>span>span]:block [&>span>span]:truncate"
          triggerClassName="composer-model-trigger group-data-[composer-model-icon=true]/toolbar:size-7 group-data-[composer-model-icon=true]/toolbar:p-0 group-data-[composer-model-icon=true]/toolbar:gap-0 group-data-[composer-model-icon=true]/toolbar:justify-center"
          triggerIconClassName="hidden group-data-[composer-model-icon=true]/toolbar:inline-flex"
          focusSelectorOnClose={V4_COMPOSER_INPUT_SELECTOR}
          providerSubmenuClassName={providerSubmenuClassName}
        />
      ) : null}
` + source.slice(end);
    return source;
  }
  if (resolve(id) === resolve(root,'../ui/src/app-shell/AnimatedSidePanePanel.tsx')) {
    let source = await readFile(id,'utf8');
    const browserAvailable = `supportsEmbeddedBrowser || typeof (globalThis as typeof globalThis & {
      __kuaixueOpenBrowser?: unknown;
    }).__kuaixueOpenBrowser === "function"`;
    const menu = '{supportsEmbeddedBrowser ? (';
    const launcher = '    supportsEmbeddedBrowser,\n  })';
    source = source.replace(/\r\n/g,'\n');
    if (!source.includes(menu) || !source.includes(launcher)) throw Error('ZCode 浏览器菜单入口变化，请核对课程适配');
    return source.replace(menu,`{(${browserAvailable}) ? (`)
      .replace(launcher,`    supportsEmbeddedBrowser: ${browserAvailable},\n  })`);
  }
  if (resolve(id) === resolve(root,'../ui/src/hooks/useAppPanels.ts')) {
    let source = await readFile(id,'utf8');
    source = source.replace(/\r\n/g,'\n');
    const fallbackOpen = '        window.open(payload.url, "_blank", "noopener,noreferrer");';
    if (!source.includes(fallbackOpen)) throw Error('ZCode 外部链接入口变化，请核对课程浏览器适配');
    source = source.replace(fallbackOpen,`        const courseBrowser = (globalThis as typeof globalThis & {
          __kuaixueOpenBrowser?: (url?: string, mode?: "toggle" | "new-tab") => boolean;
        }).__kuaixueOpenBrowser;
        if (courseBrowser?.(payload.url)) return;
        window.open(payload.url, "_blank", "noopener,noreferrer");`);
    const toggle = `    if (!supportsEmbeddedBrowser) {
      // 能力边界：Web/mobile 当前不支持 Electron webview，不创建 Browser side pane。
      logger.info(\`[App] 当前壳层不支持内嵌浏览器，忽略切换请求 workspace=\${workspaceAbsPath}\`);
      return;
    }`;
    if (!source.includes(toggle)) throw Error('ZCode Browser 切换入口变化，请核对课程浏览器适配');
    source = source.replace(toggle,`    if (!supportsEmbeddedBrowser) {
      const courseBrowser = (globalThis as typeof globalThis & {
        __kuaixueOpenBrowser?: (url?: string, mode?: "toggle" | "new-tab") => boolean;
      }).__kuaixueOpenBrowser;
      if (courseBrowser?.()) return;
      logger.info(\`[App] 当前壳层不支持内嵌浏览器，忽略切换请求 workspace=\${workspaceAbsPath}\`);
      return;
    }`);
    const newTab = `    if (!supportsEmbeddedBrowser) {
      // 能力边界：Web/mobile 当前不支持 Electron webview，不创建 Browser side pane。
      logger.info(\`[App] 当前壳层不支持内嵌浏览器，忽略新建请求 workspace=\${workspaceAbsPath}\`);
      return;
    }`;
    const second = source.indexOf(newTab);
    if (second < 0) throw Error('ZCode Browser 新建入口变化，请核对课程浏览器适配');
    source = source.slice(0, second) + `    if (!supportsEmbeddedBrowser) {
      const courseBrowser = (globalThis as typeof globalThis & {
        __kuaixueOpenBrowser?: (url?: string, mode?: "toggle" | "new-tab") => boolean;
      }).__kuaixueOpenBrowser;
      if (courseBrowser?.(undefined, "new-tab")) return;
      logger.info(\`[App] 当前壳层不支持内嵌浏览器，忽略新建请求 workspace=\${workspaceAbsPath}\`);
      return;
    }` + source.slice(second + newTab.length);
    return source;
  }
  if (resolve(id) === resolve(root,'../ui/src/lib/assistantPreviewCards.ts')) {
    const source = await readFile(id, 'utf8');
    const matcher = /export function shouldOpenAssistantHtmlInBrowser\([\s\S]*?\n}\n/;
    if (!matcher.test(source)) throw Error('ZCode HTML 产物打开入口变化，请核对课程适配');
    const changeGate = '    if (reference.kind === "markdown" || reference.kind === "html") {';
    if (!source.includes(changeGate)) throw Error('ZCode 产物文件变更门禁变化，请核对课程适配');
    return source.replace(matcher,`export function shouldOpenAssistantHtmlInBrowser(): boolean {
  return false;
}
`).replace(changeGate,`    if (reference.kind === "html" && getPathLeaf(reference.path).toLowerCase() === "index.html") {
      // 课程作品入口可能在前一轮写入，当前轮只继续测试或说明。后续
      // AssistantPreviewCards 仍会用 fileService.stat 校验文件真实存在。
      fileReferences.push(reference);
      continue;
    }
${changeGate}`);
  }
  if (resolve(id) === resolve(root,'../shared/src/conversation-preview-artifacts.ts')) {
    let source = await readFile(id, 'utf8');
    source = source.replace(/\r\n/g,'\n');
    const requires = '      const requiresFileChanges = reference.kind === "markdown" || reference.kind === "html";';
    if (!source.includes(requires)) throw Error('ZCode 共享产物文件变更规则变化，请核对课程适配');
    source = source.replace(requires,`${requires}
      const stableHtmlEntry =
        reference.kind === "html" && getPathLeaf(reference.path).toLowerCase() === "index.html";`);
    const gate = `      if (
        requiresFileChanges &&`;
    if (!source.includes(gate)) throw Error('ZCode 共享产物文件变更门禁变化，请核对课程适配');
    source = source.replace(gate,`      if (
        requiresFileChanges &&
        !stableHtmlEntry &&`);
    return source.replace(
      '        requiresFileChanges,',
      '        requiresFileChanges: requiresFileChanges && !stableHtmlEntry,',
    );
  }
  if (resolve(id) === resolve(root,'../ui/src/previewPaneContent.tsx')) {
    let source = await readFile(id, 'utf8');
    const reactImport = 'import { useMemo, type Ref, type SyntheticEvent, type UIEventHandler } from "react";';
    if (!source.includes(reactImport)) throw Error('ZCode 文件预览 React 入口变化，请核对课程适配');
    source = source.replace(
      reactImport,
      'import { useEffect, useMemo, useState, type Ref, type SyntheticEvent, type UIEventHandler } from "react";',
    );
    const language = '  const fileLanguage = inferCodeLanguage(source.path, filePreview.content);';
    if (!source.includes(language)) throw Error('ZCode 文件预览语言入口变化，请核对课程适配');
    const props = 'interface PreviewPaneContentProps {';
    if (!source.includes(props)) throw Error('ZCode 文件预览属性入口变化，请核对课程适配');
    source = source.replace(props,`function KuaixueHtmlPreview({ title, content }: { title: string; content: string }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([content], { type: "text/html;charset=utf-8" }));
    setPreviewUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [content]);
  return (
    <iframe
      title={title}
      src={previewUrl ?? undefined}
      sandbox="allow-scripts allow-forms allow-modals allow-downloads allow-popups"
      className="h-full w-full border-0 bg-white"
    />
  );
}

${props}`);
    return source.replace(language,`${language}
  if (source.type !== "code-review" && fileLanguage === "html") {
    return <KuaixueHtmlPreview title={source.title} content={filePreview.content} />;
  }`);
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
    {name:'kuaixue-workbench-brand-assets', enforce:'pre', resolveId(source) {
      if (source.endsWith('/assets/lingdong-app-icon.png')) return fileURLToPath(new URL('../src/assets/kx-class-mark.png', import.meta.url));
      return null;
    }},
    courseIconsPlugin(resolve(root, '../ui')),
    {name:'kuaixue-zcode-v4-ui',enforce:'pre',resolveId(source){
      const modules = {
        '@/ModelConfigSelect.js':resolve(root,'../ui/src/ModelConfigSelect.course-v4.tsx'),
        '@/chat-input-toolbar/ComposerModelMenu.js':resolve(root,'../ui/src/chat-input-toolbar/ComposerModelMenu.tsx'),
        '@/chat-input-toolbar/ComposerProviderMenu.js':resolve(root,'../ui/src/chat-input-toolbar/ComposerProviderMenu.tsx'),
        '@/chat-input-toolbar/ComposerEffortHeading.js':resolve(root,'../ui/src/chat-input-toolbar/ComposerEffortHeading.tsx'),
        '@/chat-input-toolbar/ComposerTriggerTransition.js':resolve(root,'../ui/src/chat-input-toolbar/ComposerTriggerTransition.tsx'),
        '@/chat-input-toolbar/composer-thought-slider.css':resolve(root,'../ui/src/chat-input-toolbar/composer-thought-slider.css'),
        '@/ControlShortcutBadge.js':resolve(root,'../ui/src/ControlShortcutBadge.tsx'),
      };
      if(source==='@zcode/shared/test-ids') return courseTestIdsModule;
      const normalized=String(source).replaceAll('\\','/');
      const suffixModules={
        '/chat-input-toolbar/ComposerModelMenu.js':resolve(root,'../ui/src/chat-input-toolbar/ComposerModelMenu.tsx'),
        '/chat-input-toolbar/ComposerProviderMenu.js':resolve(root,'../ui/src/chat-input-toolbar/ComposerProviderMenu.tsx'),
        '/chat-input-toolbar/ComposerEffortHeading.js':resolve(root,'../ui/src/chat-input-toolbar/ComposerEffortHeading.tsx'),
        '/chat-input-toolbar/ComposerTriggerTransition.js':resolve(root,'../ui/src/chat-input-toolbar/ComposerTriggerTransition.tsx'),
        '/chat-input-toolbar/composer-thought-slider.css':resolve(root,'../ui/src/chat-input-toolbar/composer-thought-slider.css'),
        '/ControlShortcutBadge.js':resolve(root,'../ui/src/ControlShortcutBadge.tsx'),
      };
      const suffix=Object.keys(suffixModules).find(key=>normalized.endsWith(key));
      if(suffix) return suffixModules[suffix];
      return modules[source] || null;
    },async load(id){
      if(id===courseTestIdsModule){
        const originalTestIds=pathToFileURL(resolve(root,'../shared/src/test-ids.ts')).href;
        return `export * from ${JSON.stringify(originalTestIds)};
export const TID_CHAT_MODEL_GUIDE = "chat-model-guide";
export const TID_CHAT_MODEL_GUIDE_DISMISS = "chat-model-guide-dismiss";`;
      }
      if(resolve(id)===resolve(root,'../ui/src/ModelConfigSelect.tsx')||
          resolve(id)===resolve(root,'../ui/src/ModelConfigSelect.course-v4.tsx')){
        return readFile(new URL('../vendor/zcode-v4-ui/components/ModelConfigSelect.tsx',import.meta.url),'utf8');
      }
      if(resolve(id)===resolve(root,'../ui/src/chat-input-toolbar/ComposerModelMenu.tsx'))
        return readFile(new URL('../vendor/zcode-v4-ui/chat-input-toolbar/ComposerModelMenu.tsx',import.meta.url),'utf8');
      if(resolve(id)===resolve(root,'../ui/src/chat-input-toolbar/ComposerProviderMenu.tsx'))
        return readFile(new URL('../vendor/zcode-v4-ui/chat-input-toolbar/ComposerProviderMenu.tsx',import.meta.url),'utf8');
      if(resolve(id)===resolve(root,'../ui/src/chat-input-toolbar/ComposerEffortHeading.tsx'))
        return readFile(new URL('../vendor/zcode-v4-ui/chat-input-toolbar/ComposerEffortHeading.tsx',import.meta.url),'utf8');
      if(resolve(id)===resolve(root,'../ui/src/chat-input-toolbar/ComposerTriggerTransition.tsx'))
        return readFile(new URL('../vendor/zcode-v4-ui/chat-input-toolbar/ComposerTriggerTransition.tsx',import.meta.url),'utf8');
      if(resolve(id)===resolve(root,'../ui/src/chat-input-toolbar/composer-thought-slider.css'))
        return readFile(new URL('../vendor/zcode-v4-ui/chat-input-toolbar/composer-thought-slider.css',import.meta.url),'utf8');
      if(resolve(id)===resolve(root,'../ui/src/ControlShortcutBadge.tsx'))
        return readFile(new URL('../vendor/zcode-v4-ui/components/ControlShortcutBadge.tsx',import.meta.url),'utf8');
      return null;
    }},
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
await copyFile(fileURLToPath(new URL('../public/third-party/IconPark-LICENSE.txt',import.meta.url)),
  fileURLToPath(new URL(output+'IconPark-LICENSE.txt',import.meta.url)));
await brandVibeWorkbench(fileURLToPath(new URL(output, import.meta.url)));
