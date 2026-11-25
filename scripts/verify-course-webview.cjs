const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const {mkdtempSync, mkdirSync, symlinkSync, writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {setTimeout: delay} = require('node:timers/promises');
const {fork} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const {app, BrowserWindow, ipcMain} = require('electron');
const verificationResources = process.env.KUAIXUE_VERIFY_RESOURCES;
const desktopRoot = verificationResources ? path.join(verificationResources, 'app.asar') : path.resolve(__dirname, '..');
const {installCourseBrowserWindow} = require(path.join(desktopRoot, 'electron/course-browser.cjs'));
const {createCourseIab, courseIabFor} = require(path.join(desktopRoot, 'electron/course-iab.cjs'));

const realAgent = process.argv.includes('--agent');
const courseRun = realAgent || process.argv.includes('--course-run');
const agentFixture = {searched:false, requested:false, proof:null, requests:0};
const runtimeDirectory = verificationResources ? path.join(verificationResources, 'vibe-local-runtime')
  : path.resolve(__dirname, process.argv.includes('--runtime-candidate')
    ? '../release/vibe-local-runtime-candidate' : '../release/vibe-local-runtime');
const dataDirectory = mkdtempSync(path.join(tmpdir(), 'kx-course-browser-'));
app.setPath('userData', dataDirectory);
let server;
let courseAssets;
let courseLocalRuntime;
let window;
let bridge;
let runtimeChild;
let localHost;
let timer;
let exiting = false;

function closeAndExit(code, error) {
  if (exiting) return;
  exiting = true;
  clearTimeout(timer);
  bridge?.close();
  localHost?.close();
  if (runtimeChild && runtimeChild.exitCode === null) runtimeChild.kill();
  server?.closeAllConnections?.();
  server?.close();
  for (const current of BrowserWindow.getAllWindows()) current.destroy();
  if (error) console.error(error);
  app.exit(code);
}

async function waitFor(test, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await test();
    if (value) return value;
    await delay(100);
  }
  throw Error(`Timed out waiting for ${label}`);
}

async function visibleGuest(tabId) {
  return window.webContents.executeJavaScript(`(() => {
    const guest = [...document.querySelectorAll('webview')].find(view => view.partition === ${JSON.stringify(tabId)});
    const box = guest?.getBoundingClientRect();
    return {exists:!!guest, visible:!!box && box.width > 0 && box.height > 0, partition:guest?.partition};
  })()`);
}

async function expectVisible(tabId) {
  const visible = await waitFor(async () => {
    const state = await visibleGuest(tabId);
    return state.visible ? state : null;
  }, `visible tab ${tabId}`);
  assert.deepEqual(visible, {exists:true, visible:true, partition:tabId});
  return visible;
}

async function serveAgentModel(request, response) {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const input = JSON.parse(raw);
  agentFixture.requests++;
  const toolNames = (input.tools || []).map(tool => tool.function.name);
  const toolName = toolNames.find(name => name.endsWith('__js'));
  console.log('COURSE_AGENT_MODEL_REQUEST', JSON.stringify({request:agentFixture.requests, jsTool:toolName, tools:toolNames}));
  let delta;
  let finish = 'stop';
  if (!realAgent) {
    delta = {role:'assistant', content:'课程工作区已就绪。'};
  } else if (!toolName && !agentFixture.searched) {
    assert.ok(toolNames.includes('ToolSearch'), 'Real Agent must offer deferred tool discovery');
    agentFixture.searched = true;
    delta = {role:'assistant', tool_calls:[{index:0, id:'call_course_discover', type:'function',
      function:{name:'ToolSearch', arguments:JSON.stringify({query:'select:mcp__node_repl__js', limit:1})}}]};
    finish = 'tool_calls';
  } else if (!agentFixture.requested) {
    assert.ok(toolName || toolNames.includes('DeferredToolCall'), 'Real Agent must offer the node-repl JavaScript tool');
    if (!toolName) {
      const discovered = (input.messages || []).filter(message => message.role === 'tool');
      assert.match(JSON.stringify(discovered), /mcp__node_repl__js/, 'Tool discovery must return the real node-repl tool');
      console.log('COURSE_AGENT_TOOL_DISCOVERY_OK', 'mcp__node_repl__js');
    }
    agentFixture.requested = true;
    const targetUrl = `http://127.0.0.1:${server.address().port}/target`;
    const code = `
      const root = process.env.ZCODE_PLUGIN_ROOT;
      if (!root) throw Error('Browser plugin root is unavailable');
      const {join} = await import('node:path');
      const {pathToFileURL} = await import('node:url');
      const {setupBrowserRuntime} = await import(pathToFileURL(join(root,'scripts','browser-client.mjs')).href);
      await setupBrowserRuntime({globals:globalThis});
      const browsers = await agent.browsers.list();
      if (!browsers.some(item => item.type === 'iab' && item.id === ${JSON.stringify(bridge.id)})) {
        throw Error('Course IAB backend is unavailable to the real Agent');
      }
      const browser = await agent.browsers.getForUrl(${JSON.stringify(targetUrl)});
      const tab = await browser.tabs.new();
      await tab.goto(${JSON.stringify(targetUrl)});
      const snapshot = await tab.playwright.domSnapshot();
      const body = await tab.playwright.locator('#proof').innerText();
      const shot = await tab.screenshot();
      await nodeRepl.emitImage(shot);
      nodeRepl.write(JSON.stringify({courseIabProof:true,browserId:browser.browserId,tabId:tab.id,
        url:await tab.url(),body,snapshot:snapshot.includes('VISIBLE_SIDEBAR_GUEST_OK'),screenshotBytes:shot.byteLength}));
    `;
    const toolInput = {title:'检查课程侧栏浏览器', code};
    delta = {role:'assistant', tool_calls:[{index:0, id:'call_course_iab', type:'function',
      function:{name:toolName || 'DeferredToolCall', arguments:JSON.stringify(toolName ? toolInput : {name:'mcp__node_repl__js', input:toolInput})}}]};
    finish = 'tool_calls';
  } else {
    for (const message of input.messages || []) {
      const blocks = typeof message.content === 'string' ? [{text:message.content}] : message.content || [];
      for (const block of blocks) {
        const match = block.text?.match(/\{"courseIabProof":true[^\r\n]*?\}/);
        if (match) agentFixture.proof = JSON.parse(match[0]);
      }
    }
    if (!agentFixture.proof) {
      console.error('COURSE_AGENT_TOOL_RESULT', JSON.stringify(input.messages?.slice(-2)).slice(-8000));
    }
    delta = {role:'assistant', content:agentFixture.proof ? 'COURSE_AGENT_IAB_OK' : 'COURSE_AGENT_IAB_FAILED'};
  }
  response.writeHead(200, {'Content-Type':'text/event-stream'});
  for (const [part, reason] of [[delta,null], [{},finish]]) {
    response.write(`data: ${JSON.stringify({id:'chatcmpl-course-iab', object:'chat.completion.chunk',
      created:Math.floor(Date.now() / 1000), model:input.model, choices:[{index:0, delta:part, finish_reason:reason}]})}\n\n`);
  }
  response.end('data: [DONE]\n\n');
}

async function sendWorkbenchPrompt(prompt) {
  const frame = await waitFor(() => window.webContents.mainFrame.framesInSubtree.find(item => item.url.includes('/kuaixue/workbench/')), 'real workbench iframe');
  await waitFor(() => frame.executeJavaScript(`Boolean(document.querySelector('[role="textbox"][contenteditable="true"]'))`), 'real Agent composer', 60_000);
  const inserted = await frame.executeJavaScript(`(() => {
    const editor = document.querySelector('[role="textbox"][contenteditable="true"]');
    editor.focus();
    return document.execCommand('insertText', false, ${JSON.stringify(prompt)});
  })()`);
  assert.equal(inserted, true, 'Real workbench composer must accept the verification prompt');
  await waitFor(() => frame.executeJavaScript(`(() => {
    const send = document.querySelector('[data-testid="v4-composer-send"]');
    if (!send || send.disabled || send.getAttribute('aria-disabled') === 'true') return false;
    send.click();
    return true;
  })()`), 'real Agent send button');
  console.log('COURSE_AGENT_PROMPT_SENT');
  return frame;
}

async function checkRealAgent() {
  const frame = await sendWorkbenchPrompt('请用课程侧栏浏览器打开本地验收页面，读取内容并截图。');
  const proof = await waitFor(() => agentFixture.proof, 'real Agent node-repl IAB proof', 90_000);
  assert.equal(proof.browserId, bridge.id);
  assert.equal(proof.body, 'VISIBLE_SIDEBAR_GUEST_OK');
  assert.equal(proof.snapshot, true);
  assert.ok(proof.screenshotBytes > 100);
  const visible = await expectVisible(proof.tabId);
  const screenshotPath = path.join(dataDirectory, 'agent-sidebar.png');
  writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  console.log('COURSE_AGENT_SCREENSHOT', screenshotPath);
  await waitFor(() => frame.executeJavaScript(`document.body.innerText.includes('COURSE_AGENT_IAB_OK')`), 'real Agent final response');
  await checkWorkbenchButton();
  console.log('COURSE_AGENT_IAB_OK', JSON.stringify({...proof, visible, modelRequests:agentFixture.requests}));
}

async function createCourseRunPage() {
  const modelId = 'aicyld-runninghub-llm-cn::deepseek/deepseek-v4.1-flash';
  const run = {
    id:'course-browser-check-run', mode:'VIBECODING', revision:0, completed:[],
    course:{id:'course-browser-check', versionId:'course-browser-check-version',
      title:'课程侧栏验收', steps:[], vibeModelIds:[modelId],
      classroomConfig:{vibeCoding:{presetPrompts:[]}}},
  };
  const gateway = {
    baseUrl:`http://127.0.0.1:${server.address().port}/v1`, token:'local-browser-verification-token',
    expiresAt:Date.now() + 600_000, modelIds:[modelId], usage:{limit:10, used:0, remaining:10},
  };
  courseLocalRuntime = {runId:run.id, userId:'browser-check-user', modelGateway:gateway};
  const resourceRoot = path.join(dataDirectory, 'resources');
  mkdirSync(resourceRoot);
  symlinkSync(runtimeDirectory, path.join(resourceRoot, 'vibe-local-runtime'), 'junction');
  const workbenchDirectory = verificationResources ? path.join(verificationResources, 'vibe-course-web')
    : path.resolve(__dirname, process.argv.includes('--workbench-candidate') ? '../release/vibe-workbench-candidate' : '../release/vibe-course-web');
  symlinkSync(workbenchDirectory, path.join(resourceRoot, 'vibe-course-web'), 'junction');
  ipcMain.handle('vibe:localStatus', () => ({exists:false}));
  ipcMain.handle('vibe:startLocal', async (event, input) => {
    console.log('COURSE_START_LOCAL_REQUEST');
    const {openCourseLocalVibe} = require(path.join(desktopRoot, 'electron/course-local-vibe.cjs'));
    localHost = await openCourseLocalVibe({...input, resourceRoot, dataRoot:dataDirectory, browserHost:event.sender});
    bridge = courseIabFor(event.sender);
    console.log('COURSE_START_LOCAL_READY');
    return {lease:localHost.lease, directory:localHost.directory, frameUrl:localHost.frameUrl};
  });
  ipcMain.handle('vibe:closeLocal', () => localHost?.close());
  const {build} = await import('vite');
  const {default:react} = await import('@vitejs/plugin-react');
  const entry = `import React from 'react';
    import {createRoot} from 'react-dom/client';
    import CourseRun from '/src/ui/CourseRun.jsx';
    import '/src/ui/workshop.css';
    createRoot(document.getElementById('root')).render(React.createElement(CourseRun, {
      run:${JSON.stringify(run)}, close:() => {}, saveBeforeLeaving:{current:null},
    }));`;
  const bundle = await build({
    root:path.resolve(__dirname, '..'), configFile:false,
    define:{'process.env.NODE_ENV':JSON.stringify('production'),
      'import.meta.env.VITE_KUAIXUE_API_BASE_URL':JSON.stringify(gateway.baseUrl),
      'import.meta.env.VITE_KUAIXUE_VIBE_ORIGIN':JSON.stringify('https://course-browser-check.test'),
      'import.meta.env.VITE_KUAIXUE_COURSE_SERVICE':JSON.stringify('1')},
    plugins:[react(), {
      name:'course-browser-verification',
      resolveId(id) { if (id.replaceAll('\\', '/').endsWith('/course-browser-check.jsx')) return '\0course-browser-check.jsx'; },
      load(id) { if (id === '\0course-browser-check.jsx') return entry; },
    }],
    build:{write:false, minify:false, lib:{entry:path.resolve(__dirname, '../course-browser-check.jsx'), formats:['es'], fileName:() => 'course-browser-check.js'}},
  });
  const output = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(result => result.output);
  courseAssets = new Map(output.map(item => [
    '/' + item.fileName, item.type === 'asset' ? item.source : item.code,
  ]));
  const styles = output.filter(item => item.fileName.endsWith('.css'))
    .map(item => '<link rel="stylesheet" href="/' + item.fileName + '">').join('');
  courseAssets.set('/course-browser-check', '<!doctype html><meta charset="utf-8">' + styles +
    '<style>html,body,#root{height:100%;margin:0;background:#17191d;color:#eee}</style>' +
    '<div id="root"></div><script type="module" src="/course-browser-check.js"></script>');
  return 'http://127.0.0.1:' + server.address().port + '/course-browser-check';
}

async function checkWorkbenchButton() {
  const frame = await waitFor(() => window.webContents.mainFrame.framesInSubtree.find(item => item.url.includes('/kuaixue/workbench/')), 'real workbench iframe');
  await waitFor(() => frame.executeJavaScript(`Boolean(document.querySelector('[aria-label="展开侧边面板"], [aria-label="收起侧边面板"]'))`), 'workbench toolbar', 60_000);
  await frame.executeJavaScript(`document.querySelector('[aria-label="展开侧边面板"]')?.click()`);
  await waitFor(() => frame.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')].find(item => /Browser|浏览器/i.test([item.title,item.getAttribute('aria-label'),item.textContent].join(' ')));
    if (!button) return false;
    button.click();
    return true;
  })()`), 'workbench Browser button', 60_000);
  await waitFor(() => window.webContents.executeJavaScript(`Boolean(document.querySelector('.course-browser-pane:not(.is-closed) webview'))`), 'Browser button opens real sidebar');
  console.log('COURSE_RUN_BROWSER_BUTTON_OK');
}

async function checkTabLifecycle(proof) {
  await waitFor(async () => !(await visibleGuest(proof.closedTabId)).exists, 'Agent closes second tab');
  const humanTab = await window.webContents.executeJavaScript(`(() => {
    const human = [...document.querySelectorAll('webview')].find(view => view.partition === 'persist:zcode-embedded-browser');
    const index = [...document.querySelectorAll('webview')].indexOf(human);
    const humanButton = document.querySelectorAll('[role="tab"]')[index];
    if (!humanButton) throw Error('Human tab missing');
    humanButton.click();
    return index;
  })()`);
  await waitFor(() => window.webContents.executeJavaScript(`document.querySelectorAll('[role="tab"]')[${humanTab}]?.getAttribute('aria-selected') === 'true'`), 'human tab activation');
  await window.webContents.executeJavaScript(`document.querySelectorAll('[role="tab"]')[${humanTab === 0 ? 1 : 0}].click()`);
  await expectVisible(proof.tabId);
  const manualUrl = `${proof.url}?manual-after-switch=1`;
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('input[aria-label="网页地址"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(manualUrl)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await delay(100);
  await window.webContents.executeJavaScript(`document.querySelector('.course-browser-address').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);
  await waitFor(() => window.webContents.executeJavaScript(`(() => {
    const guest = [...document.querySelectorAll('webview')].find(view => view.partition === ${JSON.stringify(proof.tabId)});
    return guest?.getURL() === ${JSON.stringify(manualUrl)};
  })()`), 'address-bar navigation after tab switch', 6_000);
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="关闭浏览器侧栏"]').click()`);
  await waitFor(async () => !(await visibleGuest(proof.tabId)).visible, 'sidebar close');
  await checkWorkbenchButton();
  await window.webContents.executeJavaScript(`(() => {
    const index = [...document.querySelectorAll('webview')].findIndex(view => view.partition === ${JSON.stringify(proof.tabId)});
    document.querySelectorAll('[role="tab"]')[index].click();
  })()`);
  await expectVisible(proof.tabId);
  await window.webContents.executeJavaScript(`document.querySelector('[role="tab"][aria-selected="true"]').closest('.course-browser-tab').querySelector('[aria-label="关闭标签页"]').click()`);
  await waitFor(async () => {
    const result = await bridge.execute({browserId:bridge.id, browserGeneration:1, sessionId:'e2e-task', command:{method:'list'}});
    return result.ok && result.tabs.length === 0;
  }, 'manual tab close releases Agent ownership');
  return {agentTabSwitch:true, agentTabClose:true, manualNavigationAfterSwitch:true, sidebarReopen:true, manualCloseReleasesAgentTab:true};
}

app.whenReady().then(async () => {
  try {
    server = http.createServer((request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      if (request.url === '/v1/chat/completions') {
        void serveAgentModel(request, response).catch(error => closeAndExit(1, error));
        return;
      }
      if (request.url?.endsWith('/api/v1/course-runs/local-runtime')) {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({data:courseLocalRuntime}));
        return;
      }
      response.setHeader('Access-Control-Allow-Headers', 'Authorization');
      const asset = courseAssets?.get(request.url?.split('?')[0]);
      if (asset !== undefined) {
        response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript' : request.url.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
        response.end(asset);
        return;
      }
      if (request.url === '/v1/models') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({data:[], usage:{limit:10, used:0, remaining:10}}));
        return;
      }
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (request.url === '/shell') {
        response.end(`<!doctype html><meta charset="utf-8"><title>IAB host</title>
          <style>html,body{height:100%;margin:0}#sidebar{height:100%;width:640px}webview{height:100%;width:100%;display:flex}</style>
          <aside id="sidebar" aria-label="Course Browser sidebar"></aside>
          <script>
            window.kuaixueDesktop.browser.onAgentTab(event => {
              if (event.action !== 'new') return;
              const guest = document.createElement('webview');
              guest.id = event.key; guest.partition = event.key; guest.src = 'about:blank';
              document.querySelector('#sidebar').append(guest);
            });
            window.__sidebarReady = true;
          </script>`);
        return;
      }
      response.end('<!doctype html><meta charset="utf-8"><title>Course IAB Proof</title><h1 id="proof">VISIBLE_SIDEBAR_GUEST_OK</h1><p id="url">'+request.url+'</p>');
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const targetUrl = `http://127.0.0.1:${server.address().port}/target`;
    const shellUrl = courseRun ? await createCourseRunPage() : `http://127.0.0.1:${server.address().port}/shell`;
    window = new BrowserWindow({
      show:true, width:1440, height:900,
      webPreferences:{preload:path.join(desktopRoot, 'electron/preload.cjs'),
        contextIsolation:true, nodeIntegration:false, sandbox:true, webviewTag:true},
    });
    window.webContents.on('console-message', event => {
      if (event.level === 'error') console.error('COURSE_RENDERER_ERROR', event.message);
    });
    window.webContents.on('dom-ready', () => console.log('COURSE_HOST_DOM_READY'));
    window.webContents.on('did-finish-load', () => console.log('COURSE_HOST_LOAD_FINISHED'));
    window.webContents.on('render-process-gone', (_event, details) => console.error('COURSE_RENDERER_GONE', details));
    installCourseBrowserWindow(window);
    if (!courseRun) {
      const {executeBrowserCommandOnView} = await import(pathToFileURL(path.join(runtimeDirectory, 'course-iab-executor.mjs')).href);
      bridge = createCourseIab({host:window.webContents, lease:'verify-course-iab', executePage:executeBrowserCommandOnView});
    }
    console.log('COURSE_HOST_LOADING');
    await window.loadURL(shellUrl);
    console.log('COURSE_HOST_LOADED');
    if (courseRun && !realAgent) {
      await sendWorkbenchPrompt('请确认课程工作区已经就绪。');
      await checkWorkbenchButton();
    } else if (!courseRun) {
      assert.equal(await window.webContents.executeJavaScript('window.__sidebarReady === true'), true);
    }
    if (courseRun) await waitFor(() => bridge, 'Course runtime IAB registration');
    assert.ok(bridge, 'Course runtime must register an IAB bridge on its BrowserWindow');
    if (realAgent) {
      await checkRealAgent();
      closeAndExit(0);
      return;
    }
    runtimeChild = fork(path.resolve(__dirname, 'verify-course-iab-child.mjs'), [], {
      env:{...process.env, ELECTRON_RUN_AS_NODE:'1', KUAIXUE_IAB_ID:bridge.id,
        KUAIXUE_IAB_TARGET_URL:targetUrl, KUAIXUE_VERIFY_COURSE_RUN:courseRun ? '1' : '',
        KUAIXUE_BROWSER_CLIENT_MODULE:process.env.KUAIXUE_BROWSER_CLIENT_MODULE || path.join(runtimeDirectory, 'packages/browser-use-plugin/scripts/browser-client.mjs')},
      stdio:['ignore', 'inherit', 'inherit', 'ipc'],
    });
    runtimeChild.on('exit', code => {
      if (!exiting) closeAndExit(1, Error(`Browser verification child exited early (${code})`));
    });
    runtimeChild.on('message', async message => {
      try {
        if (message?.type === 'course-iab-command') {
          let result;
          try { result = await bridge.execute(message.input); }
          catch (error) { result = {ok:false, elapsedMs:0, error:{code:'execution_error', message:error.message}}; }
          if (runtimeChild.connected) runtimeChild.send({type:'course-iab-result', key:message.key, result}, () => {});
        } else if (message?.type === 'course-iab-verify-error') {
          closeAndExit(1, Error(message.message));
        } else if (message?.type === 'course-iab-verify-checkpoint') {
          await expectVisible(message.tabId);
          runtimeChild.send({type:'course-iab-verify-continue'});
        } else if (message?.type === 'course-iab-verify-done') {
          const visible = await expectVisible(message.proof.tabId);
          const lifecycle = courseRun ? await checkTabLifecycle(message.proof) : undefined;
          console.log(courseRun ? 'COURSE_RUN_IAB_OK' : 'COURSE_IAB_VISIBLE_GUEST_OK', JSON.stringify({...message.proof, visible, lifecycle}));
          closeAndExit(0);
        }
      } catch (error) { closeAndExit(1, error); }
    });
  } catch (error) {
    if (window && !window.isDestroyed()) {
      console.error('COURSE_HOST_STATE', await window.webContents.executeJavaScript('document.body.innerText').catch(String));
      console.error('COURSE_FRAME_URLS', window.webContents.mainFrame.framesInSubtree.map(frame => frame.url));
      for (const frame of window.webContents.mainFrame.framesInSubtree.filter(item => item.url.includes('/kuaixue/workbench/'))) {
        console.error('COURSE_WORKBENCH_STATE', await frame.executeJavaScript('document.body.innerText').catch(String));
      }
    }
    closeAndExit(1, error);
  }
});
timer = setTimeout(() => closeAndExit(1, Error('Timed out waiting for course IAB verification')), realAgent ? 180_000 : courseRun ? 120_000 : 30_000);
