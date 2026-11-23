import {useState,useRef,useEffect,useCallback} from 'react';
import {CanvasEditor} from './index.jsx';
import {boxParamsLabel,buildBoxNode} from './canvasBoxNode.js';
import {materialVisual} from './materialTypes.js';
import {Icon} from './icons.jsx';
import './classroom.css';
const PROMPT_SLOT_TYPES = ['text','prompt','image','video','animation','music','audio'];
const PROMPT_SLOT_ACTION = {text:'写文字',prompt:'写文字',image:'生图',video:'生视频',animation:'生动画',music:'生音乐',audio:'生音频'};
export function CourseCanvas({initial,course,onChange,beforeGenerate,onGenerateNode,onUploadFiles}) {
  const project = {data:{...course,canvasSnapshot:initial,capabilities:[...new Set([...(course.modelPolicy || []).map(item=>item.modality.toLowerCase()),...(course.materialGroups || []).flatMap(group=>group.materials || []).map(material=>(material.snapshot?.box?.modality === 'AUDIO' ? 'music' : material.snapshot?.box?.modality?.toLowerCase())).filter(Boolean)])]}};
  const [canvasSnapshot,setCanvasSnapshot] = useState(initial);
  const [draft,updateDraft] = useState(initial);
  const draftRef = useRef(initial);
  const setDraft = useCallback(value=>{draftRef.current=value;setCanvasSnapshot(value);updateDraft(value);onChange(value);},[onChange]);
  const changeDraft = useCallback(updater=>setDraft(updater(draftRef.current)),[setDraft]);
  const [canvasRevision,setCanvasRevision] = useState(0);
  const [toolPanel,setToolPanel] = useState(null), [sidebarCollapsed,setSidebarCollapsed] = useState(false);
  const [focusRequest,setFocusRequest] = useState(null),[entranceRequest,setEntranceRequest] = useState(null);
  const [promptTarget,setPromptTarget] = useState(null),[message,setMessage] = useState('');
  const placementRef=useRef(null),placementCountRef=useRef(0);
  const editable=true,jobByBox=new Map();
  const boxSucceeded=id=>draft?.nodes?.some(node=>node.data?.boxId===id && (node.data.assetUrl || node.data.generatedText));
  const boxRunning=id=>draft?.nodes?.some(node=>node.data?.boxId===id && node.data.generationStatus==='PENDING');
  useEffect(()=>{if(message){const timer=setTimeout(()=>setMessage(''),4000);return ()=>clearTimeout(timer);}},[message]);
  function sidebarPlacement(type) {
    const offset = placementCountRef.current++ % 5;
    const placed = placementRef.current?.(type, offset);
    if (!placed) return { position: { x: 160 + offset * 36, y: 120 + offset * 26 }, viewport: null };
    return placed;
  }

  function addLessonMaterialToCanvas(material) {
    if (!editable || !material) return;
    const current = draft || canvasSnapshot || project.data.canvasSnapshot || { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const snapshot = material.snapshot && typeof material.snapshot === 'object' ? material.snapshot : {};
    const sourceData = snapshot.data || snapshot.props || {};
    const materialType = String(material.materialType || snapshot.type || 'NOTE').toUpperCase();
    const type = snapshot.type || (materialType === 'IMAGE' ? 'image' : materialType === 'VIDEO' ? 'video' : materialType === 'AUDIO' ? 'audio' : materialType === 'CHARACTER' ? 'character' : materialType === 'SCENE' ? 'scene' : materialType === 'TEXT' || materialType === 'PROMPT' ? 'prompt' : 'note');
    const fallbackData = type === 'image'
      ? { title: material.title, emoji: '✨', caption: material.description || '' }
      : type === 'video'
        ? { title: material.title, text: material.description || '' }
        : type === 'character'
          ? { title: material.title, emoji: '🧒', name: '', trait: material.description || '' }
          : type === 'scene'
            ? { title: material.title, emoji: '🌲', place: material.description || '', mood: '' }
            : { title: material.title, text: material.description || '' };


    const mediaUrl = String(material.assetUrl || '').trim();
    const mediaData = mediaUrl && ['image', 'video', 'audio', 'animation'].includes(type)
      ? { assetUrl: mediaUrl, previewUrl: String(snapshot.previewUrl || snapshot.preview_url || '').trim() || mediaUrl }
      : {};
    const { position, viewport } = sidebarPlacement(type);
    const node = {
      id: `lesson-material-${material.id}-${Date.now().toString(36)}`,
      type,
      position,
      data: { ...fallbackData, ...sourceData, ...mediaData, title: material.title || sourceData.title, lessonMaterialId: material.id, isLessonMaterial: true },
    };
    const next = { ...current, viewport: viewport || current.viewport, nodes: [...(current.nodes || []), node] };
    setCanvasSnapshot(next); setDraft(next); setEntranceRequest({ id: node.id }); setCanvasRevision((value) => value + 1);
    setMessage(`已将“${material.title || '课堂素材'}”加入画布。`);
  }

  async function uploadLocalFiles(files,position) {
    if (!editable || !onUploadFiles || !files?.length) return;
    setToolPanel('local');
    for (const [index,file] of files.entries()) {
      const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : '';
      if (!kind) {setMessage(`不支持「${file.name || '素材'}」的文件类型。`);continue;}
      const id = `local-${crypto.randomUUID?.() || Date.now().toString(36)}`;
      const node = {id,type:kind,position:{x:(position?.x || 160)+index*32,y:(position?.y || 120)+index*28},
        data:{title:file.name || '本地素材',uploaded:true,uploading:true,uploadError:'',mime:file.type,size:file.size}};
      changeDraft(current=>({...current,nodes:[...(current?.nodes || []),node]}));
      setCanvasRevision(value=>value+1);
      try {
        const asset = await onUploadFiles(file);
        changeDraft(current=>({...current,nodes:(current?.nodes || []).map(item=>item.id===id?{...item,data:{
          ...item.data,assetUrl:asset.assetUrl,previewUrl:asset.previewUrl,fileAssetId:asset.id,uploading:false,uploadError:'',
        }}:item)}));
        setCanvasRevision(value=>value+1);
        setMessage(`已上传「${file.name || '素材'}」。`);
      } catch (error) {
        changeDraft(current=>({...current,nodes:(current?.nodes || []).map(item=>item.id===id?{...item,data:{
          ...item.data,uploading:false,uploadError:error.message || '素材上传失败',
        }}:item)}));
        setCanvasRevision(value=>value+1);
        setMessage(error.message || '素材上传失败。');
      }
    }
  }

  const generationBoxes = Array.isArray(project.data.generationBoxes) ? project.data.generationBoxes : [];



  const boxModalities = [...new Set(generationBoxes.map((box) => String(box.modality || '').toUpperCase()).filter(Boolean))];

  function boxNodes() {
    const current = draft || canvasSnapshot || project.data.canvasSnapshot || { nodes: [] };
    return (current.nodes || []).filter((node) => node.data?.boxId);
  }

  function boxOnCanvas(boxId) { return boxNodes().some((node) => node.data.boxId === boxId); }

  function boxForMaterial(material) {
    const fromServer = generationBoxes.find((box) => box.id === material.id);
    if (fromServer) return fromServer;
    const raw = material.snapshot?.box && typeof material.snapshot.box === 'object' ? material.snapshot.box : {};
    return {
      id: material.id, title: material.title,
      modality: raw.modality === 'AUDIO' ? 'MUSIC' : String(raw.modality || '').toUpperCase(), model: raw.model || '',
      paramOptions: raw.paramOptions, mode: raw.mode, generationDisabled: raw.modelBinding === 'BOX' && !raw.model,



      modelLabel: raw.modelLabel || '',
      aspectRatio: raw.aspectRatio || '', resolution: raw.resolution || '',



      durationSeconds: Number.isInteger(Number(raw.durationSeconds)) && Number(raw.durationSeconds) > 0 ? Number(raw.durationSeconds) : null,
      audio: raw.audio === true ? true : raw.audio === false ? false : null,

      inputMode: String(raw.inputMode || '').toUpperCase(), inputModeLabel: raw.inputModeLabel || '',

      audioRole: String(raw.audioRole || 'LIP_SYNC').toUpperCase() === 'VOICE_REFERENCE' ? 'VOICE_REFERENCE' : 'LIP_SYNC',
      audioRoleLabel: raw.audioRoleLabel || '',
      prompt: material.snapshot?.content || '', assetUrl: material.assetUrl || '',
    };
  }



  function addBoxToCanvas(box) {
    if (!editable) { setMessage('课堂已结束，不能再修改画布。'); return; }
    const slotType = String(box.modality || '').toLowerCase();
    const current = draft || canvasSnapshot || project.data.canvasSnapshot || { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const existing = (current.nodes || []).find((node) => node.id === `box-${box.id}` || node.data?.boxId === box.id);




    if (existing) { setFocusRequest({ id: existing.id, token: Date.now() }); return; }

    if (!(Array.isArray(project.data.capabilities) ? project.data.capabilities : []).includes(slotType)) { setMessage('本课未开放该 AI 能力。'); return; }

    const job = jobByBox.get(box.id);
    const succeeded = String(job?.status || '') === 'SUCCEEDED';
    const node = buildBoxNode(box, current, { asset: succeeded ? job.assets?.[0] : null, pending: Boolean(job) && !succeeded });
    const { position, viewport } = sidebarPlacement(node.type);
    const next = { ...current, viewport: viewport || current.viewport, nodes: [...(current.nodes || []), { ...node, position }] };
    setCanvasSnapshot(next); setDraft(next); setEntranceRequest({ id: node.id }); setCanvasRevision((value) => value + 1);
    setMessage(job ? `已把「${box.title}」接回画布。` : `已添加「${box.title}」，请填写提示词或从素材插入。`);
  }

  function openPromptInsert(material) {
    if (!editable) return;
    const targets = boxNodes().filter((node) => {




      if (!PROMPT_SLOT_TYPES.includes(String(node.data?.slotType || ''))) return false;
      return !boxSucceeded(node.data.boxId) && !node.data.generatedText && !node.data.assetUrl;
    });
    if (!targets.length) { setMessage('画布上没有可插入的未生成框体，请先从「生成框体」添加。'); return; }
    setPromptTarget({ material, targets });
  }

  function insertPromptToSlot(nodeId) {
    const material = promptTarget?.material;
    if (!material || !nodeId) return;
    const text = material.snapshot?.content || material.description || material.title || '';
    const current = draft || canvasSnapshot || project.data.canvasSnapshot;
    if (!current) return;
    const target = (current.nodes || []).find((node) => node.id === nodeId);
    if (!target || boxSucceeded(target.data?.boxId) || target.data?.generatedText || target.data?.assetUrl) {
      setPromptTarget(null);
      setMessage('这个框体已生成，不能再插入提示词。');
      return;
    }
    const next = { ...current, nodes: (current.nodes || []).map((node) => {
      if (node.id !== nodeId) return node;
      const field = node.data?.slotType === 'image' ? 'caption' : 'text';
      return { ...node, data: { ...node.data, [field]: text } };
    }) };
    setCanvasSnapshot(next); setDraft(next); setCanvasRevision((value) => value + 1);
    setPromptTarget(null);
    setMessage(`已将「${material.title}」插入所选框体。`);
  }

  const lessonTitle = project.data.courseLessonTitle || 'AI 创作课堂';
  const materialGroups = Array.isArray(project.data.materialGroups) ? project.data.materialGroups : [];


  const localMaterials = ((draft || canvasSnapshot || project.data.canvasSnapshot)?.nodes || [])
    .filter((node) => node.data?.uploaded === true || node.data?.uploading === true)
    .map((node) => ({
      id: node.id,
      title: node.data?.title || '本地素材',
      kind: node.type === 'video' ? '视频' : node.type === 'audio' ? '音频' : '图片',
      uploading: node.data?.uploading === true,
      fileAssetId: node.data?.fileAssetId || null,
    }));
  const capabilities = Array.isArray(project.data.capabilities) && project.data.capabilities.length ? project.data.capabilities : [];

  const activeGroupIndex = typeof toolPanel === 'string' && toolPanel.startsWith('group:')
    ? materialGroups.findIndex((group, index) => `group:${group.id || index}` === toolPanel)
    : -1;
  const activeGroup = activeGroupIndex >= 0 ? materialGroups[activeGroupIndex] : null;


  const openMaterialsPanel = () => {
    setSidebarCollapsed(false);
    const index = materialGroups.findIndex((group) => (group.materials || []).some((item) => item.materialType === 'GENERATION_BOX'));
    const target = index >= 0 ? index : 0;
    setToolPanel(materialGroups.length ? `group:${materialGroups[target].id || target}` : 'materials');
  };
  return <div className="cv-shell">
    <section className="cv-layout">
      <aside className={`cv-sidebar ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
        <div className="cv-sidebar__head">
          <div className="cv-sidebar__title"><i><Icon name="menu" size={13} /></i><strong>工具</strong></div>
          <button type="button" className="cv-sidebar__toggle" aria-label={sidebarCollapsed ? '展开工具' : '收起工具'} aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? '展开工具' : '收起工具'} onClick={() => setSidebarCollapsed((value) => !value)}><Icon name="sidebar" size={15} /></button>
        </div>
        <div className="cv-nav">
          
          {materialGroups.map((group, index) => {
            const key = `group:${group.id || index}`;
            const count = (group.materials || []).length;
            return <button key={key} type="button" className={`cv-nav-item ${toolPanel === key ? 'is-active' : ''}`} title={`${group.title || `素材组 ${index + 1}`}（${count} 个）`} onClick={() => { setSidebarCollapsed(false); setToolPanel((value) => (value === key ? null : key)); }}><i><Icon name="grid" size={15} /></i><span>{group.title || `素材组 ${index + 1}`}</span></button>;
          })}
          {localMaterials.length ? <button type="button" className={`cv-nav-item ${toolPanel === 'local' ? 'is-active' : ''}`} title={`本地素材（${localMaterials.length} 个）`} onClick={() => { setSidebarCollapsed(false); setToolPanel((value) => (value === 'local' ? null : value)); }}><i><Icon name="upload" size={15} /></i><span>本地素材</span></button> : null}
          {materialGroups.length ? null : <button type="button" className={`cv-nav-item ${toolPanel === 'materials' ? 'is-active' : ''}`} title="课堂素材" onClick={() => { setSidebarCollapsed(false); setToolPanel((value) => (value === 'materials' ? null : value)); }}><i><Icon name="grid" size={15} /></i><span>课堂素材</span></button>}
          <button type="button" className={`cv-nav-item ${toolPanel === 'capabilities' ? 'is-active' : ''}`} title="能力" onClick={() => { setSidebarCollapsed(false); setToolPanel((value) => (value === 'capabilities' ? null : value)); }}><i><Icon name="sliders" size={15} /></i><span>能力</span></button>
        </div>
        {toolPanel && !sidebarCollapsed ? <div className="cv-panel">
          {activeGroup ? <>
            <div className="cv-panel__head"><div><strong>{activeGroup.title || `素材组 ${activeGroupIndex + 1}`}</strong><small>{editable ? '点框体或素材加入画布' : '课堂已结束，不能再修改画布'}</small></div><button type="button" className="cv-sidebar__close" onClick={() => setToolPanel(null)}><Icon name="close" size={14} /></button></div>
            <div className="cv-group">
              {(activeGroup.materials || []).map((material) => {
                const box = material.materialType === 'GENERATION_BOX' ? boxForMaterial(material) : null;


                const visual = materialVisual({ materialType: material.materialType, modality: box?.modality });
                if (box) {
                  const slotType = String(box.modality || '').toLowerCase();
                  const enabled = capabilities.includes(slotType);
                  const running = boxRunning(box.id);
                  const onCanvas = boxOnCanvas(box.id);
                  const blocked = !editable ? '课堂已结束，不能再修改画布' : (!enabled ? '本课未开放该 AI 能力' : '');
                  const state = onCanvas ? '已在画布上' : (running ? '生成中…' : (boxSucceeded(box.id) ? '已生成，点击接回画布' : '未生成'));




                  return <button className="cv-item is-gen-box" key={material.id} type="button" disabled={Boolean(blocked)} title={blocked || (onCanvas ? '已在画布上：点击定位到这个框体' : undefined)} onClick={() => addBoxToCanvas(box)}>
                    <span className={`cv-item__icon is-${visual.tone}`}><Icon name={visual.icon} size={15} /></span>
                    <span className="cv-item__text"><strong>{material.title}</strong><small>{visual.label} · {boxParamsLabel(box)} · {state}{blocked ? ' · ' + blocked : ''}</small></span>
                    <b className="cv-item__plus">{onCanvas ? '◎' : '＋'}</b>
                  </button>;
                }


                const promptText = String(material.snapshot?.content || material.description || '').replace(/\s+/g, ' ').trim();
                const subtitle = material.materialType === 'PROMPT'
                  ? (promptText ? (promptText.length > 18 ? `${promptText.slice(0, 18)}…` : promptText) : '点击后选择插入到哪个框体')
                  : (material.description || '点击后加入画布');
                const hover = material.materialType === 'PROMPT' && promptText
                  ? `${material.title || '提示词'}｜${promptText.length > 300 ? `${promptText.slice(0, 300)}…` : promptText}`
                  : (editable ? undefined : '课堂已结束，不能再修改画布');
                return <button className="cv-item" key={material.id || material.title} type="button" disabled={!editable} title={hover} onClick={() => material.materialType === 'PROMPT' ? openPromptInsert(material) : addLessonMaterialToCanvas(material)}>
                  <span className={`cv-item__icon is-${visual.tone}`}><Icon name={visual.icon} size={15} /></span>
                  <span className="cv-item__text"><strong>{material.title}</strong><small>{editable ? subtitle : '课堂已结束，不能再修改画布'}</small></span>
                  <b className="cv-item__plus">＋</b>
                </button>;
              })}
              {(activeGroup.materials || []).length ? null : <p className="cv-empty">这一组还没有素材。</p>}
            </div>
          </> : null}
          {toolPanel === 'local' ? <>
            <div className="cv-panel__head"><div><strong>本地素材</strong><small>你从电脑拖进画布的图片 / 视频 / 音频</small></div><button type="button" className="cv-sidebar__close" onClick={() => setToolPanel(null)}><Icon name="close" size={14} /></button></div>
            <div className="cv-group">{localMaterials.map((item) => <button className="cv-item" key={item.id} type="button" disabled={!editable} title={editable ? '定位到画布上的这个框体' : '课堂已结束，不能再修改画布'} onClick={() => setFocusRequest({ id: item.id, token: Date.now() })}>
              <span className={`cv-item__icon is-${item.kind === '视频' ? 'video' : item.kind === '音频' ? 'audio' : 'image'}`}><Icon name={item.kind === '视频' ? 'video' : item.kind === '音频' ? 'music' : 'image'} size={15} /></span>
              <span className="cv-item__text"><strong>{item.title}</strong><small>{item.kind} · {item.uploading ? '上传中…' : '本地素材 · 已在画布上'}</small></span>
              <b className="cv-item__plus">◎</b>
            </button>)}</div>
          </> : null}
          {toolPanel === 'materials' ? <>
            <div className="cv-panel__head"><div><strong>课堂素材</strong><small>{editable ? '点框体或素材加入画布' : '课堂已结束，不能再修改画布'}</small></div><button type="button" className="cv-sidebar__close" onClick={() => setToolPanel(null)}><Icon name="close" size={14} /></button></div>
            <p className="cv-empty">本课尚未配置画布素材。</p>
          </> : null}
          {toolPanel === 'capabilities' ? <>
            <div className="cv-panel__head"><div><strong>本课开放能力</strong><small>未勾选的 AI 能力不会出现在画布中</small></div><button type="button" className="cv-sidebar__close" onClick={() => setToolPanel(null)}><Icon name="close" size={14} /></button></div>
            <div className="cv-chips">{[['text', 'AI 文字'], ['image', 'AI 生图'], ['video', 'AI 生视频'], ['music', 'AI 音乐']].map(([key, label]) => <span className={`cv-chip ${capabilities.includes(key) ? 'is-on' : ''}`} key={key}>{capabilities.includes(key) ? '✓' : '—'} {label}</span>)}</div>
          </> : null}
          
        </div> : null}
      </aside>
      <div className="cv-main">
        
        <div className="cv-viewport"><CanvasEditor key={canvasRevision} initialSnapshot={canvasSnapshot || project.data.canvasSnapshot} capabilities={capabilities} readOnly={!editable} allowNodeCreation={false} boxModalities={boxModalities} showStarter={false} beforeGenerate={beforeGenerate} onGenerateNode={onGenerateNode} onUploadFiles={uploadLocalFiles} onRequestMaterials={openMaterialsPanel} onChange={setDraft} focusRequest={focusRequest} entranceRequest={entranceRequest} placementRef={placementRef} /></div>
      </div>
    </section>
    {message && <div className={`cv-toast ${''}`}>{message}</div>}
    {promptTarget && <div className="cv-dialog" role="dialog" aria-modal="true"><div className="cv-dialog__panel"><strong>把「{promptTarget.material.title}」插入到哪个框体？</strong><div className="cv-dialog__list">{promptTarget.targets.map((node) => <button key={node.id} type="button" onClick={() => insertPromptToSlot(node.id)}>{node.data?.title || node.type}<small>{PROMPT_SLOT_ACTION[String(node.data?.slotType || '')] || ''}{node.data?.aspectRatio ? ' · ' + node.data.aspectRatio : ''}</small></button>)}</div><button type="button" className="cv-text-btn" onClick={() => setPromptTarget(null)}>取消</button></div></div>}
  </div>;
}
