import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error?: Error | null;
  errorInfo?: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  private unhandledRejectionHandler = (event: PromiseRejectionEvent) => {
    // Prevent unhandled promise rejections (e.g. network/RPC/WS 429 errors) from breaking the UI
    try {
      const reason = event?.reason;
      let msg = '';
      if (typeof reason === 'string') {
        msg = reason;
      } else if (reason?.message) {
        msg = String(reason.message);
      } else if (reason) {
        try {
          msg = JSON.stringify(reason);
        } catch {
          msg = String(reason);
        }
      }

      const benign = [
        'NO_ROUTES_FOUND', 'No liquidity', 'User rejected', 'WalletNotConnected',
        'Transaction not confirmed', 'SIMULATION_ERROR', 'AbortError', 'Unexpected server response', 
        '429', 'ws error', 'WebSocket', 'websocket', 'failed: WebSocket is closed',
        'connection to', 'failed', 'FetchError', 'RPC', 'TypeError', 'NetworkError', 'Failed to fetch', 'Load failed',
        'ResizeObserver', 'canceled'
      ];

      if (msg && benign.some(s => msg.toLowerCase().includes(s.toLowerCase()))) {
        if (typeof event?.preventDefault === 'function') {
          event.preventDefault(); // Silently handle benign async promise rejections
        }
      }
    } catch {
      // Ignore handler error
    }
  };

  private windowErrorHandler = (event: ErrorEvent) => {
    try {
      const msg = event?.message || String(event?.error?.message || '');
      const benign = [
        'ResizeObserver loop', 'Script error', 'Failed to fetch', 'WebSocket', 
        '429', 'Unexpected server response', 'NetworkError', 'Load failed'
      ];
      if (msg && benign.some(s => msg.toLowerCase().includes(s.toLowerCase()))) {
        if (typeof event?.preventDefault === 'function') {
          event.preventDefault();
        }
      }
    } catch {
      // Ignore
    }
  };

  public componentDidMount() {
    window.addEventListener('unhandledrejection', this.unhandledRejectionHandler);
    window.addEventListener('error', this.windowErrorHandler);
  }

  public componentWillUnmount() {
    window.removeEventListener('unhandledrejection', this.unhandledRejectionHandler);
    window.removeEventListener('error', this.windowErrorHandler);
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 p-6 flex flex-col items-center justify-center font-sans">
          <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 font-bold text-lg flex-shrink-0">
                ⚠️
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-100">Application Recovered from Error</h1>
                <p className="text-xs text-slate-400">An error occurred in the component tree, but was safely intercepted.</p>
              </div>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
              <p className="text-xs font-mono text-rose-400 overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
                {this.state.error?.message || this.state.error?.toString() || 'Unknown Error'}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <button 
                onClick={this.handleReset} 
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium text-xs transition-colors cursor-pointer"
              >
                Dismiss & Continue
              </button>
              <button 
                onClick={() => {
                  this.handleReset();
                  window.location.reload();
                }} 
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium text-xs transition-colors cursor-pointer"
              >
                Reload App
              </button>
              <button 
                onClick={() => {
                  try {
                    localStorage.clear();
                    sessionStorage.clear();
                  } catch (e) {
                    console.error('Failed to clear storage:', e);
                  }
                  this.handleReset();
                  window.location.reload();
                }} 
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg font-medium text-xs transition-colors cursor-pointer"
              >
                Reset Storage & Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;


