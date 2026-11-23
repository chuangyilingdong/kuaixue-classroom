import catalogSeed from "../../data/course-catalog.demo.json" with { type: "json" };

const TONES = new Set(["coral", "lime", "blue", "violet", "yellow", "mint"]);
const ICONS = new Set(["film", "shapes", "code", "box", "sparkles", "book"]);

function focusPercent(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50;
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
    models: Array.isArray(item.modelLabels) ? item.modelLabels.map(String) : [],
    steps: Array.isArray(item.previewSteps) ? item.previewSteps.map(String) : [],
    bannerUrl: typeof item.bannerUrl === "string" ? item.bannerUrl.trim() || null : null,
    coverPosition: `${focusPercent(item.coverFocus?.x)}% ${focusPercent(item.coverFocus?.y)}%`,
    thumbnailUrl: item.thumbnailUrl ? String(item.thumbnailUrl) : null,
    purchaseCount: Number.isSafeInteger(item.purchaseCount) && item.purchaseCount >= 0 ? item.purchaseCount : null,
    tone: TONES.has(item.visualTone) ? item.visualTone : "coral",
    icon: ICONS.has(item.icon) ? item.icon : type === "CANVAS" ? "film" : "code",
  };
}

function normalizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images.filter((image) => typeof image?.url === "string" && image.url.trim())
    .map(({ url, alt }) => ({ url, alt: String(alt || "") }));
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
  return {
    ...course,
    galleryImages: normalizeImages(item.galleryImages),
    introImages: normalizeImages(item.introImages),
    mediaCredit: String(item.mediaCredit || ""),
    learningObjectives: item.learningObjectives.map(String),
    steps,
    assets: item.assets,
    materialGroups: item.materialGroups ?? [],canvasSnapshot:item.canvasSnapshot ?? null,modelPolicy:item.modelPolicy ?? [],
  };
}

export const courses = catalogSeed.map(normalizeCourseItem);
export const demoCourseDetails = new Map(catalogSeed.map((course) => [course.id, normalizeCourseDetail(course)]));
export const categoryFilters = ["全部课程", "画布课程", "VibeCoding"];
