const {randomUUID} = require("node:crypto");
function displayModelLabel(value) {
  const text=String(value||'').trim();
  if(!text)return '';
  const parts=text.split('::');
  const leaf=parts.at(-1).split('/').filter(Boolean);
  let label=leaf.at(-1)||text;
  if(['stable-token','default','latest'].includes(label.toLowerCase())&&leaf.length>1)label=leaf.at(-2);
  return label.replace(/-saver$/i,'');
}
function modelLabels(value) {
  if(value==null)return {};
  if(typeof value!=='object'||Array.isArray(value))throw Error('请检查模型显示名称');
  return Object.fromEntries(Object.entries(value).filter(([id,label])=>typeof id==='string'&&id&&typeof label==='string'&&label.trim())
    .map(([id,label])=>[id,label.trim()]));
}
function text(value, label, limit = 300) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`请检查${label}`);
  return value.trim();
}
function richText(value, label, limit = 200000) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > limit) throw new Error(`请检查${label}`);
  const safe = value
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|option|meta|link)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|option|meta|link)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src|poster)\s*=\s*(["'])\s*(?:javascript|vbscript|data):[\s\S]*?\2/gi, ' $1=$2#$2');
  return safe.trim();
}
function coverImages(value, title) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 5) throw new Error('课程封面最多上传 5 张');
  const seen = new Set();
  return value.map((image, index) => {
    const url = text(typeof image === 'string' ? image : image?.url, `课程封面 ${index + 1}`, 2048);
    if (seen.has(url)) throw new Error('课程封面不能重复');
    seen.add(url);
    const alt = typeof image?.alt === 'string' && image.alt.trim()
      ? image.alt.trim().slice(0, 300)
      : `${title}封面 ${index + 1}`;
    return { url, alt };
  });
}
function validSteps(steps) {
  if (!Array.isArray(steps) || steps.length > 60) throw new Error('课程步骤最多 60 项');
  const ids = new Set();
  return steps.map(step => {
    const id = text(step.id, '步骤编号', 90);
    if (ids.has(id)) throw new Error('步骤编号重复');
    ids.add(id);
    return { id, title: text(step.title, '步骤标题'), description: text(step.description, '步骤说明', 3000), deliverable: text(step.deliverable, '阶段成果') };
  });
}
function deliveryModes(modes) {
  if (!Array.isArray(modes) || !modes.length || new Set(modes).size !== modes.length || modes.some(mode => !['CANVAS','VIBECODING'].includes(mode))) throw new Error('请选择有效的课程工作区');
  return modes;
}

function modelPolicy(items = []) {
  if (!Array.isArray(items) || items.length > 4) throw Error('请检查画布模型设置');
  const modalities = new Set();
  return items.map(({modality,modelId}) => {
    if (!['TEXT','IMAGE','VIDEO','AUDIO'].includes(modality) || modalities.has(modality)) throw Error('每种创作类型只能指定一个模型');
    modalities.add(modality);
    return {modality,modelId:text(modelId,'模型编号',120)};
  });
}
function buildCourseVersion(draft, base = {}) {
  const id = base.id || randomUUID();
  const steps = validSteps(draft.steps ?? []);
  const modes = deliveryModes(draft.permittedDeliveryModes ?? [draft.type]);
  const type = modes[0];
  if (!Number.isSafeInteger(draft.price) || draft.price < 0 || draft.price > 1000000) throw new Error('请输入有效的积分价格');
  const title = text(draft.title,'课程标题',120);
  const subtitle = text(draft.subtitle,'课程简介',1000);
  const galleryImages = coverImages(draft.galleryImages ?? base.galleryImages, title);
  const existingThumbnail = String(draft.thumbnailUrl || base.thumbnailUrl || '').trim();
  if (existingThumbnail.length > 2048) throw new Error('请检查课程封面');
  const thumbnailUrl = galleryImages[0]?.url || existingThumbnail || null;
  if (thumbnailUrl && !galleryImages.length) galleryImages.push({ url: thumbnailUrl, alt: `${title}封面` });
  const introHtml = richText(draft.introHtml ?? base.introHtml, '课程详细介绍');
  const category = text(draft.category || base.category || '创作实训','课程分类',80);
  const level = text(draft.level || base.level || '入门','课程难度',40);
  const rawDuration = draft.durationMinutes ?? base.durationMinutes ?? null;
  const durationMinutes = rawDuration === '' || rawDuration == null ? null : Number(rawDuration);
  if (durationMinutes != null && (!Number.isSafeInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > 100000)) throw new Error('请输入有效的预计时长');
  const models = modes.includes('CANVAS') ? modelPolicy(draft.modelPolicy ?? base.modelPolicy) : [];
  const ids = modes.includes('VIBECODING') ? (draft.vibeModelIds ?? base.vibeModelIds ?? []) : [];
  if (!Array.isArray(ids) || ids.length > 30) throw Error('请检查 VibeCoding 模型清单');
  const vibeModelIds = [...new Set(ids.map(id => text(id,'模型编号',120)))];
  const suppliedLabels=modelLabels(draft.vibeModelLabels ?? base.vibeModelLabels);
  const vibeModelLabels=Object.fromEntries(vibeModelIds.map(id=>[id,suppliedLabels[id]||displayModelLabel(id)]));
  const suppliedModelLabels=Array.isArray(draft.modelLabels)?draft.modelLabels.map(label=>text(label,'模型显示名称',120)):[];
  const course = { ...base, id, versionId: randomUUID(), title, subtitle, introHtml, thumbnailUrl, galleryImages, type, category, level, durationMinutes,
    unlockPricePoints: draft.price, learningObjectives: steps.length ? [steps.at(-1).deliverable] : [], modelPolicy: models, vibeModelIds, vibeModelLabels,
    modelLabels: [...new Set([...suppliedModelLabels,...models.map(item => displayModelLabel(item.modelId)), ...Object.values(vibeModelLabels)])], assets: base.assets || [],
    steps, previewSteps: steps.map(s => s.title), permittedDeliveryModes: modes };
  const materialGroups = modes.includes('CANVAS') ? draft.materialGroups ?? base.materialGroups ?? [] : [];
  const snapshot = modes.includes('CANVAS') ? draft.canvasSnapshot ?? base.canvasSnapshot ?? {nodes:[],edges:[]} : {nodes:[],edges:[]};
  if (!Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges) || !Array.isArray(materialGroups) || materialGroups.length > 60) throw Error('画布编排格式不正确');
  const identifiers = new Set();
  const unique = value => {const id=text(value,'素材编号',128);if(identifiers.has(id)) throw Error('分组或素材编号重复');identifiers.add(id);return id;};
  for (const group of materialGroups) {
    unique(group.id);text(group.title,'分组名称');
    if (!Array.isArray(group.materials) || group.materials.length > 100) throw Error('分组素材格式不正确');
    for (const material of group.materials) {
      unique(material.id);text(material.title,'素材名称');
      if (!['IMAGE','VIDEO','AUDIO','PROMPT','GENERATION_BOX'].includes(material.materialType)) throw Error('不支持的素材类型');
      if (material.materialType === 'GENERATION_BOX' && !['TEXT','IMAGE','VIDEO','AUDIO','MUSIC'].includes(material.snapshot?.box?.modality)) throw Error('请指定框体类型');
      const box = material.materialType === 'GENERATION_BOX' && material.snapshot.box;
      if (box?.modelBinding === 'BOX' && box.model) {
        text(box.model,'框体模型',120);
        course.modelLabels.push(box.modelLabel || box.model);
      }
      if (material.materialType === 'PROMPT') text(material.snapshot?.content || material.description,'画布提示词',12000);
    }
  }
  const prompts = modes.includes('VIBECODING') ? (draft.classroomConfig ?? base.classroomConfig)?.vibeCoding?.presetPrompts ?? [] : [];
  if (!Array.isArray(prompts) || prompts.length > 100) throw Error('请检查提示词预设');
  const rawUsageLimit = modes.includes('VIBECODING')
    ? (draft.classroomConfig ?? base.classroomConfig)?.vibeCoding?.usageLimit ?? 0
    : 0;
  const usageLimit = rawUsageLimit === '' ? 0 : Number(rawUsageLimit);
  if (!Number.isSafeInteger(usageLimit) || usageLimit < 0 || usageLimit > 1000000) throw Error('VibeCoding 使用次数上限必须是 0-1000000 的整数');
  course.classroomConfig={
    vibeCoding:{
      presetPrompts:prompts.map(prompt=>({title:text(prompt.title,'预设名称'),text:text(prompt.text,'预设正文',12000)})),
      usageLimit,
    },
  };
  course.modelLabels = [...new Set(course.modelLabels)];
  course.materialGroups=materialGroups;course.canvasSnapshot=snapshot;
  return course;
}
module.exports = {buildCourseVersion, deliveryModes};
