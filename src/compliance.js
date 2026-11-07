import { normalizeAddress } from './addresses.js';
import { fail, requireThat } from './errors.js';

export function requireComplianceHooks(hooks) {
  requireThat(hooks && typeof hooks.regionCheck === 'function' && typeof hooks.sanctionsCheck === 'function', 'compliance_unavailable');
}

export async function checkCompliance(hooks, region, addresses) {
  requireComplianceHooks(hooks);
  requireThat(typeof region === 'string' && /^[A-Z]{2}$/.test(region));
  let allowed;
  try { allowed = await hooks.regionCheck(region); } catch { fail('compliance_unavailable'); }
  if (allowed !== true) fail(allowed === false ? 'region_unavailable' : 'compliance_unavailable');
  try { allowed = await hooks.sanctionsCheck(addresses.map(a => Object.freeze({ ...a }))); }
  catch { fail('compliance_unavailable'); }
  if (allowed !== true) fail(allowed === false ? 'address_restricted' : 'compliance_unavailable');
}

// Example wiring only: local strings are not geolocation or an up-to-date sanctions feed.
export function createLocalCompliance(policy) {
  requireThat(policy && Array.isArray(policy.blockedRegions) && Array.isArray(policy.blockedAddresses));
  requireThat(policy.blockedRegions.every(r => typeof r === 'string' && /^[A-Z]{2}$/.test(r)));
  const regions = new Set(policy.blockedRegions);
  const blocked = new Set(policy.blockedAddresses.map(({ blockchain, address }) =>
    `${blockchain}:${normalizeAddress(blockchain, address)}`));
  return Object.freeze({
    regionCheck: async region => /^[A-Z]{2}$/.test(region) && !regions.has(region),
    sanctionsCheck: async addresses => addresses.every(({ blockchain, address }) =>
      !blocked.has(`${blockchain}:${normalizeAddress(blockchain, address)}`)),
  });
}
