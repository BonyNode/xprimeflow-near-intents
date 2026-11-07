import { fail, requireThat } from './errors.js';

export const CATALOG_TTL_MS = 60 * 60 * 1000;
export function normalizeCatalog(raw) {
  requireThat(Array.isArray(raw) && raw.length > 0 && raw.length <= 10000, 'invalid_catalog');
  const ids = new Set();
  return Object.freeze(raw.map(row => {
    requireThat(row && typeof row === 'object' && !Array.isArray(row), 'invalid_catalog');
    const { assetId, blockchain, symbol, decimals } = row;
    requireThat(typeof assetId === 'string' && assetId.length > 0 && assetId.length <= 256 && !/\s/.test(assetId), 'invalid_catalog');
    requireThat(!ids.has(assetId), 'invalid_catalog'); ids.add(assetId);
    requireThat(typeof blockchain === 'string' && /^[a-z0-9_-]{1,32}$/.test(blockchain), 'invalid_catalog');
    requireThat(typeof symbol === 'string' && symbol.length > 0 && symbol.length <= 64 && !/[\u0000-\u001f\u007f]/.test(symbol), 'invalid_catalog');
    requireThat(Number.isInteger(decimals) && decimals >= 0 && decimals <= 255, 'invalid_catalog');
    const contractAddress = row.contractAddress ?? null;
    requireThat(contractAddress === null || (typeof contractAddress === 'string' && contractAddress.length > 0 && contractAddress.length <= 256), 'invalid_catalog');
    return Object.freeze({ assetId, blockchain, symbol, decimals, contractAddress });
  }));
}

export function createCatalog(request, clock = Date.now) {
  let cache;
  let loading;
  return async function getTokens() {
    if (cache && clock() < cache.expiresAt) return cache;
    cache = undefined; // A failed refresh never exposes an expired catalog.
    if (!loading) {
      const startedAt = clock();
      loading = (async () => {
        const tokens = normalizeCatalog(await request('/v0/tokens'));
        const expiresAt = startedAt + CATALOG_TTL_MS;
        if (clock() >= expiresAt) fail('catalog_expired');
        cache = Object.freeze({ tokens, expiresAt });
        return cache;
      })().finally(() => { loading = undefined; });
    }
    const result = await loading;
    if (clock() >= result.expiresAt) fail('catalog_expired');
    return result;
  };
}
