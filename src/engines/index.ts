// src/engines/index.ts

// Re-export shared engines for frontend use
export {
  eventBus,
  validationEngine,
  highFrequencyBuyDetector,
  walletIntelligence,
  riskAnalyzer,
  scannerEngine,
  createTokenTelemetry,
  startAlertManager,
} from '../../shared/index.js';

// Export types
export type {
  TokenTelemetry,
  RouteConfig,
  TokenState,
  TradeEvent,
  RiskState,
} from '../../shared/index.js';

// Frontend-specific utilities
export { detectTokenStage } from '../utils/tokenStage.js';
export type { TokenStageInfo } from '../types/index.js';
