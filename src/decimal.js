import { requireThat } from './errors.js';

export function decimal(value, { positive = false, code = 'invalid_input' } = {}) {
  requireThat(typeof value === 'string' && value.length <= 120 && /^(0|[1-9]\d*)(\.\d{1,36})?$/.test(value), code);
  const [whole, fraction = ''] = value.split('.');
  const units = BigInt(whole + fraction);
  requireThat(!positive || units > 0n, code);
  return { units, scale: fraction.length };
}

function render(units, scale) {
  const negative = units < 0n;
  const raw = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const text = scale ? `${raw.slice(0, -scale)}.${raw.slice(-scale)}`.replace(/\.?0+$/, '') : raw;
  return (negative ? '-' : '') + text;
}

export function subtractDecimal(a, b) {
  const x = decimal(a), y = decimal(b), scale = Math.max(x.scale, y.scale);
  return render(x.units * 10n ** BigInt(scale - x.scale) - y.units * 10n ** BigInt(scale - y.scale), scale);
}

// Display-only USD/unit ratio, truncated to 18 decimal places. Ranking is exact.
export function pricePerToken(usd, amount, decimals) {
  const price = decimal(usd), units = BigInt(amount);
  const scaled = price.units * 10n ** BigInt(decimals + 18) / (units * 10n ** BigInt(price.scale));
  return scaled === 0n && price.units !== 0n ? null : render(scaled, 18);
}
