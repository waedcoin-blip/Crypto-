const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const filterLogic = `                        const saved = savedGems[m.address];
                        if (saved) {
                          const currentPrice = m.priceUsd || (m.marketCap && m.supply ? m.marketCap / m.supply : 0);
                          const gain = (saved.priceAtSave > 0 && currentPrice > 0) ? ((currentPrice / saved.priceAtSave) - 1) * 100 : 0;
                          if (gain < 0) return false; // Filter out tracked but underperforming tokens
                        }`;

// We have desktop render and mobile render. Let's find exactly the base filter logic to inject into.
// Desktop:
//                      .filter(m => {
//                        const buy30s = (m.recentBuysTimeline || []).filter(t => Date.now() - t.t < 30000).length;
//                        
//                        if (alphaProtocol === 'GEMS_100X') {

content = content.replace(/(const buy30s = \(m\.recentBuysTimeline \|\| \[\]\)\.filter\(t => Date\.now\(\) - t\.t < 30000\)\.length;\s*)(if \(alphaProtocol === 'GEMS_100X'\) {)/g, "$1\n" + filterLogic + "\n$2");

// Mobile and grid renders:
//                  .filter(m => {
//                    const buy30s = (m.recentBuysTimeline || []).filter(t => Date.now() - t.t < 30000).length;
//                    
//                    if (alphaProtocol === 'GEMS_100X') {
const filterLogicMobile = `                    const saved = savedGems[m.address];
                    if (saved) {
                      const currentPrice = m.priceUsd || (m.marketCap && m.supply ? m.marketCap / m.supply : 0);
                      const gain = (saved.priceAtSave > 0 && currentPrice > 0) ? ((currentPrice / saved.priceAtSave) - 1) * 100 : 0;
                      if (gain < 0) return false; // Filter out tracked but underperforming tokens
                    }`;

content = content.replace(/(const buy30s = \(m\.recentBuysTimeline \|\| \[\]\)\.filter\(t => Date\.now\(\) - t\.t < 30000\)\.length;\s*)(if \(alphaProtocol === 'GEMS_100X'\) {)/g, "$1\n" + filterLogicMobile + "\n$2");

// Since the regex could apply to both, let's use a simpler string replace.
// Actually regex with replace all `//g` applied to entire file is fine since we just inject the checks.

// Adjust criteria to avoid underperforming tokens
content = content.replace(/const hasHolders = \(m\.holderCount \|\| 0\) > 300;/g, "const hasHolders = (m.holderCount || 0) > 400; // stricter holders");
content = content.replace(/const isLiqValid = liq >= 10000 && liq <= 30000;/g, "const isLiqValid = liq >= 15000; // Stronger liquidity floor");
content = content.replace(/const safeDev = \(m\.devWalletPercentage \|\| 0\) < 5;/g, "const safeDev = (m.devWalletPercentage || 0) <= 2; // Strict dev limits");
content = content.replace(/buySellRatio >= 1\.5/g, "buySellRatio >= 2.0");

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Update applied');
