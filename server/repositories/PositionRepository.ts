// server/repositories/PositionRepository.ts
import { readDataFile, writeDataFile } from '../db/jsonStore.js';

export type PositionState =
  | 'PENDING_BUY'
  | 'OPEN'
  | 'EXIT_REQUESTED'
  | 'EXIT_SUBMITTED'
  | 'EXIT_CONFIRMING'
  | 'CLOSED'
  | 'RECOVERY_REQUIRED';

export interface PositionRecord {
  id: string;
  mintAddress: string;
  network: string;
  amountRaw: number;
  decimals: number;
  entryPriceSOL: number;
  solSpent: number;
  currentPriceSOL: number;
  peakPriceSOL: number;
  highestPnLPct: number;
  currentPnLSol?: number;
  currentPnLPct?: number;
  tpPct: number;
  slPct: number;
  trailingSlPct?: number;
  maxHoldTimeMs?: number;
  slippageBpsTp: number;
  slippageBpsSl: number;
  state: PositionState;
  orderIds: string[];
  buySignature?: string;
  exitSignature?: string;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  realizedPnLSol?: number;
  realizedPnLPct?: number;
}

const FILE_NAME = 'positions.json';

export class PositionRepository {
  private static instance: PositionRepository;
  private positions: Map<string, PositionRecord> = new Map();

  private constructor() {
    this.load();
  }

  public static getInstance(): PositionRepository {
    if (!PositionRepository.instance) {
      PositionRepository.instance = new PositionRepository();
    }
    return PositionRepository.instance;
  }

  private load(): void {
    const list = readDataFile<PositionRecord[]>(FILE_NAME, []);
    for (const item of list) {
      if (item && item.id) {
        this.positions.set(item.id, item);
      }
    }
  }

  private save(): void {
    const arr = Array.from(this.positions.values()).slice(-500);
    writeDataFile(FILE_NAME, arr);
  }

  public getOpenPositions(): PositionRecord[] {
    return Array.from(this.positions.values()).filter(p => p.state !== 'CLOSED');
  }

  public countActivePositions(network?: string): number {
    return Array.from(this.positions.values()).filter(p => {
      if (p.state === 'CLOSED') return false;
      if (network && p.network !== network) return false;
      return true;
    }).length;
  }

  public canOpenPosition(maxPositions: number, network?: string): boolean {
    if (maxPositions <= 0) return true;
    const currentCount = this.countActivePositions(network);
    return currentCount < maxPositions;
  }

  public getPosition(id: string): PositionRecord | undefined {
    return this.positions.get(id);
  }

  public getPositionByMint(mint: string): PositionRecord | undefined {
    const cleanMint = mint.trim();
    return Array.from(this.positions.values()).find(
      p => p.mintAddress === cleanMint && p.state !== 'CLOSED'
    );
  }

  public upsertPosition(position: PositionRecord): PositionRecord {
    position.updatedAt = Date.now();
    this.positions.set(position.id, position);
    this.save();
    return position;
  }

  public updatePosition(id: string, patch: Partial<PositionRecord>): PositionRecord | undefined {
    const existing = this.positions.get(id);
    if (!existing) return undefined;

    const updated = { ...existing, ...patch, updatedAt: Date.now() };
    this.positions.set(id, updated);
    this.save();
    return updated;
  }

  public closePosition(id: string, data?: { exitSignature?: string; realizedPnLSol?: number; realizedPnLPct?: number }): PositionRecord | undefined {
    const existing = this.positions.get(id);
    if (!existing) return undefined;

    const now = Date.now();
    const updated: PositionRecord = {
      ...existing,
      state: 'CLOSED',
      closedAt: now,
      updatedAt: now,
      exitSignature: data?.exitSignature ?? existing.exitSignature,
      realizedPnLSol: data?.realizedPnLSol ?? existing.realizedPnLSol,
      realizedPnLPct: data?.realizedPnLPct ?? existing.realizedPnLPct,
    };
    this.positions.set(id, updated);
    this.save();
    return updated;
  }

  public getAllPositions(): PositionRecord[] {
    return Array.from(this.positions.values());
  }
}

export const positionRepository = PositionRepository.getInstance();
