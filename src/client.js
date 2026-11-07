import { createTransport } from './http.js';
import { createCatalog } from './catalog.js';
import { buildQuoteRequest, normalizeQuote, deadlineMs } from './quote.js';
import { normalizeAddress } from './addresses.js';
import { checkCompliance, requireComplianceHooks } from './compliance.js';
import { normalizeStatusResponse } from './status.js';
import { validateMemo } from './near-deposit.js';
import { requireThat } from './errors.js';

export function createClient({ compliance, fetchImpl, jwt, timeoutMs, clock = Date.now } = {}) {
  requireComplianceHooks(compliance);
  requireThat(typeof clock === 'function');
  const request = createTransport({ fetchImpl, jwt, timeoutMs });
  const getTokens = createCatalog(request, clock);
  return Object.freeze({
    getTokens,
    async quote(input) {
      const snapshot = { ...input };
      const catalog = await getTokens();
      const prepared = buildQuoteRequest(snapshot, catalog.tokens, clock());
      await checkCompliance(compliance, snapshot.region, [
        { blockchain: prepared.origin.blockchain, address: prepared.request.refundTo },
        { blockchain: prepared.destination.blockchain, address: prepared.request.recipient },
      ]);
      requireThat(clock() < catalog.expiresAt, 'catalog_expired');
      requireThat(clock() < deadlineMs(prepared.request.deadline));
      const raw = await request('/v0/quote', prepared.request);
      return normalizeQuote(raw, prepared, clock());
    },
    async getStatus({ blockchain, depositAddress, depositMemo, region }) {
      const normalized = normalizeAddress(blockchain, depositAddress);
      validateMemo(depositMemo);
      await checkCompliance(compliance, region, [{ blockchain, address: normalized }]);
      const search = new URLSearchParams({ depositAddress: normalized });
      if (depositMemo !== undefined) search.set('depositMemo', depositMemo);
      const raw = await request(`/v0/status?${search}`);
      return normalizeStatusResponse(raw, { blockchain, depositAddress: normalized, depositMemo });
    },
  });
}
