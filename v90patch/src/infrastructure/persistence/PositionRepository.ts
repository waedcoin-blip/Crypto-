import { BaseFirestoreRepository } from './FirestoreRepository';
import { PositionRecord } from '../../services/PositionRegistry';

export interface PositionRepositoryPort {
  savePosition(pos: PositionRecord): Promise<void>;
  getPosition(id: string): Promise<PositionRecord | null>;
  getAllPositions(): Promise<PositionRecord[]>;
}

export class PositionRepository extends BaseFirestoreRepository<PositionRecord> implements PositionRepositoryPort {
  constructor() {
    super('positions');
  }

  public async savePosition(pos: PositionRecord): Promise<void> {
    const { id, ...data } = pos;
    return this.save(id, data);
  }

  public async getPosition(id: string): Promise<PositionRecord | null> {
    return this.getById(id);
  }

  public async getAllPositions(): Promise<PositionRecord[]> {
    return this.listAll();
  }
}

export const positionRepository = new PositionRepository();
