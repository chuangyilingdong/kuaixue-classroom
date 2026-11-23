import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const imageFields = { gallery: "galleryImages", intro: "introImages" };

function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return "png";
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "jpg";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  throw new Error("请选择 PNG、JPEG 或 WebP 图片。");
}

export async function importImages(courseId, target, files, root = project) {
  if (!files.length || !["cover", "gallery", "intro", "banner", "work", "focus"].includes(target))
    throw new Error("请选择图片和用途。");
  if (["cover", "banner", "work"].includes(target) && files.length !== 1)
    throw new Error("此用途每次选择一张图片。");
  const seed = path.join(root, "data", "course-catalog.demo.json");
  const lockPath = `${seed}.images.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error("课程配图正在写入，请稍后重试。");
    throw error;
  }
  try {
    const catalog = JSON.parse(await readFile(seed, "utf8"));
    const course = catalog.find((item) => item.id === courseId);
    if (!course) throw new Error("课程不存在。");
    if (target === "focus") {
      if (files.length !== 2 || !files.every(value => /^\d{1,3}$/.test(value) && Number(value) <= 100))
        throw new Error("横向和纵向焦点均需填写 0 到 100 的整数。");
      course.coverFocus = { x: Number(files[0]), y: Number(files[1]) };
    } else {
      await updateImages(course, target, files, root);
    }
    const temporary = `${seed}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(catalog, null, 2) + "\n");
    await rename(temporary, seed);
    return course.title;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

async function updateImages(course, target, files, root) {
    const images = [];
    for (const file of files) {
      const info = await stat(file);
      if (!info.isFile() || info.size > 16 * 1024 * 1024)
        throw new Error("每张图片上限为 16 MB。");
      const bytes = await readFile(file);
      const name = `${createHash("sha256").update(bytes).digest("hex")}.${imageType(bytes)}`;
      images.push({ name, bytes, url: `./course-media/imported/${name}` });
    }
    const directory = path.join(root, "public", "course-media", "imported");
    await mkdir(directory, { recursive: true });
    for (const image of images)
      await writeFile(path.join(directory, image.name), image.bytes);
    if (target === "cover") course.thumbnailUrl = images[0].url;
    else if (target === "banner") course.bannerUrl = images[0].url;
    else if (target === "work") {
      const url = images[0].url;
      course.galleryImages = [{ url, alt: `${course.title} · 作品示例` }, ...(course.galleryImages ?? []).filter(entry => entry.url !== url)];
    } else {
      const field = imageFields[target];
      const collection = course[field] ?? [];
      for (const image of images) {
        if (!collection.some((entry) => entry.url === image.url))
          collection.push({
            url: image.url,
            alt: `${course.title} · ${target === "intro" ? "课程介绍" : "课程预览"} ${collection.length + 1}`,
          });
      }
      course[field] = collection;
    }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [id, target, ...files] = process.argv.slice(2);
  try {
    console.log(`课程配图已保存：${await importImages(id, target, files)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
