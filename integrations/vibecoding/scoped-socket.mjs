// Use the `ws` library already used by the Lingdong host. resolveHost returns the
// provisioned RPC server for this authenticated run, never a client-supplied URL.
export function createScopedSocketAcceptor({WebSocketServer, WebSocket, resolveHost, checkAccess, connectHost}) {
  const listener = new WebSocketServer({noServer:true, maxPayload:4_000_000});
  return async function acceptScopedSocket({req,socket,head,context}) {
    if (!await checkAccess(context)) throw Error('课程工作区授权已失效');
    const target = await resolveHost(context);
    if (target?.runId !== context.runId || target.userId !== context.userId || !target.token || /[;\s]/.test(target.token)) throw Error('运行服务不属于此课程');
    const url = new URL(target.origin);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        !(url.protocol === 'wss:' || url.protocol === 'ws:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw Error('无效的运行服务');
    url.pathname = '/ws';
    const upstream = new WebSocket(url,{...(connectHost ? {createConnection:() => connectHost(target)} : {}),headers:{Cookie:`zcode_lite_token=${encodeURIComponent(target.token)}`},handshakeTimeout:8000,maxPayload:4_000_000});
    socket.once('close',() => upstream.terminate());
    upstream.once('error',error => {
      console.error('[kuaixue-runtime] upstream websocket error',error?.message||error);
      socket.destroy();
    });
    upstream.once('open',() => {
      if (socket.destroyed) return upstream.terminate();
      try {listener.handleUpgrade(req,socket,head,client => {
        let checking = false;
        const stop = () => {clearInterval(timer); client.terminate();upstream.terminate();};
        const timer = setInterval(async () => {
          if (checking) return;
          checking = true;
          try {if (!await checkAccess(context)) stop();} catch {stop();} finally {checking = false;}
        },5000);
        timer.unref();
        for (const [from,to] of [[client,upstream],[upstream,client]]) {
          from.on('message',(data,binary) => {
            if (to.readyState !== WebSocket.OPEN || to.bufferedAmount > 8_000_000) return stop();
            to.send(data,{binary},error => {if (error) stop();});
          });
          from.on('close',code => {
            if(from===upstream) console.error('[kuaixue-runtime] upstream websocket closed',{code});
            stop();
          });
          from.on('error',stop);
        }
      });} catch {socket.destroy();upstream.terminate();}
    });
  };
}
