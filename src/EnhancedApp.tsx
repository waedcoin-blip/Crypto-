/**
 * Enhanced Paper Trading App
 *
 * Main application component with integrated realistic paper trading functionality
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Settings,
  BarChart3,
  Target,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Info,
  Play,
  Pause,
  RotateCcw
} from 'lucide-react';
import { useTradeMode } from './context/TradeModeContext';
import { useEnhancedPortfolio } from './services/EnhancedPortfolioManager';
import { EnhancedPortfolioDashboard } from './components/EnhancedPortfolioDashboard';
import { realisticPaperTradingEngine, OrderRequest } from './services/RealisticPaperTradingEngine';
import { EnhancedPaperTradeExecutor } from './services/EnhancedPaperTradeExecutor';

// Trading interface component
interface TradingPanelProps {
  onTrade: (type: 'buy' | 'sell', symbol: string, amount: number) => Promise<void>;
  isTrading: boolean;
}

const TradingPanel: React.FC<TradingPanelProps> = ({ onTrade, isTrading }) => {
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [symbol, setSymbol] = useState('');
  const [amount, setAmount] = useState('');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [limitPrice, setLimitPrice] = useState('');

  const { portfolio } = useEnhancedPortfolio();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol || !amount) return;

    try {
      await onTrade(tradeType, symbol, parseFloat(amount));
      setAmount('');
    } catch (error) {
      console.error('Trade failed:', error);
    }
  };

  return (
    <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-white mb-6">Place Order</h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Trade Type Toggle */}
        <div className="flex rounded-lg bg-gray-700/50 p-1">
          <button
            type="button"
            onClick={() => setTradeType('buy')}
            className={`flex-1 py-2 px-4 text-sm font-medium rounded-md transition-all ${
              tradeType === 'buy'
                ? 'bg-green-500 text-white shadow-lg'
                : 'text-gray-300 hover:text-white'
            }`}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => setTradeType('sell')}
            className={`flex-1 py-2 px-4 text-sm font-medium rounded-md transition-all ${
              tradeType === 'sell'
                ? 'bg-red-500 text-white shadow-lg'
                : 'text-gray-300 hover:text-white'
            }`}
          >
            Sell
          </button>
        </div>

        {/* Order Type */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Order Type</label>
          <select
            value={orderType}
            onChange={(e) => setOrderType(e.target.value as 'market' | 'limit')}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="market">Market Order</option>
            <option value="limit">Limit Order</option>
          </select>
        </div>

        {/* Symbol Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Token Address</label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="Enter token mint address..."
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Amount ({tradeType === 'buy' ? 'SOL' : 'Tokens'})
          </label>
          <input
            type="number"
            step="0.0001"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={tradeType === 'buy' ? 'SOL amount' : 'Token amount'}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <div className="mt-1 text-xs text-gray-400">
            Available: {tradeType === 'buy'
              ? `${portfolio?.cash.toFixed(4) || '0.0000'} SOL`
              : `${portfolio?.positions.get(symbol)?.quantity.toFixed(4) || '0.0000'} tokens`
            }
          </div>
        </div>

        {/* Limit Price (for limit orders) */}
        {orderType === 'limit' && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Limit Price</label>
            <input
              type="number"
              step="0.000001"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder="Price per token"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isTrading || !symbol || !amount}
          className={`w-full py-3 px-4 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            tradeType === 'buy'
              ? 'bg-green-500 hover:bg-green-600 text-white'
              : 'bg-red-500 hover:bg-red-600 text-white'
          }`}
        >
          {isTrading ? (
            <div className="flex items-center justify-center space-x-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Processing...</span>
            </div>
          ) : (
            `${tradeType === 'buy' ? 'Buy' : 'Sell'} ${orderType === 'market' ? 'at Market' : 'with Limit'}`
          )}
        </button>
      </form>
    </div>
  );
};

// Market status component
const MarketStatus: React.FC = () => {
  const [isConnected, setIsConnected] = useState(true);
  const [latency, setLatency] = useState(0);

  useEffect(() => {
    // Simulate market connection status
    const interval = setInterval(() => {
      setLatency(Math.floor(Math.random() * 50) + 20);
      setIsConnected(Math.random() > 0.05); // 95% uptime
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-sm font-medium text-white">
            {isConnected ? 'Market Connected' : 'Market Disconnected'}
          </span>
        </div>

        {isConnected && (
          <div className="text-xs text-gray-400">
            Latency: {latency}ms
          </div>
        )}
      </div>

      {!isConnected && (
        <div className="mt-2 text-xs text-orange-400 flex items-center space-x-1">
          <AlertTriangle className="h-3 w-3" />
          <span>Orders may be delayed</span>
        </div>
      )}
    </div>
  );
};

// Main App Component
export function App() {
  const [currentPage, setCurrentPage] = useState<'dashboard' | 'trading'>('dashboard');
  const [isTrading, setIsTrading] = useState(false);
  const [notifications, setNotifications] = useState<Array<{
    id: string;
    type: 'success' | 'error' | 'info';
    message: string;
    timestamp: number;
  }>>([]);

  const { mode, setMode } = useTradeMode();
  const { updatePortfolio, resetPortfolio } = useEnhancedPortfolio();

  // Initialize enhanced paper trade executor
  const [paperExecutor] = useState(() => new EnhancedPaperTradeExecutor());

  const addNotification = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    const id = Date.now().toString();
    setNotifications(prev => [{
      id,
      type,
      message,
      timestamp: Date.now()
    }, ...prev.slice(0, 4)]); // Keep only last 5 notifications

    // Auto-remove after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  }, []);

  const handleTrade = useCallback(async (type: 'buy' | 'sell', symbol: string, amount: number) => {
    setIsTrading(true);

    try {
      const orderId = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const order: OrderRequest = {
        id: orderId,
        type: 'market',
        side: type,
        symbol,
        quantity: amount,
        walletId: 'default',
        timeInForce: 'IOC',
      };

      // Update market data with a simulated price
      const simulatedPrice = 0.01 + Math.random() * 0.1; // Random price between 0.01-0.11
      realisticPaperTradingEngine.updateMarketData(symbol, simulatedPrice);

      const result = await realisticPaperTradingEngine.submitOrder(order);

      if (result.success) {
        addNotification('success',
          `${type.toUpperCase()} order executed successfully for ${amount} ${type === 'buy' ? 'SOL' : 'tokens'}`
        );
        updatePortfolio();
      } else {
        addNotification('error', `Order failed: ${result.error}`);
      }
    } catch (error) {
      addNotification('error', `Trade execution failed: ${(error as Error).message}`);
    } finally {
      setIsTrading(false);
    }
  }, [addNotification, updatePortfolio]);

  // Force paper mode for realistic paper trading
  useEffect(() => {
    if (mode !== 'paper') {
      setMode('paper');
    }
  }, [mode, setMode]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Header */}
      <header className="bg-gray-800/30 backdrop-blur-sm border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h1 className="text-2xl font-bold text-white">Paper Trading Pro</h1>
              <div className="px-3 py-1 bg-blue-500/20 border border-blue-500/30 rounded-full">
                <span className="text-xs font-medium text-blue-300">PAPER MODE</span>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <MarketStatus />

              {/* Navigation */}
              <div className="flex space-x-1 bg-gray-700/50 rounded-lg p-1">
                <button
                  onClick={() => setCurrentPage('dashboard')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    currentPage === 'dashboard'
                      ? 'bg-blue-500 text-white shadow-lg'
                      : 'text-gray-300 hover:text-white hover:bg-gray-600/50'
                  }`}
                >
                  <BarChart3 className="h-4 w-4 inline mr-2" />
                  Dashboard
                </button>
                <button
                  onClick={() => setCurrentPage('trading')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    currentPage === 'trading'
                      ? 'bg-green-500 text-white shadow-lg'
                      : 'text-gray-300 hover:text-white hover:bg-gray-600/50'
                  }`}
                >
                  <Target className="h-4 w-4 inline mr-2" />
                  Trading
                </button>
              </div>

              {/* Reset Portfolio Button */}
              <button
                onClick={() => {
                  if (confirm('Reset portfolio to initial state? This will clear all positions and trading history.')) {
                    resetPortfolio();
                    addNotification('info', 'Portfolio reset to initial state');
                  }
                }}
                className="p-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg transition-all"
                title="Reset Portfolio"
              >
                <RotateCcw className="h-4 w-4 text-red-400" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Notifications */}
      <div className="fixed top-20 right-6 z-50 space-y-2">
        <AnimatePresence>
          {notifications.map((notification) => (
            <motion.div
              key={notification.id}
              initial={{ opacity: 0, x: 300 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 300 }}
              className={`max-w-sm p-4 rounded-lg shadow-lg backdrop-blur-sm border ${
                notification.type === 'success'
                  ? 'bg-green-500/20 border-green-500/30 text-green-100'
                  : notification.type === 'error'
                  ? 'bg-red-500/20 border-red-500/30 text-red-100'
                  : 'bg-blue-500/20 border-blue-500/30 text-blue-100'
              }`}
            >
              <div className="flex items-start space-x-3">
                {notification.type === 'success' && <CheckCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />}
                {notification.type === 'error' && <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />}
                {notification.type === 'info' && <Info className="h-5 w-5 mt-0.5 flex-shrink-0" />}
                <div className="flex-1">
                  <p className="text-sm font-medium">{notification.message}</p>
                  <p className="text-xs opacity-75 mt-1">
                    {new Date(notification.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        <AnimatePresence mode="wait">
          {currentPage === 'dashboard' ? (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <EnhancedPortfolioDashboard />
            </motion.div>
          ) : (
            <motion.div
              key="trading"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-6"
            >
              {/* Trading Panel */}
              <div className="lg:col-span-1">
                <TradingPanel onTrade={handleTrade} isTrading={isTrading} />
              </div>

              {/* Market Information and Charts */}
              <div className="lg:col-span-2 space-y-6">
                {/* Quick Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl p-4">
                    <div className="flex items-center space-x-2">
                      <Activity className="h-5 w-5 text-blue-400" />
                      <span className="text-sm font-medium text-gray-300">Active Orders</span>
                    </div>
                    <div className="mt-2 text-2xl font-bold text-white">0</div>
                  </div>

                  <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl p-4">
                    <div className="flex items-center space-x-2">
                      <TrendingUp className="h-5 w-5 text-green-400" />
                      <span className="text-sm font-medium text-gray-300">Today's P&L</span>
                    </div>
                    <div className="mt-2 text-2xl font-bold text-green-400">+$0.00</div>
                  </div>

                  <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl p-4">
                    <div className="flex items-center space-x-2">
                      <Target className="h-5 w-5 text-purple-400" />
                      <span className="text-sm font-medium text-gray-300">Win Rate</span>
                    </div>
                    <div className="mt-2 text-2xl font-bold text-white">0%</div>
                  </div>
                </div>

                {/* Trading Instructions */}
                <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl p-6">
                  <h3 className="text-lg font-semibold text-white mb-4">Realistic Paper Trading</h3>
                  <div className="space-y-3 text-sm text-gray-300">
                    <div className="flex items-start space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                      <span>Simulates real market conditions with slippage and fees</span>
                    </div>
                    <div className="flex items-start space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                      <span>Realistic execution delays and partial fills</span>
                    </div>
                    <div className="flex items-start space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                      <span>Advanced portfolio analytics and risk metrics</span>
                    </div>
                    <div className="flex items-start space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                      <span>Trade history and performance tracking</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

export default App;