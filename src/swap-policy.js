import { SUPPORTED_NETWORKS, isNearAccountId, normalizeAddress } from './addresses.js';
import { requireThat } from './errors.js';

export const NEAR_NATIVE = 'near-native';
export const STORAGE_LIMIT = 10n ** 22n; // 0.01 NEAR; storage minimum is supplied by the caller.
export const nearAccount = isNearAccountId;
const native = 'native';
// Public protocol identifiers, not a price feed or a user's holdings.
const knownSources = [
  ['base', 'nep141:base.omft.near', native, 18],
  ['arb', 'nep141:arb.omft.near', native, 18],
  ['sol', 'nep141:sol.omft.near', native, 9],
  ['base', 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 6],
  ['arb', 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near', '0xaf88d065e77c8cc2239327c5edb3a432268e5831', 6],
  ['sol', 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6],
];

export function validAssetId(value) {
  if (typeof value !== 'string' || value.length > 160) return false;
  const [standard, contract, ...parts] = value.split(':');
  if (standard === 'nep141') return parts.length === 0 && isNearAccountId(contract);
  if (standard === 'nep245') return isNearAccountId(contract) && parts.length === 1 && /^[A-Za-z0-9_.-]{1,96}$/.test(parts[0]);
  return standard === '1cs_v1' && /^[a-z0-9-]{2,24}$/.test(contract) && parts.length >= 2 &&
    /^[a-z0-9-]{2,24}$/.test(parts[0]) && /^[A-Za-z0-9._:-]{1,100}$/.test(parts.slice(1).join(':'));
}

export function canonicalDenom(network, value) {
  return SUPPORTED_NETWORKS[network] === 'evm' && typeof value === 'string' ? value.toLowerCase() : value;
}

export function swapAnySide(side, role) {
  if (!['from', 'to'].includes(role) || !side || !Object.hasOwn(SUPPORTED_NETWORKS, side.blockchain) ||
      !validAssetId(side.assetId) || typeof side.denom !== 'string' || !side.denom.length || side.denom.length > 256 ||
      !Number.isInteger(side.decimals) || side.decimals < 0 || side.decimals > 36) return false;
  if (role === 'to') return side.denom !== NEAR_NATIVE;
  if (side.blockchain === 'near') {
    if (side.denom === NEAR_NATIVE) return side.assetId === 'nep141:wrap.near' && side.decimals === 24;
    return isNearAccountId(side.denom) && side.assetId === `nep141:${side.denom}`;
  }
  return knownSources.some(([network, id, denom, decimals]) => side.blockchain === network &&
    side.assetId === id && canonicalDenom(network, side.denom) === denom && side.decimals === decimals);
}

/** A destination's identity comes from its catalog row, never from its symbol. */
export function catalogSides(tokens) {
  const from = [], to = [];
  for (const token of tokens) {
    let denom = token.contractAddress;
    if (!denom && token.blockchain === 'near' && token.assetId?.startsWith('nep141:')) denom = token.assetId.slice(7);
    if (!denom) denom = knownSources.find(([network, id]) => network === token.blockchain && id === token.assetId)?.[2] ?? token.assetId;
    if (/^0x(?:0{40}|e{40})$/i.test(denom)) denom = native;
    const side = Object.freeze({ blockchain: token.blockchain, assetId: token.assetId,
      denom: canonicalDenom(token.blockchain, denom), decimals: token.decimals, symbol: token.symbol });
    if (swapAnySide(side, 'to')) to.push(side);
    if (swapAnySide(side, 'from')) from.push(side);
    if (side.blockchain === 'near' && side.assetId === 'nep141:wrap.near' && side.denom === 'wrap.near' && side.decimals === 24) {
      from.push(Object.freeze({ ...side, denom: NEAR_NATIVE, symbol: 'NEAR' }));
    }
  }
  return Object.freeze({ from: Object.freeze(from), to: Object.freeze(to) });
}

export function sameSide(a, b) {
  return !!a && !!b && a.blockchain === b.blockchain && a.assetId === b.assetId && a.decimals === b.decimals &&
    canonicalDenom(a.blockchain, a.denom) === canonicalDenom(b.blockchain, b.denom);
}

export function assertCatalogSide(side, role, tokens) {
  requireThat(swapAnySide(side, role) && catalogSides(tokens)[role].some(row => sameSide(side, row)), 'catalog_mismatch');
  return side;
}

export function walletAddress(network, value) {
  const normalized = normalizeAddress(network, value);
  requireThat(!/^0x(?:0{40}|0{36}dead)$/i.test(normalized), 'invalid_address');
  return normalized;
}
