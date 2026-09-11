// server/repositories/CriteriaRepository.ts
import { JsonStore } from './JsonStore.js';
import { CriteriaConfig, DEFAULT_CRITERIA } from '../services/criteriaService.js';

interface CriteriaState {
  activeCriteria: CriteriaConfig;
  presets: Record<string, Partial<CriteriaConfig>>;
  updatedAt: string;
}

/**
 * CriteriaRepository: Authoritative persistence layer for trading criteria.
 * Supports active criteria, presets, and user-scoped criteria via Firestore.
 */
export class CriteriaRepository {
  private static instance: CriteriaRepository;
  private store: JsonStore<CriteriaState>;

  private constructor() {
    this.store = new JsonStore<CriteriaState>('criteria.json', {
      activeCriteria: { ...DEFAULT_CRITERIA },
      presets: {},
      updatedAt: new Date().toISOString(),
    });
  }

  public static getInstance(): CriteriaRepository {
    if (!CriteriaRepository.instance) {
      CriteriaRepository.instance = new CriteriaRepository();
    }
    return CriteriaRepository.instance;
  }

  /**
   * Get active criteria (async version for Firestore sync).
   */
  public async getActiveCriteria(): Promise<CriteriaConfig> {
    return this.getActiveCriteriaSync();
  }

  /**
   * Get active criteria (synchronous version for hot paths).
   */
  public getActiveCriteriaSync(): CriteriaConfig {
    const state = this.store.read();
    return { ...DEFAULT_CRITERIA, ...state.activeCriteria };
  }

  /**
   * Update active criteria.
   */
  public updateCriteria(patch: Partial<CriteriaConfig>): CriteriaConfig {
    const state = this.store.read();
    state.activeCriteria = { ...state.activeCriteria, ...patch };
    state.updatedAt = new Date().toISOString();
    this.store.write(state);
    return this.getActiveCriteriaSync();
  }

  /**
   * Reset to defaults.
   */
  public resetToDefaults(): CriteriaConfig {
    const state = this.store.read();
    state.activeCriteria = { ...DEFAULT_CRITERIA };
    state.updatedAt = new Date().toISOString();
    this.store.write(state);
    return this.getActiveCriteriaSync();
  }

  /**
   * Save a named preset.
   */
  public savePreset(name: string, criteria: Partial<CriteriaConfig>): void {
    const state = this.store.read();
    state.presets[name] = criteria;
    state.updatedAt = new Date().toISOString();
    this.store.write(state);
  }

  /**
   * Load a named preset.
   */
  public loadPreset(name: string): Partial<CriteriaConfig> | undefined {
    const state = this.store.read();
    return state.presets[name];
  }

  /**
   * Get all preset names.
   */
  public getPresetNames(): string[] {
    const state = this.store.read();
    return Object.keys(state.presets);
  }
}

export const criteriaRepository = CriteriaRepository.getInstance();
