const {app, BrowserWindow} = require('electron');
const {mkdtempSync, mkdirSync, writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');

const reportPath = path.join(tmpdir(), 'kuaixue-vibe-editor-verification.json');
const screenshotPath = path.resolve(__dirname, '../_qa_render/vibe-editor-verification.png');
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'kx-vibe-editor-')));
process.env.KUAIXUE_QA_WRAPPER = '1';

async function waitFor(test, label, attempts = 180) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await Promise.resolve().then(test).catch(() => null);
    if (value) return value;
    await delay(100);
  }
  throw Error(`等待超时：${label}`);
}

app.whenReady().then(async () => {
  let host;
  let window;
  try {
    const {openCourseLocalVibe} = require('../electron/course-local-vibe.cjs');
    const modelId = 'aicyld-runninghub-llm-cn::deepseek/deepseek-v4.1-flash';
    host = await openCourseLocalVibe({
      run: {
        id: 'local-editor-check-run',
        mode: 'VIBECODING',
        completed: [],
        work: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>check</title><h1>检查</h1></html>',
        course: {
          id: 'local-editor-check-course',
          versionId: 'local-editor-check-version',
          title: 'Vibe 编辑器检查',
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
        usage: {limit: 10, used: 83, remaining: 0},
      },
      userId: 'local-editor-check-user',
      resourceRoot: process.env.KX_RESOURCE_ROOT || 'E:/快学课堂vibe/kuaixue-desktop/resources',
      dataRoot: app.getPath('userData'),
    });
    window = new BrowserWindow({
      show: false,
      width: 1440,
      height: 900,
      webPreferences: {contextIsolation: true, nodeIntegration: false, sandbox: true},
    });
    window.webContents.on('console-message', (_event, level, message, line, source) => {
      console.error(`console[${level}] ${source}:${line} ${message}`);
    });
    const wrapperUrl = new URL(host.frameUrl);
    wrapperUrl.pathname = '/kuaixue/workbench/qa-wrapper';
    const alternateWorkspace = path.join(app.getPath('userData'), 'alternate-workspace');
    mkdirSync(alternateWorkspace, {recursive: true});
    writeFileSync(path.join(alternateWorkspace, 'index.html'), '<!doctype html><title>alternate workspace</title>');
    wrapperUrl.searchParams.set('path', alternateWorkspace);
    await window.loadURL(wrapperUrl.href);
    const frame = await waitFor(
      () => window.webContents.mainFrame.framesInSubtree.find(item => new URL(item.url).pathname === '/kuaixue/workbench/'),
      'Vibe 工作台 frame',
    );
    await delay(1000);
    console.log(JSON.stringify({
      frameUrl: frame.url,
      body: await frame.executeJavaScript('document.body?.innerText || ""').catch(error => String(error)),
      html: await frame.executeJavaScript('document.documentElement?.outerHTML.slice(0, 1200) || ""').catch(error => String(error)),
      resources: await frame.executeJavaScript('performance.getEntriesByType("resource").map(item => item.name)').catch(error => String(error)),
    }));
    await waitFor(() => frame.executeJavaScript('document.body.innerText.includes("向小灵提问")'), '编辑器');
    await waitFor(
      () => frame.executeJavaScript('Boolean(document.querySelector("[data-kuaixue-vibe-quota]"))'),
      'Vibe 额度',
    );
    const quota = await frame.executeJavaScript(`(() => {
      const badge = document.querySelector('[data-kuaixue-vibe-quota]');
      return {
        text: badge?.textContent?.trim() || '',
        title: badge?.getAttribute('title') || '',
        ariaLabel: badge?.getAttribute('aria-label') || '',
      };
    })()`);
    const editor = await frame.executeJavaScript(`(() => {
      const candidates = [...document.querySelectorAll('textarea,input,[contenteditable="true"],[role="textbox"]')];
      return candidates.map((element, index) => {
        const style = getComputedStyle(element);
        return {
          index,
          tag: element.tagName,
          role: element.getAttribute('role'),
          contenteditable: element.getAttribute('contenteditable'),
          disabled: Boolean(element.disabled),
          readOnly: Boolean(element.readOnly),
          ariaDisabled: element.getAttribute('aria-disabled'),
          pointerEvents: style.pointerEvents,
          visibility: style.visibility,
          display: style.display,
          placeholder: element.getAttribute('placeholder') || element.getAttribute('data-placeholder') || '',
        };
      });
    })()`);
    const buttonCandidates = await frame.executeJavaScript(`(() => [...document.querySelectorAll('button')]
      .filter(item => /workspace|打开文件夹|选择项目|不在项目中工作/.test(item.textContent))
      .map(item => {
        const rect = item.getBoundingClientRect();
        return {text:item.textContent.trim(),x:rect.x,y:rect.y,width:rect.width,height:rect.height,disabled:Boolean(item.disabled)};
      }))()`);
    window.show();
    window.focus();
    await delay(300);
    const editorHit = await frame.executeJavaScript(`(() => {
      const editor = document.querySelector('[role="textbox"][contenteditable="true"]');
      if (!editor) return false;
      const rect = editor.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {x:rect.left + rect.width / 2,y:rect.top + rect.height / 2,hitTag:hit?.tagName,hitRole:hit?.getAttribute('role'),inside:Boolean(hit && editor.contains(hit))};
    })()`);
    if (editorHit?.inside) {
      const {x, y} = editorHit;
      window.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});
      window.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});
      await delay(100);
    }
    await frame.executeJavaScript(`(() => {
      const editor = document.querySelector('[role="textbox"][contenteditable="true"]');
      if (!editor) return false;
      editor.click();
      editor.focus();
      return document.activeElement === editor;
    })()`);
    window.webContents.insertText('测试输入');
    await delay(300);
    const typedText = await frame.executeJavaScript(`document.querySelector('[role="textbox"][contenteditable="true"]')?.innerText || ''`);
    const sendControl = await frame.executeJavaScript(`(() => {
      const button = document.querySelector('[data-testid="v4-composer-send"]');
      return button ? {found:true,disabled:Boolean(button.disabled),ariaDisabled:button.getAttribute('aria-disabled')} : {found:false};
    })()`);
    const commandText = await frame.executeJavaScript(`(() => {
      const editor = document.querySelector('[role="textbox"][contenteditable="true"]');
      if (!editor) return {text:'',html:'',command:false};
      editor.focus();
      const command = document.execCommand('insertText', false, '命令输入');
      return {text:editor.innerText,html:editor.innerHTML,command,isContentEditable:editor.isContentEditable,active:document.activeElement===editor};
    })()`);
    await delay(300);
    const commandTextAfter = await frame.executeJavaScript(`(() => {
      const editor = document.querySelector('[role="textbox"][contenteditable="true"]');
      if (!editor) return {};
      editor.textContent = '直接写入';
      return {text:editor.innerText,html:editor.innerHTML};
    })()`);
    const workspaceMenu = await frame.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'workspace' && item.getBoundingClientRect().height > 24);
      if (!button) return {found:false};
      button.click();
      return {found:true,disabled:button.disabled,ariaDisabled:button.getAttribute('aria-disabled')};
    })()`);
    const workspaceButton = await frame.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'workspace' && item.getBoundingClientRect().height > 24);
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};
    })()`);
    if (workspaceButton) {
      window.webContents.sendInputEvent({type:'mouseDown',x:workspaceButton.x,y:workspaceButton.y,button:'left',clickCount:1});
      window.webContents.sendInputEvent({type:'mouseUp',x:workspaceButton.x,y:workspaceButton.y,button:'left',clickCount:1});
      await delay(300);
    }
    const menuItems = await frame.executeJavaScript(`(() => [...document.querySelectorAll('button,[role="menuitem"]')]
      .filter(item => /打开文件夹|不在项目中工作|新建工作区|创建工作区/.test(item.textContent))
      .map(item => {const rect=item.getBoundingClientRect();return {text:item.textContent.trim(),x:rect.left+rect.width/2,y:rect.top+rect.height/2,disabled:Boolean(item.disabled)}}))()`);
    const openFolder = menuItems.find(item => item.text === '打开文件夹');
    if (openFolder) {
      window.webContents.sendInputEvent({type:'mouseDown',x:openFolder.x,y:openFolder.y,button:'left',clickCount:1});
      window.webContents.sendInputEvent({type:'mouseUp',x:openFolder.x,y:openFolder.y,button:'left',clickCount:1});
      await delay(1000);
    }
    const afterOpen = await frame.executeJavaScript(`document.body.innerText`);
    await delay(500);
    const menu = await frame.executeJavaScript(`(() => {
      const buttons = [...document.querySelectorAll('button,[role="menuitem"]')].filter(item => /打开文件夹|不在项目中工作|新建工作区/.test(item.textContent));
      return buttons.map(item => ({text:item.textContent.trim(),disabled:Boolean(item.disabled),ariaDisabled:item.getAttribute('aria-disabled')}));
    })()`);
    window.showInactive();
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    writeFileSync(reportPath, JSON.stringify({
      ok: true,
      frameUrl: host.frameUrl,
      editor,
      quota,
      sendControl,
      buttonCandidates,
      editorHit,
      typedText,
      commandText,
      commandTextAfter,
      workspaceMenu,
      menu,
      menuItems,
      afterOpen,
      screenshot: screenshotPath,
    }, null, 2) + '\n');
    console.log(JSON.stringify({ok:true, quota, sendControl, editor, workspaceMenu, menu, screenshot:screenshotPath}));
  } catch (error) {
    writeFileSync(reportPath, JSON.stringify({ok:false, error:error.stack || error.message}, null, 2) + '\n');
    console.error(error);
    process.exitCode = 1;
  } finally {
    window?.destroy();
    host?.close();
    app.quit();
  }
});
