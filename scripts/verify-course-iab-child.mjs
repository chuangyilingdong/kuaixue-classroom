import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {courseBrowserPort} from "../integrations/vibecoding/course-iab-port.mjs";

const port=courseBrowserPort(undefined,process);
try {
  const apiModule=process.env.KUAIXUE_BROWSER_CLIENT_MODULE;
  assert.ok(apiModule,"official Browser Use client module path is required");
  const {setupBrowserRuntime}=await import(pathToFileURL(apiModule).href);
  const transport={
    list:()=>port.list(),
    execute:(browserId,browserGeneration,command)=>port.execute({
      browserId,browserGeneration,sessionId:"e2e-task",command,
    }),
    assertAvailable(){
      assert.ok(process.connected,"course browser IPC transport is unavailable");
    },
  };
  globalThis.agent ??= {};
  globalThis[Symbol.for("zcode.node-repl.browser-control-bridge")]={
    ...transport,
    documentationRoot:undefined,
  };
  await setupBrowserRuntime({globals:globalThis});

  const browsers=await agent.browsers.list();
  assert.ok(browsers.some(item=>item.type==="iab"&&item.id===process.env.KUAIXUE_IAB_ID),"IAB backend was not discovered through the official Browser Use API");
  const browser=await agent.browsers.getForUrl(process.env.KUAIXUE_IAB_TARGET_URL);
  assert.equal(browser.browserId,process.env.KUAIXUE_IAB_ID);
  const tab=await browser.tabs.new();
  assert.ok(tab.id,"official Browser Use API did not return a tab id");
  const url=process.env.KUAIXUE_IAB_TARGET_URL;
  await tab.goto(url);
  assert.equal(await tab.url(),url);
  const snapshot=await tab.playwright.domSnapshot();
  assert.match(snapshot,/VISIBLE_SIDEBAR_GUEST_OK/);
  const screenshot=await tab.screenshot();
  assert.ok(screenshot instanceof Uint8Array&&screenshot.byteLength>100,"expected screenshot bytes from official Browser Use API");
  let closedTabId;
  if (process.env.KUAIXUE_VERIFY_COURSE_RUN === "1") {
    const visible = tabId => new Promise(resolve => {
      const resume = message => {
        if (message?.type !== "course-iab-verify-continue") return;
        process.off("message", resume);
        resolve();
      };
      process.on("message", resume);
      process.send({type:"course-iab-verify-checkpoint", tabId});
    });
    await visible(tab.id);
    const second = await browser.tabs.new();
    await second.goto(`${url}?second=1`);
    await visible(second.id);
    await browser.tabs.get(tab.id);
    await visible(tab.id);
    await second.close();
    closedTabId = second.id;
    assert.equal((await browser.tabs.list()).length, 1);
  }
  process.send({type:"course-iab-verify-done",proof:{tabId:tab.id,closedTabId,url:await tab.url(),snapshot:true,screenshotBytes:screenshot.byteLength,api:"official-browser-use"}});
} catch(error) {
  process.send({type:"course-iab-verify-error",message:error?.stack||String(error)});
  process.exitCode=1;
}
