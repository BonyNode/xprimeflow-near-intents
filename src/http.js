import { IntentsError, fail, requireThat } from './errors.js';

export const API_ORIGIN = 'https://1click.chaindefuser.com';
export const MAX_RESPONSE_BYTES = 1024 * 1024;

export async function readBoundedJson(response, limit = MAX_RESPONSE_BYTES) {
  const length = response.headers.get('content-length');
  if (length !== null && /^\d+$/.test(length) && BigInt(length) > BigInt(limit)) {
    await response.body?.cancel().catch(() => {});
    fail('response_too_large');
  }
  requireThat(response.body, 'provider_invalid_response');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        fail('response_too_large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks, size);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('provider_invalid_response'); }
}

// The origin and endpoints cannot be changed by API/demo request input.
// fetchImpl is a trusted dependency-injection seam for offline tests only.
export function createTransport({ fetchImpl = globalThis.fetch, jwt, timeoutMs = 10000 } = {}) {
  requireThat(typeof fetchImpl === 'function');
  requireThat(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000);
  requireThat(jwt === undefined || (typeof jwt === 'string' && jwt.length <= 8192 && /^[\x21-\x7E]+$/.test(jwt)));
  return async function request(path, body) {
    const url = new URL(path, API_ORIGIN);
    requireThat(url.origin === API_ORIGIN && ['/v0/tokens', '/v0/quote', '/v0/status'].includes(url.pathname));
    requireThat((url.pathname === '/v0/quote') === (body !== undefined));
    requireThat(body === undefined || (body.dry === true && body.swapType === 'EXACT_INPUT'));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url.href, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error',
        signal: controller.signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(jwt ? { 'X-API-Key': jwt } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok || response.redirected) {
        await response.body?.cancel().catch(() => {});
        fail(response.status === 404 && url.pathname === '/v0/status' ? 'status_not_found' : 'provider_unavailable');
      }
      const type = response.headers.get('content-type') ?? '';
      requireThat(/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(type), 'provider_invalid_response');
      return await readBoundedJson(response);
    } catch (error) {
      if (controller.signal.aborted) fail('provider_timeout');
      if (error instanceof IntentsError) throw error;
      fail('provider_unavailable');
    } finally { clearTimeout(timer); }
  };
}
