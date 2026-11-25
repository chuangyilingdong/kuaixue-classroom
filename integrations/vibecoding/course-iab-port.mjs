// Local desktop only. Use the inherited child IPC pipe, never a listening debug port.
import {randomUUID} from 'node:crypto';
export function courseBrowserPort(fallback, channel=process) {
  const env=channel.env ?? process.env;
  if (!channel.connected || !env.KUAIXUE_IAB_ID || typeof channel.send!=='function') return fallback;
  const id=env.KUAIXUE_IAB_ID, generation=1;
  const pending=new Map();
  const failure=message=>({ok:false,elapsedMs:0,error:{code:'backend_unavailable',message}});
  channel.on('message', reply=>{
    if(reply?.type==='course-iab-result') pending.get(reply.key)?.(reply.result);
  });
  channel.once('disconnect',()=>{for(const finish of pending.values()) finish(failure('课程侧栏连接已关闭'));});
  return {
    async list(input) {
      const other=await fallback?.list(input).catch(()=>[]) ?? [];
      return channel.connected ? [{id,generation,type:'iab',name:'快学课堂侧栏',capabilities:{}},...other] : other;
    },
    execute(input) {
      if(input.browserId!==id && !input.browserId?.startsWith('iab:')) return fallback?.execute(input) ?? Promise.resolve(failure('浏览器不可用'));
      if(input.browserId!==id || input.browserGeneration!==generation || !channel.connected) return Promise.resolve(failure('侧栏会话已失效'));
      const key=randomUUID();
      return new Promise(resolve=>{
        const finish=result=>{clearTimeout(timer);pending.delete(key);resolve(result);};
        const timer=setTimeout(()=>finish(failure('侧栏命令超时')),30000);
        pending.set(key,finish);
        try {channel.send({type:'course-iab-command',key,input},error=>{if(error)finish(failure('侧栏连接已关闭'));});}
        catch {finish(failure('侧栏连接已关闭'));}
      });
    },
  };
}
