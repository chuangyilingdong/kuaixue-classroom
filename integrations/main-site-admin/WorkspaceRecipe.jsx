import {useState} from 'react';

function reorder(items,index,offset) {
  const next=[...items];[next[index],next[index+offset]]=[next[index+offset],next[index]];return next;
}
function Controls({items,index,update}) {
  return <div>{[[-1,'上移'],[1,'下移']].map(([offset,label])=><button key={label} type="button" disabled={!items[index+offset]} onClick={()=>update(reorder(items,index,offset))}>{label}</button>)}
    <button type="button" onClick={()=>update(items.filter((_,at)=>at!==index))}>移除</button></div>;
}
export function WorkspaceRecipe({draft,field}) {
  const [error,setError]=useState('');
  const presets=draft.classroomConfig?.vibeCoding?.presetPrompts ?? [],groups=draft.materialGroups ?? [];
  const setPresets=values=>field('classroomConfig',{vibeCoding:{presetPrompts:values}});
  const setGroups=values=>field('materialGroups',values);
  const setGroup=(index,patch)=>setGroups(groups.map((item,at)=>at===index?{...item,...patch}:item));
  return <>
    {draft.permittedDeliveryModes.includes('CANVAS') && <fieldset><legend>学院画布编排</legend>
      <label>导入初始画布快照（可选）<input type="file" accept=".json" onChange={async event=>{const file=event.target.files[0];if(!file)return;try{const value=JSON.parse(await file.text());if(!Array.isArray(value.nodes)||!Array.isArray(value.edges))throw Error();field('canvasSnapshot',value);setError('');}catch{setError('请选择含 nodes 和 edges 的学院画布快照');}}}/></label>
      <small>{error || `初始画布：${draft.canvasSnapshot?.nodes?.length ?? 0} 个节点`}</small>
      {groups.map((group,index)=><fieldset key={group.id}><label>素材组名称<input required value={group.title} onChange={event=>setGroup(index,{title:event.target.value})}/></label>
        {group.materials.map((material,at)=>{
          const setMaterials=materials=>setGroup(index,{materials});
          const setMaterial=patch=>setMaterials(group.materials.map((item,i)=>i===at?{...item,...patch}:item));
          return <fieldset key={material.id}><label>素材名称<input required value={material.title} onChange={event=>setMaterial({title:event.target.value})}/></label>
            <label>素材类型<select value={material.materialType} onChange={event=>setMaterial({materialType:event.target.value,snapshot:event.target.value==='GENERATION_BOX'?{box:{modality:'TEXT'}}:{},assetUrl:''})}>
              {Object.entries({GENERATION_BOX:'生成框体',PROMPT:'提示词',IMAGE:'图片',VIDEO:'视频',AUDIO:'音频'}).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            {material.materialType==='GENERATION_BOX' && <label>框体类型<select value={material.snapshot?.box?.modality} onChange={event=>setMaterial({snapshot:{...material.snapshot,box:{...material.snapshot.box,modality:event.target.value}}})}>{['TEXT','IMAGE','VIDEO','MUSIC'].map((value,i)=><option key={value} value={value}>{['文字','图像','视频','音乐'][i]}</option>)}</select></label>}
            {['PROMPT','GENERATION_BOX'].includes(material.materialType) ? <label>素材提示词<textarea required={material.materialType==='PROMPT'} value={material.snapshot?.content ?? ''} onChange={event=>setMaterial({snapshot:{...material.snapshot,content:event.target.value}})}/></label> : <label>素材地址<input type="url" required value={material.assetUrl ?? ''} onChange={event=>setMaterial({assetUrl:event.target.value})}/></label>}
            <Controls items={group.materials} index={at} update={setMaterials}/></fieldset>;
        })}
        <button type="button" onClick={()=>setGroup(index,{materials:[...group.materials,{id:crypto.randomUUID(),title:'',materialType:'GENERATION_BOX',snapshot:{box:{modality:'TEXT'}}}]})}>添加素材</button>
        <Controls items={groups} index={index} update={setGroups}/></fieldset>)}
      <button type="button" onClick={()=>setGroups([...groups,{id:crypto.randomUUID(),title:'',materials:[]}])}>添加素材组</button></fieldset>}
    {draft.permittedDeliveryModes.includes('VIBECODING') && <fieldset><legend>VibeCoding 课堂提示词预设</legend>
      {presets.map((preset,index)=><fieldset key={index}>{[['title','预设名称'],['text','预设正文']].map(([key,label])=><label key={key}>{label}<textarea required value={preset[key]} onChange={event=>setPresets(presets.map((item,at)=>at===index?{...item,[key]:event.target.value}:item))}/></label>)}<Controls items={presets} index={index} update={setPresets}/></fieldset>)}
      <button type="button" onClick={()=>setPresets([...presets,{title:'',text:''}])}>添加提示词预设</button></fieldset>}
  </>;
}
