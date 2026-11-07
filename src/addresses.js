import { keccak_256 } from '@noble/hashes/sha3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { fail, requireThat } from './errors.js';

export const SUPPORTED_NETWORKS = Object.freeze({
  eth: 'evm', bsc: 'evm', base: 'evm', arb: 'evm', pol: 'evm', op: 'evm', avax: 'evm',
  sol: 'solana', near: 'near',
});

export function checksumEvmAddress(address) {
  requireThat(typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address), 'invalid_address');
  const lower = address.slice(2).toLowerCase();
  const hash = Buffer.from(keccak_256(new TextEncoder().encode(lower))).toString('hex');
  return '0x' + [...lower].map((c, i) => parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c).join('');
}

export function isNearAccountId(value) {
  return typeof value === 'string' && value.length >= 2 && value.length <= 64 &&
    /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/.test(value);
  // The grammar also includes lowercase 64-hex and 0x + 40-hex implicit accounts.
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function decodeSolanaAddress(address) {
  requireThat(typeof address === 'string' && address.length >= 32 && address.length <= 44, 'invalid_address');
  let n = 0n;
  for (const c of address) {
    const digit = BASE58.indexOf(c);
    requireThat(digit !== -1, 'invalid_address');
    n = n * 58n + BigInt(digit);
  }
  const bytes = [];
  while (n > 0n) { bytes.push(Number(n & 255n)); n >>= 8n; }
  bytes.reverse();
  const leading = address.match(/^1*/)[0].length;
  requireThat(leading + bytes.length === 32, 'invalid_address');
  return Uint8Array.from([...Array(leading).fill(0), ...bytes]);
}

export function normalizeAddress(blockchain, address) {
  requireThat(Object.hasOwn(SUPPORTED_NETWORKS, blockchain), 'unsupported_network');
  requireThat(typeof address === 'string' && address.length <= 64 && address === address.trim(), 'invalid_address');
  switch (SUPPORTED_NETWORKS[blockchain]) {
    case 'evm': {
      const checksummed = checksumEvmAddress(address);
      const body = address.slice(2);
      requireThat(body === body.toLowerCase() || body === body.toUpperCase() || address === checksummed, 'invalid_address');
      return checksummed;
    }
    case 'near':
      requireThat(isNearAccountId(address), 'invalid_address');
      return address;
    case 'solana':
      try { ed25519.Point.fromBytes(decodeSolanaAddress(address), false); }
      catch { fail('invalid_address'); }
      return address;
  }
}
