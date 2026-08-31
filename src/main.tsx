import {StrictMode, useMemo, useEffect} from 'react';
import { BrowserRouter } from 'react-router-dom';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

import { Buffer } from 'buffer';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter, SolflareWalletAdapter, TrustWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';

import { DEFAULT_HELIUS_RPC } from './constants/solana';
import { ErrorBoundary } from './components/ErrorBoundary';
import { startAlertManager } from './engines';
import { TradeManager, TradeMode } from './services/TradeManager';
import { TradeModeProvider } from './context/TradeModeContext';

window.Buffer = Buffer;

// ─── MONKEY-PATCH CONSOLE TO SUPPRESS BENIGN METRIC/WS LIMITS ──────────────
const originalConsoleError = console.error;
console.error = function (...args) {
  const msg = args.map(arg => {
    if (arg instanceof Error) {
      return arg.message + '\n' + arg.stack;
    }
    if (arg && typeof arg === 'object') {
      try { return JSON.stringify(arg); } catch (e) { return String(arg); }
    }
    return String(arg);
  }).join(' ');

  const benign = [
    'NO_ROUTES_FOUND', 'No liquidity', 'User rejected', 'WalletNotConnected',
    'Transaction not confirmed', 'SIMULATION_ERROR', 'AbortError', 'Unexpected server response', 
    '429', 'ws error', 'WebSocket', 'websocket', 'failed: WebSocket is closed',
    'connection to', 'failed', 'Unexpected server response: 429', 'Unexpected server response',
    'bigint: Failed to load bindings', 'Failed to load bindings'
  ];

  if (benign.some(s => msg.includes(s) || msg.toLowerCase().includes(s.toLowerCase()))) {
    // Suppress benign connection or rate limit noises
    return;
  }

  originalConsoleError.apply(console, args);
};

const originalConsoleWarn = console.warn;
console.warn = function (...args) {
  const msg = args.map(arg => String(arg)).join(' ');
  const benign = [
    'NO_ROUTES_FOUND', 'No liquidity', 'Unexpected server response', '429', 'ws error', 'WebSocket', 'websocket',
    'bigint: Failed to load bindings', 'Failed to load bindings'
  ];
  if (benign.some(s => msg.includes(s) || msg.toLowerCase().includes(s.toLowerCase()))) {
    return;
  }
  originalConsoleWarn.apply(console, args);
};

// ─── 24H STABILITY: Global error handlers to prevent silent crashes ────────
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  let msg = reason?.message || String(reason) || '';
  if (reason && typeof reason === 'object') { try { msg += ' ' + JSON.stringify(reason); } catch (e) {} }
  
  // Suppress known non-critical errors from crashing the app
  const benign = [
    'NO_ROUTES_FOUND', 'No liquidity', 'User rejected', 'WalletNotConnected',
    'Transaction not confirmed', 'SIMULATION_ERROR', 'AbortError', 'Unexpected server response', '429', 'ws error', 'WebSocket'
  ];
  if (benign.some(s => msg.includes(s) || msg.toLowerCase().includes(s.toLowerCase()))) {
    event.preventDefault();
    return;
  }
  
  console.error('[UNHANDLED REJECTION]:', reason);
  // Don't crash — keep the app alive for 24h operation
  event.preventDefault();
});

window.addEventListener('error', (event) => {
  let msg = event.message || event.error?.message || String(event.error) || '';
  if (event.error && typeof event.error === 'object') {
    try { msg += ' ' + JSON.stringify(event.error); } catch (e) {}
  }
  
  const benign = [
    'NO_ROUTES_FOUND', 'No liquidity', 'User rejected', 'WalletNotConnected',
    'Transaction not confirmed', 'SIMULATION_ERROR', 'AbortError', 'Unexpected server response', '429', 'ws error', 'WebSocket'
  ];
  if (benign.some(s => msg.includes(s) || msg.toLowerCase().includes(s.toLowerCase()))) {
    event.preventDefault();
    return;
  }

// Prevent white screen of death on runtime errors
});

// Using Helius RPC from App.tsx via environment or hardcoded fallback
const savedRpc = localStorage.getItem('juipter_auto_rpcUrl');
const savedRpc2 = localStorage.getItem('juipter_auto_rpcUrl2');
const savedWs = localStorage.getItem('juipter_auto_wsUrl');
const defaultRpc = DEFAULT_HELIUS_RPC;
const HELIUS_RPC = savedRpc || defaultRpc;
const HELIUS_RPC_2 = savedRpc2 || DEFAULT_HELIUS_RPC;

export const RPC_URLS = [HELIUS_RPC];
if (HELIUS_RPC_2 && HELIUS_RPC_2.trim() !== "") {
  RPC_URLS.push(HELIUS_RPC_2.trim());
}

let rpcCounter = 0;
let wsCounter = 0;
let masterCounter = 0;

export const WS_URLS = RPC_URLS.map((rpc, index) => {
  if (index === 0 && savedWs && savedWs.trim() !== "") {
    return savedWs.trim();
  }
  return rpc.replace('https://', 'wss://').replace('http://', 'ws://');
});

// Override global WebSocket to load balance websocket connections
const OriginalWebSocket = window.WebSocket;
if (OriginalWebSocket) {
  const CustomWebSocket = function (this: any, url: string | URL, protocols?: string | string[]) {
    let targetUrl = url ? url.toString() : '';
    
    // Check if WS belongs to Master Monitor
    const masterWs = (localStorage.getItem('master_monitor_ws') || '').trim().replace(/\/$/, '');
    if (masterWs && targetUrl.startsWith(masterWs)) {
      // Direct connection to Master Monitor WS - do NOT rewrite to execution WS pool
      const wsInst = (protocols !== undefined && protocols !== null)
        ? new OriginalWebSocket(targetUrl, protocols)
        : new OriginalWebSocket(targetUrl);
      wsInst.addEventListener('error', () => {});
      return wsInst;
    }

    // Normalize to handle trailing slashes or query arguments for execution WS
    if (WS_URLS.length > 1 && targetUrl) {
      const ws1 = WS_URLS[0].replace(/\/$/, '');
      const ws2 = WS_URLS[1].replace(/\/$/, '');
      
      if (ws1 && targetUrl.startsWith(ws1)) {
        const selectedWs = WS_URLS[wsCounter % WS_URLS.length].replace(/\/$/, '');
        targetUrl = targetUrl.replace(ws1, selectedWs);
        wsCounter++;
      } else if (ws2 && targetUrl.startsWith(ws2)) {
        const selectedWs = WS_URLS[wsCounter % WS_URLS.length].replace(/\/$/, '');
        targetUrl = targetUrl.replace(ws2, selectedWs);
        wsCounter++;
      }
    }
    
    const wsInstance = (protocols !== undefined && protocols !== null)
      ? new OriginalWebSocket(targetUrl, protocols)
      : new OriginalWebSocket(targetUrl);
      
    wsInstance.addEventListener('error', () => {
      // Catch & handle transient WebSocket rate-limit / connection handshake errors
    });
    
    return wsInstance;
  } as any;

  CustomWebSocket.prototype = OriginalWebSocket.prototype;
  CustomWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  CustomWebSocket.OPEN = OriginalWebSocket.OPEN;
  CustomWebSocket.CLOSING = OriginalWebSocket.CLOSING;
  CustomWebSocket.CLOSED = OriginalWebSocket.CLOSED;
  (window as any).WebSocket = CustomWebSocket;
}

import { getPrimaryRpc } from './services/rpcRouting';

export function getExecutionRpc(): string {
  const rpc = getPrimaryRpc('execution');

  if (!rpc) {
    throw new Error('EXECUTION_RPC_UNAVAILABLE');
  }

  return rpc;
}

export function getMonitorRpc(): string {
  const rpc = getPrimaryRpc('monitor');

  if (!rpc) {
    throw new Error('MONITOR_RPC_UNAVAILABLE');
  }

  return rpc;
}

export function getSearchRpc(): string {
  const rpc = getPrimaryRpc('search');

  if (!rpc) {
    throw new Error('SEARCH_RPC_UNAVAILABLE');
  }

  return rpc;
}

function Root() {
  const network = WalletAdapterNetwork.Mainnet;
  const endpoint = HELIUS_RPC;
  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new TrustWalletAdapter(),
    new SolflareWalletAdapter(),
  ], []);

  const tradeManager = useMemo(() => new TradeManager({
    mode: (localStorage.getItem('trade_mode') as TradeMode) || 'paper',
    realConfig: {},
  }), []);

  useEffect(() => {
    startAlertManager();
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <TradeModeProvider manager={tradeManager}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </TradeModeProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
