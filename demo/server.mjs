import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createClient, createLocalCompliance, buildNearDeposit, parseUnits, SUPPORTED_NETWORKS,
  IntentsError, publicError } from '../src/index.js';
import { fixtureFetch } from './fixture-fetch.mjs';
import { catalogSides, NEAR_NATIVE, assertShownSelection, compareCheapest, multiChainSymbols } from '../src/index.js';

const assets = new Map(await Promise.all([
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
  ['/compare.js', 'compare.js', 'text/javascript; charset=utf-8'],
  ['/style.css', 'style.css', 'text/css; charset=utf-8'],
].map(async ([route, file, type]) => [route, { type, body: await readFile(new URL(file, import.meta.url)) }])));
const policy = JSON.parse(await readFile(new URL('../examples/compliance.json', import.meta.url), 'utf8'));

async function readInput(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new IntentsError('invalid_input');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new IntentsError('request_too_large');
    chunks.push(chunk);
  }
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    return input;
  } catch { throw new IntentsError('invalid_input'); }
}

export function createDemoServer({ mode = 'fixture', jwt, fetchImpl, clock, networkPrice } = {}) {
  if (!['fixture', 'live'].includes(mode)) throw new IntentsError('invalid_input');
  const client = createClient({
    compliance: createLocalCompliance(policy),
    fetchImpl: mode === 'fixture' ? fixtureFetch : fetchImpl,
    jwt: mode === 'live' ? jwt : undefined, clock,
  });
  function sourceSide(input, tokens) {
    const sides = catalogSides(tokens).from;
    const denom = input.originDenom ?? (input.originAsset === 'nep141:wrap.near' ? NEAR_NATIVE : undefined);
    const side = sides.find(row => row.assetId === input.originAsset && (denom === undefined || row.denom === denom));
    if (!side) throw new IntentsError('catalog_mismatch');
    return side;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    const json = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    try {
      const host = `127.0.0.1:${server.address().port}`;
      const localhost = `localhost:${server.address().port}`;
      if (![host, localhost].includes(req.headers.host)) throw new IntentsError('forbidden');
      if (req.headers.origin && ![`http://${host}`, `http://${localhost}`].includes(req.headers.origin)) throw new IntentsError('forbidden');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new IntentsError('forbidden');
      const url = new URL(req.url, `http://${host}`);
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const asset = assets.get(url.pathname);
        res.writeHead(200, { 'Content-Type': asset.type }); res.end(asset.body); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/config') {
        json(200, { mode, supportedNetworks: SUPPORTED_NETWORKS, policy: 'local-example',
          fixtureRoute: '1 NEAR or existing wNEAR → USDC; comparison values are synthetic, not current prices' }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/tokens') { json(200, await client.getTokens()); return; }
      if (req.method === 'GET' && url.pathname === '/api/swap-catalog') {
        const { tokens, expiresAt } = await client.getTokens();
        json(200, { ...catalogSides(tokens), symbols: multiChainSymbols(tokens), expiresAt }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/cheapest') {
        const input = await readInput(req), { tokens } = await client.getTokens();
        const from = sourceSide(input, tokens), amount = parseUnits(input.amount, from.decimals);
        const comparison = await compareCheapest({ ...input, from, amount }, { client,
          networkPrice: networkPrice ?? (mode === 'fixture' ? async row => ({ base: '1.01', arb: '1.02' })[row.blockchain] ?? null : async () => null),
        });
        json(200, { mode, comparison }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/quote') {
        const input = await readInput(req);
        const { tokens } = await client.getTokens();
        const from = sourceSide(input, tokens);
        const to = catalogSides(tokens).to.find(row => row.assetId === input.destinationAsset);
        if (!to) throw new IntentsError('unknown_asset');
        if (input.mode !== undefined && input.mode !== 'swap_any') throw new IntentsError('mode_mismatch');
        const amount = parseUnits(input.amount, from.decimals);
        const selection = { mode: 'swap_any', from, to, amount };
        assertShownSelection({ ...selection, amountIn: amount }, input.shown ?? selection, tokens);
        const quote = await client.quote({ ...input, amount });
        assertShownSelection({ mode: 'swap_any', from: { ...from, assetId: quote.origin.assetId, decimals: quote.origin.decimals },
          to: { ...to, assetId: quote.destination.assetId, decimals: quote.destination.decimals }, amountIn: quote.amountIn }, selection, tokens);
        let preview = null;
        if (quote.origin.blockchain === 'near') {
          preview = {
            illustrative: true, target: 'deposit.demo.invalid',
            storageDepositSource: 'Illustrative 0.00125 NEAR; obtain storage_balance_bounds.min before any real use.',
            transaction: buildNearDeposit({ token: quote.origin, denom: from.denom, amount,
              depositAddress: 'deposit.demo.invalid', storageDepositYocto: from.denom === NEAR_NATIVE ? undefined : '1250000000000000000000',
              ...(quote.depositMemo == null ? {} : { memo: quote.depositMemo }),
            }),
          };
        }
        json(200, { mode, quote, preview, catalogMatch: true, selection }); return;
      }
      throw new IntentsError('not_found');
    } catch (error) {
      const safe = publicError(error);
      const status = safe.code === 'not_found' ? 404 : safe.code === 'forbidden' ? 403 :
        safe.code === 'request_too_large' ? 413 : /^(provider|response|quote_mismatch|catalog)/.test(safe.code) ? 502 : 400;
      if (!res.headersSent) json(status, { error: safe }); else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const port = Number(process.env.PORT ?? 8787);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new IntentsError('invalid_input');
    const mode = process.env.DEMO_MODE ?? 'fixture';
    const server = createDemoServer({ mode, jwt: mode === 'live' ? process.env.NEAR_INTENTS_JWT : undefined });
    server.on('error', () => { console.error('Demo server could not start. Check the port and configuration.'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Quote demo (${mode}): http://127.0.0.1:${port}`));
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { server.closeAllConnections(); server.close(); });
  } catch { console.error('Demo server could not start. Check the configuration.'); process.exitCode = 1; }
}
