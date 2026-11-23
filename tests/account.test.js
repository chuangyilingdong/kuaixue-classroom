import test from 'node:test';
import assert from 'node:assert/strict';
import { grantForCourse } from '../src/data/account.js';
import { createApiServer } from '../apps/api/server.mjs';
import { createAccountReader } from '../apps/api/account.mjs';
import { loadLearningAccount } from '../src/services/learningAccount.js';

const grant = { userId:'u1', courseId:'storyboard-to-film', versionId:'demo-storyboard-v1', status:'active' };
function reader({ grants = [grant], profile = { id:'u1', username:'测试学员' }, wallet = { total: 0 }, onRead = () => {} } = {}) {
  return createAccountReader({
    mainSite:'https://staging.invalid',
    identity: async session => session === 'valid' ? { userId:'u1', mainSiteToken:'fixture-token' } : null,
    listGrants: async id => { assert.equal(id,'u1'); return grants; },
    fetchImpl: async (url, init) => {
      onRead(url.pathname);
      if (url.pathname.endsWith('/wallet') && wallet === null) return new Response(null, { status: 503 });
      assert.equal(init.headers.Authorization,'Bearer fixture-token');
      assert.ok(['/api/auth/me','/api/points/wallet'].includes(url.pathname));
      return Response.json(url.pathname.endsWith('/me') ? profile : wallet);
    },
  });
}
async function serve(t, accountReader) {
  const server = createApiServer({accountReader});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
test('authenticated adapter reads authoritative zero balance, active and revoked versions without leaking main-site fields', async t => {
  const base = await serve(t, reader({grants:[grant,{...grant, versionId:'older', status:'revoked'}]}));
  const fetchImpl = (url,init) => fetch(url,{...init,headers:{Cookie:'kuaixue_session=valid'}});
  const account = await loadLearningAccount({base,fetchImpl});
  assert.equal(account.demo,false); assert.equal(account.points,0);
  assert.deepEqual(account.user,{id:'u1',name:'测试学员'});
  assert.deepEqual(account.entitlements.map(g=>g.status),['active','revoked']);
  assert.deepEqual((await (await fetchImpl(base+'/api/v1/me/entitlements?userId=other')).json()).data.entitlements,account.entitlements);
});
test('account endpoint rejects missing sessions, expired sessions and a disallowed browser origin', async t => {
  const url=(await serve(t,reader()))+'/api/v1/me';
  for(const [headers,status] of [[{},401],[{Cookie:'kuaixue_session=no'},401],[{Cookie:'kuaixue_session=valid',Origin:'https://other.invalid'},403]]) assert.equal((await fetch(url,{headers})).status,status);
});
test('mismatched accounts, another user’s entitlement and malformed balance fail closed', async () => {
  for(const setup of [{profile:{id:'u2',username:'other'}},{grants:[{...grant,userId:'u2'}]},{wallet:{total:null}}]) await assert.rejects(reader(setup)('valid'));
});
test('explicit service mode never substitutes the demonstration learner after an error', async t => {
  const base=await serve(t,undefined);
  await assert.rejects(loadLearningAccount({base}),/暂不可用/);
  const preview=await loadLearningAccount({base:''});
  assert.equal(preview.demo,true); assert.equal(preview.entitlements.filter(g=>g.status==='active').length,1);
});

test('a wallet outage preserves only verified course versions in the learning view', async t => {
  const reads = [];
  const base = await serve(t, reader({wallet: null, onRead: path => reads.push(path)}));
  const account = await loadLearningAccount({base, fetchImpl: (url, init) => fetch(url, {
    ...init, headers: {Cookie: 'kuaixue_session=valid'},
  })});
  assert.equal(account.demo, false);
  assert.equal(account.points, null);
  assert.equal(grantForCourse(account.entitlements, {id: grant.courseId, versionId: grant.versionId}).status, 'active');
  assert.equal(grantForCourse(account.entitlements, {id: grant.courseId, versionId: 'new-publication'}), undefined);
  assert.equal(reads.filter(path => path.endsWith('/wallet')).length, 1);
});

test('entitlements-only requests still validate session, owner and conflicting grants', async t => {
  for (const setup of [{profile: {id:'other'}}, {grants:[{...grant, userId:'other'}]}, {grants:[grant, {...grant, status:'revoked'}]}]) {
    const url = (await serve(t, reader(setup))) + '/api/v1/me/entitlements';
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, {headers:{Cookie:'kuaixue_session=valid'}})).status, 502);
  }
});
