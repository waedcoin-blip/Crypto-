import mitt from 'mitt';
import { TokenMetric, TelemetryAlert } from '../types';

export type AppEvents = {
  // Scanner Events
  NEW_TOKEN: { tokenAddress: string, symbol: string, data: any };
  PUMPFUN_MIGRATION: { tokenAddress: string, symbol: string };
  VOLUME_SPIKE: { tokenAddress: string, symbol: string, volume: number };
  
  // Wallet Intelligence Events
  WHALE_BUY: { tokenAddress: string, symbol: string, amount: number, wallet: string };
  SMART_MONEY_DETECTED: { tokenAddress: string, wallet: string };
  
  // Risk & Metrics Events
  LIQUIDITY_WARNING: { tokenAddress: string, ratio: number };
  RUG_RISK_DETECTED: { tokenAddress: string, riskScore: number };
  
  // Alert Manager Events
  ALERT_TRIGGERED: TelemetryAlert;
};

export const eventBus = mitt<AppEvents>();

// For debugging
eventBus.on('*', (type, e) => {
  // console.log(`[EventBus] ${String(type)}`, e);
});
