import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createDemoServer } from '../demo/server.mjs';
import { INPUT, QUOTE } from './helpers.mjs';

async function demo(t) {
  const server = createDemoServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
test('demo README route works offline; no wallet, keys, provider prices or executable deposit', async t => {
  const origin = await demo(t);
  const index = await fetch(origin); const html = await index.text();
  assert.equal(index.status, 200); assert.match(html, /Get dry quote/);
  assert.match(index.headers.get('content-security-policy'), /connect-src 'self'/);
  const config = await (await fetch(origin + '/api/config')).json(); assert.equal(config.mode, 'fixture');
  const catalog = await (await fetch(origin + '/api/tokens')).json(); assert.ok(catalog.tokens.length >= 5);
  assert.ok(catalog.tokens.every(t => !Object.hasOwn(t, 'price')));
  const response = await fetch(origin + '/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...INPUT, deadline: undefined, amount: '1' }) });
  assert.equal(response.status, 200);
  const { quote, preview } = await response.json();
  assert.equal(quote.dry, true); assert.equal(quote.amountOut, QUOTE.quote.amountOut);
  assert.equal(quote.depositAddress, null); assert.equal(preview.illustrative, true);
  assert.equal(preview.transaction.actions.length, 1);
  assert.equal(preview.transaction.receiverId, 'deposit.demo.invalid');
  assert.equal(preview.transaction.actions[0].type, 'Transfer');
});
test('demo rejects wet attempts, GB, arbitrary files, cross-origin requests and oversized input', async t => {
  const origin = await demo(t);
  const post = (data, headers = {}) => fetch(origin + '/api/quote', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  const input = { ...INPUT, deadline: undefined, amount: '1' };
  assert.equal((await post({ ...input, dry: false })).status, 400);
  const gb = await post({ ...input, region: 'GB' }); assert.equal((await gb.json()).error.code, 'region_unavailable');
  assert.equal((await fetch(origin + '/package.json')).status, 404);
  assert.equal((await fetch(origin + '/.env')).status, 404);
  assert.equal((await post(input, { Origin: 'https://example.com' })).status, 403);
  const wrongHost = await new Promise((resolve, reject) => {
    const r = http.get(origin + '/api/config', { headers: { Host: 'example.com' } }, res => { res.resume(); resolve(res.statusCode); });
    r.on('error', reject);
  });
  assert.equal(wrongHost, 403);
  const large = await post({ padding: 'a'.repeat(17000) }); assert.equal(large.status, 413);
});
