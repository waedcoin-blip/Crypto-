import { eventBus } from './eventBus';
import { useAppStore } from '../store/appStore';

/**
 * Alert Manager Engine
 * Listens to various events and pushes telemetry alerts to the central store.
 */
export function startAlertManager() {
  eventBus.on('NEW_TOKEN', (payload) => {
    // Optionally alert on high profile tokens
  });

  eventBus.on('WHALE_BUY', (payload) => {
    useAppStore.getState().addTelemetryAlert({
      id: `whale-${Date.now()}-${Math.random()}`,
      token: payload.symbol,
      address: payload.tokenAddress,
      type: 'WHALE_BUY',
      message: `Legendary Buy: ${payload.amount.toLocaleString()} ${payload.symbol}`,
      timestamp: Date.now()
    });
  });

  eventBus.on('PUMPFUN_MIGRATION', (payload) => {
    useAppStore.getState().addTelemetryAlert({
      id: `migrated-${Date.now()}-${Math.random()}`,
      token: payload.symbol,
      address: payload.tokenAddress,
      type: 'MIGRATED',
      message: `X-RAY: 🚀 NEW MIGRATION DETECTED: ${payload.symbol}`,
      timestamp: Date.now()
    });
  });

  eventBus.on('VOLUME_SPIKE', (payload) => {
    useAppStore.getState().addTelemetryAlert({
      id: `spike-${Date.now()}-${Math.random()}`,
      token: payload.symbol,
      address: payload.tokenAddress,
      type: 'VOLUME_SPIKE',
      message: `X-RAY: Volume Spike detected on ${payload.symbol}`,
      timestamp: Date.now()
    });
  });
}
