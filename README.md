# X PrimeFlow NEAR Intents

**The problem:** a user who wants a token on another network has to pick a route without seeing, before anything is signed, which network returns the most for the same input, or exactly what the wallet will be asked to send. This module answers both questions with dry NEAR Intents quotes and an unsigned deposit preview.

A standalone Node.js module and local demo for two NEAR Intents flows:

- **A — any-token route:** select catalog assets, validate the selected identity and exact amount, and inspect an unsigned NEAR deposit.
- **B — where is it cheaper?** Compare dry quotes for one symbol across networks; choose the largest token output for the same input.

Requires **Node.js 20.19+**. The demo never connects a wallet, signs, sends, claims a deposit, or requests a non-dry quote. The package is `private: true`. It has no database or internal service dependency.

## Start locally

From the repository directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
node demo/server.mjs
```

You should see tests pass, with the live test skipped, followed by `Quote demo (fixture): http://127.0.0.1:8787`. Open that address. The server listens only on loopback. Stop it with Ctrl+C. Offline fixture mode replays only 1 NEAR/wNEAR → USDC at 100 bps slippage: other amounts, tokens or slippages return "Check the input format and limits." in A or "unavailable" in B; use `DEMO_MODE=live` for arbitrary dry quotes.

## A: do this — see this

1. Leave **NEAR / NEAR · native transfer → BASE / USDC**, amount **1**, slippage **100**, region **DE**, and the example addresses. Click **Get dry quote**.
2. You see **3.666345 USDC**, minimum **3.629681 USDC**, and **24 seconds**. The quote is `dry: true`; `depositAddress` is null. These are saved fixture quantities, not current prices.
3. The catalog-match message confirms **mode + assetId + decimals + denomination + exact input**. The preview has **one Transfer**, amount `1000000000000000000000000`, to the illustrative `deposit.demo.invalid`. Never send to that placeholder.
4. Change the source asset to **wNEAR**, then request again. You see **two FunctionCall actions**: `storage_deposit(account_id, registration_only: true)` followed by `ft_transfer` with **1 yoctoNEAR**. This spends an existing wNEAR balance; it does not wrap native NEAR.
5. Change region to **GB** and request again. You see the local region-policy refusal. Set region back to **DE** and the source asset back to **NEAR · native transfer** to continue.

Native NEAR uses the catalog identity `nep141:wrap.near` plus the source-only denomination `near-native`. [1Click handles wrapping](https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/near-token). Destination wNEAR remains labelled wNEAR; a refund of native NEAR may arrive as wNEAR. Real deposits/refunds have not been verified by this demo.

In a second terminal, while `node demo/server.mjs` is still running, run the same A example without a browser:

```sh
curl --fail-with-body http://127.0.0.1:8787/api/quote \
  -H 'Content-Type: application/json' \
  --data '{"mode":"swap_any","originAsset":"nep141:wrap.near","originDenom":"near-native","destinationAsset":"nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near","amount":"1","refundTo":"quote.demo.invalid","recipient":"0x1111111111111111111111111111111111111111","slippageTolerance":100,"region":"DE"}'
```

Expect `catalogMatch: true`, `quote.amountOut: "3666345"`, `quote.depositAddress: null`, and one Transfer in `preview.transaction.actions`.

```sh
node examples/deposit-preview.mjs
```

Expect three unsigned JSON examples: native NEAR has **one Transfer**; existing wNEAR and NEAR USDC each have **two calls**. There is no signature or broadcast.

## B: do this — see this

1. Keep A's source **NEAR**, amount **1**, refund address and region **DE**. Scroll to **B · Where is it cheaper?** and select **USDC**.
2. In fixture mode Base and Arbitrum have clearly synthetic/example addresses. Leave Polygon empty. Click **Compare dry quotes**.
3. You see **Arbitrum: 3.7 USDC**, **Base: 3.666345 USDC**, **NEAR: 3.6 USDC**, then **Polygon: Add wallet address**, with no quote numbers for Polygon. No request is made for a network without an address.
4. Arbitrum is first because its token output is largest. Its route difference is **0.3 USD**: synthetic USD input **4** minus output **3.7**. Base's difference is **0.333655 USD**. These are demonstration values, not market observations or measured gas charges.
5. The Base and Arbitrum network prices are labelled **provided input**. NEAR's price is labelled **1Click quote**. The module has no private price feeds; a caller may provide a `networkPrice(row)` function.
6. Click Arbitrum's **Use route in A**. A's destination becomes Arbitrum USDC with the entered address. **No quote or send happens on that click.** Click Get dry quote yourself to see the selected route. Changing a network dropdown in A by hand clears its address field; reload the page, or click **Use route in A** again, to restore the example address.
7. Clear Arbitrum's address and compare again. Its row says Add wallet address; Base becomes the best quoted route. No address is fabricated to keep a row priced.

Symbols are candidate search terms, not asset identities. Expand **Asset ID** to inspect each contract. A matching symbol does not prove equivalent token backing, trust, liquidity, or redeemability.

```sh
curl --fail-with-body http://127.0.0.1:8787/api/cheapest \
  -H 'Content-Type: application/json' \
  --data '{"dry":true,"mode":"swap_any","originAsset":"nep141:wrap.near","originDenom":"near-native","amount":"1","symbol":"USDC","region":"DE","addressByChain":{"near":"quote.demo.invalid","base":"0x1111111111111111111111111111111111111111","arb":"0x2222222222222222222222222222222222222222"}}'
```

Expect `comparison.dry: true`, `comparison.best.blockchain: "arb"`, and Polygon with `status: "needs_wallet"`. Fixture mode supports this one input amount and USDC destinations; other selections require live mode. All comparison USD fields and non-Base output quantities are synthetic.

## Live dry quotes: explicit opt-in

```sh
LIVE=1 node --test test/live.test.mjs
```

Expect one public catalog GET and one dry quote POST for **10 USDC on Base → USDC on Arbitrum**, using synthetic repeated-digit EVM addresses. No JWT is read; no real NEAR account or wallet is used. The test fails visibly on provider error or schema mismatch. This proves a public dry quote path, not a real deposit or wallet connection.

To use the live catalog in the UI, stop the fixture server, then run:

```sh
DEMO_MODE=live node demo/server.mjs
```

The badge becomes **LIVE DRY QUOTES**. Address fields start empty. Enter the addresses you intend to use for quoting; those addresses and route parameters are disclosed to 1Click. For a NEAR refund address without a wallet, use a mainnet-format account such as the synthetic implicit account of 64 × `1`; 1Click answers `.invalid` names and the token contract `wrap.near` with an error, shown as "The quote provider is unavailable". B skips missing or invalid destination addresses. Provider validation failures remain visible; do not infer wallet ownership or executability from a successful response. Nothing is deposited, and no liquidity is reserved.

| Environment variable | Default | Effect |
|---|---|---|
| `DEMO_MODE` | `fixture` | `fixture` or `live` only |
| `PORT` | `8787` | Loopback HTTP port, integer 1024–65535 |
| `NEAR_INTENTS_JWT` | unset | Optional partner JWT; server-side X-API-Key header in live demo only |
| `LIVE` | unset | Exactly `1` enables the network test |

No `.env` loader is included. No setting changes the provider origin or enables execution. The JWT is never exposed to the browser or logs. No address, response body, key, or user record is persisted. Fee rates are not hardcoded: validated app-fee fields from the actual quote are shown; these are not an independent total-fee calculation.

## Module API

```js
import {
  createClient, createLocalCompliance, catalogSides,
  assertShownDeal, nearDeposit, compareCheapest,
} from './src/index.js';

const client = createClient({
  compliance: createLocalCompliance({ blockedRegions: ['GB'], blockedAddresses: [] }),
});
const { tokens } = await client.getTokens();
const { from, to } = catalogSides(tokens);
```

`createClient` requires explicit country/address compliance hooks. The included local policy is an illustrative denylist, not live geolocation, sanctions data, or a compliance certification. Unknown or failing hooks fail closed. The demo's GB exclusion is a local sample rule, not a statement of universal legal availability.

`client.quote({ originAsset, destinationAsset, amount, refundTo, recipient, region, slippageTolerance?, deadline? })` always requests `dry: true`, EXACT_INPUT, ORIGIN_CHAIN deposit/refund and DESTINATION_CHAIN recipient. Amounts are canonical atomic-unit strings. Use `parseUnits`/`formatUnits` for exact conversions. HTTP demo amounts are human decimal strings. Request echoes, address formats, provider deadlines, output amounts and optional fees are validated. `usdIn`/`usdOut` retain decimal strings or null; no amount is inferred from missing fields. The result never exposes an actionable deposit address.

`getTokens()` returns immutable allowlisted records and an expiry. Cache lifetime is at most one hour from fetch start. Expired catalogs are never served. Responses have a **1 MiB streamed byte limit**, timeout, fixed HTTPS origin and no redirects. Provider error bodies and raw exceptions are not exposed. `getStatus()` is a read-only optional API; the demo has no status/submit/execute route.

`catalogSides(tokens)` builds eligible source/destination rows with `blockchain`, `assetId`, `denom`, `decimals`, `symbol`. Supported families are EVM (`eth`, `bsc`, `base`, `arb`, `pol`, `op`, `avax`), Solana (`sol`), and NEAR (`near`). Destination IDs may be `nep141`, `nep245`, or `1cs_v1`. Sources are deliberately narrower: Base/Arbitrum native ETH and USDC, Solana native SOL and USDC, and NEAR native/NEP-141 assets. Catalog availability alone does not enable an arbitrary source deposit.

`assertShownDeal(deal, shown, tokens, { now })` rejects changed mode, network, denomination, decimals, assetId or exact input. It also validates positive bounded amounts, family-specific addresses, a distinct deposit/refund address, Solana-only memo (128 UTF-8 bytes), and time limits. The deposit deadline is at most ten minutes from issue; retention is at most 24 hours and must outlast the deadline. `allowExpired` permits retained status inspection only; normal construction still rejects expired deposits.

The generic deal shape is `{ mode: 'swap_any', from, to, amountIn, amountOut, minAmountOut, refundTo, recipient, depositAddress, depositMemo, storageDeposit, issuedAt, deadline, retainUntil }`. `shown` is `{ mode: 'swap_any', from, to, amount }`. This is an unsigned caller-supplied description, not proof of provider authenticity. There is no server session schema or internal claim API in this repository.

`nearDeposit(deal, { now })` validates and builds the NEAR description. `buildNearDeposit({ token, denom, amount, depositAddress, storageDepositYocto })` is the lower-level pure preview helper. `near-native` requires the wrap.near catalog identity and produces one Transfer. Existing NEP-141 tokens produce storage registration and ft_transfer. The caller must obtain `storage_balance_bounds.min`; the helper permits at most **0.01 NEAR** and never substitutes a production storage price. NEAR/EVM memo is rejected. Solana user wallet validation requires an on-curve address; a validated provider deposit may be a PDA.

`compareCheapest(input, { client, networkPrice })` accepts `{ from, amount, symbol, addressByChain, region, slippageTolerance? }`. Symbols must occur on at least two supported networks. Up to eight destination rows are evaluated, with at most four simultaneous quotes. Quantity ranking uses BigInt across differing decimals. USD route difference is an exact decimal subtraction; it may be negative. Effective/network quote prices are display ratios truncated to 18 decimal places; these rounded ratios do not determine the ranking. `networkPrice(row)` returns a positive decimal-string USD price or null; absence/failure falls back to labelled quote-derived price, or null. No data vendor or private network feed is bundled.

`createDepositAttempt({ claim, release, send })` demonstrates conservative coordination with **injected callbacks only**. The first call locks the attempt before awaiting claim. Explicit `user_rejected` calls release; the state becomes released only if release returns true. Timeouts, closed windows, invalid hashes, lost claim responses and failed release acknowledgements remain unknown/locked. A second run never opens another send prompt. The dry demo does not import or invoke this helper. It does not implement persistent server-side idempotency or authorize live execution.

## Optional near-connect example

`examples/near-wallet.js` exports `createNearWallet(NearConnector, { cspNonce })`. Pass the constructor from **@hot-labs/near-connect 0.12.0**, installed in your own integrating application. The example is not loaded by the demo and adds no dependency to normal quoting.

It creates a mainnet connector lazily, disables auto-connect, filters signing capability, returns only `{ accountId }` / `{ txHash }`, and forwards transaction actions unchanged. Capture a classic entry script's `document.currentScript.nonce` synchronously; for an ES module, pass the server-provided nonce explicitly because currentScript is null. Do not use getAttribute for nonce retrieval.

The package's [published metadata declares MIT and HOT Labs authorship](https://github.com/azbang/near-connect/blob/main/package.json). The npm implementation and generated bundles are not redistributed here; only the newly authored adapter example is included. See NOTICE. Retain upstream license notices if you build a bundle containing the library. Runtime manifests/executors are fetched by the connector and are not fixed by its npm version.

Nonce support does not prove compatibility of every wallet with your CSP. Check actual executors before enabling wallet interaction. This repo neither widens CSP nor includes live wallet acceptance. Keep `user_rejected` distinct from an uncertain submission result.

## Tests, provenance and AI-assisted code

Offline node:test coverage includes transport limits, cache expiry, echo mismatches, integer/address validation, compliance, catalog binding, native/FT actions, time windows, storage cap, memo policy, claim uncertainty, exact multi-network ranking, missing wallets, quote concurrency and both demo endpoints. The only network test requires LIVE=1.

The dependencies are pinned **@noble/hashes 2.4.0** (Keccak/EIP-55) and **@noble/curves 2.4.0** (Ed25519/Solana), both MIT. Node supplies the server, fetch and test runner. Optional near-connect is not installed or bundled by this package.

All project modules, demo code, examples, tests and documentation were newly authored with AI coding assistants: **OpenAI Codex** wrote this standalone package, and the integration rules it reimplements were developed with **Anthropic Claude (Claude Code)** in the X PrimeFlow codebase. General integration rules were reimplemented as standalone modules; private service implementations, databases, endpoints, user records and internal price catalogs were not copied. External dependency code retains its authorship. The Apache-2.0 license text is standard, not AI-authored.

`test/fixtures/provenance.json` distinguishes the recorded Base quote quantity from synthetic comparison values. `.invalid` accounts, repeated-digit addresses, status records and claim IDs are fixtures. Public token contract identifiers and EIP-55/Solana specification vectors are not owner wallet data.

Public references: [1Click catalog](https://docs.near-intents.org/api-reference/oneclick/get-supported-tokens), [dry quotes](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote), [NEAR tokens](https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/near-token), [NEAR wallet login](https://docs.near.org/web3-apps/tutorials/wallet-login), [NEP-141](https://docs.near.org/integrations/fungible-tokens). Checked 2026-11-07.

## Integration-window commits: 2026-10-19 through 2026-11-14

This repository was first published on 2026-11-07, so its whole history is inside the hackathon window. Commits are not backdated and private repository history is not copied; see `git log --date=short`.
