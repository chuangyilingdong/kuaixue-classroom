const {app}=require('electron');
const {mkdtempSync,writeFileSync}=require('node:fs');
const path=require('node:path');
const os=require('node:os');

const output=path.join(os.tmpdir(),'kuaixue-local-vibe-verification.json');
const dataRoot=mkdtempSync(path.join(os.tmpdir(),'kx-local-vibe-check-'));
app.setPath('userData',dataRoot);

app.whenReady().then(async()=>{
  let report;
  let host;
  try{
    const {openCourseLocalVibe}=require('../electron/course-local-vibe.cjs');
    const supplied=process.env.KUAIXUE_VERIFY_CONTEXT?JSON.parse(process.env.KUAIXUE_VERIFY_CONTEXT):null;
    const course=supplied?.course||{
      id:'local-check-course',versionId:'local-check-version',title:'本机启动检查',
      steps:[],classroomConfig:{vibeCoding:{presetPrompts:[]}},vibeModelIds:['aicyld-runninghub-llm-cn::deepseek/deepseek-v4.1-flash'],
    };
    host=await openCourseLocalVibe({
      run:{id:supplied?.runId||'local-check-run',mode:'VIBECODING',course,completed:supplied?.completed||[],work:'<!doctype html><title>check</title>'},
      gateway:supplied?.gateway||{baseUrl:'http://127.0.0.1:9/v1',token:'x'.repeat(40),expiresAt:Date.now()+60000,
        modelIds:['aicyld-runninghub-llm-cn::deepseek/deepseek-v4.1-flash']},
      userId:supplied?.userId||'local-check-user',
      resourceRoot:path.resolve(__dirname,'../release/classroom-official/win-unpacked/resources'),
      dataRoot,
    });
    const page=await fetch(host.frameUrl.replace(/#.*$/,''));
    const frame=new URL(host.frameUrl);
    const ticket=new URLSearchParams(frame.hash.slice(1)).get('ticket');
    const exchange=await fetch(new URL('/kuaixue/runtime/exchange',frame),{
      method:'POST',headers:{'Content-Type':'application/json',Origin:frame.origin},
      body:JSON.stringify({runId:new URLSearchParams(frame.hash.slice(1)).get('run'),ticket}),
    });
    const runtime=await exchange.json().catch(()=>null);
    let socket={status:'not-opened'};
    if(exchange.ok&&runtime?.socketId){
      const WebSocket=require(path.join(path.resolve(__dirname,'../release/classroom-official/win-unpacked/resources/vibe-local-runtime'),'socket.cjs'));
      socket=await new Promise(resolve=>{
        const socketUrl=`ws://${frame.host}/kuaixue/runtime/ws/${runtime.socketId}`;
        const ws=new WebSocket.WebSocket(socketUrl,{headers:{Origin:frame.origin}});
        const timer=setTimeout(()=>{ws.close();resolve({status:'timeout'});},5000);
        ws.once('open',()=>{clearTimeout(timer);ws.close();resolve({status:'open'});});
        ws.once('error',error=>{clearTimeout(timer);resolve({status:'error',message:error.message});});
      });
    }
    report={ok:page.ok,status:page.status,frameOrigin:frame.origin,directory:host.directory,
      exchange:{status:exchange.status,ok:exchange.ok,error:runtime?.error||null,socketId:Boolean(runtime?.socketId)},socket};
  }catch(error){
    report={ok:false,error:error.stack||error.message,dataRoot};
  }finally{
    try{host?.close();}catch{}
    writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    app.quit();
  }
});
