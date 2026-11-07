import { readFile } from 'node:fs/promises';
import { createClient, createLocalCompliance } from '../src/index.js';
export const load = async name => JSON.parse(await readFile(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8'));
export const TOKENS = await load('tokens');
export const QUOTE = await load('quote');
export const STATUS = await load('status');
export const NOW = Date.parse(QUOTE.quoteRequest.deadline) - 600000;
export const INPUT = { ...QUOTE.quoteRequest, region: 'DE' };
export const policy = { blockedRegions: ['GB'], blockedAddresses: [{ blockchain: 'near', address: 'blocked.demo.invalid' }] };
export function harness({ quote = QUOTE, tokens = TOKENS, status = STATUS, fetchImpl, ...options } = {}) {
  const calls = [];
  const mock = async (url, init) => {
    calls.push({ url, ...init });
    if (fetchImpl) return fetchImpl(url, init);
    const path = new URL(url).pathname;
    if (path === '/v0/tokens') return Response.json(tokens);
    if (path === '/v0/quote') return Response.json(quote);
    if (path === '/v0/status') return Response.json(status);
    throw new Error('Unexpected fixture request');
  };
  const client = createClient({ compliance: createLocalCompliance(policy), clock: () => NOW, ...options, fetchImpl: mock });
  return { client, calls };
}
export const code = expected => error => error?.code === expected;
