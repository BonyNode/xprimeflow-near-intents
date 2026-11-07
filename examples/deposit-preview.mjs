import { buildNearDeposit } from '../src/index.js';

const tokens = [
  { assetId: 'nep141:wrap.near', blockchain: 'near', symbol: 'wNEAR', decimals: 24, contractAddress: 'wrap.near' },
  { assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', blockchain: 'near',
    symbol: 'USDC', decimals: 6, contractAddress: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1' },
];
for (const [token, denom] of [[tokens[0], 'near-native'], [tokens[0], 'wrap.near'], [tokens[1], tokens[1].contractAddress]]) {
  const tx = buildNearDeposit({ token, amount: token.symbol === 'wNEAR' ? '1000000000000000000000000' : '1000000',
    denom, depositAddress: 'deposit.demo.invalid', storageDepositYocto: denom === 'near-native' ? undefined : '1250000000000000000000' });
  console.log(JSON.stringify({ illustrative: true, asset: denom === 'near-native' ? 'NEAR' : token.symbol, transaction: tx }, null, 2));
}
