import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {CourseCanvas} from '../../vendor/academy-canvas/CourseCanvas.jsx';
import {courseClient} from '../services/courseClient.js';

function uploadPreviewAsset(file) {
  if (file.size > 1_500_000) return Promise.reject(new Error('本机演示素材需小于 1.5 MiB，联网课程支持更大的素材。'));
  const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : '';
  if (!kind) return Promise.reject(new Error('不支持的素材类型。'));
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取本地素材失败。'));
    reader.onload = () => resolve({id:`local-${Date.now()}`,name:file.name,mime:file.type,size:file.size,kind,
      assetUrl:String(reader.result),previewUrl:String(reader.result)});
    reader.readAsDataURL(file);
  });
}

export default function CourseRun({run,close,saveBeforeLeaving}) {
  const canvas = run.mode === 'CANVAS';
  const [initial] = useState(() => run.work ?? run.course.canvasSnapshot ?? {nodes:[],edges:[]});
  const work = useRef(initial), revision = useRef(run.revision), pending = useRef(false), quotes = useRef(new Map());
  const [notice,setNotice] = useState(''), [busy,setBusy] = useState(false);
  const [frameUrl,setFrameUrl] = useState(canvas ? null : run.lease ? run.frameUrl : null);
  const [workspaceState,setWorkspaceState] = useState(canvas || run.lease ? 'ready' : 'preparing');
  const [localLease,setLocalLease] = useState(null);
  const [localDirectory,setLocalDirectory] = useState('');
  const localLeaseRef = useRef(null);
  const frameRef = useRef(null);
  const onChange = useCallback(snapshot => {work.current=snapshot;},[]);
  const quoteGeneration = useCallback(async ({nodeId,modality,input}) => {
    return courseClient.quotePreview({id:run.id,nodeId,modality:modality==='MUSIC'?'AUDIO':modality,input});
  },[run.id]);
  const uploadAsset = useCallback(file => courseClient.uploadAsset ? courseClient.uploadAsset(run.id,file) : uploadPreviewAsset(file),[run.id]);
  const stopLocal = useCallback(async()=>{
    const lease=localLeaseRef.current;
    if(!lease) return;
    localLeaseRef.current=null;setLocalLease(null);
    await window.kuaixueDesktop?.vibe?.closeLocal(lease).catch(()=>{});
  },[]);
  const startWorkspace = useCallback(async()=>{
    if(canvas||run.lease) return true;
    if(!courseClient.localRuntime || !window.kuaixueDesktop?.vibe?.startLocal) {
      setFrameUrl(run.frameUrl);setWorkspaceState('ready');return false;
    }
    setWorkspaceState('preparing');
    try {
      await stopLocal();
      const local=await courseClient.localRuntime(run.id);
      const versionModels=run.course.vibeModelIds || [];
      if(versionModels.length && (local.modelGateway.modelIds.length!==versionModels.length ||
          versionModels.some(model=>!local.modelGateway.modelIds.includes(model)))) {
        throw new Error('本机模型授权与课程版本快照不一致');
      }
      const status=await window.kuaixueDesktop.vibe.localStatus({
        userId:local.userId,courseId:run.course.id,versionId:run.course.versionId,
      });
      if(!status?.exists&&run.revision>0) {
        let snapshot;
        try {
          snapshot=await courseClient.downloadSnapshot(run.id);
        } catch(error) {
          if(error.status!==404) {
            setFrameUrl(run.frameUrl);setWorkspaceState('ready');
            setNotice(`快照恢复失败：${error.message}${run.frameUrl?'，正在尝试备用连接':''}`);
            return false;
          }
        }
        if(snapshot)await window.kuaixueDesktop.vibe.restoreLocal({
          userId:local.userId,courseId:run.course.id,versionId:run.course.versionId,
          bytes:snapshot.bytes,revision:snapshot.revision,sha256:snapshot.sha256,capturedAt:snapshot.capturedAt,
        });
      }
      const started=await window.kuaixueDesktop.vibe.startLocal({
        run:{id:run.id,mode:run.mode,course:run.course,completed:run.completed},
        gateway:local.modelGateway,userId:local.userId,
      });
      localLeaseRef.current=started.lease;setLocalLease(started.lease);
      setLocalDirectory(started.directory||'');setFrameUrl(started.frameUrl);setWorkspaceState('ready');
      return true;
    } catch(error) {
      setFrameUrl(run.frameUrl);setWorkspaceState('ready');
      setNotice(`工作区启动失败：${error.message}${run.frameUrl?'，正在尝试备用连接':''}`);
      return false;
    }
  },[canvas,run,stopLocal]);
  useEffect(()=>{
    if(canvas||run.lease) return undefined;
    void startWorkspace();
    return ()=>{if(localLeaseRef.current)void window.kuaixueDesktop?.vibe?.closeLocal(localLeaseRef.current).catch(()=>{});};
  },[canvas,run.id]);
  useEffect(()=>{
    function workbenchError(event){
      if(event.source!==frameRef.current?.contentWindow||event.data?.type!=='kuaixue-workbench-error')return;
      if(typeof event.data.message==='string'&&event.data.message)setNotice(event.data.message);
    }
    window.addEventListener('message',workbenchError);
    return ()=>window.removeEventListener('message',workbenchError);
  },[]);
  const save = useCallback(async () => {
    if (pending.current) return false;
    pending.current=true;setBusy(true);
    try {
      if(!canvas&&localLease) {
        const snapshot=await window.kuaixueDesktop?.vibe?.saveLocal({runId:run.id,lease:localLease});
        if(!snapshot?.html) throw new Error('本机工程尚未生成 index.html。');
      }
      revision.current=await courseClient.save({id:run.id,mode:run.mode,revision:revision.current,completed:run.completed,
        ...(canvas ? {work:work.current} : run.lease ? {lease:run.lease} : {})});
      setNotice('作品已保存');return true;
    } catch(error) {setNotice(error.message);return false;}
    finally {pending.current=false;setBusy(false);}
  },[run,canvas]);
  useLayoutEffect(()=>{saveBeforeLeaving.current=save;return ()=>{saveBeforeLeaving.current=null;};},[save,saveBeforeLeaving]);
  async function beforeGenerate({nodeId,modality,input}) {
    try {
      const offer=await courseClient.quote({id:run.id,nodeId,modality:modality==='MUSIC'?'AUDIO':modality,input});
      quotes.current.set(nodeId,offer.id);return true;
    } catch(error) {setNotice(error.message);return false;}
  }
  return <section className="course-surface" aria-label={canvas?'学院画布工作区':'灵动 VibeCoding 工作区'}>
    <header className="course-caption"><button disabled={busy} onClick={async()=>{if(await save()) close();}}>‹ 返回课程</button>
      <span>{run.course.title}</span>
      {!canvas&&localDirectory ? <button disabled={busy} onClick={()=>window.kuaixueDesktop?.vibe?.openLocalFolder({directory:localDirectory}).catch(error=>setNotice(error.message))}>打开工程目录</button> : null}
      <button disabled={busy} onClick={save}>保存</button><output aria-live="polite">{notice}</output></header>
    {canvas ? <CourseCanvas course={run.course} initial={initial} onChange={onChange} beforeGenerate={beforeGenerate} quoteGeneration={quoteGeneration}
      onUploadFiles={uploadAsset}
      onGenerateNode={run.generationModes?.length ? ({nodeId})=>courseClient.generate({id:run.id,jobId:quotes.current.get(nodeId)}) : undefined}/>
    : frameUrl ? <iframe ref={frameRef} className="course-workbench" title="快学 VibeCoding 工作台" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads allow-forms allow-modals" src={frameUrl}/>
    : <p role="alert" className="course-runtime-loading">{workspaceState==='preparing'?'正在打开工作区…':'工作台未连接，请返回课程后重试。'}</p>}
  </section>;
}
