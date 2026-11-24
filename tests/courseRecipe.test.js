import test from 'node:test';
import assert from 'node:assert/strict';
import { openCoursePlatform } from '../apps/api/course-platform.mjs';
import { modelDirectory, prepareBindings } from '../integrations/main-site-admin/modelDirectory.mjs';
import versioning from '../electron/course-version.cjs';

const options = { aspectRatios: ['16:9', '1:1'], resolutions: ['2K', '1K'] };
const directory = ['ink', 'oil'].map((id) => ({
  id,
  label: `插画 ${id}`,
  modality: 'IMAGE',
  options,
  privateConfig: 'server only',
}));
const material = (id, model, params = {}) => ({
  id,
  title: id,
  materialType: 'GENERATION_BOX',
  snapshot: { box: { modality: 'IMAGE', modelBinding: 'BOX', model, ...params } },
});
const draft = (materials) => ({
  title: '画面练习',
  subtitle: '两种画风',
  price: 0,
  permittedDeliveryModes: ['CANVAS'],
  materialGroups: [{ id: 'g', title: '镜头', materials }],
});

test('each purchased box uses its own published model and its fixed or selectable parameters', async (t) => {
  const jobs = [];
  const platform = openCoursePlatform(':memory:', {
    quoteGeneration: async (job) => {
      jobs.push(job);
      return { quoteId: job.jobId, points: 0, expiresAt: Date.now() + 10000 };
    },
    generateOrLookup: async () => assert.fail('quote must not invoke a model'),
  });
  t.after(() => platform.close());
  const value = draft([
    material('a', 'ink', { aspectRatio: '16:9' }),
    material('b', 'oil', { resolution: '2K' }),
    material('off', ''),
  ]);
  await prepareBindings(value, null, () => directory);
  const course = platform.publish('editor', value);
  const target = { courseId: course.id, versionId: course.versionId };
  await platform.purchase('student', target);
  const run = await platform.start('student', { ...target, mode: 'CANVAS' });
  assert.deepEqual(run.generationModes, ['IMAGE']);
  const input = {
    prompt: '第一幕',
    modelId: 'client-choice',
    params: { aspectRatio: '1:1', resolution: '1K', unknown: true },
  };
  const quote = (nodeId, modality = 'IMAGE') =>
    platform.quote('student', { id: run.id, nodeId, modality, input });
  await quote('box-a');
  await quote('box-b');
  assert.deepEqual(
    jobs.map((job) => [job.modelId, job.input.params]),
    [
      ['ink', { aspectRatio: '16:9', resolution: '1K' }],
      ['oil', { aspectRatio: '1:1', resolution: '2K' }],
    ],
  );
  assert.equal(jobs[0].input.modelId, undefined);
  for (const [nodeId, modality] of [
    ['box-off', 'IMAGE'],
    ['other', 'IMAGE'],
    ['box-a', 'VIDEO'],
  ]) {
    await assert.rejects(quote(nodeId, modality), { status: 403 });
  }
});

test('publish uses the channel directory, preserves historical configuration when unavailable, and allows disabled boxes', async () => {
  const value = draft([material('a', 'ink')]);
  assert.equal(Object.hasOwn(modelDirectory(directory)[0], 'privateConfig'), false);
  await assert.rejects(
    prepareBindings(value, null, () => []),
    { status: 400 },
  );
  await prepareBindings(value, null, () => directory);
  const original = structuredClone(value);
  await prepareBindings(value, original, () => assert.fail('unchanged model needs no directory lookup'));
  const box = value.materialGroups[0].materials[0].snapshot.box;
  box.resolution = 'not supported';
  await assert.rejects(
    prepareBindings(value, original, () => directory),
    { status: 400 },
  );
  await prepareBindings(draft([material('a', '')]), null, () => []);
});

test('published version stores model-family display labels without exposing full channel IDs',()=>{
  const ids=[
    'aicyld-runninghub-llm-cn::openai/gpt-6.2-sol-saver',
    'aicyld-runninghub-llm-cn::anthropic/claude-fable-5.2',
  ];
  const course=versioning.buildCourseVersion({
    title:'映射课程',subtitle:'显示名称',price:1,permittedDeliveryModes:['VIBECODING'],
    steps:[{id:'one',title:'创作',description:'执行',deliverable:'作品'}],
    vibeModelIds:ids,
    vibeModelLabels:{[ids[0]]:'GPT-6.2sol',[ids[1]]:'fable5.2'},
    classroomConfig:{vibeCoding:{presetPrompts:[]}},
  });
  assert.deepEqual(course.modelLabels,['GPT-6.2sol','fable5.2']);
  assert.deepEqual(course.vibeModelLabels,{[ids[0]]:'GPT-6.2sol',[ids[1]]:'fable5.2'});
  assert.ok(!course.modelLabels.some(label=>label.includes('::')));
});

test('published version stores up to five covers, selected category and safe rich introduction',()=>{
  const galleryImages=Array.from({length:5},(_,index)=>({
    url:`https://cdn.example/cover-${index+1}.png`,
    alt:`封面 ${index+1}`,
  }));
  const course=versioning.buildCourseVersion({
    title:'富文本课程',subtitle:'课程摘要',introHtml:'<h2>课程介绍</h2><p>正文</p><img src="https://cdn.example/intro.png" onerror="alert(1)"><script>alert(1)</script><video src="https://cdn.example/intro.mp4"></video>',
    price:1,category:'视觉设计',level:'进阶',durationMinutes:35,
    permittedDeliveryModes:['CANVAS'],materialGroups:[],steps:[],
    galleryImages,
  });
  assert.equal(course.category,'视觉设计');
  assert.equal(course.level,'进阶');
  assert.equal(course.durationMinutes,35);
  assert.deepEqual(course.galleryImages,galleryImages);
  assert.equal(course.thumbnailUrl,galleryImages[0].url);
  assert.match(course.introHtml,/<video\b/);
  assert.doesNotMatch(course.introHtml,/script|onerror/i);
  assert.throws(()=>versioning.buildCourseVersion({
    title:'超出封面',subtitle:'课程摘要',price:0,permittedDeliveryModes:['CANVAS'],steps:[],materialGroups:[],
    galleryImages:[...galleryImages,{url:'https://cdn.example/cover-6.png'}],
  }),/最多上传 5 张/);
});

test('an edited legacy version retains per-type defaults and can explicitly disable a single box', async (t) => {
  const platform = openCoursePlatform(':memory:', {
    quoteGeneration: async () => ({ quoteId: 'q', points: 0, expiresAt: Date.now() + 10000 }),
    generateOrLookup: async () => {},
  });
  t.after(() => platform.close());
  const legacy = material('legacy', 'previous-display-id');
  delete legacy.snapshot.box.modelBinding;
  const original = platform.publish('editor', {
    ...draft([legacy]),
    modelPolicy: [{ modality: 'IMAGE', modelId: 'old-policy' }],
  });
  const updated = platform.publish('editor', {
    ...draft([legacy, material('off', '')]),
    id: original.id,
    baseVersion: original.versionId,
  });
  const target = { courseId: updated.id, versionId: updated.versionId };
  await platform.purchase('s', target);
  const { id } = await platform.start('s', { ...target, mode: 'CANVAS' });
  assert.equal(
    (await platform.quote('s', { id, nodeId: 'box-legacy', modality: 'IMAGE', input: {} })).modelId,
    'old-policy',
  );
  await assert.rejects(platform.quote('s', { id, nodeId: 'box-off', modality: 'IMAGE', input: {} }), {
    status: 403,
  });
});
