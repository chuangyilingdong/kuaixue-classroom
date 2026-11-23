import test from "node:test";
import assert from "node:assert/strict";
import { loadCourseCatalog, loadCourseDetail, CourseCatalogError } from "../src/services/courseCatalog.js";
import { displayModelLabel, normalizeCourseDetail, normalizeMediaUrl } from "../src/data/courses.js";
import { displayCanvasModelLabel } from "../vendor/academy-canvas/canvasBoxNode.js";

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

test("version detail preserves VibeCoding model snapshot and learning metadata", async () => {
  const vibeModelIds=Array.from({length:13},(_,index)=>`runninghub-model-${index+1}`);
  const detail=await loadCourseDetail("course-1",{baseUrl:"https://kuaixue.test",fetchImpl:async()=>({
    ok:true,json:async()=>({data:{course:{
      id:"course-1",versionId:"464e75e8-784f-4c50-8edb-456cd90d54c4",title:"测试一下",type:"VIBECODING",
      unlockPricePoints:1,durationMinutes:48,thumbnailUrl:"https://cdn.example/cover.png",bannerUrl:"/api/media/banner.png",
      coverFocus:{x:40,y:60},vibeModelIds,permittedDeliveryModes:["CANVAS","VIBECODING"],
      classroomConfig:{vibeCoding:{presetPrompts:[{title:"预设",text:"按版本执行"}]}},
      learningObjectives:["目标一"],assets:[{url:"https://cdn.example/video.mp4"}],
      steps:[{id:"one",title:"创作",description:"执行",deliverable:"作品"}],
    }}}),
  })});
  assert.deepEqual(detail.vibeModelIds,vibeModelIds);
  assert.equal(detail.classroomConfig.vibeCoding.presetPrompts[0].text,"按版本执行");
  assert.deepEqual(detail.permittedDeliveryModes,["CANVAS","VIBECODING"]);
  assert.equal(detail.durationMinutes,48);
  assert.deepEqual(detail.learningObjectives,["目标一"]);
  assert.equal(detail.thumbnailUrl,"https://cdn.example/cover.png");
  assert.equal(detail.bannerUrl,"/api/media/banner.png");
  assert.equal(detail.coverPosition,"40% 60%");
});

test("course display uses backend model-family labels instead of full channel IDs",()=>{
  const ids=[
    "aicyld-runninghub-llm-cn::openai/gpt-6.2-sol-saver",
    "aicyld-runninghub-llm-cn::anthropic/claude-fable-5.2",
  ];
  const detail=normalizeCourseDetail({
    id:"course-1",versionId:"v1",title:"映射课程",type:"VIBECODING",unlockPricePoints:1,
    learningObjectives:["目标"],previewSteps:["步骤"],permittedDeliveryModes:["VIBECODING"],
    steps:[{id:"one",title:"创作",description:"执行",deliverable:"作品"}],assets:[],
    modelLabels:ids,vibeModelIds:ids,
    vibeModelLabels:{
      [ids[0]]:"GPT-6.2sol",
      [ids[1]]:"fable5.2",
    },
  });
  assert.deepEqual(detail.models,["GPT-6.2sol","fable5.2"]);
  assert.deepEqual(detail.vibeModelLabels,{[ids[0]]:"GPT-6.2sol",[ids[1]]:"fable5.2"});
});

test("generation model labels use the model family instead of the text-to-image operation",()=>{
  const detail=normalizeCourseDetail({
    id:"course-1",versionId:"v1",title:"映射课程",type:"CANVAS",unlockPricePoints:1,
    learningObjectives:["目标"],previewSteps:["步骤"],permittedDeliveryModes:["CANVAS"],
    steps:[{id:"one",title:"创作",description:"执行",deliverable:"作品"}],assets:[],
    modelLabels:[
      "aicyld-runninghub-llm-cn::deepseek/deepseek-v4.1-flash",
      "gpt-image-2.5/flare/text-to-image/stable-token",
    ],
  });
  assert.deepEqual(detail.models,["deepseek-v4.1-flash","gpt-image-2.5"]);
  assert.equal(displayModelLabel("rh-gpt-image-2.5-flare-t2i"),"gpt-image-2.5");
  assert.equal(displayModelLabel("rhart-image-g-2.5-official-token/flare/text-to-image"),"gpt-image-2.5");
  assert.equal(displayCanvasModelLabel("rh-gpt-image-2.5-flare-t2i"),"gpt-image-2.5");
});

test("legacy course detail derives VibeCoding runtime IDs from published LLM labels",()=>{
  const id="aicyld-runninghub-llm-cn::deepseek/deepseek-v4.1-flash";
  const detail=normalizeCourseDetail({
    id:"course-1",versionId:"v1",title:"旧课程",type:"VIBECODING",unlockPricePoints:1,
    learningObjectives:["目标"],previewSteps:["步骤"],permittedDeliveryModes:["VIBECODING"],
    steps:[{id:"one",title:"创作",description:"执行",deliverable:"作品"}],assets:[],
    modelLabels:[id,"gpt-image-2.5/flare/text-to-image/stable-token"],
  });
  assert.deepEqual(detail.vibeModelIds,[id]);
  assert.deepEqual(detail.vibeModelLabels,{[id]:"deepseek-v4.1-flash"});
});

test("canvas generation boxes display mapped model names instead of channel strings",()=>{
  const detail=normalizeCourseDetail({
    id:"course-1",versionId:"v1",title:"画布课程",type:"CANVAS",unlockPricePoints:1,
    learningObjectives:["目标"],previewSteps:["步骤"],permittedDeliveryModes:["CANVAS"],
    steps:[{id:"one",title:"创作",description:"执行",deliverable:"图片"}],assets:[],
    modelLabels:["gpt-image-2.5/flare/text-to-image/stable-token"],
    materialGroups:[{id:"group",title:"素材",materials:[{id:"box",title:"画面",materialType:"GENERATION_BOX",
      snapshot:{box:{id:"box",title:"画面",modality:"IMAGE",modelBinding:"BOX",
        model:"gpt-image-2.5/flare/text-to-image/stable-token"}}}]}],
  });
  assert.equal(detail.materialGroups[0].materials[0].snapshot.box.modelLabel,"gpt-image-2.5");
});

test("raw server model labels are normalized without overwriting operator names",()=>{
  const detail=normalizeCourseDetail({
    id:"course-1",versionId:"v1",title:"映射课程",type:"CANVAS",unlockPricePoints:1,
    learningObjectives:["目标"],previewSteps:["步骤"],permittedDeliveryModes:["CANVAS"],
    steps:[{id:"one",title:"创作",description:"执行",deliverable:"图片"}],assets:[],
    materialGroups:[{id:"group",title:"素材",materials:[
      {id:"raw",title:"原始",materialType:"GENERATION_BOX",snapshot:{box:{id:"raw",title:"原始",modality:"IMAGE",
        modelBinding:"BOX",model:"rh-gpt-image-2.5-flare-t2i",modelLabel:"rh-gpt-image-2.5-flare-t2i"}}},
      {id:"custom",title:"自定义",materialType:"GENERATION_BOX",snapshot:{box:{id:"custom",title:"自定义",modality:"IMAGE",
        modelBinding:"BOX",model:"rh-gpt-image-2.5-flare-t2i",modelLabel:"我的生图模型"}}},
    ]}],
  });
  assert.equal(detail.materialGroups[0].materials[0].snapshot.box.modelLabel,"gpt-image-2.5");
  assert.equal(detail.materialGroups[0].materials[1].snapshot.box.modelLabel,"我的生图模型");
});

test("media URLs allow HTTPS and approved relative paths but reject active or unsafe schemes",()=>{
  assert.equal(normalizeMediaUrl("https://cdn.example/a.png"),"https://cdn.example/a.png");
  assert.equal(normalizeMediaUrl("/api/media/a.mp4"),"/api/media/a.mp4");
  assert.equal(normalizeMediaUrl("./course-media/a.webp"),"./course-media/a.webp");
  assert.equal(normalizeMediaUrl(""),null);
  for(const value of ["javascript:alert(1)","http://cdn.example/a.png","data:text/html,test","blob:https://cdn.example/id","//evil.example/a.png","https://user:pass@cdn.example/a.png","/api\\media\\a.png"]){
    assert.throws(()=>normalizeMediaUrl(value),/URL is invalid/);
  }
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
