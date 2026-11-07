import test from 'node:test';
import assert from 'node:assert/strict';
import { createDepositAttempt } from '../src/index.js';
import { createNearWallet } from '../examples/near-wallet.js';
import { code } from './helpers.mjs';

test('only an explicit user rejection AND acknowledged release unlocks the claim', async () => {
  for (const [failure, acknowledged, expected] of [
    [{ code: 'user_rejected' }, true, 'released'], [{ code: 'user_rejected' }, false, 'unknown'],
    [{ code: 'wallet_error', message: 'private payload' }, true, 'unknown'],
    [new Error('Wallet closed'), true, 'unknown'],
  ]) {
    let releases = 0, sends = 0;
    const attempt = createDepositAttempt({ claim: async () => 'fixture-claim',
      release: async receipt => { releases++; assert.equal(receipt, 'fixture-claim'); return acknowledged; },
      send: async () => { sends++; throw failure; } });
    assert.equal((await attempt.run({})).state, expected);
    assert.equal(releases, failure.code === 'user_rejected' ? 1 : 0);
    await assert.rejects(attempt.run({}), code('attempt_locked'));
    assert.equal(sends, 1);
  }
});

test('claim loss, invalid hash and release failure retain unknown; concurrent run cannot send twice', async () => {
  let sends = 0;
  const lost = createDepositAttempt({ claim: async () => { throw new Error(); }, release: async () => true, send: async () => { sends++; } });
  assert.equal((await lost.run({})).state, 'unknown'); assert.equal(sends, 0);
  for (const result of [{ txHash: 'invalid' }, { txHash: '1'.repeat(43) }]) {
    const attempt = createDepositAttempt({ claim: async () => 'fixture', release: async () => true, send: async () => result });
    const first = attempt.run({}); await assert.rejects(attempt.run({}), code('attempt_locked'));
    assert.equal((await first).state, result.txHash === 'invalid' ? 'unknown' : 'submitted');
  }
  const attempt = createDepositAttempt({ claim: async () => 'fixture', release: async () => { throw new Error(); },
    send: async () => { throw { code: 'user_rejected' }; } });
  assert.equal((await attempt.run({})).state, 'unknown');
});

test('optional wallet example is lazy, mainnet, nonce-aware, non-modal for account, and forwards actions unchanged', async () => {
  const options = [], sent = [];
  const wallet = { manifest: { features: { signAndSendTransaction: true } }, getAccounts: async () => [{ accountId: 'fixture.invalid' }],
    signAndSendTransaction: async tx => { sent.push(tx); return { transaction_outcome: { id: '1'.repeat(43) } }; } };
  let choose = 0;
  class Connector { constructor(opts) { options.push(opts); } async connect() { choose++; return wallet; }
    async getConnectedWallet() { return { wallet, accounts: await wallet.getAccounts() }; } async disconnect() {} }
  const api = createNearWallet(Connector, { cspNonce: 'fixtureNonce1234567890' });
  assert.equal(options.length, 0); await api.account(); assert.equal(choose, 0);
  assert.equal(options[0].network, 'mainnet'); assert.equal(options[0].cspNonce, 'fixtureNonce1234567890');
  assert.equal(options[0].autoConnect, false); await api.connect(); assert.equal(options.length, 1);
  const actions = [{ type: 'Transfer', params: { deposit: '1000000000000000000000000' } }];
  assert.equal((await api.signAndSendTransaction({ receiverId: 'fixture.invalid', actions })).txHash, '1'.repeat(43));
  assert.equal(sent[0].actions, actions);
  wallet.signAndSendTransaction = async () => { throw { code: 4001, message: 'private payload' }; };
  await assert.rejects(api.signAndSendTransaction({ receiverId: 'fixture.invalid', actions }), e => e.code === 'user_rejected' && e.message === 'user_rejected');
});
