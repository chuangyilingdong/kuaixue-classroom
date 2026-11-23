import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../apps/api/server.mjs";
import { loadCourseCatalog } from "../src/services/courseCatalog.js";

let server;
let baseUrl;

before(async () => {
  server = createApiServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("serves a health check", async () => {
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("connects the desktop catalog adapter to the local API response", async () => {
  const catalog = await loadCourseCatalog({ baseUrl });
  assert.equal(catalog.source, "service");
  assert.equal(catalog.courses.length, 7);
  assert.equal(catalog.courses.find((course) => course.type === "vibe").versionId, "demo-code-v1");
});

test("serves an immutable course version with objectives and structured steps", async () => {
  const response = await fetch(`${baseUrl}/api/v1/catalog/courses/creative-coding-studio`);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.course.id, "creative-coding-studio");
  assert.equal(data.course.versionId, "demo-code-v1");
  assert.ok(data.course.learningObjectives.length > 0);
  assert.equal(data.course.steps.length, 4);
  assert.ok(data.course.steps.every((step) => step.id && step.title && step.description && step.deliverable));
  assert.deepEqual(data.course.permittedDeliveryModes, ["VIBECODING"]);
});

test("returns a stable not-found response for an unknown course", async () => {
  const response = await fetch(`${baseUrl}/api/v1/catalog/courses/not-a-course`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: "COURSE_NOT_FOUND", message: "Course not found." },
  });
});

test("filters and sorts published demo courses, then pages with a cursor", async () => {
  const firstResponse = await fetch(`${baseUrl}/api/v1/catalog/courses?type=CANVAS&sort=price_asc&limit=2`);
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.data.items.length, 2);
  assert.equal(first.data.page.total, 5);
  assert.equal(first.data.items[0].unlockPricePoints, 40);
  assert.ok(first.data.page.nextCursor);

  const secondResponse = await fetch(`${baseUrl}/api/v1/catalog/courses?type=CANVAS&sort=price_asc&limit=2&cursor=${encodeURIComponent(first.data.page.nextCursor)}`);
  const second = await secondResponse.json();
  assert.equal(second.data.items.length, 2);
  assert.ok(second.data.page.nextCursor);
  const last = await (await fetch(`${baseUrl}/api/v1/catalog/courses?type=CANVAS&sort=price_asc&limit=2&cursor=${second.data.page.nextCursor}`)).json();
  assert.equal(last.data.items.length, 1);
  assert.equal(last.data.page.nextCursor, null);
  assert.ok(second.data.items.every((item) => item.type === "CANVAS"));
});

test("searches title, subtitle, and category case-insensitively", async () => {
  const response = await fetch(`${baseUrl}/api/v1/catalog/courses?q=%E8%A7%86%E8%A7%89%E7%AC%94%E8%AE%B0`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.items.length, 1);
  assert.equal(payload.data.items[0].id, "visual-notes");
});

test("rejects unsupported filters and malformed cursors", async () => {
  const invalidType = await fetch(`${baseUrl}/api/v1/catalog/courses?type=CLASSROOM`);
  assert.equal(invalidType.status, 400);

  const invalidCursor = await fetch(`${baseUrl}/api/v1/catalog/courses?cursor=not-a-cursor`);
  assert.equal(invalidCursor.status, 400);
});

test("applies CORS only to the configured local development origins", async () => {
  const allowed = await fetch(`${baseUrl}/api/v1/catalog/courses`, { headers: { Origin: "http://127.0.0.1:5173" } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");

  const rejected = await fetch(`${baseUrl}/api/v1/catalog/courses`, { headers: { Origin: "https://unexpected.example" } });
  assert.equal(rejected.headers.get("access-control-allow-origin"), null);
});
