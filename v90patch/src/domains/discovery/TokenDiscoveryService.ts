import { tokenRegistry, TokenRecord, TokenSignal } from '../../services/TokenRegistry';
import { CandidateValidator, ValidationCriteria } from './CandidateValidator';
import { loggerService } from '../../infrastructure/logging/LoggerService';

export class TokenDiscoveryService {
  private static instance: TokenDiscoveryService;
  private listeners: Set<(token: TokenRecord) => void> = new Set();

  public static getInstance(): TokenDiscoveryService {
    if (!TokenDiscoveryService.instance) {
      TokenDiscoveryService.instance = new TokenDiscoveryService();
    }
    return TokenDiscoveryService.instance;
  }

  public discoverToken(params: {
    mintAddress: string;
    symbol?: string;
    name?: string;
    decimals?: number;
    priceSOL?: number;
    priceUSD?: number;
    liquidity?: number;
    marketCap?: number;
    signal?: TokenSignal;
  }, criteria?: ValidationCriteria): TokenRecord | null {
    const validation = CandidateValidator.validateCandidate(params, criteria);
    if (!validation.valid) {
      loggerService.emit('TRANSACTION_REJECTED', `Token candidate ${params.mintAddress} rejected: ${validation.reason}`);
      return null;
    }

    const record = tokenRegistry.registerOrUpdate({
      ...params,
      executionState: 'DISCOVERED',
    });

    loggerService.emit('TRANSACTION_PARSED', `Discovered token candidate: ${record.symbol} (${record.mintAddress})`);
    this.listeners.forEach(l => l(record));
    return record;
  }

  public onDiscovery(fn: (token: TokenRecord) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const tokenDiscoveryService = TokenDiscoveryService.getInstance();
