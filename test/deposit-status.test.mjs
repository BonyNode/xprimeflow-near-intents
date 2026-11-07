import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNearDeposit, normalizeStatus } from '../src/index.js';
import { TOKENS, STATUS, harness, code } from './helpers.mjs';

const base = { token: TOKENS[0], amount: '1000000000000000000000000',
  depositAddress: 'deposit.demo.invalid', storageDepositYocto: '1250000000000000000000' };
test('existing wNEAR: storage registration → transfer, no automatic wrapping', () => {
  const tx = buildNearDeposit(base);
  assert.equal(tx.receiverId, 'wrap.near');
  assert.deepEqual(tx.actions.map(a => a.params.methodName), ['storage_deposit', 'ft_transfer']);
  assert.deepEqual(tx.actions.map(a => a.params.deposit), [base.storageDepositYocto, '1']);
  assert.deepEqual(tx.actions[0].params.args, { account_id: base.depositAddress, registration_only: true });
  assert.deepEqual(tx.actions[1].params.args, { receiver_id: base.depositAddress, amount: base.amount });
  assert.ok(tx.actions.every(a => a.type === 'FunctionCall' && a.params.gas === '30000000000000'));
  assert.deepEqual(buildNearDeposit(base), buildNearDeposit(base));
  assert.throws(() => { tx.actions[0].params.deposit = '1'; });
});
test('NEAR USDC: token contract storage → transfer without wrapping native NEAR', () => {
  const tx = buildNearDeposit({ ...base, token: TOKENS[1], amount: '1000000' });
  assert.equal(tx.receiverId, TOKENS[1].contractAddress);
  assert.deepEqual(tx.actions.map(a => a.params.methodName), ['storage_deposit', 'ft_transfer']);
  assert.equal(tx.actions[1].params.deposit, '1');
  assert.equal(Object.hasOwn(tx.actions[1].params.args, 'memo'), false);
});
test('deposit builder rejects malformed route, missing storage, decimals, amount or memo', () => {
  for (const patch of [{ token: TOKENS[2] }, { token: { ...TOKENS[0], contractAddress: 'other.near' } },
    { token: { ...TOKENS[0], decimals: 18 } }, { amount: '0' }, { amount: String(1n << 128n) },
    { amount: 1 }, { storageDepositYocto: undefined }, { memo: '\n' }, { memo: 'é'.repeat(129) }]) {
    assert.throws(() => buildNearDeposit({ ...base, ...patch }), code('invalid_input'));
  }
  assert.throws(() => buildNearDeposit({ ...base, depositAddress: 'UPPER.near' }), code('invalid_address'));
});
test('all status states are normalized; unknown/incomplete never imply success', () => {
  const cases = { PENDING_DEPOSIT: ['awaiting_deposit', false], KNOWN_DEPOSIT_TX: ['deposit_detected', false],
    INCOMPLETE_DEPOSIT: ['incomplete_deposit', false], PROCESSING: ['processing', false],
    SUCCESS: ['succeeded', true], REFUNDED: ['refunded', true], FAILED: ['failed', true], NEW_STATE: ['unknown', false] };
  for (const [state, [normalized, terminal]] of Object.entries(cases)) {
    const r = normalizeStatus(state); assert.equal(r.state, normalized); assert.equal(r.terminal, terminal);
    assert.equal(r.succeeded, state === 'SUCCESS');
  }
});
test('status GET encodes address/memo and binds the returned deposit', async () => {
  const { client, calls } = harness();
  const result = await client.getStatus({ blockchain: 'near', depositAddress: base.depositAddress, depositMemo: 'demo-memo', region: 'DE' });
  assert.equal(result.state, 'processing');
  assert.equal(JSON.stringify(result).includes(base.depositAddress), false);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/v0/status'); assert.equal(calls[0].method, 'GET');
  assert.equal(url.searchParams.get('depositMemo'), 'demo-memo');
});
test('status refuses wrong address, missing/wrong memo and missing binding', async () => {
  for (const patch of [{ depositAddress: 'other.demo.invalid', depositMemo: 'demo-memo' },
    { depositAddress: base.depositAddress }, { depositAddress: base.depositAddress, depositMemo: 'wrong' }]) {
    await assert.rejects(harness().client.getStatus({ blockchain: 'near', region: 'DE', ...patch }), code('status_mismatch'));
  }
  const status = structuredClone(STATUS); delete status.quoteResponse;
  await assert.rejects(harness({ status }).client.getStatus({ blockchain: 'near', region: 'DE', depositAddress: base.depositAddress }), code('status_mismatch'));
});
