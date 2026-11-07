import { requireThat } from './errors.js';

export const UINT256_MAX = (1n << 256n) - 1n;
export const UINT128_MAX = (1n << 128n) - 1n;

export function integerString(value, { positive = false, max = UINT256_MAX, code = 'invalid_input' } = {}) {
  requireThat(typeof value === 'string' && value.length <= 78 && /^(0|[1-9][0-9]*)$/.test(value), code);
  const n = BigInt(value);
  requireThat(n <= max && (!positive || n > 0n), code);
  return value;
}

export function parseUnits(value, decimals) {
  requireThat(Number.isInteger(decimals) && decimals >= 0 && decimals <= 255);
  requireThat(typeof value === 'string' && value.length <= 335 && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value));
  const [whole, fraction = ''] = value.split('.');
  requireThat(fraction.length <= decimals);
  const raw = (whole + fraction.padEnd(decimals, '0')).replace(/^0+(?=\d)/, '');
  return integerString(raw, { positive: true });
}

export function formatUnits(value, decimals) {
  integerString(value);
  requireThat(Number.isInteger(decimals) && decimals >= 0 && decimals <= 255);
  if (decimals === 0) return value;
  const digits = value.padStart(decimals + 1, '0');
  const tail = digits.slice(-decimals).replace(/0+$/, '');
  return digits.slice(0, -decimals) + (tail ? `.${tail}` : '');
}
