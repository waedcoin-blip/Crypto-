import { loggerService } from '../../infrastructure/logging/LoggerService';

export interface TradeReceipt {
  receiptId: string;
  mint: string;
  side: 'buy' | 'sell';
  amountSol: number;
  tokensReceivedOrSold: number;
  signature: string;
  timestamp: number;
  success: boolean;
  error?: string;
}

export class TradeReceiptService {
  private static instance: TradeReceiptService;
  private receipts: TradeReceipt[] = [];

  public static getInstance(): TradeReceiptService {
    if (!TradeReceiptService.instance) {
      TradeReceiptService.instance = new TradeReceiptService();
    }
    return TradeReceiptService.instance;
  }

  public recordReceipt(receipt: TradeReceipt): void {
    this.receipts.unshift(receipt);
    loggerService.emit(
      receipt.success ? 'TRADE_EXECUTED' : 'TRADE_FAILED',
      `Trade ${receipt.side.toUpperCase()} for ${receipt.mint}: ${receipt.amountSol} SOL (${receipt.success ? 'Success' : receipt.error})`,
      { tokenMint: receipt.mint, transactionSignature: receipt.signature }
    );
  }

  public getReceipts(): TradeReceipt[] {
    return [...this.receipts];
  }
}

export const tradeReceiptService = TradeReceiptService.getInstance();
