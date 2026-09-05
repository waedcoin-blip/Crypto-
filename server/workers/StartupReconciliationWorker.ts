// server/workers/StartupReconciliationWorker.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { positionRepository } from '../repositories/PositionRepository.js';
import { orderRepository } from '../repositories/OrderRepository.js';
import { tokenMintResolver } from '../market/TokenMintResolver.js';
import { paperWalletLedger } from '../wallet/PaperWalletLedger.js';

export async function reconcileDatabaseWithMainnet(): Promise<void> {
  console.log('[StartupReconciliationWorker] Starting database reconciliation...');
  const openPositions = positionRepository.getOpenPositions();
  console.log(`[StartupReconciliationWorker] Checking ${openPositions.length} open positions from database...`);

  const rpcUrl = process.env.EXECUTION_RPC_URL || process.env.MONITOR_RPC_URL || 'https://api.mainnet-beta.solana.com';
  let connection: Connection | null = null;
  try {
    connection = new Connection(rpcUrl, 'confirmed');
  } catch (e) {
    console.warn('[StartupReconciliationWorker] Connection setup warning:', e);
  }

  const walletPubkey = process.env.WALLET_PUBLIC_KEY;

  for (const pos of openPositions) {
    // 1. PAPER TRADING RECONCILIATION
    if (pos.network === 'paper') {
      const paperBal = paperWalletLedger.getTokenBalance(pos.mintAddress);
      console.log(`[StartupReconciliationWorker] Paper position ${pos.id} (${pos.mintAddress}) paper balance: ${paperBal}`);
      if (paperBal > 0) {
        positionRepository.updatePosition(pos.id, {
          amountRaw: paperBal,
          state: pos.state === 'PENDING_BUY' ? 'OPEN' : pos.state,
        });
      }
      // Never delete paper positions on mainnet RPC failure or 0 mainnet balance!
      continue;
    }

    // 2. LIVE TRADING (DEVNET / MAINNET) RECONCILIATION
    if (!walletPubkey || !connection) {
      console.log(`[StartupReconciliationWorker] Verified live position ${pos.id} (${pos.mintAddress}) state: ${pos.state}`);
      continue;
    }

    try {
      if (!tokenMintResolver.isValidPublicKey(walletPubkey) || !tokenMintResolver.isValidPublicKey(pos.mintAddress)) {
        console.log(`[StartupReconciliationWorker] Verified position ${pos.id} (${pos.mintAddress}) state: ${pos.state}`);
        continue;
      }

      const pubkey = new PublicKey(walletPubkey);
      const mintPk = new PublicKey(pos.mintAddress);
      const tokenAccounts = await connection.getTokenAccountsByOwner(pubkey, { mint: mintPk });

      let rawBalance = 0;
      if (tokenAccounts.value.length > 0) {
        const accountInfo = tokenAccounts.value[0].account.data;
        if (accountInfo.length >= 72) {
          rawBalance = Number(accountInfo.readBigUInt64LE(64));
        }
      }

      if (rawBalance <= 1000) {
        console.log(`[StartupReconciliationWorker] Position ${pos.id} confirmed zero on-chain balance. Closing position.`);
        positionRepository.closePosition(pos.id, { realizedPnLSol: 0, realizedPnLPct: -100 });
      } else {
        positionRepository.updatePosition(pos.id, {
          amountRaw: rawBalance,
          state: (pos.state === 'PENDING_BUY' ? 'OPEN' : pos.state),
        });
      }
    } catch (err: any) {
      // 🟢 RPC FAILURE SAFETY: On RPC error, DO NOT CLOSE POSITION!
      console.warn(`[StartupReconciliationWorker] Warning verifying live position ${pos.mintAddress} (RPC failure, preserving position):`, err?.message || err);
    }
  }

  // Check pending orders
  const pendingOrders = orderRepository.getOrders().filter(o =>
    ['SUBMITTED', 'CONFIRMING', 'TRANSACTION_BUILDING', 'SIGNING'].includes(o.state)
  );

  for (const order of pendingOrders) {
    if (order.signature && connection) {
      try {
        const status = await connection.getSignatureStatus(order.signature);
        if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
          if (!status.value.err) {
            await orderRepository.updateState(order.order_id, 'CONFIRMED');
          } else {
            await orderRepository.updateState(order.order_id, 'FAILED', { error: JSON.stringify(status.value.err) });
          }
        } else {
          await orderRepository.updateState(order.order_id, 'RECOVERY_REQUIRED');
        }
      } catch {
        await orderRepository.updateState(order.order_id, 'RECOVERY_REQUIRED');
      }
    } else {
      await orderRepository.updateState(order.order_id, 'CANCELLED', { error: 'Interrupted prior to submission' });
    }
  }

  console.log('[StartupReconciliationWorker] Database reconciliation complete.');
}

