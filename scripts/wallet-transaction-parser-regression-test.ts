import assert from 'assert';
import { parseWalletTransaction } from '../src/services/WalletTransactionParser';

const wallet = 'Wallet1111111111111111111111111111111111111';
const mint = 'Mint111111111111111111111111111111111111111';

const tx = {
  blockTime: 1000,
  meta: {
    preTokenBalances: [
      { accountIndex: 0, owner: 'Other', mint, uiTokenAmount: { amount: '999999', decimals: 6 } },
      { accountIndex: 1, owner: wallet, mint, uiTokenAmount: { amount: '1000000', decimals: 6 } },
    ],
    postTokenBalances: [
      { accountIndex: 0, owner: 'Other', mint, uiTokenAmount: { amount: '1', decimals: 6 } },
      { accountIndex: 1, owner: wallet, mint, uiTokenAmount: { amount: '2500000', decimals: 6 } },
    ],
  },
};

const parsed = parseWalletTransaction(tx, wallet);
assert(parsed, 'must parse a wallet-owned delta');
assert.strictEqual(parsed.type, 'buy');
assert.strictEqual(parsed.mint, mint);
assert.strictEqual(parsed.amount, 1.5);
assert.strictEqual(parseWalletTransaction(tx, 'UnknownWallet'), null, 'must never use another wallet balance');
assert.strictEqual(parseWalletTransaction({ meta: { preTokenBalances: [], postTokenBalances: [] } }, wallet), null, 'must not fabricate amounts');
console.log('Wallet transaction parser regression tests passed');
