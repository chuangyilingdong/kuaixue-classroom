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
  const requestUrls = [];
  const result = await loadCourseCatalog({
    baseUrl: "https://kuaixue.test/",
    fetchImpl: async (url, options) => {
      requestUrls.push(url);
      assert.equal(options.headers.Accept, "application/json");
      if (new URL(url).pathname.endsWith("/categories")) {
        return {
          ok: true,
          json: async () => ({ data: { entries: [
            { id: "visual", label: "视觉创作", filterType: "category", filterValue: "Design", enabled: true },
            { id: "vibe", label: "VibeCoding", filterType: "mode", filterValue: "VIBECODING", enabled: true },
          ] } }),
        };
      }
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

  assert.deepEqual(requestUrls, [
    "https://kuaixue.test/api/v1/catalog/courses",
    "https://kuaixue.test/api/v1/catalog/categories",
  ]);
  assert.deepEqual(result.categories, [
    { id: "visual", label: "视觉创作", category: "Design" },
    { id: "vibe", label: "VibeCoding", mode: "VIBECODING" },
  ]);
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
      introHtml:"<h2>课程介绍</h2><video src=\"https://cdn.example/intro.mp4\"></video>",
      galleryImages:[
        {url:"https://cdn.example/cover.png",alt:"主封面"},
        {url:"https://cdn.example/cover-2.png",alt:"第二张"},
      ],
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
  assert.match(detail.introHtml,/<video\b/);
  assert.equal(detail.galleryImages.length,2);
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
    if (new URL(url).pathname.endsWith("/categories")) {
      return { ok: true, json: async () => ({ data: { entries: [
        { id: "first-entry", label: "第一类", filterType: "mode", filterValue: "CANVAS", enabled: true },
      ] } }) };
    }
    const cursor = new URL(url).searchParams.get("cursor");
    pages.push(cursor);
    return { ok: true, json: async () => ({ data: { items: [{id: cursor ? "second" : "first", title:"Course", type:"CANVAS", unlockPricePoints:8}], page: {nextCursor: cursor ? null : "+2="} } }) };
  } });
  assert.deepEqual(pages, [null,"+2="]);
  assert.deepEqual(result.courses.map(c => c.id), ["first","second"]);
});

test("dedicated category entries override legacy fields and preserve backend order and hidden state", async () => {
  const entries = [
    {id:"visual_design",label:"视觉设计",filterType:"category",filterValue:"Design"},
    {id:"disabled",label:"隐藏",filterType:"mode",filterValue:"CANVAS",enabled:false},
    {id:"all",label:"代码课程",filterType:"mode",filterValue:"VIBECODING"},
  ];
  const result = await loadCourseCatalog({
    baseUrl:"https://kuaixue.test",
    fetchImpl:async url => Response.json({data:url.endsWith("/categories") ? {entries} : {
      items:[{id:"c",title:"Course",type:"CANVAS",unlockPricePoints:0}],
      categories:[{id:"legacy",label:"旧入口",mode:"CANVAS"}],
    }}),
  });
  assert.deepEqual(result.categories,[
    {id:"visual_design",label:"视觉设计",category:"Design"},
    {id:"all",label:"代码课程",mode:"VIBECODING"},
  ]);
});

test("an empty entry configuration keeps only the client all-courses entry", async () => {
  const result = await loadCourseCatalog({
    baseUrl:"https://kuaixue.test",
    fetchImpl:async url => Response.json({data:url.endsWith("/categories") ? {entries:[]} : {items:[]}}),
  });
  assert.deepEqual(result.categories,[]);
});

test("the client accepts the backend maximum of 30 entries", async () => {
  const entries = Array.from({length:30},(_,index)=>({
    id:`category_${index}`,label:`分类 ${index}`,filterType:"category",filterValue:`类别 ${index}`,
  }));
  const result = await loadCourseCatalog({
    baseUrl:"https://kuaixue.test",
    fetchImpl:async url => Response.json({data:url.endsWith("/categories") ? {entries} : {items:[]}}),
  });
  assert.equal(result.categories.length,30);
  assert.equal(result.categories.at(-1).category,"类别 29");
});

test("category refresh reports malformed or unavailable configuration and propagates cancellation", async () => {
  const fetchCategories = value => async url => url.endsWith("/categories") ? value() : Response.json({data:{items:[]}});
  for (const response of [
    Response.json({data:{entries:"invalid"}}),
    Response.json({data:{entries:[{id:"bad",label:"错误",filterType:"mode",filterValue:"OTHER"}]}}),
    Response.json({}, {status:503}),
  ]) {
    await assert.rejects(loadCourseCatalog({baseUrl:"https://kuaixue.test",fetchImpl:fetchCategories(()=>response)}),CourseCatalogError);
  }
  const aborted = Object.assign(new Error("cancelled"),{name:"AbortError"});
  await assert.rejects(loadCourseCatalog({baseUrl:"https://kuaixue.test",fetchImpl:fetchCategories(()=>{throw aborted;})}),error=>error===aborted);
});

test("older course services retain their embedded categories when the new endpoint is absent", async () => {
  const categories = [{id:"legacy",label:"旧入口",mode:"CANVAS"}];
  const result = await loadCourseCatalog({
    baseUrl:"https://kuaixue.test",
    fetchImpl:async url => url.endsWith("/categories") ? Response.json({}, {status:404})
      : Response.json({data:{items:[],categories}}),
  });
  assert.deepEqual(result.categories,categories);
});

test("desktop category reads preserve a legacy 404 without relying on its CORS headers", async () => {
  const requested = [];
  const catalog = await loadCourseCatalog({
    baseUrl:"https://kuaixue.test",
    fetchImpl:async url => {
      requested.push(url);
      assert.ok(url.endsWith("/courses"));
      return Response.json({data:{items:[{id:"live",title:"Live course",type:"CANVAS",unlockPricePoints:1}]}});
    },
    readCategories:async () => ({status:404,body:{error:"接口不存在"}}),
  });
  assert.equal(requested.length,1);
  assert.equal(catalog.courses[0].id,"live");
  assert.deepEqual(catalog.categories.map(item => item.id),["canvas","vibecoding"]);
});

test("desktop category reads keep configured order and report service errors and cancellation", async () => {
  const options = {baseUrl:"https://kuaixue.test",fetchImpl:async () => Response.json({data:{items:[]}})};
  const catalog = await loadCourseCatalog({
    ...options,
    readCategories:async () => ({status:200,body:{data:{entries:[
      {id:"code",label:"代码",filterType:"mode",filterValue:"VIBECODING"},
      {id:"canvas",label:"画布",filterType:"mode",filterValue:"CANVAS"},
    ]}}}),
  });
  assert.deepEqual(catalog.categories.map(item => item.id),["code","canvas"]);
  await assert.rejects(loadCourseCatalog({...options,readCategories:async () => ({status:503})}),
    error => error instanceof CourseCatalogError && error.status === 503);
  const controller = new AbortController();
  await assert.rejects(loadCourseCatalog({...options,signal:controller.signal,readCategories:async () => {
    controller.abort();
    return {status:404};
  }}), error => error.name === "AbortError");
});
