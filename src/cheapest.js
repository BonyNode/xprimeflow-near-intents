import { catalogSides, assertCatalogSide, walletAddress } from './swap-policy.js';
import { integerString, formatUnits } from './amounts.js';
import { requireThat } from './errors.js';
import { decimal, pricePerToken, subtractDecimal } from './decimal.js';

const symbolKey = text => typeof text === 'string' ? text.trim().toUpperCase() : '';
export function multiChainSymbols(tokens) {
  const networks = new Map();
  for (const row of catalogSides(tokens).to) {
    const symbol = symbolKey(row.symbol);
    if (!networks.has(symbol)) networks.set(symbol, new Set());
    networks.get(symbol).add(row.blockchain);
  }
  return [...networks].filter(([, chains]) => chains.size >= 2).map(([symbol]) => symbol).sort();
}

function amountOrder(a, b) {
  const left = BigInt(a.amountOut) * 10n ** BigInt(b.decimals);
  const right = BigInt(b.amountOut) * 10n ** BigInt(a.decimals);
  return left === right ? a.assetId.localeCompare(b.assetId) : left > right ? -1 : 1;
}

/** Only dry quotes; price data is an explicit dependency, not an internal feed. */
export async function compareCheapest(input, { client, networkPrice = async () => null } = {}) {
  requireThat(input && typeof input === 'object' && !Array.isArray(input));
  requireThat(client && typeof client.getTokens === 'function' && typeof client.quote === 'function');
  requireThat(input?.dry === undefined || input.dry === true);
  requireThat(input?.mode === undefined || input.mode === 'swap_any', 'mode_mismatch');
  requireThat(typeof networkPrice === 'function');
  const { tokens } = await client.getTokens();
  const from = { ...input.from };
  assertCatalogSide(from, 'from', tokens);
  const amount = integerString(input.amount, { positive: true });
  const target = symbolKey(input.symbol);
  requireThat(multiChainSymbols(tokens).includes(target), 'comparison_unavailable');
  const addresses = { ...input.addressByChain };
  requireThat(typeof addresses[from.blockchain] === 'string', 'needs_wallet');
  const refundTo = walletAddress(from.blockchain, addresses[from.blockchain]);
  const candidates = catalogSides(tokens).to.filter(row => symbolKey(row.symbol) === target && row.assetId !== from.assetId);
  const selected = candidates.slice(0, 8), rows = Array(selected.length);
  let next = 0;
  async function worker() {
    while (next < selected.length) {
      const i = next++, row = selected[i];
      let recipient;
      try { recipient = walletAddress(row.blockchain, addresses[row.blockchain]); }
      catch { rows[i] = { ...row, status: 'needs_wallet' }; continue; }
      try {
        const quote = await client.quote({ dry: true, originAsset: from.assetId, destinationAsset: row.assetId, amount,
          refundTo, recipient, region: input.region, slippageTolerance: input.slippageTolerance });
        requireThat(quote.dry === true && quote.amountIn === amount && quote.origin?.assetId === from.assetId &&
          quote.destination?.assetId === row.assetId && quote.destination.decimals === row.decimals, 'quote_mismatch');
        integerString(quote.amountOut, { positive: true });
        const usdIn = quote.usdIn ?? null, usdOut = quote.usdOut ?? null;
        if (usdIn !== null) decimal(usdIn, { positive: true });
        if (usdOut !== null) decimal(usdOut);
        let supplied = null;
        try {
          supplied = await networkPrice(Object.freeze({ ...row }));
          if (supplied !== null) decimal(supplied, { positive: true });
        } catch { supplied = null; }
        const quotePrice = usdOut === null ? null : pricePerToken(usdOut, quote.amountOut, row.decimals);
        rows[i] = { ...row, status: 'ok', amountOut: quote.amountOut, tokensOut: formatUnits(quote.amountOut, row.decimals),
          usdIn, usdOut, routeFeeUsd: usdIn === null || usdOut === null ? null : subtractDecimal(usdIn, usdOut),
          chainPriceUsd: supplied ?? quotePrice,
          priceSource: supplied !== null ? 'provided' : quotePrice !== null ? 'oneclick_quote' : null,
          effectivePriceUsd: usdIn === null ? null : pricePerToken(usdIn, quote.amountOut, row.decimals),
          timeEstimate: quote.timeEstimate };
      } catch (error) {
        const code = ['region_unavailable', 'address_restricted', 'quote_mismatch'].includes(error?.code) ? error.code : 'unavailable';
        rows[i] = { ...row, status: code };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, worker));
  const quoted = rows.filter(row => row.status === 'ok').sort(amountOrder);
  return { dry: true, symbol: target, from, amountIn: amount, omitted: Math.max(0, candidates.length - selected.length),
    rows: [...quoted, ...rows.filter(row => row.status !== 'ok')],
    best: quoted[0] ? { blockchain: quoted[0].blockchain, assetId: quoted[0].assetId, denom: quoted[0].denom } : null };
}
