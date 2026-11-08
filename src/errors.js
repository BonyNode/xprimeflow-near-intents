const messages = Object.freeze({
  catalog_mismatch: 'The selected catalog row or exact amount changed. Review the route again.',
  mode_mismatch: 'This operation requires the swap_any mode.',
  invalid_deal: 'The deposit description failed validation.',
  deal_expired: 'The deposit time window is invalid or expired.',
  attempt_locked: 'This attempt is already claimed or finished. Do not send it again.',
  comparison_unavailable: 'Choose a symbol present on at least two supported networks.',
  needs_wallet: 'Provide a connected wallet address for this network.',
  invalid_input: 'Check the input format and limits.',
  fixture_unsupported: 'Offline fixture mode only replays 1 NEAR or wNEAR → USDC at 100 bps slippage. Run with DEMO_MODE=live for other inputs.',
  invalid_address: 'The address is invalid for the selected network.',
  unsupported_network: 'Address validation is unavailable for this network.',
  unknown_asset: 'Select an asset from the current catalog.',
  invalid_catalog: 'The provider catalog failed validation.',
  catalog_expired: 'The catalog expired. Request it again.',
  provider_unavailable: 'The quote provider is unavailable. Try again later.',
  provider_timeout: 'The quote provider timed out.',
  provider_invalid_response: 'The provider response failed validation.',
  response_too_large: 'The provider response exceeds the size limit.',
  quote_mismatch: 'The provider quote does not match the request.',
  status_mismatch: 'The status does not match the requested deposit.',
  status_not_found: 'No status was found for this deposit.',
  compliance_unavailable: 'The configured compliance checks are unavailable.',
  region_unavailable: 'This region is unavailable under the configured policy.',
  address_restricted: 'An address is restricted under the configured policy.',
  request_too_large: 'The request exceeds the size limit.',
  forbidden: 'This request is not permitted.',
  not_found: 'Not found.',
});

// No upstream body, URL, address, request, token, or Error.cause is retained.
export class IntentsError extends Error {
  constructor(code) {
    super(messages[code] ?? messages.provider_unavailable);
    this.name = 'IntentsError';
    this.code = Object.hasOwn(messages, code) ? code : 'provider_unavailable';
  }
}

export function fail(code) { throw new IntentsError(code); }
export function requireThat(condition, code = 'invalid_input') {
  if (!condition) fail(code);
}
export function publicError(error) {
  const safe = error instanceof IntentsError ? error : new IntentsError('provider_unavailable');
  return { code: safe.code, message: safe.message };
}
