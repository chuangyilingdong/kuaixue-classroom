const {app, BrowserWindow} = require('electron');
const {appendFileSync, mkdtempSync, mkdirSync, writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');

app.disableHardwareAcceleration();
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'kx-vibe-focus-')));
const reportPath = path.resolve(__dirname, '../_qa_render/vibe-focus-latest.json');
const progressPath = path.resolve(__dirname, '../_qa_render/vibe-focus-latest.log');
function progress(message) {
  appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`);
}

async function waitFor(test, label, attempts = 240) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await Promise.resolve().then(test).catch(() => null);
    if (value) return value;
    await delay(100);
  }
  throw Error(`等待超时：${label}`);
}

function focusTimeline() {
  const events = [];
  const add = (type, detail = '') => {
    events.push({
      type,
      detail,
      at: Math.round(performance.now()),
      hasFocus: document.hasFocus(),
      visibility: document.visibilityState,
    });
  };
  window.addEventListener('focus', () => add('window-focus'));
  window.addEventListener('blur', () => add('window-blur'));
  document.addEventListener('focusin', event => {
    const target = event.target;
    add(
      'focusin',
      target instanceof Element
        ? [target.tagName, target.getAttribute('role'), target.getAttribute('aria-label')].filter(Boolean).join(':')
        : '',
    );
  });
  document.addEventListener('focusout', event => {
    const target = event.target;
    add(
      'focusout',
      target instanceof Element
        ? [target.tagName, target.getAttribute('role'), target.getAttribute('aria-label')].filter(Boolean).join(':')
        : '',
    );
  });
  document.addEventListener('visibilitychange', () => add('visibility', document.visibilityState));
  return events;
}

async function snapshot(frame) {
  return frame.executeJavaScript(`(() => {
    const editor = document.querySelector('[role="textbox"][contenteditable="true"]');
    return {
      editorFound: Boolean(editor),
      editorActive: Boolean(editor && document.activeElement === editor),
      editorText: editor?.innerText || '',
      activeTag: document.activeElement?.tagName || '',
      activeRole: document.activeElement?.getAttribute?.('role') || '',
      activeLabel: document.activeElement?.getAttribute?.('aria-label') || '',
      documentFocus: document.hasFocus(),
      visibility: document.visibilityState,
    };
  })()`);
}

app.whenReady().then(async () => {
  writeFileSync(progressPath, `${new Date().toISOString()} app-ready\n`);
  let host;
  let window;
  let frame;
  let bodyText = '';
  let bodyHtml = '';
  let resources = [];
  const consoleMessages = [];
  try {
    progress('opening local runtime');
    const {openCourseLocalVibe} = require('../electron/course-local-vibe.cjs');
    const modelId = 'aicyld-runninghub-llm-cn::deepseek/deepseek-v4.1-flash';
    host = await openCourseLocalVibe({
      run: {
        id: 'focus-diagnostic-run',
        mode: 'VIBECODING',
        completed: [],
        work: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>focus</title></html>',
        course: {
          id: 'focus-diagnostic-course',
          versionId: 'focus-diagnostic-version',
          title: 'Vibe 焦点诊断',
          steps: [],
          classroomConfig: {vibeCoding: {presetPrompts: []}},
          vibeModelIds: [modelId],
        },
      },
      gateway: {
        baseUrl: 'http://127.0.0.1:9/v1',
        token: 'x'.repeat(40),
        expiresAt: Date.now() + 60000,
        modelIds: [modelId],
      },
      userId: 'focus-diagnostic-user',
      resourceRoot: process.env.KX_RESOURCE_ROOT || 'E:/快学课堂vibe/kuaixue-desktop/resources',
      dataRoot: app.getPath('userData'),
    });
    progress(`local runtime ready ${host.frameUrl}`);
    const wrapperUrl = new URL(host.frameUrl);
    wrapperUrl.pathname = '/kuaixue/workbench/qa-wrapper';
    const workspace = path.join(app.getPath('userData'), 'workspace');
    mkdirSync(workspace, {recursive: true});
    writeFileSync(path.join(workspace, 'index.html'), '<!doctype html><title>workspace</title>');
    wrapperUrl.searchParams.set('path', workspace);
    window = new BrowserWindow({
      show: false,
      width: 1440,
      height: 900,
      webPreferences: {contextIsolation: true, nodeIntegration: false, sandbox: true},
    });
    const nativeFocus = [];
    window.on('focus', () => nativeFocus.push({type: 'focus', at: Date.now()}));
    window.on('blur', () => nativeFocus.push({type: 'blur', at: Date.now()}));
    window.webContents.on('did-finish-load', () => progress(`did-finish-load ${window.webContents.getURL()}`));
    window.webContents.on('did-fail-load', (_event, code, description, url, mainFrame) =>
      progress(`did-fail-load ${code} ${description} ${url} main=${mainFrame}`));
    window.webContents.on('render-process-gone', (_event, details) =>
      progress(`render-process-gone ${details.reason} ${details.exitCode}`));
    window.webContents.on('console-message', (_event, level, message, line, source) => {
      consoleMessages.push({level, message, line, source});
      console.error(`console[${level}] ${source}:${line} ${message}`);
    });
    progress('loading wrapper');
    void window.loadURL(wrapperUrl.href).catch(error => progress(`wrapper load error: ${error.message}`));
    frame = await waitFor(
      () => window.webContents.mainFrame.framesInSubtree.find(item => new URL(item.url).pathname === '/kuaixue/workbench/'),
      'Vibe 工作台 frame',
    );
    progress('vibe frame found');
    await delay(3000);
    bodyText = await frame.executeJavaScript('document.body?.innerText || ""').catch(error => String(error));
    bodyHtml = await frame.executeJavaScript('document.documentElement?.outerHTML.slice(0, 4000) || ""').catch(error => String(error));
    resources = await frame.executeJavaScript('performance.getEntriesByType("resource").map(item=>item.name)').catch(() => []);
    progress(`body captured chars=${bodyText.length}`);
    await waitFor(
      () => frame.executeJavaScript('Boolean(document.querySelector(\'[role="textbox"][contenteditable="true"]\'))'),
      '编辑器',
    );
    progress('editor found');
    await frame.executeJavaScript(`globalThis.__focusTimeline = (${focusTimeline.toString()})();`);
    const initial = await snapshot(frame);
    await delay(5000);
    const afterIdle = await snapshot(frame);
    const idleEvents = await frame.executeJavaScript('globalThis.__focusTimeline');
    const focusResult = await frame.executeJavaScript(`(() => {
      const editor = document.querySelector('[role="textbox"][contenteditable="true"]');
      if (!editor) return false;
      editor.click();
      editor.focus();
      return document.activeElement === editor;
    })()`);
    window.webContents.insertText('焦点诊断输入');
    await delay(500);
    const afterType = await snapshot(frame);
    const typedEvents = await frame.executeJavaScript('globalThis.__focusTimeline');
    const report = {
      ok: true,
      initial,
      afterIdle,
      idleEventCount: idleEvents.length,
      idleEvents,
      focusResult,
      afterType,
      typedEventCount: typedEvents.length,
      nativeFocus,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    progress('report written');
    console.log(JSON.stringify(report));
  } catch (error) {
    writeFileSync(reportPath, JSON.stringify({
      ok:false,
      error:error.stack||error.message,
      frameUrl:frame?.url,
      bodyText,
      bodyHtml,
      resources,
      consoleMessages,
    }, null, 2) + '\n');
    progress(`error report written: ${error.message}`);
    console.error(error);
    process.exitCode = 1;
  } finally {
    window?.destroy();
    host?.close();
    app.exit(process.exitCode || 0);
  }
});
