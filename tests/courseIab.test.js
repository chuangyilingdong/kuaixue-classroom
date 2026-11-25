import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {courseBrowserPort} from '../integrations/vibecoding/course-iab-port.mjs';
const require=createRequire(import.meta.url);
const {createCourseIab}=require('../electron/course-iab.cjs');

class FakeChannel extends EventEmitter {
  connected=true; env={KUAIXUE_IAB_ID:'iab:course-test'}; sent=[];
  send(message,callback){this.sent.push(message);callback?.();}
}

test('course browser executor discovers IAB and routes only matching backend generation over IPC',async()=>{
  const channel=new FakeChannel();
  const fallback={list:async()=>[{id:'cdp:test',generation:1,type:'cdp',name:'CDP',capabilities:{}}],execute:async()=>({ok:true})};
  const port=courseBrowserPort(fallback,channel);
  const listed=await port.list({sessionId:'s'});
  assert.deepEqual(listed.map(row=>row.type),['iab','cdp']);
  const request=port.execute({browserId:'iab:course-test',browserGeneration:1,sessionId:'s',command:{method:'list'}});
  const wire=channel.sent[0];
  channel.emit('message',{type:'course-iab-result',key:wire.key,result:{ok:true,tabs:[],elapsedMs:1}});
  assert.deepEqual(await request,{ok:true,tabs:[],elapsedMs:1});
  assert.deepEqual(await port.execute({browserId:'cdp:test',browserGeneration:1,sessionId:'s',command:{method:'list'}}),{ok:true});
  assert.equal((await port.execute({browserId:'iab:course-test',browserGeneration:9,sessionId:'s',command:{method:'list'}})).ok,false);
});

test('IAB owns only task-created webviews and executes commands against that exact guest',async()=>{
  const host={events:[],isDestroyed:()=>false,send(channel,payload){this.events.push({channel,payload});}};
  const bridge=createCourseIab({host,lease:'lease-1',executePage:async(view,command)=>({ok:true,url:view.webContents.getURL(),method:command.method,elapsedMs:1})});
  const creation=bridge.execute({browserId:bridge.id,browserGeneration:1,sessionId:'task-A',command:{method:'newTab'}});
  const event=host.events.at(-1).payload;
  assert.equal(event.action,'new');
  const guest=new EventEmitter();
  guest.getURL=()=> 'about:blank';guest.getTitle=()=>'';
  guest.executeJavaScript=async()=>({width:640,height:480});
  assert.equal(bridge.pending(event.key),true);
  assert.equal(bridge.attach(event.key,guest),true);
  const created=await creation;
  assert.equal(created.tab.tabId,event.key);
  assert.deepEqual((await bridge.execute({browserId:bridge.id,browserGeneration:1,sessionId:'task-A',command:{method:'navigate',tabId:event.key,url:'https://example.com'}})).url,'about:blank');
  assert.equal((await bridge.execute({browserId:bridge.id,browserGeneration:1,sessionId:'task-B',command:{method:'getState',tabId:event.key}})).ok,false);
  bridge.close();
});
