import { isNearAccountId, normalizeAddress } from './addresses.js';
import { integerString, UINT128_MAX } from './amounts.js';
import { requireThat } from './errors.js';
import { NEAR_NATIVE, STORAGE_LIMIT } from './swap-policy.js';

export function validateMemo(memo, code = 'invalid_input') {
  requireThat(memo === undefined || (typeof memo === 'string' && Buffer.byteLength(memo, 'utf8') <= 256 && !/[\u0000-\u001f\u007f]/.test(memo)), code);
  return memo;
}

/** Pure transaction description in near-connect's signAndSendTransaction format.
 * storageDepositYocto must come from the token's storage_balance_bounds.min.
 * near-native transfers NEAR to the provider; a token deposit spends existing FT.
 * There are deliberately no wallet, RPC, key, or signing dependencies here.
 */
export function buildNearDeposit({ token, denom, amount, depositAddress, storageDepositYocto, memo }) {
  requireThat(token?.blockchain === 'near' && typeof token.assetId === 'string' && token.assetId.startsWith('nep141:'));
  const contract = token.assetId.slice('nep141:'.length);
  requireThat(isNearAccountId(contract));
  requireThat(Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 36);
  requireThat(token.contractAddress == null || token.contractAddress === contract);
  normalizeAddress('near', depositAddress);
  requireThat(depositAddress !== contract && memo == null);
  integerString(amount, { positive: true, max: UINT128_MAX });
  if (contract === 'wrap.near') requireThat(token.decimals === 24);
  requireThat(denom === undefined || denom === contract || denom === NEAR_NATIVE);
  if (denom === NEAR_NATIVE) {
    requireThat(contract === 'wrap.near' && storageDepositYocto == null);
    return Object.freeze({ receiverId: depositAddress, actions: Object.freeze([
      Object.freeze({ type: 'Transfer', params: Object.freeze({ deposit: amount }) }),
    ]) });
  }
  integerString(storageDepositYocto, { positive: true, max: STORAGE_LIMIT });
  const call = (methodName, args, deposit) => Object.freeze({ type: 'FunctionCall', params: Object.freeze({
    methodName, args: Object.freeze(args), gas: '30000000000000', deposit,
  }) });
  const actions = [call('storage_deposit', { account_id: depositAddress, registration_only: true }, storageDepositYocto)];
  actions.push(call('ft_transfer', {
    receiver_id: depositAddress, amount,
  }, '1'));
  return Object.freeze({ receiverId: contract, actions: Object.freeze(actions) });
}
