// Optional integration example. The dry demo does not import this module.
// Pass NearConnector from @hot-labs/near-connect 0.12.0; no vendor code is copied.
// For a classic script bundle, retain its nonce before returning to the event loop.
const scriptNonce = typeof document === 'undefined' ? undefined : document.currentScript?.nonce;

export function createNearWallet(NearConnector, { cspNonce = scriptNonce } = {}) {
  let connector;
  const instance = () => connector ||= new NearConnector({
    network: 'mainnet', autoConnect: false, features: { signAndSendTransaction: true }, cspNonce,
  });
  const safe = failure => {
    const rejected = ['user_rejected', 'USER_REJECTED', 'ACTION_REJECTED', 4001, '4001'].includes(failure?.code) ||
      (typeof failure === 'string' ? failure : failure?.message) === 'User rejected';
    const code = rejected ? 'user_rejected' : failure?.code === 'no_wallet' ? 'no_wallet' : 'wallet_error';
    return Object.assign(new Error(code), { code });
  };
  const account = accounts => typeof accounts?.[0]?.accountId === 'string' ? { accountId: accounts[0].accountId } : null;
  async function selected() {
    try { return await instance().getConnectedWallet(); }
    catch (error) {
      if (['No wallet selected', 'No accounts found'].includes(error?.message)) return null;
      throw error;
    }
  }
  return Object.freeze({
    async connect() {
      try {
        const wallet = await instance().connect(), result = account(await wallet.getAccounts());
        if (!result) throw { code: 'no_wallet' };
        return result;
      } catch (error) { throw safe(error); }
    },
    async account() {
      try { return account((await selected())?.accounts); } catch (error) { throw safe(error); }
    },
    async disconnect() {
      if (!connector) return;
      try { const state = await selected(); if (state) await connector.disconnect(state.wallet); }
      catch (error) { throw safe(error); }
    },
    async signAndSendTransaction(input) {
      try {
        if (!connector) throw { code: 'no_wallet' };
        const state = await selected();
        if (!state?.wallet || state.wallet.manifest?.features?.signAndSendTransaction !== true) throw { code: 'no_wallet' };
        const { receiverId, actions } = input;
        const result = await state.wallet.signAndSendTransaction({ receiverId, actions });
        const txHash = result?.transaction?.hash ?? result?.transaction_outcome?.id;
        if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(txHash)) throw new Error();
        return { txHash };
      } catch (error) { throw safe(error); }
    },
  });
}
