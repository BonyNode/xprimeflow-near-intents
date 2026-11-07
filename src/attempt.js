import { requireThat } from './errors.js';

/** Injected callbacks only; the dry demo never creates an attempt or sends it.
 * A rejected signing request releases a claim only after explicit acknowledgement.
 * Any uncertain result stays locked and cannot open a second signing prompt.
 */
export function createDepositAttempt({ claim, release, send }) {
  requireThat([claim, release, send].every(fn => typeof fn === 'function'));
  let state = 'ready', txHash = null;
  return Object.freeze({
    snapshot: () => Object.freeze({ state, txHash }),
    async run(transaction) {
      requireThat(state === 'ready', 'attempt_locked');
      state = 'claimed';
      let receipt;
      try { receipt = await claim(); requireThat(receipt != null && receipt !== false); }
      catch { state = 'unknown'; return { state, code: 'wallet_error' }; }
      try {
        const result = await send(transaction);
        requireThat(typeof result?.txHash === 'string' && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(result.txHash));
        txHash = result.txHash; state = 'submitted';
        return { state, txHash };
      } catch (error) {
        if (error?.code === 'user_rejected') {
          try {
            if (await release(receipt) === true) { state = 'released'; return { state, code: 'user_rejected' }; }
          } catch { /* A failed acknowledgement is not a released claim. */ }
        }
        state = 'unknown'; return { state, code: 'wallet_error' };
      }
    },
  });
}
