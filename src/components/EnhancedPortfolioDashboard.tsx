/**
 * Enhanced Portfolio Dashboard Component
 *
 * Provides comprehensive portfolio visualization with:
 * - Real-time portfolio metrics
 * - Performance charts
 * - Risk analytics
 * - Trade history
 * - Advanced portfolio statistics
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  PieChart,
  Activity,
  Target,
  AlertTriangle,
  BarChart3,
  Clock,
  Award,
  Shield,
  RefreshCw,
  Download,
  Upload,
  RotateCcw,
  Eye,
  EyeOff
} from 'lucide-react';
import { useEnhancedPortfolio, PortfolioMetrics, RiskMetrics, TradeStatistics } from '../services/EnhancedPortfolioManager';

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number;
  icon: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  subtitle?: string;
  format?: 'currency' | 'percentage' | 'number';
}

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  change,
  icon,
  trend = 'neutral',
  subtitle,
  format = 'number'
}) => {
  const formatValue = (val: string | number) => {
    if (typeof val === 'string') return val;

    switch (format) {
      case 'currency':
        return `$${val.toFixed(2)}`;
      case 'percentage':
        return `${val.toFixed(2)}%`;
      default:
        return val.toLocaleString();
    }
  };

  const getTrendColor = () => {
    switch (trend) {
      case 'up': return 'text-green-400';
      case 'down': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getTrendIcon = () => {
    switch (trend) {
      case 'up': return <TrendingUp className="h-4 w-4" />;
      case 'down': return <TrendingDown className="h-4 w-4" />;
      default: return null;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl p-6 hover:bg-gray-800/70 transition-all duration-300"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-500/10 rounded-lg">
            {icon}
          </div>
          <div>
            <p className="text-sm text-gray-400">{title}</p>
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          </div>
        </div>
        {change !== undefined && (
          <div className={`flex items-center space-x-1 ${getTrendColor()}`}>
            {getTrendIcon()}
            <span className="text-sm font-medium">
              {change > 0 ? '+' : ''}{change.toFixed(2)}%
            </span>
          </div>
        )}
      </div>
      <div className="text-2xl font-bold text-white">
        {formatValue(value)}
      </div>
    </motion.div>
  );
};

interface PerformanceChartProps {
  data: Array<{ timestamp: number; totalValue: number; pnl: number }>;
}

const PerformanceChart: React.FC<PerformanceChartProps> = ({ data }) => {
  const [timeRange, setTimeRange] = useState<'1D' | '7D' | '30D' | 'ALL'>('7D');

  const filteredData = React.useMemo(() => {
    const now = Date.now();
    const ranges = {
      '1D': 24 * 60 * 60 * 1000,
      '7D': 7 * 24 * 60 * 60 * 1000,
      '30D': 30 * 24 * 60 * 60 * 1000,
      'ALL': Infinity
    };

    return data.filter(point => now - point.timestamp <= ranges[timeRange]);
  }, [data, timeRange]);

  const maxValue = Math.max(...filteredData.map(d => d.totalValue));
  const minValue = Math.min(...filteredData.map(d => d.totalValue));
  const range = maxValue - minValue;

  return (
    <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-white">Portfolio Performance</h3>
        <div className="flex space-x-2">
          {(['1D', '7D', '30D', 'ALL'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1 text-sm rounded-lg transition-all ${
                timeRange === range
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      <div className="relative h-64">
        {filteredData.length > 1 ? (
          <svg className="w-full h-full">
            <defs>
              <linearGradient id="performanceGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>

            {/* Area under curve */}
            <path
              d={`M 0 ${256 - ((filteredData[0].totalValue - minValue) / range) * 256} ${filteredData
                .map((point, index) => {
                  const x = (index / (filteredData.length - 1)) * 100;
                  const y = 256 - ((point.totalValue - minValue) / range) * 256;
                  return `L ${x}% ${y}`;
                })
                .join(' ')} L 100% 256 L 0 256 Z`}
              fill="url(#performanceGradient)"
            />

            {/* Main line */}
            <path
              d={`M 0 ${256 - ((filteredData[0].totalValue - minValue) / range) * 256} ${filteredData
                .map((point, index) => {
                  const x = (index / (filteredData.length - 1)) * 100;
                  const y = 256 - ((point.totalValue - minValue) / range) * 256;
                  return `L ${x}% ${y}`;
                })
                .join(' ')}`}
              stroke="#3b82f6"
              strokeWidth="2"
              fill="none"
            />

            {/* Data points */}
            {filteredData.map((point, index) => {
              const x = (index / (filteredData.length - 1)) * 100;
              const y = 256 - ((point.totalValue - minValue) / range) * 256;
              return (
                <circle
                  key={index}
                  cx={`${x}%`}
                  cy={y}
                  r="3"
                  fill="#3b82f6"
                  className="hover:r-5 transition-all cursor-pointer"
                >
                  <title>
                    ${point.totalValue.toFixed(2)} at {new Date(point.timestamp).toLocaleString()}
                  </title>
                </circle>
              );
            })}
          </svg>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Not enough data to display chart</p>
              <p className="text-sm">Start trading to see performance</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface PositionTableProps {
  positions: Array<{
    symbol: string;
    quantity: number;
    avgPrice: number;
    unrealizedPnL: number;
    realizedPnL: number;
  }>;
}

const PositionTable: React.FC<PositionTableProps> = ({ positions }) => {
  const [showAll, setShowAll] = useState(false);
  const displayPositions = showAll ? positions : positions.slice(0, 5);

  return (
    <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-white">Current Positions</h3>
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex items-center space-x-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          {showAll ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          <span>{showAll ? 'Show Less' : 'Show All'}</span>
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-xs text-gray-400 border-b border-gray-700">
              <th className="text-left py-2">Symbol</th>
              <th className="text-right py-2">Quantity</th>
              <th className="text-right py-2">Avg Price</th>
              <th className="text-right py-2">Unrealized P&L</th>
              <th className="text-right py-2">Realized P&L</th>
            </tr>
          </thead>
          <tbody>
            {displayPositions.map((position, index) => (
              <motion.tr
                key={position.symbol}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors"
              >
                <td className="py-3 font-medium text-white">
                  {position.symbol.slice(0, 8)}...
                </td>
                <td className="py-3 text-right text-gray-300">
                  {position.quantity.toFixed(4)}
                </td>
                <td className="py-3 text-right text-gray-300">
                  ${position.avgPrice.toFixed(6)}
                </td>
                <td className={`py-3 text-right font-medium ${
                  position.unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  ${position.unrealizedPnL.toFixed(4)}
                </td>
                <td className={`py-3 text-right font-medium ${
                  position.realizedPnL >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  ${position.realizedPnL.toFixed(4)}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>

        {positions.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <PieChart className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No positions yet</p>
            <p className="text-sm">Start trading to see positions</p>
          </div>
        )}
      </div>
    </div>
  );
};

export const EnhancedPortfolioDashboard: React.FC = () => {
  const {
    portfolio,
    metrics,
    riskMetrics,
    tradeStats,
    performanceHistory,
    updatePortfolio,
    resetPortfolio,
    exportData,
    importData,
    isLoading
  } = useEnhancedPortfolio();

  const [activeTab, setActiveTab] = useState<'overview' | 'positions' | 'performance' | 'risk' | 'trades'>('overview');

  useEffect(() => {
    updatePortfolio();
  }, [updatePortfolio]);

  const handleExport = () => {
    const data = exportData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portfolio_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = e.target?.result as string;
        if (importData(data)) {
          alert('Portfolio data imported successfully');
        } else {
          alert('Failed to import portfolio data');
        }
      };
      reader.readAsText(file);
    }
  };

  const positions = portfolio ? Array.from(portfolio.positions.values()).filter(pos => pos.quantity !== 0) : [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Enhanced Paper Trading Portfolio</h1>
            <p className="text-gray-400">Real-time portfolio management with advanced analytics</p>
          </div>

          <div className="flex items-center space-x-4">
            <button
              onClick={() => updatePortfolio()}
              disabled={isLoading}
              className="p-2 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 rounded-lg transition-all disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 text-blue-400 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={handleExport}
              className="p-2 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 rounded-lg transition-all"
            >
              <Download className="h-4 w-4 text-green-400" />
            </button>

            <label className="p-2 bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/30 rounded-lg transition-all cursor-pointer">
              <Upload className="h-4 w-4 text-yellow-400" />
              <input type="file" accept=".json" onChange={handleImport} className="hidden" />
            </label>

            <button
              onClick={() => resetPortfolio()}
              className="p-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg transition-all"
            >
              <RotateCcw className="h-4 w-4 text-red-400" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-1 mb-8 bg-gray-800/30 rounded-xl p-1">
          {[
            { key: 'overview', label: 'Overview', icon: <DollarSign className="h-4 w-4" /> },
            { key: 'positions', label: 'Positions', icon: <PieChart className="h-4 w-4" /> },
            { key: 'performance', label: 'Performance', icon: <Activity className="h-4 w-4" /> },
            { key: 'risk', label: 'Risk', icon: <Shield className="h-4 w-4" /> },
            { key: 'trades', label: 'Trades', icon: <Target className="h-4 w-4" /> },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-blue-500 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              {/* Main Metrics */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <MetricCard
                  title="Total Value"
                  value={metrics.totalValue}
                  format="currency"
                  icon={<DollarSign className="h-5 w-5 text-blue-400" />}
                  trend={metrics.totalPnL >= 0 ? 'up' : 'down'}
                  change={metrics.totalPnLPercent}
                />
                <MetricCard
                  title="Day P&L"
                  value={metrics.dayPnL}
                  format="currency"
                  icon={<TrendingUp className="h-5 w-5 text-green-400" />}
                  trend={metrics.dayPnL >= 0 ? 'up' : 'down'}
                  change={metrics.dayPnLPercent}
                />
                <MetricCard
                  title="Cash Balance"
                  value={metrics.cashBalance}
                  format="currency"
                  icon={<Activity className="h-5 w-5 text-yellow-400" />}
                  subtitle="Available to trade"
                />
                <MetricCard
                  title="Positions"
                  value={metrics.numberOfPositions}
                  icon={<PieChart className="h-5 w-5 text-purple-400" />}
                  subtitle="Active holdings"
                />
              </div>

              {/* Performance Chart */}
              <PerformanceChart data={performanceHistory} />

              {/* Positions Table */}
              <PositionTable positions={positions} />
            </motion.div>
          )}

          {activeTab === 'risk' && (
            <motion.div
              key="risk"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            >
              <MetricCard
                title="Portfolio Volatility"
                value={riskMetrics.portfolioVolatility * 100}
                format="percentage"
                icon={<AlertTriangle className="h-5 w-5 text-orange-400" />}
                subtitle="Annualized"
              />
              <MetricCard
                title="Sharpe Ratio"
                value={riskMetrics.sharpeRatio.toFixed(2)}
                icon={<Award className="h-5 w-5 text-gold-400" />}
                subtitle="Risk-adjusted return"
              />
              <MetricCard
                title="Max Drawdown"
                value={riskMetrics.maxDrawdown * 100}
                format="percentage"
                icon={<TrendingDown className="h-5 w-5 text-red-400" />}
                subtitle="Peak to trough"
              />
              <MetricCard
                title="Value at Risk"
                value={riskMetrics.valueAtRisk}
                format="currency"
                icon={<Shield className="h-5 w-5 text-blue-400" />}
                subtitle="95% confidence, 1-day"
              />
              <MetricCard
                title="Concentration Risk"
                value={riskMetrics.concentration.toFixed(3)}
                icon={<Target className="h-5 w-5 text-purple-400" />}
                subtitle="Herfindahl index"
              />
              <MetricCard
                title="Leverage Ratio"
                value={riskMetrics.leverageRatio.toFixed(2) + 'x'}
                icon={<BarChart3 className="h-5 w-5 text-indigo-400" />}
                subtitle="Portfolio leverage"
              />
            </motion.div>
          )}

          {activeTab === 'trades' && (
            <motion.div
              key="trades"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            >
              <MetricCard
                title="Win Rate"
                value={tradeStats.winRate}
                format="percentage"
                icon={<Target className="h-5 w-5 text-green-400" />}
                subtitle={`${tradeStats.winningTrades}W / ${tradeStats.losingTrades}L`}
              />
              <MetricCard
                title="Profit Factor"
                value={tradeStats.profitFactor.toFixed(2)}
                icon={<Award className="h-5 w-5 text-gold-400" />}
                subtitle="Gross profit / gross loss"
              />
              <MetricCard
                title="Avg Hold Time"
                value={`${tradeStats.avgHoldTime.toFixed(1)}h`}
                icon={<Clock className="h-5 w-5 text-blue-400" />}
                subtitle="Average position duration"
              />
              <MetricCard
                title="Avg Win"
                value={tradeStats.avgWinAmount}
                format="currency"
                icon={<TrendingUp className="h-5 w-5 text-green-400" />}
                subtitle="Per winning trade"
              />
              <MetricCard
                title="Avg Loss"
                value={tradeStats.avgLossAmount}
                format="currency"
                icon={<TrendingDown className="h-5 w-5 text-red-400" />}
                subtitle="Per losing trade"
              />
              <MetricCard
                title="Total Trades"
                value={tradeStats.totalTrades}
                icon={<Activity className="h-5 w-5 text-purple-400" />}
                subtitle="Completed trades"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};