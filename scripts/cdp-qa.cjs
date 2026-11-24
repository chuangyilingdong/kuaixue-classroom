const {writeFileSync} = require('node:fs');
const WebSocket = require('ws');

const port = Number(process.env.KX_CDP_PORT || 9223);
let socket;

async function main() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const match = process.env.KX_CDP_MATCH || '';
  const target = (match && targets.find(item => item.type === 'iframe' && item.url.includes(match))) ||
    targets.find(item => item.type === 'page');
  if (!target?.webSocketDebuggerUrl) throw Error('No CDP page target');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  let id = 0;
  const pending = new Map();
  const events = [];
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.method) {
      const method = String(message.method);
      if (/^(Runtime\.(consoleAPICalled|exceptionThrown)|Log\.entryAdded|Network\.(loadingFailed|webSocketCreated|webSocketWillSendHandshakeRequest|webSocketHandshakeResponseReceived|webSocketFrameError|webSocketClosed))$/.test(method))
        events.push({method,params:message.params});
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(Error(message.error.message));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, {resolve, reject});
    socket.send(JSON.stringify({id:requestId, method, params}));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  const command = process.argv[2] || 'body';
  if (command === 'shot') {
    const output = process.argv[3] || 'output.png';
    const result = await send('Page.captureScreenshot', {format:'png', captureBeyondViewport:false});
    writeFileSync(output, Buffer.from(result.data, 'base64'));
    console.log(output);
    return;
  }
  if (command === 'text') {
    await send('Input.insertText', {text:process.argv[3] || ''});
    console.log('typed');
    return;
  }
  if (command === 'enter') {
    const key = {key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13};
    await send('Input.dispatchKeyEvent', {type:'keyDown', ...key});
    await send('Input.dispatchKeyEvent', {type:'keyUp', ...key});
    console.log('entered');
    return;
  }
  if (command === 'monitor') {
    await send('Log.enable');
    await send('Network.enable');
    await new Promise(resolve => setTimeout(resolve,Number(process.argv[3] || 20) * 1000));
    console.log(JSON.stringify(events,null,2));
    return;
  }
  const expression = command === 'eval'
    ? process.argv[3]
    : 'document.body?.innerText || document.documentElement?.innerText || ""';
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise:true,
    returnByValue:true,
    userGesture:true,
  });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text || 'Evaluation failed');
  console.log(JSON.stringify(result.result?.value ?? null, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(() => socket?.close());
