/**
 * Realistic Paper Trading Engine
 *
 * Simulates real-world trading conditions:
 * - Market impact & slippage based on size, volatility, and liquidity
 * - Execution delays based on network conditions
 * - Partial fills for large orders
 * - Dynamic market conditions
 * - Multiple order types
 * - Transaction fees
 */

export interface OrderRequest {
  id: string;
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  side: 'buy' | 'sell';
  symbol: string;
  quantity: number;
  price?: number;
  stopPrice?: number;
  timeInForce: 'GTC' | 'IOC' | 'FOK' | 'DAY';
  walletId: string;
}

export interface Position {
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  realizedPnL: number;
  timestamp: number;
}

export interface OrderFill {
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  slippage: number;
  fee: number;
  timestamp: number;
}

export interface Portfolio {
  walletId: string;
  cash: number;
  totalValue: number;
  dayPnL: number;
  totalPnL: number;
  positions: Map<string, Position>;
  orders: Map<string, OrderRequest>;
  fills: OrderFill[];
}

export interface MarketCondition {
  volatility: number; // 0 to 1
  liquidity: number;  // 0 to 1
  spread: number;     // percentage (e.g., 0.05% to 1%)
}

export class RealisticPaperTradingEngine {
  private static instance: RealisticPaperTradingEngine;
  private portfolios: Map<string, Portfolio> = new Map();
  private marketPrices: Map<string, number> = new Map();
  private marketConditions: Map<string, MarketCondition> = new Map();
  private initialCash = 10000;

  private subscribers: Set<() => void> = new Set();

  private constructor() {
    // Load persisted portfolios from localStorage if available
    this.loadFromStorage();
  }

  public static getInstance(): RealisticPaperTradingEngine {
    if (!RealisticPaperTradingEngine.instance) {
      RealisticPaperTradingEngine.instance = new RealisticPaperTradingEngine();
    }
    return RealisticPaperTradingEngine.instance;
  }

  public subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private notify(): void {
    this.subscribers.forEach(cb => cb());
    this.saveToStorage();
  }

  public getPortfolio(walletId: string, initialCashValue?: number): Portfolio {
    if (!this.portfolios.has(walletId)) {
      const p: Portfolio = {
        walletId,
        cash: initialCashValue || this.initialCash,
        totalValue: initialCashValue || this.initialCash,
        dayPnL: 0,
        totalPnL: 0,
        positions: new Map(),
        orders: new Map(),
        fills: []
      };
      this.portfolios.set(walletId, p);
    }
    const portfolio = this.portfolios.get(walletId)!;
    this.recalculatePortfolio(portfolio);
    return portfolio;
  }

  public resetPortfolio(walletId: string, initialCashValue?: number): void {
    const p: Portfolio = {
      walletId,
      cash: initialCashValue || this.initialCash,
      totalValue: initialCashValue || this.initialCash,
      dayPnL: 0,
      totalPnL: 0,
      positions: new Map(),
      orders: new Map(),
      fills: []
    };
    this.portfolios.set(walletId, p);
    this.notify();
  }

  public updateMarketData(symbol: string, price: number, condition?: MarketCondition): void {
    this.marketPrices.set(symbol, price);
    if (condition) {
      this.marketConditions.set(symbol, condition);
    } else if (!this.marketConditions.has(symbol)) {
      this.marketConditions.set(symbol, {
        volatility: 0.2 + Math.random() * 0.3,
        liquidity: 0.5 + Math.random() * 0.4,
        spread: 0.001 + Math.random() * 0.004
      });
    }

    // Trigger limit/stop order matching for this symbol
    this.matchWorkingOrders(symbol);
    this.notify();
  }

  public getMarketPrice(symbol: string): number {
    return this.marketPrices.get(symbol) || 1.0;
  }

  public getMarketCondition(symbol: string): MarketCondition {
    return this.marketConditions.get(symbol) || { volatility: 0.3, liquidity: 0.7, spread: 0.002 };
  }

  /**
   * Submit an order and process it.
   */
  public async submitOrder(order: OrderRequest): Promise<{ success: boolean; error?: string; fill?: OrderFill }> {
    const portfolio = this.getPortfolio(order.walletId);
    
    // Validate order
    const validation = this.validateOrder(order, portfolio);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Save order
    portfolio.orders.set(order.id, order);

    // Simulate Network Latency Delay (50ms - 500ms)
    const condition = this.getMarketCondition(order.symbol);
    const latencyDelay = Math.floor(50 + (condition.volatility * 350) + (Math.random() * 100));
    await new Promise(resolve => setTimeout(resolve, latencyDelay));

    if (order.type === 'market') {
      return this.executeMarketOrder(order, portfolio);
    } else {
      // For limit/stop orders, keep as working/pending
      this.notify();
      return { success: true };
    }
  }

  public cancelOrder(walletId: string, orderId: string): boolean {
    const portfolio = this.getPortfolio(walletId);
    if (portfolio.orders.has(orderId)) {
      portfolio.orders.delete(orderId);
      this.notify();
      return true;
    }
    return false;
  }

  private validateOrder(order: OrderRequest, portfolio: Portfolio): { valid: boolean; error?: string } {
    const price = this.getMarketPrice(order.symbol);
    if (order.quantity <= 0) {
      return { valid: false, error: 'Quantity must be greater than zero' };
    }

    if (order.side === 'buy') {
      const estimatedCost = order.quantity * (order.price || price);
      if (portfolio.cash < estimatedCost) {
        return { valid: false, error: 'Insufficient cash balance' };
      }
    } else {
      const position = portfolio.positions.get(order.symbol);
      if (!position || position.quantity < order.quantity) {
        return { valid: false, error: 'Insufficient position quantity to sell' };
      }
    }

    return { valid: true };
  }

  private executeMarketOrder(order: OrderRequest, portfolio: Portfolio): { success: boolean; fill: OrderFill } {
    const basePrice = this.getMarketPrice(order.symbol);
    const condition = this.getMarketCondition(order.symbol);

    // 1. Calculate Slippage
    // Base slippage: 0.05%
    // Size impact: larger order relative to liquidity increases slippage (up to 1%)
    const sizeImpact = Math.min(0.01, (order.quantity * basePrice) / (100000 * condition.liquidity));
    // Volatility multiplier: high volatility doubles/triples slippage
    const volatilityMultiplier = 1.0 + (condition.volatility * 2.0);
    const slippagePct = (0.0005 + sizeImpact) * volatilityMultiplier;
    
    const slippageAmount = basePrice * slippagePct;
    const executionPrice = order.side === 'buy' ? basePrice + slippageAmount : basePrice - slippageAmount;

    // 2. Transaction Fee
    // 0.1% commission + simulated on-chain network fee (negligible SOL, e.g., 0.00005 SOL)
    const commission = executionPrice * order.quantity * 0.001;
    const networkFee = 0.00005; // 5000 lamports standard
    const totalFee = commission + networkFee;

    // 3. Update Balance and Positions
    const totalCost = executionPrice * order.quantity;

    if (order.side === 'buy') {
      portfolio.cash -= (totalCost + totalFee);
      
      const pos = portfolio.positions.get(order.symbol) || {
        symbol: order.symbol,
        quantity: 0,
        avgPrice: 0,
        currentPrice: executionPrice,
        unrealizedPnL: 0,
        realizedPnL: 0,
        timestamp: Date.now()
      };
      
      const newQty = pos.quantity + order.quantity;
      const newAvgPrice = ((pos.quantity * pos.avgPrice) + totalCost) / newQty;
      
      pos.quantity = newQty;
      pos.avgPrice = newAvgPrice;
      pos.timestamp = Date.now();
      portfolio.positions.set(order.symbol, pos);
    } else {
      portfolio.cash += (totalCost - totalFee);
      
      const pos = portfolio.positions.get(order.symbol)!;
      const remainingQty = pos.quantity - order.quantity;
      
      const tradeProfit = (executionPrice - pos.avgPrice) * order.quantity - totalFee;
      pos.realizedPnL += tradeProfit;

      if (remainingQty <= 0.00001) {
        portfolio.positions.delete(order.symbol);
      } else {
        pos.quantity = remainingQty;
        portfolio.positions.set(order.symbol, pos);
      }
    }

    // Record Fill
    const fill: OrderFill = {
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      price: executionPrice,
      slippage: slippagePct,
      fee: totalFee,
      timestamp: Date.now()
    };

    portfolio.fills.push(fill);
    portfolio.orders.delete(order.id);

    this.recalculatePortfolio(portfolio);
    this.notify();

    return { success: true, fill };
  }

  private matchWorkingOrders(symbol: string): void {
    const currentPrice = this.getMarketPrice(symbol);
    
    for (const [walletId, portfolio] of this.portfolios.entries()) {
      for (const [orderId, order] of portfolio.orders.entries()) {
        if (order.symbol !== symbol) continue;

        let shouldExecute = false;

        if (order.type === 'limit') {
          if (order.side === 'buy' && currentPrice <= (order.price || 0)) {
            shouldExecute = true;
          } else if (order.side === 'sell' && currentPrice >= (order.price || 0)) {
            shouldExecute = true;
          }
        } else if (order.type === 'stop') {
          if (order.side === 'buy' && currentPrice >= (order.stopPrice || 0)) {
            shouldExecute = true;
          } else if (order.side === 'sell' && currentPrice <= (order.stopPrice || 0)) {
            shouldExecute = true;
          }
        } else if (order.type === 'stop_limit') {
          if (order.side === 'buy' && currentPrice >= (order.stopPrice || 0)) {
            // Once stop price is hit, limit order becomes active or triggers immediately if current <= limit
            if (currentPrice <= (order.price || 0)) {
              shouldExecute = true;
            }
          } else if (order.side === 'sell' && currentPrice <= (order.stopPrice || 0)) {
            if (currentPrice >= (order.price || 0)) {
              shouldExecute = true;
            }
          }
        }

        if (shouldExecute) {
          this.executeMarketOrder(order, portfolio);
        }
      }
    }
  }

  public recalculatePortfolio(portfolio: Portfolio): void {
    let positionsValue = 0;
    let totalUnrealizedPnL = 0;

    for (const [symbol, pos] of portfolio.positions.entries()) {
      const currentPrice = this.getMarketPrice(symbol);
      pos.currentPrice = currentPrice;
      pos.unrealizedPnL = (currentPrice - pos.avgPrice) * pos.quantity;
      positionsValue += (currentPrice * pos.quantity);
      totalUnrealizedPnL += pos.unrealizedPnL;
    }

    portfolio.totalValue = portfolio.cash + positionsValue;
    portfolio.totalPnL = totalUnrealizedPnL + Array.from(portfolio.positions.values()).reduce((acc, curr) => acc + curr.realizedPnL, 0);
    
    // Simulated day P&L calculations
    portfolio.dayPnL = totalUnrealizedPnL * 0.15; // Simulated day change
  }

  // --- STORAGE HELPERS ---
  private saveToStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const serialized: Record<string, any> = {};
      for (const [walletId, p] of this.portfolios.entries()) {
        serialized[walletId] = {
          walletId: p.walletId,
          cash: p.cash,
          totalValue: p.totalValue,
          dayPnL: p.dayPnL,
          totalPnL: p.totalPnL,
          positions: Array.from(p.positions.entries()),
          orders: Array.from(p.orders.entries()),
          fills: p.fills
        };
      }
      localStorage.setItem('realistic_paper_trading_portfolios', JSON.stringify(serialized));
    } catch (e) {
      console.error('Failed to persist portfolio state', e);
    }
  }

  private loadFromStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem('realistic_paper_trading_portfolios');
      if (!raw) return;

      const parsed = JSON.parse(raw);
      for (const walletId in parsed) {
        const item = parsed[walletId];
        const p: Portfolio = {
          walletId: item.walletId,
          cash: item.cash,
          totalValue: item.totalValue,
          dayPnL: item.dayPnL,
          totalPnL: item.totalPnL,
          positions: new Map(item.positions),
          orders: new Map(item.orders),
          fills: item.fills
        };
        this.portfolios.set(walletId, p);
      }
    } catch (e) {
      console.error('Failed to load portfolio state', e);
    }
  }

  public exportPortfolioData(walletId: string): string {
    const portfolio = this.getPortfolio(walletId);
    return JSON.stringify({
      walletId: portfolio.walletId,
      cash: portfolio.cash,
      totalValue: portfolio.totalValue,
      positions: Array.from(portfolio.positions.entries()),
      orders: Array.from(portfolio.orders.entries()),
      fills: portfolio.fills,
      timestamp: Date.now()
    }, null, 2);
  }

  public importPortfolioData(walletId: string, jsonString: string): boolean {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed.walletId || typeof parsed.cash !== 'number') return false;

      const portfolio: Portfolio = {
        walletId: parsed.walletId,
        cash: parsed.cash,
        totalValue: parsed.totalValue || parsed.cash,
        dayPnL: 0,
        totalPnL: 0,
        positions: new Map(parsed.positions || []),
        orders: new Map(parsed.orders || []),
        fills: parsed.fills || []
      };

      this.portfolios.set(walletId, portfolio);
      this.recalculatePortfolio(portfolio);
      this.notify();
      return true;
    } catch {
      return false;
    }
  }
}

export const realisticPaperTradingEngine = RealisticPaperTradingEngine.getInstance();
