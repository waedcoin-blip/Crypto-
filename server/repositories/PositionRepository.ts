// server/repositories/PositionRepository.ts
import { JsonStore } from './JsonStore.js';
import { PositionRecord } from '../types/index.js';

export type PositionState =
  | 'PENDING_BUY'
  | 'OPEN'
  | 'EXIT_REQUESTED'
  | 'EXIT_SUBMITTED'
  | 'EXIT_CONFIRMING'
  | 'CLOSED'
  | 'RECOVERY_REQUIRED';

export { PositionRecord };

/**
 * PositionRepository: Authoritative persistence layer for all trading positions.
 * Stores positions in a JSON file with atomic writes.
 */
export class PositionRepository {
  private static instance: PositionRepository;
  private store: JsonStore<Record<string, PositionRecord>>;

  private constructor() {
    this.store = new JsonStore<Record<string, PositionRecord>>('positions.json', {});
  }

  public static getInstance(): PositionRepository {
    if (!PositionRepository.instance) {
      PositionRepository.instance = new PositionRepository();
    }
    return PositionRepository.instance;
  }

  /**
   * Upsert a position record.
   */
  public upsertPosition(record: PositionRecord): void {
    const all = this.store.read();
    all[record.id] = record;
    this.store.write(all);
  }

  /**
   * Get a position by ID.
   */
  public getPosition(id: string): PositionRecord | undefined {
    const all = this.store.read();
    return all[id];
  }

  /**
   * Get all positions.
   */
  public getAllPositions(): PositionRecord[] {
    const all = this.store.read();
    return Object.values(all);
  }

  /**
   * Get open positions (not CLOSED).
   */
  public getOpenPositions(network?: string): PositionRecord[] {
    return this.getAllPositions().filter(p =>
      p.state !== 'CLOSED' && (!network || p.network === network)
    );
  }

  /**
   * Close a position and record exit details.
   */
  public closePosition(id: string, exitDetails: {
    exitSignature?: string;
    realizedPnLSol?: number;
    realizedPnLPct?: number;
  }): void {
    const all = this.store.read();
    const position = all[id];
    if (!position) return;

    position.state = 'CLOSED';
    position.exitSignature = exitDetails.exitSignature;
    position.realizedPnLSol = exitDetails.realizedPnLSol;
    position.realizedPnLPct = exitDetails.realizedPnLPct;
    position.closedAt = Date.now();
    position.updatedAt = Date.now();

    this.store.write(all);
  }

  /**
   * Delete a position (for cleanup/testing).
   */
  public deletePosition(id: string): void {
    const all = this.store.read();
    delete all[id];
    this.store.write(all);
  }
}

export const positionRepository = PositionRepository.getInstance();
