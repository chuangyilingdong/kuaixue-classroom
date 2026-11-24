const {app, BrowserWindow} = require('electron');
const {mkdtempSync, mkdirSync, writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');

app.disableHardwareAcceleration();
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'kx-vibe-send-')));
process.env.KUAIXUE_QA_WRAPPER = '1';

const reportPath = path.resolve(__dirname, '../_qa_render/vibe-send-latest.json');

async function waitFor(test, label, attempts = 240) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await Promise.resolve().then(test).catch(() => null);
    if (value) return value;
    await delay(100);
  }
  throw Error(`等待超时：${label}`);
}

app.whenReady().then(async () => {
  let host;
  let window;
  let frame;
  const consoleMessages = [];
  const pageErrors = [];
  const requests = [];
  try {
    const {openCourseLocalVibe} = require('../electron/course-local-vibe.cjs');
    const modelId = 'aicyld-runninghub-llm-cn::deepseek/deepseek-v4.1-flash';
    host = await openCourseLocalVibe({
      run: {
        id: 'send-diagnostic-run',
        mode: 'VIBECODING',
        completed: [],
        work: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>send</title></html>',
        course: {
          id: 'send-diagnostic-course',
          versionId: 'send-diagnostic-version',
          title: 'Vibe 发送诊断',
          steps: [],
          classroomConfig: {vibeCoding: {presetPrompts: []}},
          vibeModelIds: [modelId],
          vibeModelLabels: {[modelId]:'DeepSeek V4.1 Flash'},
        },
      },
      gateway: {
        baseUrl: 'http://127.0.0.1:9/v1',
        token: 'x'.repeat(40),
        expiresAt: Date.now() + 60000,
        modelIds: [modelId],
      },
      userId: 'send-diagnostic-user',
      resourceRoot: process.env.KX_RESOURCE_ROOT || 'E:/快学课堂vibe/kuaixue-desktop/resources',
      dataRoot: app.getPath('userData'),
    });
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
    window.webContents.on('console-message', (_event, level, message, line, source) => {
      consoleMessages.push({level, message, line, source});
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      pageErrors.push({type: 'render-process-gone', details});
    });
    window.webContents.session.webRequest.onCompleted({urls: ['http://127.0.0.1:*/*']}, details => {
      requests.push({
        type: 'completed',
        method: details.method,
        url: details.url,
        statusCode: details.statusCode,
        fromCache: details.fromCache,
      });
    });
    window.webContents.session.webRequest.onErrorOccurred({urls: ['http://127.0.0.1:*/*']}, details => {
      requests.push({type: 'error', method: details.method, url: details.url, error: details.error});
    });
    await window.loadURL(wrapperUrl.href);
    frame = await waitFor(
      () => window.webContents.mainFrame.framesInSubtree.find(item => {
        const url = new URL(item.url);
        return url.pathname.startsWith('/kuaixue/workbench/') && url.pathname !== '/kuaixue/workbench/qa-wrapper';
      }),
      'Vibe 工作台 frame',
    );
    await waitFor(
      () => frame.executeJavaScript('Boolean(document.querySelector(\'[role="textbox"][contenteditable="true"]\'))'),
      '编辑器',
      900,
    );
    await delay(2000);
    const before = await frame.executeJavaScript(`({
      text: document.body.innerText,
      workspaceLabels: [...document.querySelectorAll('button')]
        .map(item => item.textContent.trim())
        .filter(text => /选择项目|send-diagnostic/.test(text)),
    })`);
    const beforeShot = await window.webContents.capturePage();
    writeFileSync(path.resolve(__dirname, '../_qa_render/vibe-send-before.png'), beforeShot.toPNG());
    await frame.executeJavaScript(`(() => {
      const editor = document.querySelector('[role="textbox"][contenteditable="true"]');
      editor.click();
      editor.focus();
      return document.activeElement === editor;
    })()`);
    window.webContents.insertText('你好');
    await delay(300);
    window.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Return'});
    window.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Return'});
    await delay(8000);
    const after = await frame.executeJavaScript(`({
      text: document.body.innerText,
      editorText: document.querySelector('[role="textbox"][contenteditable="true"]')?.innerText || '',
      dialogs: [...document.querySelectorAll('[role="dialog"],[role="alert"]')]
        .map(item => item.textContent.trim()).filter(Boolean),
    })`);
    const afterShot = await window.webContents.capturePage();
    writeFileSync(path.resolve(__dirname, '../_qa_render/vibe-send-after.png'), afterShot.toPNG());
    writeFileSync(reportPath, JSON.stringify({
      ok: !/草稿会话创建失败/.test(after.text),
      host: host.frameUrl,
      workspace,
      before,
      after,
      consoleMessages,
      pageErrors,
      requests,
    }, null, 2) + '\n');
    console.log(JSON.stringify({
      ok: !/草稿会话创建失败/.test(after.text),
      before,
      after,
      errors: consoleMessages.filter(item => item.level >= 2),
      failedRequests: requests.filter(item => item.type === 'error' || item.statusCode >= 400),
    }));
    if (/草稿会话创建失败/.test(after.text)) process.exitCode = 2;
  } catch (error) {
    const bodyText = await frame?.executeJavaScript('document.body?.innerText || ""').catch(() => '');
    writeFileSync(reportPath, JSON.stringify({
      ok: false,
      error: error.stack || error.message,
      bodyText,
      consoleMessages,
      pageErrors,
      requests,
    }, null, 2) + '\n');
    console.error(error);
    process.exitCode = 1;
  } finally {
    window?.destroy();
    host?.close();
    app.exit(process.exitCode || 0);
  }
});
