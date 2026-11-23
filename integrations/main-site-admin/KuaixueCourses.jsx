import { useEffect, useState } from 'react';
import './courses.css';
import {WorkspaceRecipe} from './WorkspaceRecipe.jsx';
const newStep = () => ({id:crypto.randomUUID(),title:'',description:'',deliverable:''});
const empty = () => ({title:'',subtitle:'',price:0,vibeModels:"",modelPolicy:[],permittedDeliveryModes:['CANVAS'],steps:[]});
function draftFor(course) {
  return {...course,baseVersion:course.versionId,permittedDeliveryModes:course.permittedDeliveryModes ?? [course.type],vibeModels:(course.vibeModelIds || []).join("\n"),modelPolicy:course.modelPolicy ?? [],price:course.unlockPricePoints,steps:course.steps};
}
export default function KuaixueCourses({ api }) {
  const [catalog,setCatalog] = useState([]);
  const [draft,setDraft] = useState(empty);
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  useEffect(() => {api.catalog().then(setCatalog).catch(e => setMessage(e.message));},[api]);
  function field(key,value) {setDraft(d => ({...d,[key]:value}));}
  function stepField(index,key,value) {field('steps',draft.steps.map((s,i) => i === index ? {...s,[key]:value} : s));}
  async function apply(kind) {
    if (kind === 'publish' && !draft.permittedDeliveryModes.length) {setMessage('请至少选择一个工作区'); return;}
    setBusy(true);
    try {
      if (kind === 'publish') {const course = await api.publish({...draft,vibeModelIds:draft.vibeModels.split(/\s+/).filter(Boolean)});setDraft(draftFor(course));}
      else await api.hide(draft.id,draft.baseVersion);
      setCatalog(await api.catalog());setMessage(kind === 'publish' ? '课程版本已发布' : '已下架，已购学员仍可学习该版本');
    } catch (error) {setMessage(error.message);} finally {setBusy(false);}
  }
  return <main className="studio"><header><small>创易灵动 · 快学课堂</small><h1>课程管理</h1></header>
    <div className="studio-grid"><nav inert={busy ? "" : undefined}><button onClick={() => {setDraft(empty());setMessage('');}}>＋ 创建课程</button>
      {catalog.map(course => <button key={course.id} aria-pressed={course.id === draft.id} onClick={() => {setDraft(draftFor(course));setMessage('');}}>{course.title}<small>{course.visible ? '已发布' : '已下架'}</small></button>)}
    </nav><form inert={busy ? "" : undefined} onSubmit={e => {e.preventDefault();apply('publish');}}><h2>{draft.baseVersion ? '编辑并发布新版本' : '创建课程'}</h2>
      <label>课程名称<input required maxLength={120} value={draft.title} onChange={e => field('title',e.target.value)} /></label>
      <label>课程简介<textarea required maxLength={1000} value={draft.subtitle} onChange={e => field('subtitle',e.target.value)} /></label>
      <div className="studio-pair"><fieldset><legend>购课后开放的工作区</legend>
        {Object.entries({CANVAS:'学院画布', VIBECODING:'灵动 VibeCoding'}).map(([mode,name]) => <label key={mode}>
          <input type="checkbox" checked={draft.permittedDeliveryModes.includes(mode)} onChange={e => field('permittedDeliveryModes',e.target.checked ? [...draft.permittedDeliveryModes,mode] : draft.permittedDeliveryModes.filter(m => m !== mode))} />{name}
        </label>)}
      </fieldset>
      <label>课程解锁价（积分）<input type="number" required min="0" max="1000000" value={draft.price} onChange={e => field('price',e.target.value === '' ? '' : Number(e.target.value))} /></label></div>
      {draft.permittedDeliveryModes.includes('CANVAS') && <fieldset><legend>画布创作模型</legend>
        <p>按主站模型清单填写编号，留空表示本课关闭该项生成。</p>
        {Object.entries({TEXT:'文字',IMAGE:'图像',VIDEO:'视频',AUDIO:'音频'}).map(([modality,label]) => <label key={modality}>{label}模型编号
          <input maxLength={120} value={draft.modelPolicy.find(item => item.modality === modality)?.modelId || ''}
            onChange={e => field('modelPolicy',[...draft.modelPolicy.filter(item => item.modality !== modality),...(e.target.value ? [{modality,modelId:e.target.value}] : [])])} /></label>)}
      </fieldset>}
      {draft.permittedDeliveryModes.includes('VIBECODING') && <label>VibeCoding 模型编号（每行一个）<textarea value={draft.vibeModels} onChange={e => field('vibeModels',e.target.value)} /></label>}
      <WorkspaceRecipe draft={draft} field={field}/>
      <h2>详情页大纲（可选，不生成工作区步骤）</h2>{draft.steps.map((step,i) => <fieldset key={step.id}><legend>条目 {i+1}</legend>
        <label>标题<input required value={step.title} onChange={e => stepField(i,'title',e.target.value)} /></label>
        <label>操作说明<textarea required value={step.description} onChange={e => stepField(i,'description',e.target.value)} /></label>
        <label>阶段成果<input required value={step.deliverable} onChange={e => stepField(i,'deliverable',e.target.value)} /></label>
        <button type="button" disabled={i === 0} onClick={() => {const next = [...draft.steps];[next[i-1],next[i]]=[next[i],next[i-1]];field('steps',next);}}>上移</button>
        <button type="button" disabled={draft.steps.length < 2} onClick={() => field('steps',draft.steps.filter(s => s.id !== step.id))}>移除步骤</button></fieldset>)}
      <button type="button" onClick={() => field('steps',[...draft.steps,newStep()])}>＋ 添加步骤</button>
      <footer><button disabled={busy}>发布课程版本</button>{draft.baseVersion && <button type="button" disabled={busy} onClick={() => apply('hide')}>下架课程</button>}<span role="status">{message}</span></footer>
    </form></div></main>;
}
