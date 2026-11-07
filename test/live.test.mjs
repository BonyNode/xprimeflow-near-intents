import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, createLocalCompliance } from '../src/index.js';
import { policy } from './helpers.mjs';

// Explicit opt-in. No JWT is read, no real wallet is used, and no response body is logged.
test('LIVE: anonymous public catalog and one dry quote', { skip: process.env.LIVE !== '1', timeout: 30000 }, async t => {
  const calls = [];
  const client = createClient({ compliance: createLocalCompliance(policy), fetchImpl: async (url, options) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://1click.chaindefuser.com');
    assert.ok(['/v0/tokens', '/v0/quote'].includes(u.pathname));
    if (options.body) assert.equal(JSON.parse(options.body).dry, true);
    assert.equal(options.headers['X-API-Key'], undefined);
    calls.push(u.pathname);
    const response = await fetch(url, options);
    t.diagnostic(`${options.method} ${u.pathname}: HTTP ${response.status}`);
    return response;
  } });
  const catalog = await client.getTokens(); assert.ok(catalog.tokens.length > 0);
  // Repeated-digit addresses are synthetic. NEAR action construction is tested
  // offline; no real NEAR account is used to make this network check pass.
  const q = await client.quote({ originAsset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    destinationAsset: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
    amount: '10000000', refundTo: '0x1111111111111111111111111111111111111111',
    recipient: '0x2222222222222222222222222222222222222222', region: 'DE' });
  assert.equal(q.dry, true); assert.equal(q.depositAddress, null);
  assert.ok(BigInt(q.amountOut) >= BigInt(q.minAmountOut));
  assert.deepEqual(calls, ['/v0/tokens', '/v0/quote']);
  t.diagnostic(JSON.stringify({ catalogCount: catalog.tokens.length, capturedAt: new Date().toISOString(),
    amountIn: q.amountIn, amountOut: q.amountOut, minAmountOut: q.minAmountOut, timeEstimate: q.timeEstimate, fees: q.fees }));
});
