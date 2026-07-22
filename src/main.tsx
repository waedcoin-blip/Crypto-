import {StrictMode, useMemo, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

import { Buffer } from 'buffer';
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
    'connection to', 'failed', 'Unexpected server response: 429', 'Unexpected server response'
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
    'NO_ROUTES_FOUND', 'No liquidity', 'Unexpected server response', '429', 'ws error', 'WebSocket', 'websocket'
  ];
  if (benign.some(s => msg.includes(s) || msg.toLowerCase().includes(s.toLowerCase()))) {
    return;
  }
  originalConsoleWarn.apply(console, args);
};

// ─── 24H STABILITY: Global error handlers to prevent silent crashes ────────
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const msg = reason?.message || String(reason) || '';
  
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
  const msg = event.message || event.error?.message || String(event.error) || '';
  
  const benign = [
    'NO_ROUTES_FOUND', 'No liquidity', 'User rejected', 'WalletNotConnected',
    'Transaction not confirmed', 'SIMULATION_ERROR', 'AbortError', 'Unexpected server response', '429', 'ws error', 'WebSocket'
  ];
  if (benign.some(s => msg.includes(s) || msg.toLowerCase().includes(s.toLowerCase()))) {
    event.preventDefault();
    return;
  }

  console.error('[GLOBAL ERROR]:', event.error);
  // Prevent white screen of death on runtime errors
});

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter, SolflareWalletAdapter, TrustWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';

import { DEFAULT_HELIUS_RPC } from './constants/solana';

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
    let targetUrl = url.toString();
    
    // Normalize to handle trailing slashes or query arguments
    if (WS_URLS.length > 1) {
      const ws1 = WS_URLS[0].replace(/\/$/, '');
      const ws2 = WS_URLS[1].replace(/\/$/, '');
      
      if (targetUrl.startsWith(ws1) || targetUrl.startsWith(ws2)) {
        const selectedWs = WS_URLS[wsCounter % WS_URLS.length].replace(/\/$/, '');
        if (targetUrl.startsWith(ws1)) {
          targetUrl = targetUrl.replace(ws1, selectedWs);
        } else if (targetUrl.startsWith(ws2)) {
          targetUrl = targetUrl.replace(ws2, selectedWs);
        }
        wsCounter++;
      }
    }
    
    return protocols !== undefined
      ? new OriginalWebSocket(targetUrl, protocols)
      : new OriginalWebSocket(targetUrl);
  } as any;

  CustomWebSocket.prototype = OriginalWebSocket.prototype;
  CustomWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  CustomWebSocket.OPEN = OriginalWebSocket.OPEN;
  CustomWebSocket.CLOSING = OriginalWebSocket.CLOSING;
  CustomWebSocket.CLOSED = OriginalWebSocket.CLOSED;
  (window as any).WebSocket = CustomWebSocket;
}

// Override global fetch to intercept requests to RPC nodes
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  let url = '';
  if (typeof args[0] === 'string') {
    url = args[0];
  } else if (args[0] && typeof args[0] === 'object' && 'url' in (args[0] as any)) {
    url = (args[0] as Request).url;
  }

  // Load balancing logic for RPC URL
  if (RPC_URLS.length > 1 && url) {
    const rpc1 = RPC_URLS[0].replace(/\/$/, '');
    const rpc2 = RPC_URLS[1].replace(/\/$/, '');
    
    if (url.startsWith(rpc1) || url.startsWith(rpc2)) {
      const selectedRpc = RPC_URLS[rpcCounter % RPC_URLS.length].replace(/\/$/, '');
      rpcCounter++;
      let newUrl = url;
      if (url.startsWith(rpc1)) {
        newUrl = url.replace(rpc1, selectedRpc);
      } else if (url.startsWith(rpc2)) {
        newUrl = url.replace(rpc2, selectedRpc);
      }
      
      let newArgs = [...args] as any;
      if (typeof newArgs[0] === 'string') {
        newArgs[0] = newUrl;
      } else if (newArgs[0] && typeof newArgs[0] === 'object' && 'url' in newArgs[0]) {
        try {
          newArgs[0] = new Request(newUrl, newArgs[0] as any);
        } catch {
          newArgs[0] = newUrl;
        }
      }
      return originalFetch(newArgs[0], newArgs[1]);
    }
  }

  return originalFetch(args[0], args[1]);
};

function Root() {
  const network = WalletAdapterNetwork.Mainnet;
  const endpoint = HELIUS_RPC;
  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new TrustWalletAdapter(),
    new SolflareWalletAdapter(),
  ], []);

  useEffect(() => {
    startAlertManager();
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

import { ErrorBoundary } from './components/ErrorBoundary';
import { startAlertManager } from './engines';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
