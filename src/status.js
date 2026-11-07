import { normalizeAddress } from './addresses.js';
import { fail, requireThat } from './errors.js';
import { deadlineMs } from './quote.js';

const STATES = Object.freeze({
  PENDING_DEPOSIT: 'awaiting_deposit', KNOWN_DEPOSIT_TX: 'deposit_detected',
  INCOMPLETE_DEPOSIT: 'incomplete_deposit', PROCESSING: 'processing',
  SUCCESS: 'succeeded', REFUNDED: 'refunded', FAILED: 'failed',
});

export function normalizeStatus(status) {
  const known = typeof status === 'string' && Object.hasOwn(STATES, status);
  return Object.freeze({
    state: known ? STATES[status] : 'unknown',
    providerStatus: known ? status : 'UNKNOWN',
    terminal: ['SUCCESS', 'REFUNDED', 'FAILED'].includes(status),
    succeeded: status === 'SUCCESS',
    needsAttention: !known || ['INCOMPLETE_DEPOSIT', 'FAILED'].includes(status),
  });
}

export function normalizeStatusResponse(raw, { blockchain, depositAddress, depositMemo }) {
  requireThat(raw && typeof raw === 'object' && typeof raw.status === 'string', 'provider_invalid_response');
  const quote = raw.quoteResponse?.quote;
  try {
    requireThat(normalizeAddress(blockchain, quote?.depositAddress) === depositAddress, 'status_mismatch');
    requireThat((quote.depositMemo ?? '') === (depositMemo ?? ''), 'status_mismatch');
  } catch { fail('status_mismatch'); }
  deadlineMs(raw.updatedAt, 'provider_invalid_response');
  // No transaction history, raw payload, correlation ID, or address is returned.
  return Object.freeze({ ...normalizeStatus(raw.status), updatedAt: raw.updatedAt });
}
