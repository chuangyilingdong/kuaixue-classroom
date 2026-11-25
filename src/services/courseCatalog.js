import { courses as demoCourses, demoCourseDetails, normalizeCourseDetail, normalizeCourseItem } from "../data/courses.js";
import { defaultCatalogCategories, normalizeCatalogEntries, validateCatalogCategories } from "../../shared/catalog-categories.mjs";

export const catalogBaseUrl = String(import.meta.env?.VITE_KUAIXUE_API_BASE_URL || "").trim();

export class CourseCatalogError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "CourseCatalogError";
    this.status = status;
  }
}

export async function loadCourseCatalog({
  baseUrl = catalogBaseUrl,
  fetchImpl = globalThis.fetch,
  signal,
  readCategories = globalThis.location?.protocol === 'kuaixue:' ? globalThis.kuaixueDesktop?.catalogCategories : undefined,
} = {}) {
  const origin = String(baseUrl).trim().replace(/\/+$/, "");
  if (!origin) {
    const api = globalThis.location?.protocol === 'file:' && globalThis.kuaixueDesktop?.workshop;
    return { source: "demo", courses: api ? (await api.catalog()).map(normalizeCourseItem) : demoCourses, categories: defaultCatalogCategories };
  }
  if (typeof fetchImpl !== "function") throw new CourseCatalogError("Fetch is unavailable in this runtime.");

  const courses = [];
  const seen = new Set();
  let categories = defaultCatalogCategories;
  let cursor;
  do {
    const page = await fetchCatalogPage(origin, fetchImpl, signal, cursor);
    if (page.categories) {
      categories = page.categories;
    }
    courses.push(...page.courses);
    cursor = page.next;
    if (cursor != null && (typeof cursor !== "string" || seen.has(cursor))) {
      throw new CourseCatalogError("Catalog service returned an invalid page cursor.");
    }
    seen.add(cursor);
  } while (cursor);
  const configured = await fetchCatalogCategories(origin, fetchImpl, signal, readCategories);
  if (configured !== null) categories = configured;
  return { source: "service", courses, categories };
}

async function fetchCatalogPage(origin, fetchImpl, signal, cursor) {
  let response;
  try {
    response = await fetchImpl(`${origin}/api/v1/catalog/courses${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new CourseCatalogError("Could not reach the Kuaixue catalog service.");
  }

  if (!response.ok) throw new CourseCatalogError(`Catalog service returned HTTP ${response.status}.`, response.status);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new CourseCatalogError("Catalog service returned invalid JSON.");
  }

  const items = payload?.data?.items;
  if (!Array.isArray(items)) throw new CourseCatalogError("Catalog response does not match the proposed contract.");
  try {
    return { courses: items.map(normalizeCourseItem), next: payload.data.page?.nextCursor,
      categories: payload.data.categories === undefined ? undefined : validateCatalogCategories(payload.data.categories) };
  } catch (error) {
    throw new CourseCatalogError(error instanceof Error ? error.message : "Catalog contains an invalid course record.");
  }
}

async function fetchCatalogCategories(origin, fetchImpl, signal, readCategories) {
  let status;
  let payload;
  try {
    signal?.throwIfAborted();
    if (readCategories) {
      const result = await readCategories();
      status = result.status;
      payload = result.body;
    } else {
      const response = await fetchImpl(`${origin}/api/v1/catalog/categories`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal,
      });
      status = response.status ?? (response.ok ? 200 : 500);
      payload = await response.json().catch(() => null);
    }
    signal?.throwIfAborted();
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new CourseCatalogError("课程分类暂时无法读取，请刷新重试。");
  }
  if (status === 404) return null;
  if (status < 200 || status >= 300) throw new CourseCatalogError("课程分类暂时无法读取，请刷新重试。", status);
  try {
    return normalizeCatalogEntries(payload?.data?.entries);
  } catch (error) {
    throw new CourseCatalogError(error.message);
  }
}

export async function loadCourseDetail(courseId, {
  versionId,
  baseUrl = catalogBaseUrl,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const origin = String(baseUrl).trim().replace(/\/+$/, "");
  if (!origin) {
    const api = globalThis.location?.protocol === 'file:' && globalThis.kuaixueDesktop?.workshop;
    if (api && versionId) return normalizeCourseDetail(await api.detail(courseId, versionId));
    const detail = demoCourseDetails.get(String(courseId));
    if (!detail || (versionId && versionId !== detail.versionId)) throw new CourseCatalogError("Course not found.", 404);
    return detail;
  }
  if (typeof fetchImpl !== "function") throw new CourseCatalogError("Fetch is unavailable in this runtime.");

  let response;
  try {
    response = await fetchImpl(`${origin}/api/v1/catalog/courses/${encodeURIComponent(courseId)}${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ""}`, {
      headers: { Accept: "application/json" },
      credentials: "include", redirect:"error", signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new CourseCatalogError("Could not reach the course detail service.");
  }
  if (!response.ok) throw new CourseCatalogError(`Course detail service returned HTTP ${response.status}.`, response.status);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new CourseCatalogError("Course detail service returned invalid JSON.");
  }
  try {
    const detail = normalizeCourseDetail(payload?.data?.course);
    if (detail.id !== String(courseId)) throw new Error("Course detail ID does not match the request.");
    if (versionId && detail.versionId !== versionId) throw new Error("Course version does not match the request.");
    return detail;
  } catch (error) {
    throw new CourseCatalogError(error instanceof Error ? error.message : "Course detail does not match the proposed contract.");
  }
}

