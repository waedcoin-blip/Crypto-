const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const target1 = `            if (alphaProtocol === 'GEMS_100X') {
              const mc = m.marketCap || 0; 
              const vol = m.volume24h || 0; 
              const liq = m.liquidity || 0; 
              const isMcValid = mc >= 10000 && mc <= 350000; 
              const isVolValid = mc > 0 && (vol / mc >= 1.5); 
              const buySellRatio = (m.buyCount || 0) / (m.sellCount || 1); 
              return isMcValid && isVolValid && liq >= 5000 && buySellRatio >= 1.5 && (m.holderCount || 0) > 50 && (m.devWalletPercentage || 0) < 5 && m.isRugSafe;
            }`;

const rep1 = `            if (alphaProtocol === 'GEMS_100X') {
              // 100X "Goldilocks Zone" Criteria based on Deep Analysis
              const mc = m.marketCap || 0; 
              const vol = m.volume24h || 0; 
              const liq = m.liquidity || 0; 
              
              // Market Cap: $50k - $100k
              const isMcValid = mc >= 50000 && mc <= 100000; 
              // Volume/MC Ratio: 2:1 or 3:1 (Velocity)
              const isVolValid = mc > 0 && (vol / mc >= 2); 
              // Initial Liquidity: $10k - $30k
              const isLiqValid = liq >= 10000 && liq <= 30000;
              // Buy/Sell Ratio: >= 1.5
              const buySellRatio = (m.buyCount || 0) / (m.sellCount || 1); 
              // Unique Holders: > 300
              const hasHolders = (m.holderCount || 0) > 300;
              // Dev Holding: < 5%
              const safeDev = (m.devWalletPercentage || 0) < 5;

              // Volumetric Velocity ($10k+ / min estimated via recent Buys)
              const buy30sVol = (m.recentBuysTimeline || []).filter(t => Date.now() - t.t < 30000).reduce((a, b) => a + b.a, 0);
              const hasVelocity = buy30sVol >= 5000; // $5k per 30s = $10k per min

              return isMcValid && isVolValid && isLiqValid && buySellRatio >= 1.5 && hasHolders && safeDev && m.isRugSafe && hasVelocity;
            }`;

content = content.replace(target1, rep1);

const target2 = `                        if (alphaProtocol === 'GEMS_100X') {
                          const mc = m.marketCap || 0; 
                          const vol = m.volume24h || 0; 
                          const liq = m.liquidity || 0; 
                          const isMcValid = mc >= 10000 && mc <= 350000; 
                          const isVolValid = mc > 0 && (vol / mc >= 1.5); 
                          const buySellRatio = (m.buyCount || 0) / (m.sellCount || 1); 
                          return isMcValid && isVolValid && liq >= 5000 && buySellRatio >= 1.5 && (m.holderCount || 0) > 50 && (m.devWalletPercentage || 0) < 5 && m.isRugSafe;
                        }`;

const rep2 = `                        if (alphaProtocol === 'GEMS_100X') {
                          const mc = m.marketCap || 0; 
                          const vol = m.volume24h || 0; 
                          const liq = m.liquidity || 0; 
                          const isMcValid = mc >= 50000 && mc <= 100000; 
                          const isVolValid = mc > 0 && (vol / mc >= 2); 
                          const isLiqValid = liq >= 10000 && liq <= 30000;
                          const buySellRatio = (m.buyCount || 0) / (m.sellCount || 1); 
                          const hasHolders = (m.holderCount || 0) > 300;
                          const safeDev = (m.devWalletPercentage || 0) < 5;
                          const buy30sVol = (m.recentBuysTimeline || []).filter(t => Date.now() - t.t < 30000).reduce((a, b) => a + b.a, 0);
                          const hasVelocity = buy30sVol >= 5000;
                          return isMcValid && isVolValid && isLiqValid && buySellRatio >= 1.5 && hasHolders && safeDev && m.isRugSafe && hasVelocity;
                        }`;

content = content.replace(target2, rep2);

const target3 = `                      if (alphaProtocol === 'GEMS_100X') {
                        const mc = m.marketCap || 0; 
                        const vol = m.volume24h || 0; 
                        const liq = m.liquidity || 0; 
                        const isMcValid = mc >= 10000 && mc <= 350000; 
                        const isVolValid = mc > 0 && (vol / mc >= 1.5); 
                        const buySellRatio = (m.buyCount || 0) / (m.sellCount || 1); 
                        return isMcValid && isVolValid && liq >= 5000 && buySellRatio >= 1.5 && (m.holderCount || 0) > 50 && (m.devWalletPercentage || 0) < 5 && m.isRugSafe;
                      }`;

const rep3 = `                      if (alphaProtocol === 'GEMS_100X') {
                        const mc = m.marketCap || 0; 
                        const vol = m.volume24h || 0; 
                        const liq = m.liquidity || 0; 
                        const isMcValid = mc >= 50000 && mc <= 100000; 
                        const isVolValid = mc > 0 && (vol / mc >= 2); 
                        const isLiqValid = liq >= 10000 && liq <= 30000;
                        const buySellRatio = (m.buyCount || 0) / (m.sellCount || 1); 
                        const hasHolders = (m.holderCount || 0) > 300;
                        const safeDev = (m.devWalletPercentage || 0) < 5;
                        const buy30sVol = (m.recentBuysTimeline || []).filter(t => Date.now() - t.t < 30000).reduce((a, b) => a + b.a, 0);
                        const hasVelocity = buy30sVol >= 5000;
                        return isMcValid && isVolValid && isLiqValid && buySellRatio >= 1.5 && hasHolders && safeDev && m.isRugSafe && hasVelocity;
                      }`;

content = content.replace(target3, rep3);

const target4 = `                    if (alphaProtocol === 'GEMS_100X') {
                      const mc = m.marketCap || 0; 
                      const vol = m.volume24h || 0; 
                      const liq = m.liquidity || 0; 
                      const isMcValid = mc >= 10000 && mc <= 350000; 
                      const isVolValid = mc > 0 && (vol / mc >= 1.5); 
                      const buySellRatio = (m.buyCount || 0) / (m.sellCount || 1); 
                      return isMcValid && isVolValid && liq >= 5000 && buySellRatio >= 1.5 && (m.holderCount || 0) > 50 && (m.devWalletPercentage || 0) < 5 && m.isRugSafe;
                    }`;

const rep4 = `                    if (alphaProtocol === 'GEMS_100X') {
                      const mc = m.marketCap || 0; 
                      const vol = m.volume24h || 0; 
                      const liq = m.liquidity || 0; 
                      const isMcValid = mc >= 50000 && mc <= 100000; 
                      const isVolValid = mc > 0 && (vol / mc >= 2); 
                      const isLiqValid = liq >= 10000 && liq <= 30000;
                      const buySellRatio = (m.buyCount || 0) / (m.sellCount || 1); 
                      const hasHolders = (m.holderCount || 0) > 300;
                      const safeDev = (m.devWalletPercentage || 0) < 5;
                      const buy30sVol = (m.recentBuysTimeline || []).filter(t => Date.now() - t.t < 30000).reduce((a, b) => a + b.a, 0);
                      const hasVelocity = buy30sVol >= 5000;
                      return isMcValid && isVolValid && isLiqValid && buySellRatio >= 1.5 && hasHolders && safeDev && m.isRugSafe && hasVelocity;
                    }`;

content = content.replace(target4, rep4);

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Done');
