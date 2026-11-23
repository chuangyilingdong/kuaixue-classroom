const path = require('node:path');
const {writeFileSync} = require('node:fs');
const {app, session} = require('electron');

const origin = process.env.KUAIXUE_DIAG_ORIGIN || 'https://aicyld.com.cn';
const userData = process.env.KUAIXUE_DIAG_USER_DATA || path.join(process.env.APPDATA || '', 'KuaixueClassroom');
app.setName('快学课堂');
app.setPath('userData', userData);

async function call(ses, method, pathname, body) {
  const response = await ses.fetch(origin + pathname, {
    method,
    credentials: 'include',
    redirect: 'error',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
    },
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  const payload = await response.json().catch(() => null);
  return {status: response.status, ok: response.ok, payload};
}

function summarize(response) {
  return {
    status: response.status,
    code: response.payload?.error?.code || null,
    message: response.payload?.error?.message || null,
  };
}

app.whenReady().then(async () => {
  let report;
  try {
    const ses = session.defaultSession;
    const account = await call(ses, 'GET', '/api/v1/me');
    const catalog = await call(ses, 'GET', '/api/v1/catalog/courses');
    const item = catalog.payload?.data?.items?.find(course => course.title === '测试一下') || catalog.payload?.data?.items?.[0];
    if (!item) throw new Error('生产目录没有可用于诊断的课程');

    const detail = await call(ses, 'GET', `/api/v1/catalog/courses/${encodeURIComponent(item.id)}?versionId=${encodeURIComponent(item.versionId)}`);
    const course = detail.payload?.data?.course;
    const canvas = await call(ses, 'POST', '/api/v1/course-runs/open', {
      courseId: item.id,
      versionId: item.versionId,
      mode: 'CANVAS',
    });
    const vibe = await call(ses, 'POST', '/api/v1/course-runs/open', {
      courseId: item.id,
      versionId: item.versionId,
      mode: 'VIBECODING',
    });
    const localRuntime = vibe.ok
      ? await call(ses, 'POST', '/api/v1/course-runs/local-runtime', {id:vibe.payload.data.id})
      : null;

    const boxes = (course?.materialGroups || [])
      .flatMap(group => group.materials || [])
      .filter(material => material.materialType === 'GENERATION_BOX');
    const imageBox = boxes.find(material => material.snapshot?.box?.modality === 'IMAGE');
    let quote = null;
    if (canvas.ok && imageBox) {
      const box = imageBox.snapshot.box;
      quote = await call(ses, 'POST', '/api/v1/generations/quote', {
        id: canvas.payload.data.id,
        nodeId: `box-${imageBox.id}`,
        modality: 'IMAGE',
        input: {
          title: box.title || imageBox.title || '诊断报价',
          prompt: '诊断报价，不生成',
          referenceAssets: [],
          params: {
            ...(box.aspectRatio ? {aspectRatio: box.aspectRatio} : {}),
            ...(box.resolution ? {resolution: box.resolution} : {}),
          },
        },
      });
    }

    report = {
      account: summarize(account),
      catalog: {status: catalog.status, count: catalog.payload?.data?.items?.length || 0},
      detail: {status: detail.status, courseId: course?.id || null, versionId: course?.versionId || null},
      canvasOpen: summarize(canvas),
      vibeOpen: summarize(vibe),
      localRuntime: localRuntime ? {
        status: localRuntime.status,
        code: localRuntime.payload?.error?.code || null,
        message: localRuntime.payload?.error?.message || null,
        userId: Boolean(localRuntime.payload?.data?.userId),
        modelCount: localRuntime.payload?.data?.modelGateway?.modelIds?.length || 0,
        baseHost: (() => { try { return new URL(localRuntime.payload?.data?.modelGateway?.baseUrl).host; } catch { return null; } })(),
      } : null,
      canvasHasRuntimeTicket: typeof canvas.payload?.data?.runtimeTicket === 'string',
      vibeHasRuntimeTicket: typeof vibe.payload?.data?.runtimeTicket === 'string',
      imageBoxFound: Boolean(imageBox),
      quote: quote ? {
        status: quote.status,
        code: quote.payload?.error?.code || null,
        message: quote.payload?.error?.message || null,
        points: quote.payload?.data?.points ?? null,
        modelId: quote.payload?.data?.modelId || null,
      } : null,
    };
  } catch (error) {
    report = {error: error.stack || error.message};
    process.exitCode = 1;
  } finally {
    const output = process.env.KUAIXUE_DIAG_OUTPUT || path.join(process.env.TEMP || '', 'kuaixue-production-diagnosis.json');
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    app.quit();
  }
});
