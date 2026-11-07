const el = id => document.getElementById(id);
let catalog = [];
let config;
let generation = 0;
export let swapCatalog;
const rowKey = row => JSON.stringify([row.assetId, row.denom]);
export const selected = side => swapCatalog?.[side].find(row => rowKey(row) === el(`${side}-asset`).value);
export const demoMode = () => config?.mode;
export const routeInput = () => ({ originAsset: selected('from')?.assetId, originDenom: selected('from')?.denom,
  amount: el('amount').value, refundTo: el('refund').value, region: el('region').value.toUpperCase(),
  slippageTolerance: Number(el('slippage').value) });
export function useDestination(row, address) {
  el('to-network').value = row.blockchain; fillAssets('to', rowKey(row));
  el('recipient').value = address; invalidate(); el('quote-form').scrollIntoView(); el('submit').focus();
}

async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? 'Request failed.');
  return data;
}

function fillAssets(side, preferred) {
  const network = el(`${side}-network`).value;
  el(`${side}-asset`).replaceChildren(...swapCatalog[side].filter(t => t.blockchain === network).map(t => {
    const option = new Option(`${t.symbol} · ${t.denom === 'near-native' ? 'native transfer' : t.assetId}`, rowKey(t));
    option.title = t.assetId; return option;
  }));
  if (preferred && swapCatalog[side].some(t => t.blockchain === network && rowKey(t) === preferred)) el(`${side}-asset`).value = preferred;
}

function units(value, decimals) {
  if (decimals === 0) return value;
  const digits = value.padStart(decimals + 1, '0');
  const rest = digits.slice(-decimals).replace(/0+$/, '');
  return digits.slice(0, -decimals) + (rest ? `.${rest}` : '');
}

function invalidate() {
  generation++;
  el('result').hidden = true; el('empty').hidden = false; el('error').textContent = '';
}

el('quote-form').addEventListener('input', invalidate);
for (const side of ['from', 'to']) el(`${side}-network`).addEventListener('change', () => {
  fillAssets(side);
  const field = side === 'from' ? 'refund' : 'recipient';
  el(field).value = '';
  el(field).placeholder = `Address on ${el(`${side}-network`).value}`;
  invalidate();
});

el('quote-form').addEventListener('submit', async event => {
  event.preventDefault();
  invalidate();
  const current = generation;
  el('submit').disabled = true; el('submit').textContent = 'Requesting quote…';
  try {
    const from = selected('from'), to = selected('to');
    const value = el('amount').value;
    if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) throw new Error('Enter a decimal token amount.');
    const [whole, fraction = ''] = value.split('.');
    if (fraction.length > from.decimals) throw new Error('Too many decimal places.');
    const atomic = (whole + fraction.padEnd(from.decimals, '0')).replace(/^0+(?=\d)/, '');
    const data = await api('/api/quote', {
      mode: 'swap_any', originAsset: from.assetId, originDenom: from.denom, destinationAsset: to.assetId,
      shown: { mode: 'swap_any', from, to, amount: atomic },
      amount: el('amount').value, refundTo: el('refund').value, recipient: el('recipient').value,
      slippageTolerance: Number(el('slippage').value), region: el('region').value.toUpperCase(),
    });
    if (current !== generation) return;
    const q = data.quote;
    el('output').textContent = `${units(q.amountOut, q.destination.decimals)} ${q.destination.symbol}`;
    el('minimum').textContent = `${units(q.minAmountOut, q.destination.decimals)} ${q.destination.symbol}`;
    el('time').textContent = `${q.timeEstimate} seconds`;
    el('app-fee').textContent = `${q.fees.appFeeBps} bps`;
    el('withdraw').textContent = q.fees.withdrawFee ?? 'Not provided';
    el('refund-fee').textContent = q.fees.refundFee ?? 'Not provided';
    el('catalog-match').textContent = 'Catalog match: asset ID, decimals, denomination, mode and exact input checked.';
    el('preview-note').textContent = data.preview
      ? `Illustrative target deposit.demo.invalid; never send to it. ${from.denom === 'near-native' ? 'Native NEAR: one Transfer; 1Click handles wrapping. A refund may arrive as wNEAR.' : 'Spends an existing token balance. Storage amount is an example, not a token storage query.'}`
      : 'The NEAR deposit builder applies to a NEAR source asset. No actions are constructed for this source network.';
    el('preview').textContent = data.preview ? JSON.stringify(data.preview.transaction, null, 2) : '';
    el('preview').hidden = !data.preview;
    el('raw').textContent = JSON.stringify(q, null, 2);
    el('result').hidden = false; el('empty').hidden = true;
  } catch (error) {
    if (current === generation) el('error').textContent = error.message;
  } finally { el('submit').disabled = false; el('submit').textContent = 'Get dry quote'; }
});

try {
  config = await api('/api/config');
  const data = await api('/api/tokens'); catalog = data.tokens;
  swapCatalog = await api('/api/swap-catalog');
  for (const side of ['from', 'to']) {
    const networks = [...new Set(swapCatalog[side].map(t => t.blockchain))].sort();
    el(`${side}-network`).replaceChildren(...networks.map(network => {
      const enabled = Object.hasOwn(config.supportedNetworks, network);
      const option = new Option(network.toUpperCase() + (enabled ? '' : ' · not supported here'), network);
      option.disabled = !enabled; return option;
    }));
    el(`${side}-network`).value = side === 'from' ? 'near' : 'base';
  }
  const source = swapCatalog.from.find(t => t.denom === 'near-native');
  fillAssets('from', source && rowKey(source));
  const usdc = swapCatalog.to.find(t => t.blockchain === 'base' && t.symbol === 'USDC');
  fillAssets('to', usdc && rowKey(usdc));
  el('mode').textContent = config.mode === 'fixture' ? 'Offline fixture' : 'Live dry quotes';
  el('context').textContent = config.mode === 'fixture'
    ? 'Offline: 1 NEAR or existing wNEAR → USDC. Base output is a saved sample; other outputs and all USD values are synthetic comparison fixtures, not current prices.'
    : 'Live mode sends the addresses and route you enter to 1Click for dry quotes. No address is invented. No deposit or transaction is created.';
  if (config.mode === 'live') { el('refund').value = ''; el('recipient').value = ''; }
  el('submit').disabled = false;
} catch {
  el('mode').textContent = 'Unavailable';
  el('context').textContent = 'The catalog could not be loaded. Reload to retry; expired data is not used.';
}
