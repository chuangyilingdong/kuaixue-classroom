import catalogSeed from "../../data/course-catalog.demo.json" with { type: "json" };

const TONES = new Set(["coral", "lime", "blue", "violet", "yellow", "mint"]);
const ICONS = new Set(["film", "shapes", "code", "box", "sparkles", "book"]);
const MEDIA_KEYS = new Set(["url","assetUrl","previewUrl","thumbnailUrl","bannerUrl","posterUrl","referenceUrl","sourceAssetUrl","lastFrameAssetUrl"]);

export function displayModelLabel(value) {
  const text=String(value || "").trim();
  if(!text) return "";
  const parts=text.split("::");
  const provider=parts.at(-1);
  const gpt=provider.match(/^(?:rh(?:art)?-image-)?g-(\d+(?:\.\d+)?)(?:[\/-]|$)/i) ||
    provider.match(/^rh-gpt-image-(\d+(?:\.\d+)?)(?:[\/-]|$)/i) ||
    provider.match(/^gpt-image-(\d+(?:\.\d+)?)(?:[\/-]|$)/i);
  if(gpt) return `gpt-image-${gpt[1]}`;
  const nano=provider.match(/^(?:rh(?:art)?-image-)?n-(nb21|nb2)(?:[\/-]|$)/i) ||
    provider.match(/^(?:rh-)?nano-banana-(\d+(?:\.\d+)?)(?:[\/-]|$)/i);
  if(nano) return nano[1].toLowerCase()==='nb21'||nano[1]==='2.1' ? 'nano-banana 2.1' : 'nano-banana 2';
  const leaf=provider.split("/").filter(Boolean);
  let label=leaf.at(-1) || text;
  const operation=leaf.findIndex(segment=>/^(?:text|image|video|audio|music)-(?:to)-(?:image|video|audio|music)$/i.test(segment));
  if(operation>0) label=leaf[0];
  else if(["stable-token","default","latest"].includes(label.toLowerCase()) && leaf.length>1) label=leaf.at(-2);
  return label.replace(/-saver$/i,"");
}

function focusPercent(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50;
}

export function normalizeMediaUrl(value, field = "media") {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`Course ${field} URL is invalid.`);
  const text = value.trim();
  if (!text) return null;
  if (/[\u0000-\u001f]/.test(text) || text.startsWith("//")) throw new Error(`Course ${field} URL is invalid.`);
  if (text.startsWith("/")) {
    if (text.includes("\\")) throw new Error(`Course ${field} URL is invalid.`);
    return text;
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) {
    if (text.includes("\\")) throw new Error(`Course ${field} URL is invalid.`);
    return text;
  }
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error(`Course ${field} URL is invalid.`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error(`Course ${field} URL is invalid.`);
  return parsed.href;
}

function normalizeMediaTree(value, field = "media") {
  if (Array.isArray(value)) return value.map((item,index) => normalizeMediaTree(item,`${field}[${index}]`));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key,item]) => [
    key,
    MEDIA_KEYS.has(key) && (typeof item === "string" || item == null)
      ? normalizeMediaUrl(item,`${field}.${key}`)
      : normalizeMediaTree(item,`${field}.${key}`),
  ]));
}

export function normalizeCourseItem(item) {
  if (!item || typeof item !== "object") throw new Error("Course catalog contains an invalid item.");
  const type = String(item.type || "").toUpperCase();
  const modes = item.permittedDeliveryModes === undefined ? [type] : item.permittedDeliveryModes;
  if (!Array.isArray(modes) || !modes.length || new Set(modes).size !== modes.length ||
      modes.some(mode => !["CANVAS", "VIBECODING"].includes(mode)) || !modes.includes(type)) {
    throw new Error("Course catalog contains invalid workspace modes.");
  }
  const price = Number(item.unlockPricePoints);
  const duration = Number(item.durationMinutes);
  const modelLabels = Array.isArray(item.modelLabels) ? item.modelLabels.map(String) : [];
  const labelMap = item.vibeModelLabels && typeof item.vibeModelLabels === "object" ? item.vibeModelLabels : {};
  if (!item.id || !item.title || !["CANVAS", "VIBECODING"].includes(type) || !Number.isInteger(price) || price < 0) {
    throw new Error("Course catalog item is missing required fields.");
  }

  return {
    id: String(item.id),
    versionId: item.versionId ? String(item.versionId) : null,
    title: String(item.title),
    subtitle: String(item.subtitle || ""),
    type: type === "CANVAS" ? "canvas" : "vibe",
    permittedDeliveryModes: [...modes],
    category: String(item.category || "其他"),
    level: String(item.level || "未分级"),
    duration: Number.isFinite(duration) && duration > 0 ? `约 ${duration} 分钟` : "时长待定",
    durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : null,
    price,
    models: [...new Set(modelLabels.map(label => typeof labelMap[label] === "string" && labelMap[label].trim()
      ? labelMap[label].trim()
      : displayModelLabel(label)).filter(Boolean))],
    steps: Array.isArray(item.previewSteps) ? item.previewSteps.map(String) : [],
    bannerUrl: normalizeMediaUrl(item.bannerUrl,"bannerUrl"),
    coverPosition: `${focusPercent(item.coverFocus?.x)}% ${focusPercent(item.coverFocus?.y)}%`,
    thumbnailUrl: normalizeMediaUrl(item.thumbnailUrl,"thumbnailUrl"),
    purchaseCount: Number.isSafeInteger(item.purchaseCount) && item.purchaseCount >= 0 ? item.purchaseCount : null,
    tone: TONES.has(item.visualTone) ? item.visualTone : "coral",
    icon: ICONS.has(item.icon) ? item.icon : type === "CANVAS" ? "film" : "code",
  };
}

function normalizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images.slice(0, 5).map(image => {
    if (!image || typeof image !== "object") throw new Error("Course image is invalid.");
    const url = normalizeMediaUrl(image.url,"image.url");
    return url ? { url, alt: String(image.alt || "") } : null;
  }).filter(Boolean);
}

export function normalizeCourseDetail(item) {
  const course = normalizeCourseItem(item);
  if (!item.versionId || !Array.isArray(item.learningObjectives) || !Array.isArray(item.steps) || !Array.isArray(item.assets) || !Array.isArray(item.permittedDeliveryModes)) {
    throw new Error("Course detail is missing required version or learning fields.");
  }
  const steps = item.steps.map((step) => {
    if (!step || typeof step !== "object" || !step.id || !step.title || !step.description || !step.deliverable) {
      throw new Error("Course detail contains an invalid step.");
    }
    return {
      id: String(step.id),
      title: String(step.title),
      description: String(step.description),
      deliverable: String(step.deliverable),
    };
  });
  const labels=item.vibeModelLabels&&typeof item.vibeModelLabels==='object'?item.vibeModelLabels:{};
  const declaredIds=Array.isArray(item.vibeModelIds)?item.vibeModelIds.map(String).filter(Boolean):[];
  const legacyIds=(Array.isArray(item.modelLabels)?item.modelLabels.map(String):[])
    .filter(id=>/^aicyld-runninghub-llm-(?:cn|global)::[A-Za-z0-9._/:+-]+$/.test(id));
  const vibeModelIds=[...new Set([...declaredIds,...legacyIds])];
  const vibeModelLabels=Object.fromEntries(vibeModelIds.map(id=>[id,
    displayModelLabel(typeof labels[id]==='string'&&labels[id].trim()?labels[id].trim():id)]));
  const materialGroups=normalizeMediaTree(item.materialGroups ?? [],"materialGroups");
  for(const group of materialGroups){
    for(const material of group.materials || []){
      const box=material?.snapshot?.box;
      if(box&&(box.model||box.modelLabel))box.modelLabel=displayModelLabel(box.modelLabel||box.model);
    }
  }
  return {
    ...course,
    introHtml: typeof item.introHtml === "string" ? item.introHtml : "",
    galleryImages: normalizeImages(item.galleryImages),
    introImages: normalizeImages(item.introImages),
    mediaCredit: String(item.mediaCredit || ""),
    learningObjectives: item.learningObjectives.map(String),
    steps,
    assets: normalizeMediaTree(item.assets,"assets"),
    materialGroups,
    canvasSnapshot:item.canvasSnapshot ?? null,modelPolicy:item.modelPolicy ?? [],
    classroomConfig:item.classroomConfig && typeof item.classroomConfig==='object' ? item.classroomConfig : {},
    vibeModelIds,
    vibeModelLabels,
  };
}

export const courses = catalogSeed.map(normalizeCourseItem);
export const demoCourseDetails = new Map(catalogSeed.map((course) => [course.id, normalizeCourseDetail(course)]));
export const categoryFilters = ["全部课程", "画布课程", "VibeCoding"];
