import test from "node:test";
import assert from "node:assert/strict";
import { loadCourseCatalog, loadCourseDetail, CourseCatalogError } from "../src/services/courseCatalog.js";

test("uses the labeled demo catalog when no service origin is configured", async () => {
  const result = await loadCourseCatalog({ baseUrl: "" });
  assert.equal(result.source, "demo");
  assert.ok(result.courses.length > 0);
});

test("loads and normalizes the proposed service catalog contract", async () => {
  let requestUrl;
  const result = await loadCourseCatalog({
    baseUrl: "https://kuaixue.test/",
    fetchImpl: async (url, options) => {
      requestUrl = url;
      assert.equal(options.headers.Accept, "application/json");
      return {
        ok: true,
        json: async () => ({ data: { items: [{
          id: "course-1",
          versionId: "v3",
          title: "Canvas Basics",
          subtitle: "A test course",
          type: "CANVAS",
          category: "Design",
          level: "Beginner",
          durationMinutes: 35,
          unlockPricePoints: 70,
          modelLabels: ["Image generation"],
          previewSteps: ["Plan", "Create"],
        }] } }),
      };
    },
  });

  assert.equal(requestUrl, "https://kuaixue.test/api/v1/catalog/courses");
  assert.equal(result.source, "service");
  assert.deepEqual(result.courses[0], {
    id: "course-1",
    versionId: "v3",
    title: "Canvas Basics",
    subtitle: "A test course",
    type: "canvas",
    permittedDeliveryModes: ["CANVAS"],
    category: "Design",
    level: "Beginner",
    duration: "约 35 分钟",
    durationMinutes: 35,
    price: 70,
    models: ["Image generation"],
    steps: ["Plan", "Create"],
    thumbnailUrl: null,
    bannerUrl: null,
    coverPosition: "50% 50%",
    purchaseCount: null,
    tone: "coral",
    icon: "film",
  });
});

test("loads a versioned course detail from the proposed endpoint", async () => {
  let requestUrl;
  const detail = await loadCourseDetail("creative-coding-studio", {
    baseUrl: "https://kuaixue.test/",
    fetchImpl: async (url) => {
      requestUrl = url;
      return {
        ok: true,
        json: async () => ({ data: { course: {
          id: "creative-coding-studio",
          versionId: "v3",
          title: "Creative Coding",
          type: "VIBECODING",
          unlockPricePoints: 80,
          learningObjectives: ["Build a page"],
          previewSteps: ["Plan"],
          steps: [{ id: "plan", title: "Plan", description: "Write the page goal.", deliverable: "Brief" }],
          assets: [],
          permittedDeliveryModes: ["VIBECODING"],
        } } }),
      };
    },
  });

  assert.equal(requestUrl, "https://kuaixue.test/api/v1/catalog/courses/creative-coding-studio");
  assert.equal(detail.versionId, "v3");
  assert.equal(detail.steps[0].deliverable, "Brief");
  assert.deepEqual(detail.permittedDeliveryModes, ["VIBECODING"]);
});

test("uses the labeled local demo course detail without a service origin", async () => {
  const detail = await loadCourseDetail("visual-notes", { baseUrl: "" });
  assert.equal(detail.versionId, "demo-notes-v1");
  assert.equal(detail.steps.length, 4);
  assert.ok(detail.learningObjectives.length > 0);
});

test("rejects mismatched or incomplete course detail responses", async () => {
  await assert.rejects(
    loadCourseDetail("course-1", {
      baseUrl: "https://kuaixue.test",
      fetchImpl: async () => ({ ok: true, json: async () => ({ data: { course: {
        id: "other-course", title: "Wrong", type: "CANVAS", unlockPricePoints: 1,
      } } }) }),
    }),
    (error) => error instanceof CourseCatalogError && /missing required version or learning fields/.test(error.message),
  );
});

test("does not fall back to demo data when the configured service fails", async () => {
  await assert.rejects(
    loadCourseCatalog({ baseUrl: "https://kuaixue.test", fetchImpl: async () => { throw new Error("offline"); } }),
    (error) => error instanceof CourseCatalogError && /Could not reach/.test(error.message),
  );
});

test("rejects a catalog response outside the proposed contract", async () => {
  await assert.rejects(
    loadCourseCatalog({ baseUrl: "https://kuaixue.test", fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }) }),
    (error) => error instanceof CourseCatalogError && /does not match/.test(error.message),
  );
});

test("rejects malformed course records instead of rendering incomplete purchase data", async () => {
  await assert.rejects(
    loadCourseCatalog({
      baseUrl: "https://kuaixue.test",
      fetchImpl: async () => ({ ok: true, json: async () => ({ data: { items: [{ id: "course-1", title: "Incomplete", type: "CANVAS" }] } }) }),
    }),
    (error) => error instanceof CourseCatalogError && /missing required fields/.test(error.message),
  );
});


test("keeps courses beyond the first service page available for library filters", async () => {
  const pages = [];
  const result = await loadCourseCatalog({ baseUrl: "https://kuaixue.test", fetchImpl: async url => {
    const cursor = new URL(url).searchParams.get("cursor");
    pages.push(cursor);
    return { ok: true, json: async () => ({ data: { items: [{id: cursor ? "second" : "first", title:"Course", type:"CANVAS", unlockPricePoints:8}], page: {nextCursor: cursor ? null : "+2="} } }) };
  } });
  assert.deepEqual(pages, [null,"+2="]);
  assert.deepEqual(result.courses.map(c => c.id), ["first","second"]);
});
