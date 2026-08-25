import { useActiveWalletStore } from '../store/activeWalletStore';
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { createJupiterApiClient } from '@jup-ag/api';
import { MainnetJupiterExecutor } from './MainnetJupiterExecutor';

export interface HybridConfig {
  rpcEndpoint: string;
  jupiterEndpoint: string;
  jupiterApiKey: string;
  privateKeyBase58: string;
  jitoEndpoints: string[];
  heliusRpcUrl: string;
  defaultJitoTipSol: number;
  minJitoTipSol: number;
  maxJitoTipSol: number;
  heliusMinTipSol: number;
  vaultPubkey: string;
  profitSharePct: number;
  verbose?: boolean;
}

export interface PositionSnapshot {
  mint: string;
  amount: number;
  solSpent: number;
  tpPct: number;
  slPct: number;
}

export interface AtomicBundleResult {
  method: 'jito' | 'helius' | 'executor';
  signature: string;
  side: 'tp' | 'sl';
  slot: number;
  netSolToWallet: number;
  profitShared: number;
  tipSol: number;
  landingTimeMs: number;
  simulated: boolean;
  simulationUnitsConsumed?: number;
}

export class HybridExecutionEngine {
  public connection: Connection;
  public jupiterApi: ReturnType<typeof createJupiterApiClient>;
  private config: HybridConfig;
  private mainnetExecutor: MainnetJupiterExecutor;

  get wallet(): Keypair {
    const kp = useActiveWalletStore.getState().activeWallet?.keypair;
    if (!kp) throw new Error("No active wallet in store for HybridExecutionEngine");
    return kp;
  }

  get publicKey(): PublicKey {
    return this.wallet.publicKey;
  }

  constructor(config: HybridConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcEndpoint, 'confirmed');
    this.jupiterApi = createJupiterApiClient({ basePath: config.jupiterEndpoint });
    this.mainnetExecutor = new MainnetJupiterExecutor(config.rpcEndpoint);
  }

  private log(...args: any[]) {
    if (this.config.verbose) console.log('[HybridEngine]', ...args);
  }

  // Bracket evaluation delegating to authoritative MainnetJupiterExecutor
  async evaluateBracket(
    pos: PositionSnapshot,
    currentPriceSol: number,
    peakPnLPct: number
  ): Promise<AtomicBundleResult | null> {
    const tpPrice = (pos.solSpent * (1 + pos.tpPct / 100)) / pos.amount;
    const slPrice = (pos.solSpent * (1 - pos.slPct / 100)) / pos.amount;
    const trailingSL =
      peakPnLPct > 20
        ? (pos.solSpent * (1 + (peakPnLPct - 15) / 100)) / pos.amount
        : slPrice;
    const effectiveSL = Math.max(slPrice, trailingSL);

    let side: 'tp' | 'sl' | null = null;
    if (currentPriceSol >= tpPrice) side = 'tp';
    else if (currentPriceSol <= effectiveSL) side = 'sl';

    if (!side) return null;

    return this.executeAtomicExit(pos, side);
  }

  // Authoritative delegation through MainnetJupiterExecutor
  async executeAtomicExit(
    pos: PositionSnapshot,
    side: 'tp' | 'sl',
    _tipSol?: number
  ): Promise<AtomicBundleResult> {
    const startTime = Date.now();
    const slippageBps = side === 'tp' ? 250 : 1000;
    const label = side === 'tp' ? 'exit_tp' : 'exit_sl';

    this.log(`Delegating exit for ${pos.mint} to MainnetJupiterExecutor (${side.toUpperCase()})`);

    const result = await this.mainnetExecutor.swap(
      pos.mint,
      'So11111111111111111111111111111111111111112',
      pos.amount,
      slippageBps,
      label
    );

    const netSol = Math.max(0, (result.outputAmount / LAMPORTS_PER_SOL) - (result.feeSol || 0));

    return {
      method: 'executor',
      signature: result.signature,
      side,
      slot: result.slot || 0,
      netSolToWallet: netSol,
      profitShared: 0,
      tipSol: result.feeSol || 0,
      landingTimeMs: Date.now() - startTime,
      simulated: false,
      simulationUnitsConsumed: 0,
    };
  }

  isJitoCongested(): boolean {
    return false;
  }

  calibrateJitoTip(lastTipSol: number, _landed: boolean): number {
    return lastTipSol;
  }

  getRecommendedTip(): number {
    return this.config.defaultJitoTipSol || 0.00005;
  }
}

