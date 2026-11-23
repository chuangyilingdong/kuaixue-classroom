import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {openFormalProvider}=require('../formal-provider.cjs');

test('formal provider routes server API reads through the loopback-only origin',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'kx-formal-provider-'));
  const provider=openFormalProvider(join(directory,'provider.sqlite'),{
    KUAIXUE_SESSION_SECRET:'fixture-session-secret',
    KUAIXUE_WALLET_SECRET:'fixture-wallet-secret',
    KUAIXUE_MAIN_SITE_ORIGIN:'https://public.example',
    KUAIXUE_INTERNAL_ORIGIN:'http://127.0.0.1:3001',
  });
  const originalFetch=globalThis.fetch;
  const requests=[];
  globalThis.fetch=async (input,options={})=>{
    const url=String(input);
    requests.push({url,options});
    if(url==='http://127.0.0.1:3001/api/auth/me') return Response.json({id:'user-1',username:'Fixture'});
    if(url==='http://127.0.0.1:3001/internal/kuaixue/wallet/debit') {
      return Response.json({data:{orderId:'order-1',status:'confirmed'}});
    }
    if(url==='http://127.0.0.1:3001/api/points/ledger?limit=20') {
      return Response.json({data:[]});
    }
    return Response.json({error:{message:'unexpected request'}},{status:404});
  };
  t.after(async()=>{
    globalThis.fetch=originalFetch;
    provider.close();
    await rm(directory,{recursive:true,force:true});
  });

  const nonce=provider.desktopAuth.begin({challenge:'a'.repeat(43),state:'s'.repeat(32)});
  const authorization=await provider.desktopAuth.complete({nonce,mainToken:'t'.repeat(32)});
  const order=await provider.debitOrLookup({orderId:'order-1',userId:'user-1',points:1});
  const ledger=await provider.ledger('t'.repeat(32),'?limit=20');

  assert.equal(authorization.state,'s'.repeat(32));
  assert.equal(order.status,'confirmed');
  assert.deepEqual(ledger.data,[]);
  assert.deepEqual(requests.map(item=>item.url),[
    'http://127.0.0.1:3001/api/auth/me',
    'http://127.0.0.1:3001/internal/kuaixue/wallet/debit',
    'http://127.0.0.1:3001/api/points/ledger?limit=20',
  ]);
});
