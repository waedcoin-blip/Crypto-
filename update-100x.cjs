const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const replacement1 = `
            if (alphaProtocol === 'GEMS_100X') {
              const mc = m.marketCap || 0; 
              const vol = m.volume24h || 0; 
              const liq = m.liquidity || 0; 
              const isMcValid = mc >= 10000 && mc <= 350000; 
              const isVolValid = mc > 0 && (vol / mc >= 1.5); 
              const buySellRatio = (m.buyCount || 0) / (m.sellCount || 1); 
              return isMcValid && isVolValid && liq >= 5000 && buySellRatio >= 1.5 && (m.holderCount || 0) > 50 && (m.devWalletPercentage || 0) < 5 && m.isRugSafe;
            }`;

const exactMatch1 = `
            if (alphaProtocol === 'GEMS_100X') {
              return (m.marketCap || 0) < 10000000 && (m.buyCount || 0) >= 2 && m.isRugSafe && m.liquidityBurned;
            }`;

const replacement2 = `
                        if (alphaProtocol === 'GEMS_100X') {
                          const mc = m.marketCap || 0; 
                          const vol = m.volume24h || 0; 
                          const liq = m.liquidity || 0; 
                          const isMcValid = mc >= 10000 && mc <= 350000; 
                          const isVolValid = mc > 0 && (vol / mc >= 1.5); 
                          const buySellRatio = (m.buyCount || 0) / (m.sellCount || 1); 
                          return isMcValid && isVolValid && liq >= 5000 && buySellRatio >= 1.5 && (m.holderCount || 0) > 50 && (m.devWalletPercentage || 0) < 5 && m.isRugSafe;
                        }`;

const exactMatch2 = `
                        if (alphaProtocol === 'GEMS_100X') {
                          return (m.marketCap || 0) < 10000000 && (m.buyCount || 0) >= 1;
                        }`;

const replacement3 = `
                      if (alphaProtocol === 'GEMS_100X') {
                        const mc = m.marketCap || 0; 
                        const vol = m.volume24h || 0; 
                        const liq = m.liquidity || 0; 
                        const isMcValid = mc >= 10000 && mc <= 350000; 
                        const isVolValid = mc > 0 && (vol / mc >= 1.5); 
                        const buySellRatio = (m.buyCount || 0) / (m.sellCount || 1); 
                        return isMcValid && isVolValid && liq >= 5000 && buySellRatio >= 1.5 && (m.holderCount || 0) > 50 && (m.devWalletPercentage || 0) < 5 && m.isRugSafe;
                      }`;

const exactMatch3 = `
                      if (alphaProtocol === 'GEMS_100X') {
                        return (m.marketCap || 0) < 10000000 && (m.buyCount || 0) >= 1;
                      }`;

const replacement4 = `
                    if (alphaProtocol === 'GEMS_100X') {
                      const mc = m.marketCap || 0; 
                      const vol = m.volume24h || 0; 
                      const liq = m.liquidity || 0; 
                      const isMcValid = mc >= 10000 && mc <= 350000; 
                      const isVolValid = mc > 0 && (vol / mc >= 1.5); 
                      const buySellRatio = (m.buyCount || 0) / (m.sellCount || 1); 
                      return isMcValid && isVolValid && liq >= 5000 && buySellRatio >= 1.5 && (m.holderCount || 0) > 50 && (m.devWalletPercentage || 0) < 5 && m.isRugSafe;
                    }`;

const exactMatch4 = `
                    if (alphaProtocol === 'GEMS_100X') {
                      return (m.marketCap || 0) < 10000000 && (m.buyCount || 0) >= 1;
                    }`;

content = content.replace(exactMatch1, replacement1);
content = content.split(exactMatch2).join(replacement2);
content = content.split(exactMatch3).join(replacement3);
content = content.split(exactMatch4).join(replacement4);

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log("Done");
