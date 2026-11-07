import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport, readBoundedJson, MAX_RESPONSE_BYTES } from '../src/http.js';
import { CATALOG_TTL_MS } from '../src/catalog.js';
import { TOKENS, NOW, harness, code } from './helpers.mjs';

test('catalog allowlist, immutable cache, and concurrent request coalescing', async () => {
  const { client, calls } = harness();
  const [a, b] = await Promise.all([client.getTokens(), client.getTokens()]);
  assert.equal(a, b); assert.equal(calls.length, 1);
  assert.equal(a.expiresAt, NOW + CATALOG_TTL_MS);
  assert.deepEqual(Object.keys(a.tokens[0]).sort(), ['assetId', 'blockchain', 'contractAddress', 'decimals', 'symbol']);
  assert.throws(() => { a.tokens[0].assetId = 'modified'; });
  assert.equal(JSON.stringify(a).includes('discard-this-field'), false);
});
test('catalog expires at exactly one hour and never falls back on refresh failure', async () => {
  let now = NOW; let requests = 0;
  const { client } = harness({ clock: () => now, fetchImpl: async () => {
    if (++requests === 1) return Response.json(TOKENS);
    return new Response('SECRET UPSTREAM BODY', { status: 503 });
  } });
  await client.getTokens(); now += CATALOG_TTL_MS - 1;
  await client.getTokens(); assert.equal(requests, 1);
  now++;
  await assert.rejects(client.getTokens(), code('provider_unavailable'));
  await assert.rejects(client.getTokens(), code('provider_unavailable'));
  assert.equal(requests, 3);
});
test('slow catalog response cannot extend the hard deadline', async () => {
  let now = NOW;
  const { client } = harness({ clock: () => now, fetchImpl: async () => {
    now += CATALOG_TTL_MS; return Response.json(TOKENS);
  } });
  await assert.rejects(client.getTokens(), code('catalog_expired'));
});
test('catalog rejects duplicate asset IDs and malformed metadata', async () => {
  for (const tokens of [[TOKENS[0], TOKENS[0]], [{ ...TOKENS[0], decimals: '24' }], [], {}]) {
    await assert.rejects(harness({ tokens }).client.getTokens(), code('invalid_catalog'));
  }
});
test('exact 1 MiB JSON is accepted, oversized malformed JSON rejected before parse', async () => {
  const body = '"' + 'a'.repeat(MAX_RESPONSE_BYTES - 2) + '"';
  assert.equal((await readBoundedJson(new Response(body))).length, MAX_RESPONSE_BYTES - 2);
  await assert.rejects(readBoundedJson(new Response('!'.repeat(MAX_RESPONSE_BYTES + 1))), code('response_too_large'));
});
test('streamed limit counts bytes without trusting Content-Length', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(c) {
    c.enqueue(new Uint8Array(MAX_RESPONSE_BYTES)); c.enqueue(new Uint8Array(1));
  }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedJson(new Response(stream, { headers: { 'content-length': '1' } })), code('response_too_large'));
  assert.equal(cancelled, true);
  await assert.rejects(readBoundedJson(new Response('small', { headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } })), code('response_too_large'));
  await assert.rejects(readBoundedJson(new Response('"' + 'é'.repeat(MAX_RESPONSE_BYTES / 2) + '"')), code('response_too_large'));
});
test('malformed JSON and invalid UTF-8 return safe schema errors', async () => {
  for (const body of ['{"password":"SECRET"', Uint8Array.from([0xff])]) {
    await assert.rejects(readBoundedJson(new Response(body)), e => e.code === 'provider_invalid_response' && !e.message.includes('SECRET'));
  }
});
test('non-2xx errors never read or expose the provider body', async () => {
  let read = false; let cancelled = false;
  const transport = createTransport({ fetchImpl: async () => ({ ok: false, status: 503,
    body: { cancel: async () => { cancelled = true; } },
    text: async () => { read = true; return 'secret'; },
  }) });
  await assert.rejects(transport('/v0/tokens'), code('provider_unavailable'));
  assert.equal(read, false); assert.equal(cancelled, true);
});
test('timeout covers stalled fetch and stalled response body', async () => {
  const stalled = createTransport({ timeoutMs: 20, fetchImpl: async (_url, { signal }) =>
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('secret')))) });
  await assert.rejects(stalled('/v0/tokens'), code('provider_timeout'));
  const body = createTransport({ timeoutMs: 20, fetchImpl: async (_url, { signal }) => new Response(new ReadableStream({
    start(c) { signal.addEventListener('abort', () => c.error(new Error('secret'))); },
  }), { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(body('/v0/tokens'), code('provider_timeout'));
});
test('transport allows only fixed provider endpoints and refuses wet quotes', async () => {
  let sent = 0;
  const request = createTransport({ fetchImpl: async () => { sent++; return Response.json({}); } });
  for (const [path, body] of [['https://example.com/v0/tokens'], ['/v0/deposit/submit', {}], ['/v0/quote', { dry: false, swapType: 'EXACT_INPUT' }]]) {
    await assert.rejects(request(path, body), code('invalid_input'));
  }
  assert.equal(sent, 0);
});
test('optional JWT stays in X-API-Key; redirects and transport errors are sanitized', async () => {
  const request = createTransport({ jwt: 'synthetic-test-token', fetchImpl: async (_url, init) => {
    assert.equal(init.headers['X-API-Key'], 'synthetic-test-token'); assert.equal(init.redirect, 'error');
    throw new Error('synthetic-test-token SECRET BODY');
  } });
  await assert.rejects(request('/v0/tokens'), e => !e.message.includes('synthetic') && !e.cause && e.code === 'provider_unavailable');
});
