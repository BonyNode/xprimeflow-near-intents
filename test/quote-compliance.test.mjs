import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, createLocalCompliance } from '../src/index.js';
import { INPUT, QUOTE, NOW, TOKENS, harness, code, policy } from './helpers.mjs';

test('valid EXACT_INPUT quote is dry and uses exact request echoes', async () => {
  const { client, calls } = harness();
  const q = await client.quote(INPUT);
  assert.equal(q.dry, true); assert.equal(q.amountOut, QUOTE.quote.amountOut);
  assert.equal(q.depositAddress, null); assert.equal(q.providerDeadline, null);
  const sent = JSON.parse(calls[1].body);
  const { appFees: _providerFee, ...expectedRequest } = QUOTE.quoteRequest;
  assert.deepEqual(sent, expectedRequest);
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].headers['X-API-Key'], undefined);
  assert.equal(calls[1].url, 'https://1click.chaindefuser.com/v0/quote');
});

for (const [field, changed] of Object.entries({
  dry: false, swapType: 'EXACT_OUTPUT', slippageTolerance: 200, originAsset: 'wrong', destinationAsset: 'wrong',
  amount: '100', refundTo: 'changed.demo.invalid', recipient: '0x0000000000000000000000000000000000000001',
  depositType: 'INTENTS', refundType: 'INTENTS', recipientType: 'INTENTS', deadline: '2030-01-01T00:00:00Z',
})) test(`reject mismatched echo: ${field}`, async () => {
  const quote = structuredClone(QUOTE); quote.quoteRequest[field] = changed;
  await assert.rejects(harness({ quote }).client.quote(INPUT), code('quote_mismatch'));
});

test('echo is required; unsolicited routing rejected', async () => {
  const missing = structuredClone(QUOTE); delete missing.quoteRequest;
  await assert.rejects(harness({ quote: missing }).client.quote(INPUT), code('provider_invalid_response'));
  for (const patch of [{ virtualChainRecipient: 'other' }, { customRecipientMsg: 'other' }]) {
    const quote = structuredClone(QUOTE); Object.assign(quote.quoteRequest, patch);
    await assert.rejects(harness({ quote }).client.quote(INPUT), code('quote_mismatch'));
  }
});
test('provider default appFees are validated and reported without a hardcoded rate', async () => {
  const quote = structuredClone(QUOTE);
  quote.quoteRequest.appFees = [{ recipient: 'fees.demo.invalid', fee: 25 }];
  assert.equal((await harness({ quote }).client.quote(INPUT)).fees.appFeeBps, 25);
  quote.quoteRequest.appFees[0].fee = '25';
  await assert.rejects(harness({ quote }).client.quote(INPUT), code('provider_invalid_response'));
});
test('quote amounts must be canonical strings; output cannot be below minimum', async () => {
  for (const patch of [{ amountOut: 3000000 }, { amountOut: '1e6' }, { minAmountOut: '-1' },
    { amountOut: '0001' }, { amountOut: '0' }, { minAmountOut: '4000000' }, { refundFee: 1 }, { timeEstimate: '45' }]) {
    const quote = structuredClone(QUOTE); Object.assign(quote.quote, patch);
    await assert.rejects(harness({ quote }).client.quote(INPUT), code('provider_invalid_response'));
  }
  const changed = structuredClone(QUOTE); changed.quote.amountIn = '1';
  await assert.rejects(harness({ quote: changed }).client.quote(INPUT), code('quote_mismatch'));
});
test('invalid inputs and expired/oversized deadlines send no quote request', async () => {
  for (const patch of [{ dry: false }, { swapType: 'EXACT_OUTPUT' }, { amount: 1 }, { amount: '0' },
    { slippageTolerance: 1.5 }, { slippageTolerance: 10001 }, { deadline: '2026-02-30T12:00:00Z' },
    { deadline: new Date(NOW).toISOString() }, { deadline: new Date(NOW + 86400001).toISOString() }]) {
    const { client, calls } = harness();
    await assert.rejects(client.quote({ ...INPUT, ...patch }), code('invalid_input'));
    assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  }
});
test('asset identity comes from assetId, not a ticker or caller-supplied chain', async () => {
  await assert.rejects(harness().client.quote({ ...INPUT, originAsset: 'USDC' }), code('unknown_asset'));
  await assert.rejects(harness().client.quote({ ...INPUT, originAsset: TOKENS[4].assetId }), code('unsupported_network'));
  const { client } = harness();
  const result = await client.quote({ ...INPUT, originBlockchain: 'base' });
  assert.equal(result.origin.blockchain, 'near');
});
test('compliance hooks are mandatory; exceptions and indeterminate results fail closed', async () => {
  assert.throws(() => createClient(), code('compliance_unavailable'));
  for (const hooks of [
    { regionCheck: async () => { throw new Error('private body'); }, sanctionsCheck: async () => true },
    { regionCheck: async () => undefined, sanctionsCheck: async () => true },
    { regionCheck: async () => true, sanctionsCheck: async () => { throw new Error('private body'); } },
    { regionCheck: async () => true, sanctionsCheck: async () => undefined },
  ]) {
    const { client, calls } = harness({ compliance: hooks });
    await assert.rejects(client.quote(INPUT), code('compliance_unavailable'));
    assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  }
});
test('local policy excludes GB and a synthetic blocked address before POST', async () => {
  for (const [patch, expected] of [[{ region: 'GB' }, 'region_unavailable'],
    [{ refundTo: 'blocked.demo.invalid' }, 'address_restricted']]) {
    const { client, calls } = harness();
    await assert.rejects(client.quote({ ...INPUT, ...patch }), code(expected));
    assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  }
});
test('both canonical addresses reach sanctions hook; a slow check cannot use expired catalog', async () => {
  let seen; let now = NOW;
  const hooks = createLocalCompliance(policy);
  const { client } = harness({ clock: () => now, compliance: { ...hooks, sanctionsCheck: async addresses => {
    seen = addresses; now += 3600000; return true;
  } } });
  await assert.rejects(client.quote(INPUT), code('catalog_expired'));
  assert.deepEqual(seen, [{ blockchain: 'near', address: INPUT.refundTo }, { blockchain: 'base', address: INPUT.recipient }]);
});
