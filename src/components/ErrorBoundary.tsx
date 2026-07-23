import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

export class ErrorBoundary extends React.Component<any, any> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    const msg = error?.message || String(error) || '';
    const benign = [
      'NO_ROUTES_FOUND', 'No liquidity', 'User rejected', 'WalletNotConnected',
      'Transaction not confirmed', 'SIMULATION_ERROR', 'AbortError', 'Unexpected server response', 
      '429', 'ws error', 'WebSocket', 'websocket', 'failed: WebSocket is closed',
      'connection to', 'failed', 'Unexpected server response: 429'
    ];
    if (benign.some(s => msg.includes(s) || msg.toLowerCase().includes(s.toLowerCase()))) {
      return { hasError: false };
    }
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const msg = error?.message || String(error) || '';
    const benign = [
      'NO_ROUTES_FOUND', 'No liquidity', 'User rejected', 'WalletNotConnected',
      'Transaction not confirmed', 'SIMULATION_ERROR', 'AbortError', 'Unexpected server response', 
      '429', 'ws error', 'WebSocket', 'websocket', 'failed: WebSocket is closed',
      'connection to', 'failed', 'Unexpected server response: 429'
    ];
    if (benign.some(s => msg.includes(s) || msg.toLowerCase().includes(s.toLowerCase()))) {
      return; // Ignore benign errors silently
    }
    this.setState({
      errorInfo
    });
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 p-6 flex flex-col items-center justify-center font-sans">
          <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <h1 className="text-xl font-bold text-red-400">Application Error Encountered</h1>
            <p className="text-sm text-slate-400">An uncaught exception occurred in a component. You can reload the app to recover.</p>
            <pre className="bg-slate-950 p-3 rounded-lg text-xs font-mono text-rose-300 overflow-x-auto max-h-40">{this.state.error?.toString()}</pre>
            <div className="flex gap-3 pt-2">
              <button 
                onClick={() => {
                  this.setState({ hasError: false, error: undefined, errorInfo: undefined });
                  window.location.reload();
                }} 
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium text-sm transition-colors cursor-pointer"
              >
                Reload Application
              </button>
              <button 
                onClick={() => {
                  try {
                    localStorage.clear();
                    sessionStorage.clear();
                  } catch (e) {
                    console.error('Failed to clear storage:', e);
                  }
                  this.setState({ hasError: false, error: undefined, errorInfo: undefined });
                  window.location.reload();
                }} 
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg font-medium text-sm transition-colors cursor-pointer"
              >
                Reset Cache & Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
