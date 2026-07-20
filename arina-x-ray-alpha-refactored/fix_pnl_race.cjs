const fs = require('fs');
const file = 'src/components/pages/PnLPage.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
`      // MONITORING LOOP 2: ENTRIES
      if (isRunning) {
         const metrics = tokenMetricsRef.current;
         const activeMints = Object.keys(positionsRef.current).filter(k => isValidPosition(positionsRef.current[k]));`,
`      // MONITORING LOOP 2: ENTRIES
      if (isRunning) {
         const metrics = tokenMetricsRef.current;
         const activeMints = Object.keys(positionsRef.current).filter(k => isValidPosition(positionsRef.current[k]));
         let currentActiveCountLoop = activeMints.length;`
);

code = code.replace(
`         for (const [mint, metric] of Object.entries(metrics)) {
            if (maxPositions > 0 && activeMints.length >= maxPositions) break;`,
`         for (const [mint, metric] of Object.entries(metrics)) {
            if (maxPositions > 0 && currentActiveCountLoop >= maxPositions) break;`
);

code = code.replace(
`             if (verifyHardenedScannerCriteria(metricsObj, activeMints.length, maxPositions, configRef.current)) {`,
`             if (verifyHardenedScannerCriteria(metricsObj, currentActiveCountLoop, maxPositions, configRef.current)) {`
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
