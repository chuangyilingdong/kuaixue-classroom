// Adapted from 灵动 VibeCoding packages/web/src/main.tsx. Uses its actual Root and RPC client.
import { createRoot } from "react-dom/client";
import { Root, AppErrorBoundary, ZCodeIntlProvider, generateMobileDeviceFingerprint, setStreamClientId } from "@zcode/ui";
import "@zcode/ui/styles.css";
import 'kuaixue-classroom-font.css';
import 'kuaixue-course-preview.css';
import { createCourseHtmlPreview } from 'kuaixue-course-html-preview';
import { connectViaWebSocket } from "@zcode/client";
import type { IPlatformService, RemoteTarget } from "@zcode/shared";

type CourseWebPlatform = IPlatformService & {
  classroom: NonNullable<IPlatformService['classroom']> & {openCourseHtmlPreview: (url: string) => boolean};
};

let dialogRequestId = 0;
const pendingClassroomDialogs = new Map<string, {
  resolve: (paths: string[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.data?.type !== 'kuaixue-classroom-paths-result') return;
  const request = pendingClassroomDialogs.get(String(event.data.requestId || ''));
  if (!request) return;
  pendingClassroomDialogs.delete(String(event.data.requestId));
  clearTimeout(request.timer);
  if (event.data.error) request.reject(Error(String(event.data.error)));
  else request.resolve(Array.isArray(event.data.paths) ? event.data.paths.filter((item: unknown) => typeof item === 'string') : []);
});

function chooseClassroomPaths(kind: 'directory' | 'file', multiple = false): Promise<string[]> {
  const requestId = `${Date.now().toString(36)}-${++dialogRequestId}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingClassroomDialogs.delete(requestId);
      reject(Error('文件选择已超时，请重试'));
    }, 5 * 60 * 1000);
    pendingClassroomDialogs.set(requestId, {resolve, reject, timer});
    window.parent.postMessage({
      type: 'kuaixue-classroom-paths-request',
      requestId,
      kind,
      multiple,
    }, '*');
  });
}

function workspaceFileUrl(path: string) {
  const url = new URL('file:///');
  url.pathname = `/${path.replaceAll('\\', '/')}`;
  return url.href;
}

function createWebPlatform(presets, openCourseHtmlPreview): CourseWebPlatform {
  return {
    classroom: {openCourseHtmlPreview, getPresets:async () => presets,getSnapshot:async () => null,
      onClassroomEnded:() => () => {}, claimClassroomEndedAutoSubmit:async () => false,
      completeClassroomEndedAutoSubmit:async () => {},prepareWorkPreview:async () => null,
      logout:async () => {throw Error('请使用快学账号菜单');},scanWorkspaceFiles:async () => {throw Error('使用快学课程工程');},
      submitWork:async () => {throw Error('使用快学作品保存');},listWorks:async () => ({items:[]})},
    canSelectFilePath: true,
    canOpenLocalFiles: true,
    selectDirectory: async () => (await chooseClassroomPaths('directory'))[0] ?? null,
    selectDirectories: () => chooseClassroomPaths('directory', true),
    selectFile: async () => (await chooseClassroomPaths('file'))[0] ?? null,
    selectFiles: () => chooseClassroomPaths('file', true),
    getPathForFile: () => null,
    createTempTextAttachment: () =>
      Promise.reject(new Error("Temporary text attachments require a desktop host")),
    onRemoteConnectionLog: () => () => {},
    onRemoteSessionClosed: () => () => {},
    onBotRemoteWorkspaceReconnected: () => () => {},
    // Web 端无多窗口管理
    activateOrSetWorkspace: () => Promise.resolve({ activated: false }),
    // TODO(web-remote-workspace): 普通 Web 模式先只保证 server 本地工作区可用。
    // 远程 WebSocket 只暴露部分 service，与 Root/RemoteServiceAccess 需要的完整
    // accessor 不匹配，直接打开 ?remote=<id> 会在项目向导或首屏卡住。
    connectRemote(options: RemoteTarget) {
      return Promise.resolve({
        success: false,
        error: `Remote connect is not supported in Web mode yet: ${options.kind}`,
      });
    },
    cancelPendingRemoteConnection: (_requestId?: string) => Promise.resolve(),
    disposeRemoteSession: () => Promise.resolve(),
    isDockerAvailable: () => Promise.resolve(false),
    listWSLDistros: () => Promise.resolve([]),
    listDockerContainers: () => Promise.resolve([]),
    listSSHConfigAliases: () => Promise.resolve([]),
    loadMcpFromUserDirectory: () => Promise.resolve({ servers: [] }),
    saveMcpToUserDirectory: () =>
      Promise.resolve({
        success: false,
        error: "MCP native directory management requires a desktop attachment",
      }),
    migrateLegacyCommonMcp: () =>
      Promise.resolve({
        servers: {},
        totalCount: 0,
        importedCount: 0,
        skippedCount: 0,
      }),
    openExternal: () => {},
    openFeedback: async () => {},
    openCommunity: async () => {},
    canOpenCommunity: async () => false,
    openInFileManager: () =>
      Promise.resolve({ success: false, error: "Not supported in web mode" }),
    openExternalFile: (path: string) =>
      Promise.resolve(openCourseHtmlPreview(workspaceFileUrl(path))
        ? { success: true }
        : { success: false, error: "课程工作区只预览 HTML 文件" }),
    registerOAuthState: (_payload) => {},
    onOAuthCallback: () => () => {},
    onPaymentCallback: () => () => {},
    onShareImport: () => () => {},
    notifyRendererReady: () => {},
    reportTelemetryEvent: async () => {},
    reportArmsCustomEvent: () => Promise.resolve(),
    showTaskNotification: () => {},
    syncWindowTabs: () => {},
    // Web 端没有宿主层 Dock / 任务栏徽标，保持空实现以兼容统一平台接口
    syncWindowUnreadCount: () => {},
    syncActiveTaskSession: () => {},
    onFocusTab: () => () => {},
    onNewTab: () => () => {},
    onCloseActiveContextRequest: () => () => {},
    onOpenBrowserUrl: () => () => {},
    onNewTask: () => () => {},
    onOpenWorkspace: () => () => {},
    onWindowFullscreenChanged: () => () => {},
    onTaskNotificationClick: () => () => {},
    exportLogs: () => Promise.resolve({ success: false, error: "Not supported in web mode" }),
    captureWindowScreenshot: () => Promise.resolve(null),
    importChromeBrowserData: (_options) =>
      Promise.resolve({
        success: false,
        cookies: { imported: 0, skipped: 0, failed: 0 },
        localStorage: {
          originsImported: 0,
          entriesImported: 0,
          originsSkipped: 0,
          originsFailed: 0,
        },
        error: "chrome_import_not_supported" as const,
      }),
    clearEmbeddedBrowserData: () =>
      Promise.resolve({ success: false, error: "Not supported in web mode" }),
    // IPlatformService 新增更新提示能力后，Web fallback 没有同步补齐空实现，
    // 根级 typecheck 会直接失败，连与桌面端无关的改动都没法完成校验。
    // Web 端当前没有桌面更新器，先显式 no-op，保持接口完整且不改变现有行为。
    onUpdateReady: () => () => {},
    onUpdateCheckResult: () => () => {},
    onUpdateStateChanged: () => () => {},
    getUpdateState: () => Promise.resolve({ kind: "idle", enabled: true }),
    downloadUpdate: () => Promise.resolve(),
    cancelUpdateDownload: () => Promise.resolve(),
    getDesktopSessionActivity: () => Promise.resolve({ runningAgentSessionCount: 0 }),
    getDesktopZoomLevel: () => Promise.resolve({ zoomLevel: 0 }),
    onDesktopZoomLevelChanged: () => () => {},
    onPostUpdateReleaseNotes: () => () => {},
    acknowledgePostUpdateReleaseNotes: () => Promise.resolve(),
    skipUpdateVersion: () => Promise.resolve(),
    quitAndInstallUpdate: () => Promise.resolve(),
    getInstalledEditors: () => Promise.resolve([]),
    openInEditor: () => Promise.resolve({ success: false, error: "Not supported in web mode" }),
    executeDesktopCommand: () => Promise.resolve(),
    setApplicationLocale: (_locale) => Promise.resolve(),
    setTitleBarTheme: () => Promise.resolve(),
    getDeviceId: () => {
      const nav = globalThis.navigator as Navigator & { platform?: string };
      const platform = nav?.platform ?? "";
      const screenWidth = globalThis.screen?.width;
      const screenHeight = globalThis.screen?.height;
      const colorDepth = globalThis.screen?.colorDepth;
      const parts = [
        platform,
        screenWidth !== undefined ? String(screenWidth) : "",
        screenHeight !== undefined ? String(screenHeight) : "",
        colorDepth !== undefined ? String(colorDepth) : "",
      ];
      return parts.filter(Boolean).join("|");
    },
  };
}

const root = createRoot(document.getElementById('root')!);
const launch = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, '', location.pathname);
function reportToClassroom(message: string) {
  try { window.parent.postMessage({type:'kuaixue-workbench-error',message}, '*'); } catch {}
}
async function enterCourse() {
  const runId = launch.get('run');
  const ticket = launch.get('ticket');
  if (!ticket || !runId || window.parent === window) throw Error();
  const result = await fetch('/kuaixue/runtime/exchange', {
    method: 'POST', redirect: 'error', cache: 'no-store', credentials: 'omit',
    headers: {'Content-Type':'application/json'}, body: JSON.stringify({runId, ticket}),
    signal: AbortSignal.timeout(12000),
  });
  launch.delete('ticket');
  if (!result.ok) {
    const problem = await result.json().catch(() => null) as {error?:{message?:string;code?:string}} | null;
    throw Error(problem?.error?.message || problem?.error?.code || `工作区换票失败（${result.status}）`);
  }
  const runtime = await result.json();
  if (runtime.runId !== runId || !runtime.workspacePath || typeof runtime.socketId !== 'string' ||
      !/^[a-zA-Z0-9_-]{24,256}$/.test(runtime.socketId)) throw Error();
  if (runtime.previewToken != null && (typeof runtime.previewToken !== 'string' ||
      !/^[a-zA-Z0-9_-]{43}$/.test(runtime.previewToken))) throw Error();
  const protocol = location.protocol === 'https:' ? 'wss' : location.hostname === '127.0.0.1' ? 'ws' : null;
  if (!protocol) throw Error();
  const modelLabels = Object.fromEntries(Object.entries(runtime.modelLabels ?? {})
    .filter(([id,label]) => typeof id === 'string' && id && typeof label === 'string' && label.trim())
    .map(([id,label]) => [id,label.trim()]));
  (globalThis as typeof globalThis & {
    __kuaixueModelLabel?: (modelId: string) => string | undefined;
  }).__kuaixueModelLabel = modelId => modelLabels[modelId];
  const services = await connectViaWebSocket(`${protocol}://${location.host}/kuaixue/runtime/ws/${runtime.socketId}`, {
    onClose: () => root.render(<p role="alert">创作连接已断开，请返回课程后重新进入。</p>),
  });
  let initialProjectId: string | undefined;
  try {
    const project = await services.projectService?.saveProject({
      roots: [runtime.workspacePath],
      reuseExistingRoot: true,
    });
    if (project?.id) initialProjectId = project.id;
  } catch (error) {
    console.warn('[kuaixue-course] 课程项目登记失败，继续打开工程目录', error);
  }
  const registry = await services.modelSelectionService.getView();
  const modelsReady = registry.providers.some(provider => provider.providerId === 'lingdong-platform-gateway' && provider.models.length);
  setStreamClientId(generateMobileDeviceFingerprint());
  root.render(<AppErrorBoundary><ZCodeIntlProvider settingService={services.settingService} broadcastService={services.broadcastService}>
    {!modelsReady && <div role="status" style={{position:'fixed',top:0,right:12,zIndex:10,pointerEvents:'none'}}>课程工程可编辑 · AI 生成未开放</div>}
    <Root services={services} platform={createWebPlatform(runtime.presets ?? [], createCourseHtmlPreview(services.fileService, runtime.workspacePath, runtime.previewToken))} initialWorkspaceAbsPath={runtime.workspacePath}
      initialWorkspaceIdentity={runtime.workspaceIdentity} initialWorkspacePurpose="project"
      initialTaskDraft={initialProjectId ? {projectId: initialProjectId} : undefined}
      restoreSession={false} allowOpenWorkspace
      supportsSettings={false} preferDirectoryBrowser={false} supportsEmbeddedBrowser={false} allowRemoteWorkspace={false} />
  </ZCodeIntlProvider></AppErrorBoundary>);
}
root.render(<p role="status">正在打开课程工作区…</p>);
void enterCourse().catch(error => {
  reportToClassroom(error instanceof Error ? error.message : '课程工作区连接失败');
  root.render(<p role="alert">课程工作区连接失败，请返回课程后重试。</p>);
});
