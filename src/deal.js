import { decodeSolanaAddress } from './addresses.js';
import { integerString, UINT128_MAX, UINT256_MAX } from './amounts.js';
import { requireThat } from './errors.js';
import { deadlineMs } from './quote.js';
import { buildNearDeposit } from './near-deposit.js';
import { NEAR_NATIVE, STORAGE_LIMIT, swapAnySide, walletAddress, canonicalDenom, assertCatalogSide, sameSide } from './swap-policy.js';

export function assertShownSelection(deal, shown, tokens) {
  requireThat(shown?.mode === 'swap_any' && deal?.mode === shown.mode, 'mode_mismatch');
  for (const role of ['from', 'to']) {
    assertCatalogSide(shown[role], role, tokens);
    requireThat(sameSide(shown[role], deal[role]), 'catalog_mismatch');
  }
  integerString(shown.amount, { positive: true });
  requireThat(deal.amountIn === shown.amount, 'catalog_mismatch');
  return deal;
}

/** Validate a caller-provided deposit description. No request, claim, or signing. */
export function assertSwapAnyDeposit(deal, { now = Date.now(), allowExpired = false } = {}) {
  requireThat(deal?.mode === 'swap_any', 'mode_mismatch');
  requireThat(swapAnySide(deal.from, 'from') && swapAnySide(deal.to, 'to'), 'invalid_deal');
  requireThat(deal.from.blockchain !== deal.to.blockchain || deal.from.assetId !== deal.to.assetId, 'invalid_deal');
  const network = deal.from.blockchain;
  const max = network === 'near' ? UINT128_MAX : network === 'sol' ? (1n << 64n) - 1n : UINT256_MAX;
  integerString(deal.amountIn, { positive: true, max, code: 'invalid_deal' });
  integerString(deal.amountOut, { positive: true, code: 'invalid_deal' });
  integerString(deal.minAmountOut, { positive: true, code: 'invalid_deal' });
  requireThat(BigInt(deal.minAmountOut) <= BigInt(deal.amountOut), 'invalid_deal');
  for (const fee of ['refundFee', 'withdrawFee']) if (deal[fee] != null) integerString(deal[fee], { code: 'invalid_deal' });
  const refund = walletAddress(network, deal.refundTo);
  walletAddress(deal.to.blockchain, deal.recipient);
  let deposit;
  if (network === 'sol') {
    // A provider deposit can be an off-curve program address; the user's wallet cannot.
    requireThat(decodeSolanaAddress(deal.depositAddress).some(byte => byte !== 0), 'invalid_address');
    deposit = deal.depositAddress;
  } else deposit = walletAddress(network, deal.depositAddress);
  requireThat(deposit !== refund && canonicalDenom(network, deposit) !== canonicalDenom(network, deal.from.denom), 'invalid_deal');
  if (deal.depositMemo != null) requireThat(network === 'sol' && typeof deal.depositMemo === 'string' &&
    deal.depositMemo.length > 0 && new TextEncoder().encode(deal.depositMemo).length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(deal.depositMemo), 'invalid_deal');
  if (network === 'near' && deal.from.denom !== NEAR_NATIVE) {
    integerString(deal.storageDeposit, { positive: true, max: STORAGE_LIMIT, code: 'invalid_deal' });
  } else requireThat(deal.storageDeposit == null, 'invalid_deal');
  const deadline = deadlineMs(deal.deadline, 'deal_expired');
  requireThat(Number.isSafeInteger(now) && Number.isSafeInteger(deal.issuedAt) && Number.isSafeInteger(deal.retainUntil) &&
    deal.issuedAt <= now && deadline > deal.issuedAt && deadline <= deal.issuedAt + 600000 &&
    deal.retainUntil > deadline && deal.retainUntil <= deal.issuedAt + 86400000 && now < deal.retainUntil &&
    (allowExpired || now < deadline), 'deal_expired');
  return deal;
}

export function assertShownDeal(deal, shown, tokens, options) {
  assertShownSelection(deal, shown, tokens);
  return assertSwapAnyDeposit(deal, options);
}

export function nearDeposit(deal, options) {
  assertSwapAnyDeposit(deal, { ...options, allowExpired: false });
  requireThat(deal.from.blockchain === 'near', 'invalid_deal');
  return buildNearDeposit({ token: deal.from, denom: deal.from.denom, amount: deal.amountIn,
    depositAddress: deal.depositAddress, storageDepositYocto: deal.storageDeposit, memo: deal.depositMemo });
}
