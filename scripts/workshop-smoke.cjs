const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
(async () => {
  const tmp = mkdtempSync(path.join(tmpdir(),'kx-dual-'));
  const app = await _electron.launch({executablePath:path.resolve(process.argv[2] || 'release/classroom-workspace-preview/win-unpacked/快学课堂.exe'),env:{...process.env,APPDATA:tmp},args:['--user-data-dir='+tmp,'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-features=CalculateNativeWinOcclusion']});
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(20000);
    assert.ok((await app.evaluate(({app}) => app.getPath('userData'))).startsWith(tmp));
    const errors = []; page.on('pageerror',err=>errors.push(err.message));
    const btn = name => page.getByRole('button',{name,exact:true});
    await btn('课程库').click();
    const card = page.locator('.course-card').filter({hasText:'从故事分镜到互动网页'});
    await btn('画布课程').click(); await card.waitFor(); await btn('VibeCoding').click(); await card.locator('.card-open').click();
    await btn('使用演示学员体验课程').click();
    await btn('用 100 演示积分解锁课程').click();
    async function fillsWorkspace(selector) {
      const bounds=await page.locator(selector).boundingBox(),main=await page.locator('main').first().boundingBox();
      assert.ok(Math.abs(bounds.x-main.x)<2 && Math.abs(bounds.width-main.width)<2 && Math.abs(bounds.y-32)<2 && Math.abs(bounds.height+32-main.height)<2,JSON.stringify({bounds,main}));
      assert.equal(await page.locator('.workshop-steps').count(),0);
    }
    await btn('进入学院画布').click();await btn('故事分镜').click();
    await page.getByRole('button',{name:/镜头草稿.*文字/}).click();
    await page.getByRole('button',{name:/分镜起稿/}).click();await page.getByRole('dialog').getByRole('button',{name:/镜头草稿/}).click();
    await page.locator('.react-flow__node').first().waitFor();await fillsWorkspace('.cv-shell');
    await page.screenshot({path:path.resolve('_qa_render/academy-workspace-full.png')});
    await btn('‹ 返回课程').click();await btn('进入 VibeCoding 工作区').click();
    const editor=page.frameLocator('iframe[title="灵动 VibeCoding 创作工作台"]');
    await editor.getByText('向小灵提问，小灵即可开启创造',{exact:true}).waitFor();await fillsWorkspace('.course-workbench');
    await editor.getByRole('button',{name:'课堂提示词预设'}).click();
    await editor.getByRole('button',{name:/互动故事页面/}).click();await editor.getByText('已插入当前任务输入框。',{exact:true}).waitFor();
    await page.screenshot({path:path.resolve('_qa_render/vibe-presets-full.png')});
    await editor.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).first().click();
    await editor.locator('[contenteditable="true"]').filter({hasText:'根据我的三个分镜制作一个互动故事网页'}).first().waitFor();
    await page.screenshot({path:path.resolve('_qa_render/workspace-proof.png')});
    await btn('‹ 返回课程').click();await btn('进入学院画布').click();await page.locator('.react-flow__node').first().waitFor();
    await btn('‹ 返回课程').click();await btn('我的学习').click();await page.locator('.learning-account').getByText('260',{exact:true}).waitFor();
    await btn('我的作品').click();assert.equal(await page.getByRole('button',{name:'继续创作'}).count(),2);
    assert.equal(app.windows().length,1);assert.deepEqual(errors,[]);
    console.log('通过：双入口满幅、后台素材分组和框体、画布恢复、原版课堂提示词插入草稿、作品列表与余额。');
  } catch (error) {
    const page=app.windows()[0];
    console.error((await page.locator('body').innerText()).slice(-1700));
    for (const f of page.frames().slice(1)) console.error((await f.locator('body').innerText({timeout:1500}).catch(()=>'' )).slice(-800));
    throw error;
  } finally {await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

