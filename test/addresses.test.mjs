import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAddress, isNearAccountId, checksumEvmAddress, parseUnits, formatUnits } from '../src/index.js';
import { code } from './helpers.mjs';

const checksummed = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
test('EVM: EIP-55 vectors, normalization and invalid mixed case', () => {
  assert.equal(checksumEvmAddress(checksummed.toLowerCase()), checksummed);
  assert.equal(normalizeAddress('eth', checksummed), checksummed);
  assert.equal(normalizeAddress('base', checksummed.toLowerCase()), checksummed);
  assert.throws(() => normalizeAddress('eth', checksummed.replace('Aeb', 'aeb')), code('invalid_address'));
  for (const address of ['0x1234', checksummed + ' ', '0X' + checksummed.slice(2), '0x' + 'g'.repeat(40)]) {
    assert.throws(() => normalizeAddress('eth', address), code('invalid_address'));
  }
});
test('Solana: canonical base58 32-byte on-curve point; reject off-curve and malformed', () => {
  const valid = '13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK';
  assert.equal(normalizeAddress('sol', valid), valid);
  // All-0xff bytes are not a canonical compressed Edwards point.
  for (const invalid of ['JEKNVnkbo3jma5nREBBJCDoXFVeKkD56V3xKrvRmWxFG', '0'.repeat(32), '1'.repeat(33), valid + '1']) {
    assert.throws(() => normalizeAddress('sol', invalid), code('invalid_address'));
  }
});
test('NEAR: named, subaccounts, implicit and ETH-implicit; exact length/grammar', () => {
  for (const account of ['aa', 'alice.near', 'a-b.c_d.near', 'a'.repeat(64), 'ab'.repeat(32), '0x' + 'ab'.repeat(20)]) {
    assert.equal(isNearAccountId(account), true);
    assert.equal(normalizeAddress('near', account), account);
  }
  for (const account of ['a', 'a'.repeat(65), 'Alice.near', '-ab', 'ab-', 'a..b', 'a__b', 'a-_b', 'a._b', 'a@b', 'a b', 'аlice.near']) {
    assert.equal(isNearAccountId(account), false);
    assert.throws(() => normalizeAddress('near', account), code('invalid_address'));
  }
  assert.throws(() => normalizeAddress('btc', 'anything'), code('unsupported_network'));
});
test('amounts remain exact integer strings above Number.MAX_SAFE_INTEGER', () => {
  assert.equal(parseUnits('1.000000000000000000000001', 24), '1000000000000000000000001');
  assert.equal(formatUnits('1000000000000000000000001', 24), '1.000000000000000000000001');
  assert.equal(parseUnits('0.000001', 6), '1');
  for (const value of ['0', '-1', '1e6', '01', '1.', ' 1', '1.0000001']) assert.throws(() => parseUnits(value, 6), code('invalid_input'));
});
