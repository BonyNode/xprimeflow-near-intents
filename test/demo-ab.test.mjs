import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDemoServer } from '../demo/server.mjs';

test('A/B demo: catalog-bound preview, best route, missing wallet, unknown mode and wet requests', async t => {
  const server = createDemoServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const catalog = await (await fetch(base + '/api/swap-catalog')).json();
  const from = catalog.from.find(r => r.denom === 'near-native'), to = catalog.to.find(r => r.blockchain === 'base');
  const input = { mode: 'swap_any', originAsset: from.assetId, originDenom: from.denom, destinationAsset: to.assetId,
    amount: '1', refundTo: 'quote.demo.invalid', recipient: '0x1111111111111111111111111111111111111111', region: 'DE' };
  const post = async (path, data) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  const native = await post('/api/quote', input); assert.equal(native.status, 200);
  assert.equal(native.body.preview.transaction.actions[0].type, 'Transfer'); assert.equal(native.body.catalogMatch, true);
  const ft = await post('/api/quote', { ...input, originDenom: 'wrap.near' });
  assert.equal(ft.body.preview.transaction.actions.length, 2);
  const mismatch = await post('/api/quote', { ...input, shown: { mode: 'swap_any', from: { ...from, decimals: 18 }, to, amount: '1' } });
  assert.equal(mismatch.body.error.code, 'catalog_mismatch');
  assert.equal((await post('/api/quote', { ...input, mode: 'verified' })).body.error.code, 'mode_mismatch');
  const compare = { ...input, symbol: 'USDC', addressByChain: { near: input.refundTo, base: input.recipient,
    arb: '0x2222222222222222222222222222222222222222' } };
  const b = await post('/api/cheapest', compare); assert.equal(b.status, 200);
  assert.equal(b.body.comparison.best.blockchain, 'arb');
  assert.equal(b.body.comparison.rows.find(r => r.blockchain === 'pol').status, 'needs_wallet');
  assert.equal((await post('/api/cheapest', { ...compare, dry: false })).status, 400);
  assert.equal((await fetch(base + '/api/submit', { method: 'POST' })).status, 404);
});
