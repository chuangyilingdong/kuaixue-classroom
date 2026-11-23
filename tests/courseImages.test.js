import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importImages } from "../scripts/import-course-images.mjs";
import { normalizeCourseDetail } from "../src/data/courses.js";

test("platform image import appends in order and is safe to repeat", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kuaixue-media-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"));
  const seed = path.join(root, "data/course-catalog.demo.json");
  const catalog = JSON.parse(
    await readFile(
      new URL("../data/course-catalog.demo.json", import.meta.url),
      "utf8",
    ),
  );
  await writeFile(seed, JSON.stringify(catalog));
  const course = catalog[1];
  const images = ["brand", "notes"].map(
    (name) => new URL(`../public/course-media/${name}.webp`, import.meta.url),
  );
  for (const target of ["intro", "gallery", "intro"])
    await importImages(course.id, target, images, root);
  const detail = normalizeCourseDetail(
    JSON.parse(await readFile(seed, "utf8"))[1],
  );
  assert.equal(detail.introImages.length, 2);
  assert.deepEqual(
    detail.introImages.map((image) => image.url),
    detail.galleryImages.slice(course.galleryImages.length).map((image) => image.url),
  );
  for (const [index, image] of detail.introImages.entries()) {
    assert.deepEqual(
      await readFile(path.join(root, "public", image.url)),
      await readFile(images[index]),
    );
  }
  await assert.rejects(importImages(course.id, "cover", images, root));
  await importImages(course.id, "banner", [images[0]], root);
  await importImages(course.id, "focus", ["65", "40"], root);
  for (let i = 0; i < 2; i++) await importImages(course.id, "work", [images[1]], root);
  const updated = normalizeCourseDetail(JSON.parse(await readFile(seed, "utf8"))[1]);
  assert.equal(updated.thumbnailUrl, detail.thumbnailUrl);
  assert.equal(updated.bannerUrl, detail.introImages[0].url);
  assert.equal(updated.coverPosition, "65% 40%");
  assert.equal(updated.galleryImages[0].url, detail.introImages[1].url);
  assert.equal(updated.galleryImages.length, detail.galleryImages.length);
  await assert.rejects(importImages(course.id, "focus", ["101", "-5"], root));
  const saved = await readFile(seed, "utf8");
  await assert.rejects(
    importImages(course.id, "intro", [images[0], seed], root),
  );
  assert.equal(await readFile(seed, "utf8"), saved);
});
