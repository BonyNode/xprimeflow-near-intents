import { normalizeAddress } from './addresses.js';
import { integerString } from './amounts.js';
import { fail, requireThat } from './errors.js';
import { validateMemo } from './near-deposit.js';
import { decimal } from './decimal.js';

export function deadlineMs(value, code = 'invalid_input') {
  requireThat(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value), code);
  const ms = Date.parse(value);
  requireThat(Number.isFinite(ms), code);
  // Date.parse may normalize impossible calendar dates; require an exact round trip.
  requireThat(new Date(ms).toISOString().replace(/\.000Z$/, 'Z') ===
    value.replace(/\.(\d{1,3})Z$/, (_, n) => `.${n.padEnd(3, '0')}Z`).replace(/\.000Z$/, 'Z'), code);
  return ms;
}

export function buildQuoteRequest(input, tokens, now) {
  requireThat(input && typeof input === 'object' && !Array.isArray(input));
  requireThat(input.dry === undefined || input.dry === true);
  requireThat(input.swapType === undefined || input.swapType === 'EXACT_INPUT');
  const origin = tokens.find(t => t.assetId === input.originAsset);
  const destination = tokens.find(t => t.assetId === input.destinationAsset);
  requireThat(origin && destination, 'unknown_asset');
  requireThat(origin.assetId !== destination.assetId);
  const amount = integerString(input.amount, { positive: true });
  const slippageTolerance = input.slippageTolerance ?? 100;
  requireThat(Number.isInteger(slippageTolerance) && slippageTolerance >= 0 && slippageTolerance <= 10000);
  const refundTo = normalizeAddress(origin.blockchain, input.refundTo);
  const recipient = normalizeAddress(destination.blockchain, input.recipient);
  const expires = input.deadline === undefined ? now + 10 * 60 * 1000 : deadlineMs(input.deadline);
  requireThat(expires > now && expires <= now + 24 * 60 * 60 * 1000);
  const request = Object.freeze({
    dry: true, swapType: 'EXACT_INPUT', slippageTolerance,
    originAsset: origin.assetId, depositType: 'ORIGIN_CHAIN',
    destinationAsset: destination.assetId, amount,
    refundTo, refundType: 'ORIGIN_CHAIN', recipient, recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(expires).toISOString(),
  });
  return { request, origin, destination };
}

export function normalizeQuote(raw, { request, origin, destination }, now) {
  const echo = raw?.quoteRequest;
  const q = raw?.quote;
  requireThat(echo && q && typeof echo === 'object' && typeof q === 'object', 'provider_invalid_response');
  for (const key of ['dry', 'swapType', 'slippageTolerance', 'originAsset', 'depositType',
    'destinationAsset', 'amount', 'refundType', 'recipientType']) {
    requireThat(echo[key] === request[key], 'quote_mismatch');
  }
  try {
    requireThat(normalizeAddress(origin.blockchain, echo.refundTo) === request.refundTo, 'quote_mismatch');
    requireThat(normalizeAddress(destination.blockchain, echo.recipient) === request.recipient, 'quote_mismatch');
    requireThat(deadlineMs(echo.deadline) === deadlineMs(request.deadline), 'quote_mismatch');
  } catch { fail('quote_mismatch'); }
  // 1Click may add its default fee to the echoed request even when appFees was
  // omitted. Validate and surface it, rather than hardcoding a fee schedule.
  const appFees = echo.appFees ?? [];
  requireThat(Array.isArray(appFees) && appFees.length <= 100, 'provider_invalid_response');
  let appFeeBps = 0;
  for (const item of appFees) {
    requireThat(item && Number.isInteger(item.fee) && item.fee >= 0 && item.fee <= 10000, 'provider_invalid_response');
    try { normalizeAddress('near', item.recipient); } catch { fail('provider_invalid_response'); }
    appFeeBps += item.fee;
  }
  requireThat(appFeeBps <= 10000, 'provider_invalid_response');
  // Routing instructions that we did not request remain forbidden.
  for (const key of ['virtualChainRecipient', 'virtualChainRefundRecipient', 'customRecipientMsg']) {
    requireThat(echo[key] === undefined || echo[key] === null || echo[key] === '', 'quote_mismatch');
  }
  requireThat(deadlineMs(request.deadline) > now, 'quote_mismatch');
  const amountIn = integerString(q.amountIn, { positive: true, code: 'provider_invalid_response' });
  requireThat(amountIn === request.amount, 'quote_mismatch');
  const amountOut = integerString(q.amountOut, { positive: true, code: 'provider_invalid_response' });
  const minAmountOut = integerString(q.minAmountOut, { code: 'provider_invalid_response' });
  requireThat(BigInt(amountOut) >= BigInt(minAmountOut), 'provider_invalid_response');
  requireThat(typeof q.timeEstimate === 'number' && Number.isFinite(q.timeEstimate) && q.timeEstimate >= 0, 'provider_invalid_response');
  const fees = { appFeeBps };
  for (const name of ['refundFee', 'withdrawFee']) {
    fees[name] = q[name] == null ? null : integerString(q[name], { code: 'provider_invalid_response' });
  }
  // These may be absent for dry quotes. Never invent a provider deadline or deposit.
  for (const name of ['deadline', 'timeWhenInactive']) {
    if (q[name] != null) {
      const t = deadlineMs(q[name], 'provider_invalid_response');
      requireThat(t > now && t <= deadlineMs(request.deadline), 'provider_invalid_response');
    }
  }
  const memo = validateMemo(q.depositMemo ?? undefined, 'provider_invalid_response');
  const usd = name => {
    if (q[name] == null) return null;
    // Preserve decimal strings: do not rank routes or subtract fees in binary floats.
    const value = typeof q[name] === 'number' && Number.isFinite(q[name]) ? String(q[name]) : q[name];
    decimal(value, { code: 'provider_invalid_response' });
    return value;
  };
  return Object.freeze({
    dry: true, request, origin, destination, amountIn, amountOut, minAmountOut,
    timeEstimate: q.timeEstimate, fees: Object.freeze(fees), usdIn: usd('amountInUsd'), usdOut: usd('amountOutUsd'),
    providerDeadline: q.deadline ?? null, timeWhenInactive: q.timeWhenInactive ?? null,
    depositAddress: null, depositMemo: memo ?? null,
  });
}
