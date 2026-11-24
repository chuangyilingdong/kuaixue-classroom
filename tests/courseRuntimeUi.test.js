import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('VibeCoding 工作台不向学员暴露运行位置、切换或手动同步概念',()=>{
  const source=readFileSync(new URL('../src/ui/CourseRun.jsx',import.meta.url),'utf8');
  for(const forbidden of ['切到本机','切换云端','备份到云端','恢复本机工程','本机运行','云端运行']){
    assert.doesNotMatch(source,new RegExp(forbidden),`不应出现“${forbidden}”`);
  }
});

test('画布把预估价格放在生成按钮旁并点击后直接校验生成',()=>{
  const run=readFileSync(new URL('../src/ui/CourseRun.jsx',import.meta.url),'utf8');
  const canvas=readFileSync(new URL('../vendor/academy-canvas/index.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(run,/window\.confirm/);
  assert.match(run,/quoteGeneration/);
  assert.match(canvas,/function GenerationPrice/);
  assert.match(canvas,/预估/);
  assert.match(canvas,/!=='adaptive'/);
});

test('生成媒体提供本地下载入口',()=>{
  const canvas=readFileSync(new URL('../vendor/academy-canvas/index.jsx',import.meta.url),'utf8');
  const main=readFileSync(new URL('../electron/main.cjs',import.meta.url),'utf8');
  assert.match(canvas,/function MediaDownloadButton/);
  assert.match(canvas,/kind="image"/);
  assert.match(canvas,/kind="video"/);
  assert.match(main,/ipcMain\.handle\('media:download'/);
});

test('缺少云端快照时继续启动本机 Vibe 工作区',()=>{
  const run=readFileSync(new URL('../src/ui/CourseRun.jsx',import.meta.url),'utf8');
  assert.match(run,/error\.status!==404/);
  assert.match(run,/if\(snapshot\)await window\.kuaixueDesktop\.vibe\.restoreLocal/);
});

test('VibeCoding 支持原生目录、文件选择和新工作区',()=>{
  const entry=readFileSync(new URL('../integrations/vibecoding/course-entry.tsx',import.meta.url),'utf8');
  const run=readFileSync(new URL('../src/ui/CourseRun.jsx',import.meta.url),'utf8');
  const main=readFileSync(new URL('../electron/main.cjs',import.meta.url),'utf8');
  const preload=readFileSync(new URL('../electron/preload.cjs',import.meta.url),'utf8');
  const builder=readFileSync(new URL('../scripts/build-vibe-workbench.mjs',import.meta.url),'utf8');
  assert.match(entry,/allowOpenWorkspace(?:\s|\/|>)/);
  assert.doesNotMatch(entry,/allowOpenWorkspace=\{false\}/);
  assert.match(entry,/selectDirectory:\s*async/);
  assert.match(entry,/selectFiles:\s*\(\)\s*=>\s*chooseClassroomPaths/);
  // 焦点由 ZCode 自己的工作区/会话状态管理；课程壳层再用定时器抢焦点会造成
  // 弹层被关闭、输入框闪烁或窗口反复请求前台。
  assert.doesNotMatch(entry,/focusCourseComposer/);
  assert.match(builder,/dedupe:\['react','react-dom'/);
  assert.match(run,/kuaixue-classroom-paths-request/);
  assert.match(run,/function cleanCanvasWork/);
  assert.match(main,/ipcMain\.handle\('vibe:selectPaths'/);
  assert.match(preload,/'selectPaths'/);
});

test('Vibe 剩余次数放在输入框底栏，耗尽时禁用发送并实时刷新',()=>{
  const run=readFileSync(new URL('../src/ui/CourseRun.jsx',import.meta.url),'utf8');
  const entry=readFileSync(new URL('../integrations/vibecoding/course-entry.tsx',import.meta.url),'utf8');
  const local=readFileSync(new URL('../electron/course-local-vibe.cjs',import.meta.url),'utf8');
  const builder=readFileSync(new URL('../scripts/build-vibe-workbench.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(run,/course-vibe-usage-caption/);
  assert.match(run,/type:'kuaixue-vibe-usage'/);
  assert.match(run,/setInterval\(refreshUsage,1000\)/);
  assert.match(entry,/getSnapshot:async \(\) => courseUsage/);
  assert.match(entry,/event\.data\?\.type === 'kuaixue-vibe-usage'/);
  assert.match(builder,/classroomQuotaExhausted/);
  assert.match(builder,/Vibe 0 次可用/);
  assert.match(builder,/data-kuaixue-vibe-quota/);
  assert.match(builder,/!classroomQuotaExhausted/);
  assert.match(local,/usageLimit:String\(gateway\.usage\.limit\)/);
});

test('Vibe 工作区默认不自动打开作品预览',()=>{
  const run=readFileSync(new URL('../src/ui/CourseRun.jsx',import.meta.url),'utf8');
  assert.match(run,/const \[previewOpen,setPreviewOpen\] = useState\(false\)/);
  assert.match(run,/type==='kuaixue-open-html-preview'/);
  assert.match(run,/setPreviewOpen\(true\)/);
});

test('点击产物文件打开课程侧边栏，不注入额外 HTML 预览按钮',()=>{
  const run=readFileSync(new URL('../src/ui/CourseRun.jsx',import.meta.url),'utf8');
  const entry=readFileSync(new URL('../integrations/vibecoding/course-entry.tsx',import.meta.url),'utf8');
  const preview=readFileSync(new URL('../integrations/vibecoding/course-html-preview.mjs',import.meta.url),'utf8');
  const builder=readFileSync(new URL('../scripts/build-vibe-workbench.mjs',import.meta.url),'utf8');
  const main=readFileSync(new URL('../electron/main.cjs',import.meta.url),'utf8');
  assert.doesNotMatch(entry,/HTML 预览/);
  assert.doesNotMatch(entry,/data-kuaixue-html-preview/);
  assert.doesNotMatch(run,/预览作品/);
  assert.match(entry,/kuaixue-workbench-workspace/);
  assert.match(entry,/kuaixue-open-html-preview/);
  assert.match(entry,/data-task-item-key/);
  assert.match(preview,/window\.parent\.postMessage/);
  assert.match(builder,/__kuaixueOpenCourseHtmlPreview/);
  assert.match(run,/setPreviewFile\(event\.data\.file\)/);
  assert.match(main,/authorizedWorkspaceDirectory/);
  assert.match(main,/rememberWorkspaceRoot/);
});

test('画布会从服务端恢复已完成的生成结果',()=>{
  const platform=readFileSync(new URL('../apps/api/course-platform.mjs',import.meta.url),'utf8');
  const actions=readFileSync(new URL('../apps/api/course-actions.mjs',import.meta.url),'utf8');
  const client=readFileSync(new URL('../src/services/courseClient.js',import.meta.url),'utf8');
  const run=readFileSync(new URL('../src/ui/CourseRun.jsx',import.meta.url),'utf8');
  const canvas=readFileSync(new URL('../vendor/academy-canvas/index.jsx',import.meta.url),'utf8');
  assert.match(platform,/generationState/);
  assert.match(actions,/'\/api\/v1\/generations\/status'/);
  assert.match(client,/generateTracked/);
  assert.match(client,/generations\/status/);
  assert.match(run,/recoverGeneration/);
  assert.match(canvas,/recoveredGenerationNodesRef/);
});
