import { readFile } from 'node:fs/promises';
import { IntentsError } from '../src/index.js';

const fixtures = new URL('../test/fixtures/', import.meta.url);
const tokens = JSON.parse(await readFile(new URL('tokens.json', fixtures), 'utf8'));
const quote = JSON.parse(await readFile(new URL('quote.json', fixtures), 'utf8'));

export async function fixtureFetch(url, options) {
  const path = new URL(url).pathname;
  if (path === '/v0/tokens' && options.method === 'GET') return Response.json(tokens);
  if (path === '/v0/quote' && options.method === 'POST') {
    const request = JSON.parse(options.body);
    for (const key of ['dry', 'swapType', 'originAsset', 'amount', 'slippageTolerance']) {
      if (request[key] !== quote.quoteRequest[key]) throw new IntentsError('invalid_input');
    }
    const target = tokens.find(t => t.assetId === request.destinationAsset && t.symbol === 'USDC');
    const amounts = { base: ['3666345', '3629681'], arb: ['3700000', '3663000'], near: ['3600000', '3564000'], pol: ['3680000', '3643200'] };
    if (!target || !amounts[target.blockchain]) throw new IntentsError('invalid_input');
    const [amountOut, minAmountOut] = amounts[target.blockchain];
    // Base quantity is the recorded sample; other outputs and all USD fields are
    // synthetic comparison fixtures. They are never labelled as current prices.
    return Response.json({ quoteRequest: { ...request, appFees: quote.quoteRequest.appFees ?? [] }, quote: {
      ...quote.quote, amountOut, minAmountOut, amountInUsd: '4',
      amountOutUsd: `${amountOut.slice(0, -6)}.${amountOut.slice(-6)}`,
    } });
  }
  throw new IntentsError('invalid_input');
}
