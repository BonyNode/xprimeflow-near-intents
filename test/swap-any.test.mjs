import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogSides, swapAnySide, validAssetId, nearAccount, assertShownSelection, assertShownDeal,
  assertSwapAnyDeposit, nearDeposit, buildNearDeposit, STORAGE_LIMIT } from '../src/index.js';
import { TOKENS, NOW, code } from './helpers.mjs';

const sides = catalogSides(TOKENS);
const from = sides.from.find(row => row.denom === 'near-native');
const to = sides.to.find(row => row.blockchain === 'base');
const amount = '1000000000000000000000000';
const selection = { mode: 'swap_any', from, to, amount };
const valid = () => ({ mode: 'swap_any', from, to, amountIn: amount, amountOut: '3666345', minAmountOut: '3629681',
  refundTo: 'quote.demo.invalid', recipient: '0x1111111111111111111111111111111111111111',
  depositAddress: 'deposit.demo.invalid', depositMemo: null, storageDeposit: null,
  issuedAt: NOW, deadline: new Date(NOW + 600000).toISOString(), retainUntil: NOW + 86400000 });

test('source policy is closed; destinations accept all three catalog ID formats without trusting ticker', () => {
  assert.ok(nearAccount('named-account.near')); assert.ok(nearAccount('a'.repeat(64)));
  assert.ok(nearAccount('0x' + '1'.repeat(40)));
  for (const value of ['Upper.near', 'a..near', '-bad.near', 'x']) assert.equal(nearAccount(value), false);
  for (const row of sides.to) assert.equal(validAssetId(row.assetId), true);
  assert.ok(sides.to.some(row => row.assetId.startsWith('nep245:')));
  assert.ok(sides.to.some(row => row.assetId.startsWith('1cs_v1:')));
  for (const role of ['from', 'to']) assert.equal(swapAnySide({ ...to, blockchain: 'btc' }, role), false);
  assert.equal(swapAnySide({ ...to, assetId: 'nep141:fake.invalid' }, 'from'), false);
  assert.equal(swapAnySide({ ...to, decimals: 18 }, 'from'), false);
  assert.equal(swapAnySide(sides.to.find(row => row.blockchain === 'pol'), 'from'), false);
  assert.equal(swapAnySide(from, 'to'), false, 'NEAR native alias is source-only');
  assert.equal(swapAnySide(from, 'unknown'), false);
  for (const id of ['nep141:', 'nep245:bad..near:1', '1cs_v1:a:erc20:abc', 'nep141:wrap.near\n']) assert.equal(validAssetId(id), false);
});

test('shown selection binds catalog ID, denomination, decimals, network, exact amount and mode', () => {
  const q = valid(); assert.equal(assertShownDeal(q, selection, TOKENS, { now: NOW }), q);
  for (const role of ['from', 'to']) for (const [field, value] of Object.entries({ assetId: 'nep141:other.invalid',
    denom: 'other.invalid', decimals: q[role].decimals + 1, blockchain: 'arb' })) {
    const changed = structuredClone(q); changed[role][field] = value;
    assert.throws(() => assertShownSelection(changed, selection, TOKENS), code('catalog_mismatch'));
  }
  assert.throws(() => assertShownSelection({ ...q, amountIn: amount + '0' }, selection, TOKENS), code('catalog_mismatch'));
  for (const mode of [undefined, 'verified', 'swap-any', null]) assert.throws(() => assertShownSelection({ ...q, mode }, selection, TOKENS), code('mode_mismatch'));
  const updated = TOKENS.map(row => row.assetId === from.assetId ? { ...row, decimals: 18 } : row);
  assert.throws(() => assertShownSelection(q, selection, updated), code('catalog_mismatch'));
});

test('NEAR native is exactly one Transfer; existing wNEAR and NEP-141 are two calls with storage cap', () => {
  const q = valid(), snapshot = JSON.stringify(q);
  assert.deepEqual(nearDeposit(q, { now: NOW }), { receiverId: q.depositAddress, actions: [{ type: 'Transfer', params: { deposit: amount } }] });
  for (const ft of sides.from.filter(row => row.blockchain === 'near' && row.denom !== 'near-native')) {
    const deal = { ...q, from: ft, storageDeposit: STORAGE_LIMIT.toString() };
    const tx = nearDeposit(deal, { now: NOW });
    assert.equal(tx.receiverId, ft.denom);
    assert.deepEqual(tx.actions.map(a => a.params.methodName), ['storage_deposit', 'ft_transfer']);
    assert.deepEqual(tx.actions[0].params.args, { account_id: q.depositAddress, registration_only: true });
    assert.equal(tx.actions[1].params.deposit, '1');
    assert.ok(tx.actions.every(a => a.params.gas === '30000000000000'));
    for (const bad of [undefined, '0', (STORAGE_LIMIT + 1n).toString()]) assert.throws(() => nearDeposit({ ...deal, storageDeposit: bad }, { now: NOW }));
  }
  assert.equal(JSON.stringify(q), snapshot);
  assert.throws(() => buildNearDeposit({ token: TOKENS[0], denom: 'near-native', amount, depositAddress: q.depositAddress, storageDepositYocto: '1' }));
});

test('invalid time windows, amounts, deposits and unexpected memo/storage fail before construction', () => {
  const q = valid();
  for (const patch of [
    { deadline: new Date(NOW + 600001).toISOString() }, { issuedAt: NOW + 1 }, { retainUntil: NOW + 86400001 },
    { retainUntil: NOW + 100 }, { amountIn: '01' }, { amountIn: (1n << 128n).toString() },
    { amountIn: 1 }, { minAmountOut: '9999999' }, { depositAddress: q.refundTo },
    { depositAddress: '0x' + '0'.repeat(40) }, { recipient: 'bad' }, { depositMemo: 'memo' }, { storageDeposit: '1' },
  ]) assert.throws(() => assertSwapAnyDeposit({ ...q, ...patch }, { now: NOW }));
  assert.throws(() => assertSwapAnyDeposit(q, { now: NOW + 600000 }), code('deal_expired'));
  assert.equal(assertSwapAnyDeposit(q, { now: NOW + 600000, allowExpired: true }), q);
  assert.throws(() => nearDeposit(q, { now: NOW + 600000, allowExpired: true }), code('deal_expired'));
  assert.throws(() => assertSwapAnyDeposit(q, { now: q.retainUntil, allowExpired: true }), code('deal_expired'));
});

test('Solana permits a bounded memo and a provider PDA; EVM/NEAR never accept a memo', () => {
  const sol = sides.from.find(row => row.blockchain === 'sol');
  const deal = { ...valid(), from: sol, amountIn: '1000000000', refundTo: '13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK',
    depositAddress: 'JEKNVnkbo3jma5nREBBJCDoXFVeKkD56V3xKrvRmWxFG', depositMemo: 'é'.repeat(64) };
  assert.equal(assertSwapAnyDeposit(deal, { now: NOW }), deal);
  for (const memo of ['', 'é'.repeat(65), 'bad\n']) assert.throws(() => assertSwapAnyDeposit({ ...deal, depositMemo: memo }, { now: NOW }));
  assert.throws(() => assertSwapAnyDeposit({ ...deal, amountIn: (1n << 64n).toString() }, { now: NOW }));
});
