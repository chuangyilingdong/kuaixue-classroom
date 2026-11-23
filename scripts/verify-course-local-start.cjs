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
    const course={
      id:'local-check-course',versionId:'local-check-version',title:'本机启动检查',
      steps:[],classroomConfig:{vibeCoding:{presetPrompts:[]}},vibeModelIds:['aicyld-runninghub-llm-cn::deepseek/deepseek-v4.1-flash'],
    };
    host=await openCourseLocalVibe({
      run:{id:'local-check-run',mode:'VIBECODING',course,completed:[],work:'<!doctype html><title>check</title>'},
      gateway:{baseUrl:'http://127.0.0.1:9/v1',token:'x'.repeat(40),expiresAt:Date.now()+60000,
        modelIds:['aicyld-runninghub-llm-cn::deepseek/deepseek-v4.1-flash']},
      userId:'local-check-user',
      resourceRoot:path.resolve(__dirname,'../release/classroom-official/win-unpacked/resources'),
      dataRoot,
    });
    const page=await fetch(host.frameUrl.replace(/#.*$/,''));
    report={ok:page.ok,status:page.status,frameOrigin:new URL(host.frameUrl).origin,directory:host.directory};
  }catch(error){
    report={ok:false,error:error.stack||error.message,dataRoot};
  }finally{
    try{host?.close();}catch{}
    writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    app.quit();
  }
});
