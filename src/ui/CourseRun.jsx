import {useCallback,useLayoutEffect,useRef,useState} from 'react';
import {CourseCanvas} from '../../vendor/academy-canvas/CourseCanvas.jsx';
import {courseClient} from '../services/courseClient.js';

export default function CourseRun({run,close,saveBeforeLeaving}) {
  const canvas = run.mode === 'CANVAS';
  const [initial] = useState(() => run.work ?? run.course.canvasSnapshot ?? {nodes:[],edges:[]});
  const work = useRef(initial), revision = useRef(run.revision), pending = useRef(false), quotes = useRef(new Map());
  const [notice,setNotice] = useState(''), [busy,setBusy] = useState(false);
  const onChange = useCallback(snapshot => {work.current=snapshot;},[]);
  const save = useCallback(async () => {
    if (pending.current) return false;
    pending.current=true;setBusy(true);
    try {
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
      if (!window.confirm(offer.pending ? '查询此节点已提交的任务？' : `使用 ${offer.modelId}，本次最多消耗 ${offer.points} 积分？`)) return false;
      quotes.current.set(nodeId,offer.id);return true;
    } catch(error) {setNotice(error.message);return false;}
  }
  return <section className="course-surface" aria-label={canvas?'学院画布工作区':'灵动 VibeCoding 工作区'}>
    <header className="course-caption"><button disabled={busy} onClick={async()=>{if(await save()) close();}}>‹ 返回课程</button>
      <span>{run.course.title}</span><small>{run.lease ? '本机演示 · AI 生成未启用' : ''}</small>
      <button disabled={busy} onClick={save}>保存作品</button><output aria-live="polite">{notice}</output></header>
    {canvas ? <CourseCanvas course={run.course} initial={initial} onChange={onChange} beforeGenerate={beforeGenerate}
      onGenerateNode={run.generationModes?.length ? ({nodeId})=>courseClient.generate({id:run.id,jobId:quotes.current.get(nodeId)}) : undefined}/>
    : run.frameUrl ? <iframe className="course-workbench" title="灵动 VibeCoding 创作工作台" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin" src={run.frameUrl}/>
    : <p role="alert">工作台未连接，请返回课程后重新进入。</p>}
  </section>;
}
