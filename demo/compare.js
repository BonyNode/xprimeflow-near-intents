import { swapCatalog, selected, demoMode, routeInput, useDestination } from './app.js';
const el = id => document.getElementById(id), addressBook = {};
let generation = 0;
function invalidate() {
  generation++; el('comparison-result').hidden = true; el('compare-error').textContent = '';
}
function addresses() { return { ...addressBook, [selected('from').blockchain]: routeInput().refundTo }; }
function fields() {
  const networks = [...new Set(swapCatalog.to.filter(row => row.symbol.toUpperCase() === el('compare-symbol').value).map(row => row.blockchain))];
  el('wallet-fields').replaceChildren(...networks.filter(network => network !== selected('from').blockchain).map(network => {
    const label = document.createElement('label'); label.textContent = network.toUpperCase();
    const input = document.createElement('input'); input.dataset.network = network; input.value = addressBook[network] ?? '';
    input.placeholder = 'Leave empty to skip'; input.autocomplete = 'off'; input.spellcheck = false;
    input.addEventListener('input', () => { addressBook[network] = input.value; invalidate(); });
    label.append(input); return label;
  }));
}
if (swapCatalog) {
  el('compare-symbol').replaceChildren(...swapCatalog.symbols.map(symbol => new Option(symbol, symbol)));
  el('compare-symbol').value = 'USDC';
  if (demoMode() === 'fixture') {
    addressBook.base = el('recipient').value;
    addressBook.arb = '0x2222222222222222222222222222222222222222';
  }
  fields(); el('compare-submit').disabled = false;
  el('quote-form').addEventListener('input', invalidate);
  el('from-network').addEventListener('change', fields);
  el('compare-symbol').addEventListener('change', () => { invalidate(); fields(); });
}
el('compare-form').addEventListener('submit', async event => {
  event.preventDefault(); invalidate(); const current = generation;
  el('compare-submit').disabled = true;
  try {
    const response = await fetch('/api/cheapest', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...routeInput(), dry: true, mode: 'swap_any', symbol: el('compare-symbol').value, addressByChain: addresses() }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? 'Comparison unavailable.');
    if (current !== generation) return;
    const result = data.comparison;
    el('best').textContent = result.best ? `Most tokens for this input: ${result.best.blockchain.toUpperCase()}.` : 'No usable quote. Check addresses and route availability.';
    el('comparison-rows').replaceChildren(...result.rows.map(row => {
      const tr = document.createElement('tr');
      const values = [row.blockchain.toUpperCase(), row.status === 'ok' ? `${row.tokensOut} ${row.symbol}` : row.status === 'needs_wallet' ? 'Add wallet address' : row.status,
        row.chainPriceUsd == null ? '—' : `${row.chainPriceUsd} (${row.priceSource === 'provided' ? 'provided input' : '1Click quote'})`,
        row.routeFeeUsd ?? '—', row.effectivePriceUsd ?? '—'];
      for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
      const identity = document.createElement('details'), summary = document.createElement('summary');
      summary.textContent = 'Asset ID'; identity.append(summary, document.createTextNode(row.assetId)); tr.firstChild.append(identity);
      const td = document.createElement('td');
      if (row.status === 'ok') {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Use route in A';
        button.addEventListener('click', () => { useDestination(row, addresses()[row.blockchain] ?? ''); invalidate(); }); td.append(button);
      }
      tr.append(td); return tr;
    }));
    el('comparison-result').hidden = false;
  } catch (error) { if (current === generation) el('compare-error').textContent = error.message; }
  finally { el('compare-submit').disabled = false; }
});
