import {handleCourseAction,sessionPrincipal,readBody} from './course-actions.mjs';
import {openCoursePlatform,CourseProblem} from './course-platform.mjs';
import { createAccountReader, WalletUnavailable } from "./account.mjs";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = resolve(HERE, "../../data/course-catalog.demo.json");
const DEFAULT_CATALOG = JSON.parse(readFileSync(SEED_PATH, "utf8"));
const ALLOWED_TYPES = new Set(["CANVAS", "VIBECODING"]);
const ALLOWED_SORTS = new Set(["recommended", "price_asc", "duration_asc"]);

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

function cursorOffset(cursor) {
  if (!cursor) return 0;
  try {
    const value = Buffer.from(cursor, "base64url").toString("utf8");
    if (!/^offset:\d+$/.test(value)) return null;
    const offset = Number(value.slice("offset:".length));
    return Number.isSafeInteger(offset) ? offset : null;
  } catch {
    return null;
  }
}

function nextCursor(offset) {
  return Buffer.from(`offset:${offset}`).toString("base64url");
}

function courseDetails(course) {
  const {
    id, versionId, title, subtitle, type, category, level, durationMinutes,
    unlockPricePoints, modelLabels, previewSteps, thumbnailUrl = null, bannerUrl, coverFocus, purchaseCount = null, visualTone,
    icon, learningObjectives, steps, assets, permittedDeliveryModes, galleryImages, introImages, mediaCredit,
  } = course;
  return {
    id, versionId, title, subtitle, type, category, level, durationMinutes,
    unlockPricePoints, modelLabels, previewSteps, thumbnailUrl, bannerUrl, coverFocus, purchaseCount, visualTone, icon,
    learningObjectives, steps, assets, permittedDeliveryModes, galleryImages, introImages, mediaCredit,
  };
}

function catalogPage(catalog, params) {
  const type = (params.get("type") || "").trim().toUpperCase();
  const query = (params.get("q") || "").trim().toLocaleLowerCase("zh-CN");
  const sort = params.get("sort") || "recommended";
  const limitRaw = Number(params.get("limit") || 20);
  const offset = cursorOffset(params.get("cursor"));

  if (type && !ALLOWED_TYPES.has(type)) return { error: "Invalid course type.", status: 400 };
  if (!ALLOWED_SORTS.has(sort)) return { error: "Invalid sort value.", status: 400 };
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100) return { error: "Limit must be between 1 and 100.", status: 400 };
  if (offset === null) return { error: "Invalid cursor.", status: 400 };
  if (query.length > 100) return { error: "Search query is too long.", status: 400 };

  let items = catalog.filter((course) => {
    if (type && !(course.permittedDeliveryModes ?? [course.type]).includes(type)) return false;
    if (!query) return true;
    return `${course.title} ${course.subtitle} ${course.category}`.toLocaleLowerCase("zh-CN").includes(query);
  });
  if (sort === "price_asc") items = items.toSorted((a, b) => a.unlockPricePoints - b.unlockPricePoints);
  if (sort === "duration_asc") items = items.toSorted((a, b) => a.durationMinutes - b.durationMinutes);

  const pageItems = items.slice(offset, offset + limitRaw).map(({ id, versionId, title, subtitle, type: courseType, permittedDeliveryModes, category, level, durationMinutes, unlockPricePoints, modelLabels, previewSteps, thumbnailUrl = null, bannerUrl, coverFocus, purchaseCount = null, visualTone, icon }) => ({
    id, versionId, title, subtitle, type: courseType, permittedDeliveryModes, category, level, durationMinutes,
    unlockPricePoints, modelLabels, previewSteps, thumbnailUrl, bannerUrl, coverFocus, purchaseCount, visualTone, icon,
  }));
  const nextOffset = offset + pageItems.length;

  return {
    data: {
      items: pageItems,
      page: {
        limit: limitRaw,
        total: items.length,
        nextCursor: nextOffset < items.length ? nextCursor(nextOffset) : null,
      },
    },
  };
}

export function createApiServer({ catalog = DEFAULT_CATALOG, accountReader, platform, identity, desktopAuth, allowedOrigins = ["http://127.0.0.1:5173", "http://localhost:5173"] } = {}) {
  const allowed = new Set(allowedOrigins.filter(origin => origin !== "null" && origin !== "*"));
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Accept, Content-Type",
        "Access-Control-Max-Age": "600",
      });
      return res.end();
    }

    let url;
    try {
      url = new URL(req.url || "/", "http://127.0.0.1");
    } catch {
      return json(res, 400, { error: { code: "BAD_URL", message: "Invalid request URL." } });
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/desktop/logout') {
      if (origin && !allowed.has(origin)) return json(res,403,{error:{code:'ORIGIN_DENIED'}});
      if (!desktopAuth?.revokeSession) return json(res,503,{error:{code:'LOGOUT_NOT_CONFIGURED'}});
      try {
        const session = /(?:^|;\s*)kuaixue_session=([^;\s]+)/.exec(req.headers.cookie || '')?.[1];
        if (session) await desktopAuth.revokeSession(session);
        res.setHeader('Set-Cookie','kuaixue_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=None');
        return json(res,200,{data:{authenticated:false}});
      } catch {return json(res,503,{error:{code:'LOGOUT_UNAVAILABLE'}});}
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/desktop/session') {
      if (origin && !allowed.has(origin)) return json(res,403,{error:{code:'ORIGIN_DENIED'}});
      if (!desktopAuth) return json(res,503,{error:{code:'LOGIN_NOT_CONFIGURED'}});
      try {
        const {code,verifier,redirectUri,clientId} = await readBody(req);
        if (typeof code !== 'string' || !code || code.length > 2048 || typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
            redirectUri !== desktopAuth.redirectUri || clientId !== desktopAuth.clientId || !clientId) return json(res,400,{error:{code:'INVALID_CALLBACK'}});
        const session = await desktopAuth.exchange({code,verifier,redirectUri,clientId});
        if (typeof session !== 'string' || !/^[a-zA-Z0-9_-]{32,256}$/.test(session)) return json(res,401,{error:{code:'LOGIN_FAILED'}});
        res.setHeader('Set-Cookie',`kuaixue_session=${session}; Path=/; HttpOnly; Secure; SameSite=None`);
        return json(res,200,{data:{authenticated:true}});
      } catch { return json(res,401,{error:{code:'LOGIN_FAILED'}}); }
    }
    if (await handleCourseAction(req,res,{path:url.pathname, allowed, identity, platform, json})) return;
    if (req.method === "GET" && ["/api/v1/me", "/api/v1/me/entitlements"].includes(url.pathname)) {
      if (origin && !allowed.has(origin)) return json(res, 403, { error: { code: "ORIGIN_DENIED" } });
      if (!accountReader) return json(res, 503, { error: { code: "ACCOUNT_NOT_CONFIGURED" } });
      const session = /(?:^|;\s*)kuaixue_session=([^;\s]+)/.exec(req.headers.cookie || "")?.[1];
      if (!session) return json(res, 401, { error: { code: "SESSION_REQUIRED" } });
      try {
        const entitlementsOnly = url.pathname.endsWith("/entitlements");
        const account = await accountReader(session, { entitlementsOnly });
        if (!account) return json(res, 401, { error: { code: "SESSION_EXPIRED" } });
        const data = entitlementsOnly ? { entitlements: account.entitlements } : account;
        return json(res, 200, { data });
      } catch (error) {
        if (error instanceof WalletUnavailable) return json(res, 502, { error: { code: "WALLET_UNAVAILABLE" } });
        return json(res, 502, { error: { code: "ACCOUNT_UNAVAILABLE" } });
      }
    }
    if (req.method === "GET" && url.pathname === "/healthz") return json(res, 200, { status: "ok" });
    if (req.method === "GET" && url.pathname === "/api/v1/catalog/courses") {
      const result = catalogPage(platform ? platform.catalog() : catalog, url.searchParams);
      if (result.error) return json(res, result.status, { error: { code: "INVALID_CATALOG_QUERY", message: result.error } });
      res.setHeader("Cache-Control", "public, max-age=30");
      return json(res, 200, result);
    }

    const detailMatch = url.pathname.match(/^\/api\/v1\/catalog\/courses\/([^/]+)$/);
    if (req.method === "GET" && detailMatch) {
      let courseId;
      try {
        courseId = decodeURIComponent(detailMatch[1]);
      } catch {
        return json(res, 400, { error: { code: "BAD_COURSE_ID", message: "Invalid course ID." } });
      }
      const version = url.searchParams.get("versionId");
      if (platform) {
        try {
          if (origin && !allowed.has(origin)) return json(res,403,{error:{code:"ORIGIN_DENIED"}});
          const user = await sessionPrincipal(req,identity);
          const course = platform.detail(courseId,version,user?.userId);
          return json(res,200,{data:{course:courseDetails(course)}});
        } catch (error) { return json(res,error instanceof CourseProblem ? error.status : 503,{error:{code:"COURSE_DETAIL_UNAVAILABLE"}}); }
      }
      const course = catalog.find((item) => item.id === courseId && (version === null || item.versionId === version));
      if (!course) return json(res, 404, { error: { code: "COURSE_NOT_FOUND", message: "Course not found." } });
      res.setHeader("Cache-Control", "public, max-age=30");
      return json(res, 200, { data: { course: courseDetails(course) } });
    }

    if (url.pathname.startsWith("/api/")) {
      res.setHeader("Allow", "GET, OPTIONS");
      return json(res, req.method === "GET" ? 404 : 405, { error: { code: "NOT_FOUND", message: "API route not found." } });
    }
    return json(res, 404, { error: { code: "NOT_FOUND", message: "Route not found." } });
  });
}

export function startApiServer({ port = Number(process.env.KUAIXUE_API_PORT || 4174), host = "127.0.0.1", accountReader, platform, identity, desktopAuth } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("KUAIXUE_API_PORT must be between 1 and 65535.");
  const server = createApiServer({
    accountReader, platform, identity, desktopAuth,
    allowedOrigins: process.env.KUAIXUE_ALLOWED_ORIGINS?.split(",").map((item) => item.trim()).filter(Boolean),
  });
  server.listen(port, host, () => console.log(`Kuaixue catalog API listening on http://${host}:${port}`));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let accountReader, platform, identity, desktopAuth;
  if (process.env.KUAIXUE_ACCOUNT_PROVIDER) {
    const provider = await import(pathToFileURL(resolve(process.env.KUAIXUE_ACCOUNT_PROVIDER)).href);
    identity = provider.identity;
    desktopAuth = provider.desktopAuth;
    if (process.env.KUAIXUE_COURSE_DB) platform = openCoursePlatform(process.env.KUAIXUE_COURSE_DB,provider);
    accountReader = createAccountReader({ identity, listGrants: platform?.listGrants || provider.listGrants, mainSite: process.env.KUAIXUE_MAIN_SITE_ORIGIN });
  }
  startApiServer({ accountReader, platform, identity, desktopAuth });
}
