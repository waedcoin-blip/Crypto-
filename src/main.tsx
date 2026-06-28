import {StrictMode, useMemo, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

import { Buffer } from 'buffer';
window.Buffer = Buffer;

// ─── 24H STABILITY: Global error handlers to prevent silent crashes ────────
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const msg = reason?.message || String(reason) || '';
  
  // Suppress known non-critical errors from crashing the app
  const benign = [
    'NO_ROUTES_FOUND', 'No liquidity', 'User rejected', 'WalletNotConnected',
    'Transaction not confirmed', 'SIMULATION_ERROR', 'AbortError'
  ];
  if (benign.some(s => msg.includes(s))) {
    event.preventDefault();
    return;
  }
  
  console.error('[UNHANDLED REJECTION]:', reason);
  // Don't crash — keep the app alive for 24h operation
  event.preventDefault();
});

window.addEventListener('error', (event) => {
  console.error('[GLOBAL ERROR]:', event.error);
  // Prevent white screen of death on runtime errors
});

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter, SolflareWalletAdapter, TrustWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';

// Using Helius RPC from App.tsx via environment or hardcoded fallback
const savedRpc = localStorage.getItem('juipter_auto_rpcUrl');
const savedRpc2 = localStorage.getItem('juipter_auto_rpcUrl2');
const savedWs = localStorage.getItem('juipter_auto_wsUrl');
const defaultRpc = 'https://mainnet.helius-rpc.com/?api-key=e161791f-b336-40b9-80d6-f4c9f626833c';
const HELIUS_RPC = savedRpc || defaultRpc;
const HELIUS_RPC_2 = savedRpc2 || "https://mainnet.helius-rpc.com/?api-key=e161791f-b336-40b9-80d6-f4c9f626833c";

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
(window as any).WebSocket = class LoadBalancedWebSocket extends OriginalWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    let targetUrl = url.toString();
    
    // Normalize to handle trailing slashes or query arguments
    if (WS_URLS.length > 1) {
      const ws1 = WS_URLS[0].replace(/\/$/, '');
      const ws2 = WS_URLS[1].replace(/\/$/, '');
      
      if (targetUrl.startsWith(ws1) || targetUrl.startsWith(ws2)) {
        const selectedWs = WS_URLS[wsCounter % WS_URLS.length].replace(/\/$/, '');
        // Replace the matched base with the selected base
        if (targetUrl.startsWith(ws1)) {
           targetUrl = targetUrl.replace(ws1, selectedWs);
        } else if (targetUrl.startsWith(ws2)) {
           targetUrl = targetUrl.replace(ws2, selectedWs);
        }
        wsCounter++;
      }
    }
    
    super(targetUrl, protocols);
  }
};

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
      // Fire requests to all RPCs simultaneously and return the fastest valid response (Promise.any)
      return Promise.any(
        RPC_URLS.map(async (rpcUrl) => {
          const selectedRpc = rpcUrl.replace(/\/$/, '');
          let newUrl = url;
          if (url.startsWith(rpc1)) {
             newUrl = url.replace(rpc1, selectedRpc);
          } else if (url.startsWith(rpc2)) {
             newUrl = url.replace(rpc2, selectedRpc);
          }
          
          let newArgs = [...args] as any;
          if (typeof newArgs[0] === 'string') {
            newArgs[0] = newUrl;
          } else {
            // Re-create request for the new URL if it was a Request object
            newArgs[0] = new Request(newUrl, newArgs[0] as any);
          }
          
          const res = await originalFetch(newArgs[0], newArgs[1]);
          if (!res.ok) {
            throw new Error(`RPC returned ${res.status}`);
          }
          return res;
        })
      ).catch(e => {
        // Fallback to original if all parallel requests fail
        return originalFetch(args[0], args[1]);
      });
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
