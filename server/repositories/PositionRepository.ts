// server/repositories/PositionRepository.ts
import { readDataFile, updateDataFileAtomic } from '../db/jsonStore.js';

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
  wallet?: string;
  amountRaw: number | string;
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
  version?: number;
}

const FILE_NAME = 'positions.json';

export class PositionRepository {
  private static instance: PositionRepository;

  private constructor() {}

  public static getInstance(): PositionRepository {
    if (!PositionRepository.instance) {
      PositionRepository.instance = new PositionRepository();
    }
    return PositionRepository.instance;
  }

  private readAll(): PositionRecord[] {
    return readDataFile<PositionRecord[]>(FILE_NAME, []);
  }

  public getOpenPositions(network?: string): PositionRecord[] {
    const all = this.readAll();
    return all.filter(p => {
      if (p.state === 'CLOSED') return false;
      if (network && p.network !== network) return false;
      return true;
    });
  }

  public countActivePositions(network?: string): number {
    return this.getOpenPositions(network).length;
  }

  public canOpenPosition(maxPositions: number, network?: string): boolean {
    if (maxPositions <= 0) return true;
    const currentCount = this.countActivePositions(network);
    return currentCount < maxPositions;
  }

  public getPosition(id: string): PositionRecord | undefined {
    return this.readAll().find(p => p.id === id);
  }

  public getPositionByMint(mint: string, network?: string): PositionRecord | undefined {
    const cleanMint = mint.trim();
    return this.readAll().find(
      p => p.mintAddress.trim() === cleanMint &&
           p.state !== 'CLOSED' &&
           (!network || p.network === network)
    );
  }

  public getAllPositions(): PositionRecord[] {
    return this.readAll();
  }

  /**
   * Atomic Upsert with strict state-machine guard against resurrecting CLOSED positions.
   */
  public upsertPosition(position: PositionRecord): PositionRecord {
    let resultRecord: PositionRecord = position;

    updateDataFileAtomic<PositionRecord[]>(FILE_NAME, [], (current) => {
      const now = Date.now();
      const existingIdx = current.findIndex(p => p.id === position.id);

      if (existingIdx !== -1) {
        const existing = current[existingIdx];

        // 🔴 STATE MACHINE GUARD: A position already marked CLOSED can NEVER be overwritten back to OPEN
        if (existing.state === 'CLOSED' && position.state !== 'CLOSED') {
          console.warn(`[PositionRepository] Prevented resurrecting CLOSED position ${position.id} to state ${position.state}`);
          resultRecord = { ...existing };
          return current;
        }

        const nextVersion = (existing.version || 1) + 1;
        const merged: PositionRecord = {
          ...existing,
          ...position,
          version: nextVersion,
          updatedAt: now,
        };

        current[existingIdx] = merged;
        resultRecord = merged;
      } else {
        const newRecord: PositionRecord = {
          ...position,
          version: 1,
          createdAt: position.createdAt || now,
          updatedAt: now,
        };
        current.push(newRecord);
        resultRecord = newRecord;
      }

      return current;
    });

    return resultRecord;
  }

  /**
   * Atomic surgical update with state machine validation.
   */
  public updatePosition(id: string, patch: Partial<PositionRecord>): PositionRecord | undefined {
    let updatedRecord: PositionRecord | undefined;

    updateDataFileAtomic<PositionRecord[]>(FILE_NAME, [], (current) => {
      const idx = current.findIndex(p => p.id === id);
      if (idx === -1) return current;

      const existing = current[idx];

      // 🔴 STATE MACHINE GUARD: Closed positions cannot be reopened or mutated by price updates
      if (existing.state === 'CLOSED') {
        if (patch.state && patch.state !== 'CLOSED') {
          console.warn(`[PositionRepository] Rejected invalid transition from CLOSED to ${patch.state} for position ${id}`);
          updatedRecord = existing;
          return current;
        }

        // If it's a price or PnL update on a closed position, ignore it
        if (patch.currentPriceSOL !== undefined || patch.currentPnLSol !== undefined || patch.currentPnLPct !== undefined) {
          updatedRecord = existing;
          return current;
        }
      }

      const nextVersion = (existing.version || 1) + 1;
      const updated: PositionRecord = {
        ...existing,
        ...patch,
        version: nextVersion,
        updatedAt: Date.now(),
      };

      current[idx] = updated;
      updatedRecord = updated;
      return current;
    });

    return updatedRecord;
  }

  /**
   * Authoritative close position transition with file lock and atomic persistence.
   */
  public closePosition(
    id: string,
    data?: { exitSignature?: string; realizedPnLSol?: number; realizedPnLPct?: number }
  ): PositionRecord | undefined {
    let closedRecord: PositionRecord | undefined;

    updateDataFileAtomic<PositionRecord[]>(FILE_NAME, [], (current) => {
      const idx = current.findIndex(p => p.id === id);
      if (idx === -1) return current;

      const existing = current[idx];
      const now = Date.now();
      const nextVersion = (existing.version || 1) + 1;

      const updated: PositionRecord = {
        ...existing,
        state: 'CLOSED',
        closedAt: existing.closedAt || now,
        updatedAt: now,
        version: nextVersion,
        exitSignature: data?.exitSignature ?? existing.exitSignature,
        realizedPnLSol: data?.realizedPnLSol ?? existing.realizedPnLSol,
        realizedPnLPct: data?.realizedPnLPct ?? existing.realizedPnLPct,
      };

      current[idx] = updated;
      closedRecord = updated;
      return current;
    });

    return closedRecord;
  }
}

export const positionRepository = PositionRepository.getInstance();
