import {handleCourseAction,sessionPrincipal,readBody} from './course-actions.mjs';
import {openCoursePlatform,CourseProblem} from './course-platform.mjs';
import { createAccountReader, WalletUnavailable } from "./account.mjs";
import {mainSiteRuntimeFromEnv} from './main-site-runtime.mjs';
import {canvasGenerationFromEnv} from './canvas-generation.mjs';
import {snapshotLimits} from '../../shared/local-snapshot.mjs';
import {verifyCourseAssetAccess} from '../../shared/course-asset-url.mjs';
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
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

async function readAssetBody(req, limit = 50 * 1024 * 1024,oversizeMessage='素材超出大小限制') {
  const declared = Number(req.headers['content-length'] || 0);
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > limit) throw new CourseProblem(413,oversizeMessage);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new CourseProblem(413,oversizeMessage);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,size);
}

function parseByteRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (!match[1] && !match[2])) return false;
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start === null) {
    const suffix = end;
    if (!suffix || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    end = end === null ? size - 1 : Math.min(end, size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return false;
  return { start, end };
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
    classroomConfig, vibeModelIds, vibeModelLabels,
  } = course;
  return {
    id, versionId, title, subtitle, type, category, level, durationMinutes,
    unlockPricePoints, modelLabels, previewSteps, thumbnailUrl, bannerUrl, coverFocus, purchaseCount, visualTone, icon,
    learningObjectives, steps, assets, permittedDeliveryModes, galleryImages, introImages, mediaCredit,
    classroomConfig, vibeModelIds, vibeModelLabels,
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

export function createApiServer({ catalog = DEFAULT_CATALOG, accountReader, platform, identity, desktopAuth,
  assetSigningSecret='', allowedOrigins = ["http://127.0.0.1:5173", "http://localhost:5173"] } = {}) {
  const allowed = new Set(allowedOrigins.filter(origin => origin !== "null" && origin !== "*"));
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Expose-Headers", "ETag, X-Kuaixue-Revision, X-Kuaixue-Snapshot-SHA256, X-Kuaixue-Captured-At");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Accept, Content-Type, If-None-Match, X-Kuaixue-Run-Id, X-Kuaixue-File-Name, X-Kuaixue-Asset-Kind, X-Kuaixue-Base-Revision, X-Kuaixue-Snapshot-SHA256",
        "Access-Control-Expose-Headers": "ETag, X-Kuaixue-Revision, X-Kuaixue-Snapshot-SHA256, X-Kuaixue-Captured-At",
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
        res.setHeader('Set-Cookie',`kuaixue_session=${session}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=None`);
        return json(res,200,{data:{authenticated:true}});
      } catch { return json(res,401,{error:{code:'LOGIN_FAILED'}}); }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/course-assets') {
      try {
        if (origin && !allowed.has(origin)) return json(res,403,{error:{code:'ORIGIN_DENIED'}});
        if (!platform?.uploadAsset) return json(res,503,{error:{code:'ASSET_SERVICE_UNAVAILABLE'}});
        const principal = await sessionPrincipal(req,identity);
        if (!principal?.userId) return json(res,401,{error:{code:'SESSION_REQUIRED'}});
        const runId = String(req.headers['x-kuaixue-run-id'] || '');
        const kind = String(req.headers['x-kuaixue-asset-kind'] || '');
        const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        let fileName;
        try {fileName = decodeURIComponent(String(req.headers['x-kuaixue-file-name'] || ''));} catch {fileName = '';}
        if (!/^[a-zA-Z0-9-]{8,80}$/.test(runId) || !['image','video','audio'].includes(kind) || !fileName) {
          return json(res,400,{error:{code:'INVALID_ASSET',message:'素材参数无效'}});
        }
        const bytes = await readAssetBody(req);
        const asset = await platform.uploadAsset(principal.userId,{runId,fileName,mime,kind,bytes});
        return json(res,201,{data:asset});
      } catch (error) {
        const known = error instanceof CourseProblem;
        if (!known) console.error('课程素材上传失败',error);
        return json(res,known?error.status:503,{error:{code:'ASSET_UPLOAD_FAILED',message:known?error.message:'素材服务暂不可用'}});
      }
    }
    const assetMatch = url.pathname.match(/^\/api\/v1\/course-assets\/([a-zA-Z0-9-]{8,80})$/);
    if (['GET','HEAD'].includes(req.method) && assetMatch) {
      try {
        if (!platform?.asset) return json(res,503,{error:{code:'ASSET_SERVICE_UNAVAILABLE'}});
        const expires=Number(url.searchParams.get('expires'));
        const signature=url.searchParams.get('signature');
        const signed=url.searchParams.has('expires')||url.searchParams.has('signature');
        let asset;
        if(signed){
          if(!verifyCourseAssetAccess({assetId:assetMatch[1],expires,signature,secret:assetSigningSecret})){
            return json(res,403,{error:{code:'ASSET_ACCESS_DENIED',message:'素材访问授权无效'}});
          }
          if(!platform.assetById)return json(res,503,{error:{code:'ASSET_SERVICE_UNAVAILABLE'}});
          asset=platform.assetById(assetMatch[1]);
        }else{
          const principal = await sessionPrincipal(req,identity);
          if (!principal?.userId) return json(res,401,{error:{code:'SESSION_REQUIRED'}});
          asset = platform.asset(principal.userId,assetMatch[1]);
        }
        const bytes = await readFile(asset.path);
        const range = parseByteRange(req.headers.range,bytes.length);
        if (range === false) {
          res.writeHead(416,{'Content-Range':`bytes */${bytes.length}`,'Accept-Ranges':'bytes'});
          return res.end();
        }
        const body = range ? bytes.subarray(range.start,range.end+1) : bytes;
        res.writeHead(range ? 206 : 200,{
          'Content-Type':asset.mime,
          'Content-Length':String(body.length),
          'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
          'Cache-Control':'private, max-age=31536000, immutable',
          'Accept-Ranges':'bytes',
          ...(range ? {'Content-Range':`bytes ${range.start}-${range.end}/${bytes.length}`} : {}),
          'X-Content-Type-Options':'nosniff',
        });
        return req.method === 'HEAD' ? res.end() : res.end(body);
      } catch (error) {
        const known = error instanceof CourseProblem;
        return json(res,known?error.status:404,{error:{code:'ASSET_NOT_FOUND',message:known?error.message:'素材不存在'}});
      }
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/course-runs/local-snapshot'){
      try{
        if(origin&&!allowed.has(origin))return json(res,403,{error:{code:'ORIGIN_DENIED'}});
        if(!platform?.uploadLocalSnapshot)return json(res,503,{error:{code:'SNAPSHOT_SERVICE_UNAVAILABLE',message:'云端工程快照存储待接入'}});
        const principal=await sessionPrincipal(req,identity);
        if(!principal?.userId)return json(res,401,{error:{code:'SESSION_REQUIRED'}});
        const mime=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
        if(mime!=='application/zip')return json(res,415,{error:{code:'INVALID_SNAPSHOT',message:'工程快照必须是 ZIP'}});
        const runId=String(req.headers['x-kuaixue-run-id']||'');
        const baseRevision=Number(req.headers['x-kuaixue-base-revision']);
        const sha256=String(req.headers['x-kuaixue-snapshot-sha256']||'').toLowerCase();
        if(!/^[a-zA-Z0-9-]{8,80}$/.test(runId)||!Number.isSafeInteger(baseRevision)||baseRevision<0||
            !/^[a-f0-9]{64}$/.test(sha256)) {
          return json(res,400,{error:{code:'INVALID_SNAPSHOT',message:'工程快照参数无效'}});
        }
        const bytes=await readAssetBody(req,snapshotLimits.archiveBytes,'工程快照压缩后超过 64 MiB');
        const digest=createHash('sha256').update(bytes).digest('hex');
        if(digest!==sha256)return json(res,400,{error:{code:'SNAPSHOT_HASH_MISMATCH',message:'工程快照摘要不一致'}});
        const data=await platform.uploadLocalSnapshot(principal.userId,{runId,baseRevision,sha256,bytes});
        res.setHeader('Cache-Control','no-store');
        return json(res,200,{data});
      }catch(error){
        if(!(error instanceof CourseProblem)&&!(Number.isInteger(error.status)&&error.status<500))console.error('工程快照上传失败',error);
        const upstream=error instanceof CourseProblem?error.status:
          [401,403].includes(error.status)?503:error.status;
        return json(res,Number.isInteger(upstream)&&upstream>=400?upstream:503,{
          error:{code:error.code||'SNAPSHOT_UPLOAD_FAILED',message:error.message||'工程快照上传失败'},
          ...(Number.isSafeInteger(error.currentRevision)?{currentRevision:error.currentRevision}:{}),
        });
      }
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/course-runs/local-snapshot'){
      try{
        if(origin&&!allowed.has(origin))return json(res,403,{error:{code:'ORIGIN_DENIED'}});
        if(!platform?.downloadLocalSnapshot)return json(res,503,{error:{code:'SNAPSHOT_SERVICE_UNAVAILABLE',message:'云端工程快照存储待接入'}});
        const principal=await sessionPrincipal(req,identity);
        if(!principal?.userId)return json(res,401,{error:{code:'SESSION_REQUIRED'}});
        const runId=String(url.searchParams.get('runId')||'');
        if(!/^[a-zA-Z0-9-]{8,80}$/.test(runId))return json(res,400,{error:{code:'INVALID_SNAPSHOT',message:'缺少运行编号'}});
        const data=await platform.downloadLocalSnapshot(principal.userId,{runId});
        const etag=`"${data.sha256}"`;
        const headers={
          ETag:etag,
          'X-Kuaixue-Revision':String(data.revision),
          'X-Kuaixue-Snapshot-SHA256':data.sha256,
          'X-Kuaixue-Captured-At':data.capturedAt,
          'Cache-Control':'no-store',
        };
        if(req.headers['if-none-match']===etag){
          res.writeHead(304,headers);
          return res.end();
        }
        res.writeHead(200,{
          ...headers,
          'Content-Type':'application/zip',
          'Content-Length':String(data.bytes.length),
          'Content-Disposition':`attachment; filename="kuaixue-${runId}.zip"`,
          'X-Content-Type-Options':'nosniff',
        });
        return res.end(data.bytes);
      }catch(error){
        if(!(error instanceof CourseProblem)&&!(Number.isInteger(error.status)&&error.status<500))console.error('工程快照下载失败',error);
        const upstream=error instanceof CourseProblem?error.status:
          [401,403].includes(error.status)?503:error.status;
        return json(res,Number.isInteger(upstream)&&upstream>=400?upstream:503,{
          error:{code:error.code||'SNAPSHOT_DOWNLOAD_FAILED',message:error.message||'工程快照下载失败'},
        });
      }
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

export function startApiServer({ port = Number(process.env.KUAIXUE_API_PORT || 4174), host = "127.0.0.1", accountReader, platform, identity, desktopAuth,
  assetSigningSecret=process.env.KUAIXUE_ASSET_SIGNING_SECRET||process.env.KUAIXUE_INTERNAL_SECRET||process.env.KUAIXUE_CANVAS_BILLING_SECRET||'' } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("KUAIXUE_API_PORT must be between 1 and 65535.");
  const server = createApiServer({
    accountReader, platform, identity, desktopAuth, assetSigningSecret,
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
    if (process.env.KUAIXUE_COURSE_DB) {
      const {openTicketedCoursePlatform} = await import('../../integrations/vibecoding/main-site-tickets.mjs');
      const runtime=mainSiteRuntimeFromEnv();
      const canvas=canvasGenerationFromEnv();
      const runtimeProvider={
        ...provider,
        ...(provider.issueLocalModelGrant?{}:{issueLocalModelGrant:runtime?.issueLocalModelGrant}),
        ...(provider.uploadLocalSnapshot?{}:{uploadLocalSnapshot:runtime?.uploadLocalSnapshot}),
        ...(provider.downloadLocalSnapshot?{}:{downloadLocalSnapshot:runtime?.downloadLocalSnapshot}),
        ...(provider.quoteGeneration?{}:{quoteGeneration:canvas?.quoteGeneration}),
        ...(provider.generateOrLookup?{}:{generateOrLookup:canvas?.generateOrLookup}),
      };
      platform = openTicketedCoursePlatform(openCoursePlatform, process.env.KUAIXUE_COURSE_DB, {
        ...runtimeProvider,
        assetRoot: process.env.KUAIXUE_ASSET_ROOT,
      }, process.env.KUAIXUE_RUNTIME_TICKET_DB);
    }
    accountReader = createAccountReader({
      identity,
      listGrants: platform?.listGrants || provider.listGrants,
      mainSite: process.env.KUAIXUE_INTERNAL_ORIGIN || process.env.KUAIXUE_MAIN_SITE_ORIGIN,
    });
  }
  startApiServer({ accountReader, platform, identity, desktopAuth });
}
