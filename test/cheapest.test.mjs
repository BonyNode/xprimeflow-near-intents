import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, createLocalCompliance, catalogSides, compareCheapest, multiChainSymbols } from '../src/index.js';
import { fixtureFetch } from '../demo/fixture-fetch.mjs';
import { TOKENS, NOW, policy, code } from './helpers.mjs';

const from = catalogSides(TOKENS).from.find(row => row.denom === 'near-native');
const input = { from, amount: '1000000000000000000000000', symbol: 'usdc', region: 'DE',
  addressByChain: { near: 'quote.demo.invalid', base: '0x1111111111111111111111111111111111111111', arb: '0x2222222222222222222222222222222222222222' } };
function fixture() {
  const calls = [];
  const client = createClient({ compliance: createLocalCompliance(policy), clock: () => NOW,
    fetchImpl: async (url, options) => { if (options.body) calls.push(JSON.parse(options.body)); return fixtureFetch(url, options); } });
  return { client, calls };
}

test('B ranks outputs, subtracts provider USD fields, and labels provided/quote price sources honestly', async () => {
  const { client, calls } = fixture();
  assert.deepEqual(multiChainSymbols(TOKENS), ['USDC']);
  const result = await compareCheapest(input, { client, networkPrice: async row => row.blockchain === 'base' ? '1.01' : null });
  assert.equal(result.dry, true); assert.equal(result.best.blockchain, 'arb');
  assert.deepEqual(result.rows.filter(row => row.status === 'ok').map(row => row.blockchain), ['arb', 'base', 'near']);
  const base = result.rows.find(row => row.blockchain === 'base');
  assert.equal(base.routeFeeUsd, '0.333655'); assert.equal(base.chainPriceUsd, '1.01'); assert.equal(base.priceSource, 'provided');
  const near = result.rows.find(row => row.blockchain === 'near');
  assert.equal(near.chainPriceUsd, '1'); assert.equal(near.priceSource, 'oneclick_quote');
  const polygon = result.rows.find(row => row.blockchain === 'pol');
  assert.equal(polygon.status, 'needs_wallet'); assert.equal(polygon.amountOut, undefined);
  assert.equal(calls.length, 3); assert.ok(calls.every(call => call.dry === true));
  assert.ok(calls.every(call => call.recipient === input.addressByChain[TOKENS.find(t => t.assetId === call.destinationAsset).blockchain]));
});

test('no source address rejects; missing/invalid destination address produces no provider quote', async () => {
  let s = fixture();
  await assert.rejects(compareCheapest({ ...input, addressByChain: {} }, s), code('needs_wallet'));
  assert.equal(s.calls.length, 0);
  s = fixture();
  const result = await compareCheapest({ ...input, addressByChain: { near: input.addressByChain.near, base: 'bad' } }, s);
  assert.equal(s.calls.length, 1); assert.equal(result.best.blockchain, 'near');
  assert.equal(result.rows.filter(row => row.status === 'needs_wallet').length, 3);
});

test('GB policy, wet mode and single-network symbols cannot cause a quote POST', async () => {
  const s = fixture();
  const result = await compareCheapest({ ...input, region: 'GB' }, s);
  assert.equal(result.best, null); assert.equal(s.calls.length, 0);
  assert.ok(result.rows.every(row => ['region_unavailable', 'needs_wallet'].includes(row.status)));
  await assert.rejects(compareCheapest({ ...input, dry: false }, s), code('invalid_input'));
  await assert.rejects(compareCheapest({ ...input, mode: 'other' }, s), code('mode_mismatch'));
  await assert.rejects(compareCheapest({ ...input, symbol: 'SOL' }, s), code('comparison_unavailable'));
  assert.equal(s.calls.length, 0);
});

test('ranking stays exact beyond Number precision and across different decimals; negative USD difference is preserved', async () => {
  const tokens = [TOKENS[0], { ...TOKENS[2], decimals: 18 }, { ...TOKENS[5], decimals: 18 }];
  const client = { getTokens: async () => ({ tokens }), quote: async request => {
    const destination = tokens.find(row => row.assetId === request.destinationAsset);
    return { dry: true, origin: tokens[0], destination, amountIn: request.amount,
      amountOut: destination.blockchain === 'base' ? '90071992547409931234567891' : '90071992547409931234567890',
      usdIn: '1', usdOut: '1.1', timeEstimate: 1 };
  } };
  let result = await compareCheapest(input, { client });
  assert.equal(result.best.blockchain, 'base'); assert.equal(result.rows[0].routeFeeUsd, '-0.1');
  tokens[2].decimals = 19;
  result = await compareCheapest(input, { client });
  assert.equal(result.best.blockchain, 'base');
});

test('at most eight routes and four simultaneous quotes; no provider payload escapes on failures', async () => {
  const tokens = [TOKENS[0], ...Array.from({ length: 10 }, (_, i) => ({ assetId: `nep141:token${i}.invalid`,
    blockchain: i % 2 ? 'base' : 'arb', symbol: 'DEMO', decimals: 6, contractAddress: '0x' + String(i + 1).padStart(40, '0') }))];
  let active = 0, max = 0, count = 0;
  const client = { getTokens: async () => ({ tokens }), quote: async request => {
    active++; max = Math.max(max, active); count++;
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    if (request.destinationAsset === 'nep141:token0.invalid') throw new Error('private upstream text');
    return { dry: true, origin: tokens[0], destination: tokens.find(row => row.assetId === request.destinationAsset),
      amountIn: request.amount, amountOut: '1000000', timeEstimate: 1 };
  } };
  const result = await compareCheapest({ ...input, symbol: 'DEMO' }, { client });
  assert.equal(count, 8); assert.equal(max, 4); assert.equal(result.omitted, 2);
  assert.equal(result.rows.at(-1).status, 'unavailable');
  assert.ok(!JSON.stringify(result).includes('private upstream text'));
  assert.equal(result.rows[0].chainPriceUsd, null);
});
