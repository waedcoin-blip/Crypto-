const fs = require('fs');
const file = 'src/components/pages/PnLPage.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
`         for (const [mint, metric] of scannerTokens.slice(0, 3) as [string, any][]) {
            if (maxPositions > 0 && activeMints.length >= maxPositions) break;`,
`         for (const [mint, metric] of scannerTokens.slice(0, 3) as [string, any][]) {
            if (maxPositions > 0 && currentActiveCountLoop >= maxPositions) break;`
);

code = code.replace(
`             await executeBuy(mint, metric.symbol || 'Unknown', metric.priceNative || metric.priceUsd, tradeAmount);
         }
      }`,
`             await executeBuy(mint, metric.symbol || 'Unknown', metric.priceNative || metric.priceUsd, tradeAmount);
             currentActiveCountLoop++;
         }
      }`
);

fs.writeFileSync(file, code);
